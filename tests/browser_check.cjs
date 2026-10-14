/**
 * Desktop browser check. Needs system Chrome and puppeteer-core:
 *   NODE_PATH=/tmp/pptr/node_modules node tests/browser_check.cjs
 * Serves the repo itself; start nothing if http://127.0.0.1:8765 is already up.
 */
const puppeteer = require("puppeteer-core");

const URL = process.env.SUCHENG_URL || "http://127.0.0.1:8765/";

async function readChar(page) {
  return page.$eval("#target-char", (el) => el.textContent.trim());
}

async function answerCurrent(page, codeByChar, { space = false } = {}) {
  const before = await readChar(page);
  const code = codeByChar.get(before);
  if (!code) throw new Error("No Sucheng code for " + before);
  for (const letter of code) {
    await page.keyboard.press(letter);
  }
  await page.waitForFunction((prev) => {
    if (document.querySelector("#round-summary")) return true;
    const el = document.querySelector("#target-char");
    const feedback = document.querySelector("#feedback");
    if (!el) return false;
    if (el.textContent.trim() !== prev) return true;
    return feedback && feedback.dataset.state === "correct";
  }, { timeout: 4000 }, before);

  const status = await page.evaluate((prev) => {
    if (document.querySelector("#round-summary")) return "summary";
    const el = document.querySelector("#target-char");
    if (el && el.textContent.trim() !== prev) return "next";
    return "pending";
  }, before);

  if (status === "pending") {
    if (space) await page.keyboard.press("Space");
    await page.waitForFunction((prev) => {
      if (document.querySelector("#round-summary")) return true;
      const el = document.querySelector("#target-char");
      return Boolean(el && el.textContent.trim() !== prev);
    }, { timeout: 3000 }, before);
  }
  return { char: before, code, length: code.length };
}

async function main() {
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME || "/usr/local/bin/google-chrome",
    headless: "new",
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (err) => errors.push("PAGE " + err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push("CONSOLE " + msg.text());
  });

  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await page.goto(URL, { waitUntil: "networkidle0" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle0" });
  await page.waitForSelector("#target-char");

  const data = await page.evaluate(() => fetch("./data/characters.json").then((r) => r.json()));
  const codeByChar = new Map(data.characters.slice(0, data.practiceSize).map((entry) => [entry.char, entry.code]));

  const client = await page.createCDPSession();
  const manifest = await client.send("Page.getAppManifest");
  if (!manifest.data || manifest.errors.length) {
    throw new Error("Manifest problem: " + JSON.stringify(manifest.errors));
  }

  let oneLetter = 0;
  for (let index = 0; index < 50; index += 1) {
    const result = await answerCurrent(page, codeByChar, { space: index === 0 });
    if (result.length === 1) oneLetter += 1;
  }
  if (oneLetter < 1) throw new Error("Expected a one-letter code in the first 50");

  const summary = await page.$eval("#round-summary", (el) => el.innerText);
  if (!summary.includes("答對 50／50") || !summary.includes("準確率 100%") || !summary.includes("最長連勝 50")) {
    throw new Error("Summary was wrong:\n" + summary);
  }
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("sucheng-practice-v1")));
  if (stored.today.correct !== 50 || stored.today.attempted !== 50 || stored.review.length !== 0) {
    throw new Error("Storage after a perfect round: " + JSON.stringify(stored));
  }
  if (stored.nextBlock !== 1) throw new Error("Expected next block 1, got " + stored.nextBlock);

  await page.reload({ waitUntil: "networkidle0" });
  await page.waitForSelector("#target-char");
  const afterReload = await page.evaluate(() => JSON.parse(localStorage.getItem("sucheng-practice-v1")).today);
  if (afterReload.correct !== 50 || afterReload.attempted !== 50) {
    throw new Error("Today stats did not survive reload");
  }
  const sw = await page.evaluate(async () => {
    const ready = await navigator.serviceWorker.ready;
    return {
      scope: ready.scope,
      state: ready.active && ready.active.state,
      controller: Boolean(navigator.serviceWorker.controller),
    };
  });
  if (!sw.controller || sw.state !== "activated") throw new Error("Service worker not controlling: " + JSON.stringify(sw));

  async function settleOnTwoLetter() {
    for (let guard = 0; guard < 8; guard += 1) {
      const ch = await readChar(page);
      const code = codeByChar.get(ch);
      if (code.length === 2) return { ch, code };
      await answerCurrent(page, codeByChar);
    }
    throw new Error("Could not find a two-letter character");
  }

  const first = await settleOnTwoLetter();
  await page.keyboard.press(first.code[0]);
  const typed = await page.$eval(".slot-letter", (el) => el.textContent.trim());
  const radical = await page.$eval(".slot-radical", (el) => el.textContent.trim());
  if (typed !== first.code[0]) throw new Error("First box was " + typed);
  const radicals = await page.evaluate(() => fetch("./data/radicals.json").then((r) => r.json()));
  if (radical !== radicals.map[first.code[0].toLowerCase()]) {
    throw new Error("Radical under " + first.code[0] + " was " + radical);
  }
  await page.keyboard.press("Escape");
  const cleared = await page.$eval(".slot-letter", (el) => el.textContent.trim());
  if (cleared) throw new Error("Escape did not clear");

  const wrongCode = first.code === "QQ" ? "WW" : "QQ";
  await page.keyboard.press(wrongCode[0]);
  await page.keyboard.press(wrongCode[1]);
  await page.waitForSelector("#feedback[data-state='wrong']");
  const wrongText = await page.$eval(".retry", (el) => el.textContent.trim());
  if (wrongText !== "× 唔對，再試一次") throw new Error("Wrong message: " + wrongText);
  const reviewAfterMiss = await page.evaluate(() => JSON.parse(localStorage.getItem("sucheng-practice-v1")).review);
  if (!reviewAfterMiss.includes(first.ch)) throw new Error("Miss was not added to review");

  for (const letter of first.code) await page.keyboard.press(letter);
  await page.waitForSelector("#feedback[data-state='correct']");
  const reviewAfterFix = await page.evaluate(() => JSON.parse(localStorage.getItem("sucheng-practice-v1")).review);
  if (reviewAfterFix.includes(first.ch)) throw new Error("A corrected answer stayed in review");
  await page.keyboard.press("Space");
  await page.waitForFunction((prev) => document.querySelector("#target-char").textContent.trim() !== prev, {}, first.ch);

  const revealed = await settleOnTwoLetter();
  await page.keyboard.press("Tab");
  const hint = await page.$eval("#feedback", (el) => el.textContent.trim());
  if (!hint.includes("提示：頭碼係 " + revealed.code[0])) throw new Error("Hint was: " + hint);
  await page.keyboard.press("Tab");
  const answer = await page.$eval("#feedback", (el) => el.textContent.trim());
  if (!answer.includes("答案係 " + revealed.code)) throw new Error("Reveal was: " + answer);
  for (const letter of revealed.code) await page.keyboard.press(letter);
  await page.waitForSelector("#feedback[data-state='correct']");
  const kept = await page.evaluate(() => JSON.parse(localStorage.getItem("sucheng-practice-v1")).review);
  if (!kept.includes(revealed.ch)) throw new Error("Revealed character left the review list");
  await page.keyboard.press("Space");
  await page.waitForFunction((prev) => {
    const el = document.querySelector("#target-char");
    return el && el.textContent.trim() !== prev;
  }, {}, revealed.ch);

  await page.click("[data-action='review']");
  await page.waitForFunction((char) => document.querySelector("#target-char").textContent.trim() === char, {}, revealed.ch);
  const reviewCode = codeByChar.get(revealed.ch);
  for (const letter of reviewCode) await page.keyboard.press(letter);
  await page.waitForFunction(() => {
    const summaryNode = document.querySelector("#round-summary");
    const feedback = document.querySelector("#feedback");
    return (summaryNode && summaryNode.textContent.includes("複習清晒")) || (feedback && feedback.dataset.state === "correct");
  });
  const reviewLeft = await page.evaluate(() => JSON.parse(localStorage.getItem("sucheng-practice-v1")).review);
  if (reviewLeft.length !== 0) throw new Error("Review list was not cleared: " + reviewLeft.join(""));

  await page.keyboard.press("?");
  await page.waitForSelector(".overlay:not([hidden])");
  const y = await page.$eval("[data-letter='y'] .key-radical", (el) => el.textContent);
  if (y !== "\u535c" || y === "\u30c8") throw new Error("Y radical is " + y);
  const z = await page.$eval("[data-letter='z'] .key-radical", (el) => el.textContent);
  const x = await page.$eval("[data-letter='x'] .key-radical", (el) => el.textContent);
  if (z !== "重" || x !== "難") throw new Error("Special keys were " + x + z);
  await page.screenshot({ path: "/tmp/shots/map.png" });
  await page.keyboard.press("Escape");
  await page.waitForSelector(".overlay[hidden]");

  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
  const narrow = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
  if (!narrow) throw new Error("Mobile layout overflows sideways");
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });

  await page.setOfflineMode(true);
  const offlineErrorsBefore = errors.length;
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("#target-char", { timeout: 5000 });
  const offlineChar = await readChar(page);
  if (!codeByChar.has(offlineChar)) throw new Error("Offline page showed an unknown character");
  const offlineExtra = errors.slice(offlineErrorsBefore);

  if (errors.length) {
    console.log("console/page errors:\n" + errors.join("\n"));
  }
  const pageErrors = errors.filter((item) => item.startsWith("PAGE"));
  const onlineErrors = errors.slice(0, offlineErrorsBefore);
  if (pageErrors.length || onlineErrors.length) {
    throw new Error("Errors before offline:\n" + onlineErrors.concat(pageErrors).join("\n"));
  }
  console.log("ok", JSON.stringify({ oneLetter, sw, offlineChar, offlineConsole: offlineExtra }));
  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
