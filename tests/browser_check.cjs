/**
 * Desktop browser check. Needs system Chrome and puppeteer-core:
 *   NODE_PATH=/tmp/pptr/node_modules node tests/browser_check.cjs
 * Serves the repo itself; start nothing if http://127.0.0.1:8765 is already up.
 */
const fs = require("fs");
const puppeteer = require("puppeteer-core");

const URL = process.env.SUCHENG_URL || "http://127.0.0.1:8765/";

async function readChar(page) {
  return page.$eval("#target-char", (el) => el.textContent.trim());
}

async function compose(page, reading, character) {
  await page.focus("#answer");
  const midway = await page.evaluate((readingText) => {
    const el = document.querySelector("#answer");
    el.focus();
    el.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "" }));
    el.value = readingText;
    el.dispatchEvent(new CompositionEvent("compositionupdate", { bubbles: true, data: readingText }));
    el.dispatchEvent(new InputEvent("input", { bubbles: true, data: readingText, inputType: "insertCompositionText" }));
    const feedback = document.querySelector("#feedback");
    return feedback ? feedback.dataset.state : "";
  }, reading);
  if (midway === "correct" || midway === "wrong") {
    throw new Error("Composition reading was scored: " + midway);
  }
  await page.evaluate((text) => {
    const el = document.querySelector("#answer");
    el.value = text;
    el.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: text }));
    el.dispatchEvent(new InputEvent("input", { bubbles: true, data: text, inputType: "insertCompositionText" }));
  }, character);
  await page.waitForFunction(() => {
    const feedback = document.querySelector("#feedback");
    return feedback && (feedback.dataset.state === "correct" || feedback.dataset.state === "wrong");
  }, { timeout: 3000 });
}

async function answerCurrent(page) {
  const before = await readChar(page);
  await compose(page, "xx", before);
  const state = await page.$eval("#feedback", (el) => el.dataset.state);
  if (state !== "correct") throw new Error("Expected correct for " + before + ", got " + state);
  const banner = await page.$eval("#result-banner", (el) => el.textContent);
  if (!banner.includes("Space")) throw new Error("Success banner did not mention Space: " + banner);
  if (!banner.includes(before)) throw new Error("Success banner missing the character: " + banner);
  await page.keyboard.press("Enter");
  const afterEnter = await readChar(page);
  if (afterEnter !== before) throw new Error("Enter advanced after a correct answer");
  await page.keyboard.press("Space");
  await page.waitForFunction((prev) => {
    if (document.querySelector("#round-summary")) return true;
    const el = document.querySelector("#target-char");
    return Boolean(el && el.textContent.trim() !== prev);
  }, { timeout: 3000 }, before);
  return before;
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
  await page.waitForSelector("#answer");

  const chromeUi = await page.evaluate(() => ({
    candidates: Boolean(document.querySelector("#candidates, .candidates, .candidate, .slots, .slot-letter, #catcher")),
    shortcuts: document.querySelector(".shortcut-bar").innerText.replace(/\s+/g, " "),
    hint: document.querySelector(".hint-line").textContent,
  }));
  if (chromeUi.candidates) throw new Error("Candidate bar or code boxes are still in the page");
  if (!chromeUi.shortcuts.includes("Space") || !chromeUi.shortcuts.includes("下一題")) {
    throw new Error("Shortcuts were: " + chromeUi.shortcuts);
  }
  if (chromeUi.shortcuts.includes("揀字") || chromeUi.shortcuts.includes("翻頁")) {
    throw new Error("Old candidate shortcuts remain: " + chromeUi.shortcuts);
  }

  fs.mkdirSync("/tmp/shots", { recursive: true });
  fs.mkdirSync("/opt/cursor/artifacts", { recursive: true });
  await page.screenshot({ path: "/tmp/shots/practice_without_candidates.png" });
  fs.copyFileSync("/tmp/shots/practice_without_candidates.png", "/opt/cursor/artifacts/practice_without_candidates.png");

  const client = await page.createCDPSession();
  const manifest = await client.send("Page.getAppManifest");
  if (!manifest.data || manifest.errors.length) {
    throw new Error("Manifest problem: " + JSON.stringify(manifest.errors));
  }

  const first = await readChar(page);
  const composingSpace = await page.evaluate(() => {
    const event = new KeyboardEvent("keydown", { key: " ", code: "Space", bubbles: true, cancelable: true, isComposing: true });
    return document.dispatchEvent(event);
  });
  if (!composingSpace) throw new Error("Space was cancelled while composing");
  if ((await readChar(page)) !== first) throw new Error("Composing Space changed the question");

  await compose(page, "xx", first);
  const success = await page.$eval("#result-banner", (el) => el.textContent);
  const data = await page.evaluate(() => fetch("./data/characters.json").then((response) => response.json()));
  const byChar = new Map(data.characters.slice(0, data.practiceSize).map((entry) => [entry.char, entry]));
  const radicals = await page.evaluate(() => fetch("./data/radicals.json").then((response) => response.json()));
  const firstEntry = byChar.get(first);
  const radicalText = [...firstEntry.code.toLowerCase()].map((letter) => radicals.map[letter]).join("");
  if (!success.includes(firstEntry.code) || !success.includes(radicalText) || !success.includes("Space")) {
    throw new Error("Learning banner was: " + success);
  }
  await page.screenshot({ path: "/tmp/shots/practice_correct_space.png" });
  fs.copyFileSync("/tmp/shots/practice_correct_space.png", "/opt/cursor/artifacts/practice_correct_space.png");
  await page.keyboard.press("Space");
  await page.waitForFunction((prev) => document.querySelector("#target-char").textContent.trim() !== prev, {}, first);

  for (let index = 1; index < 50; index += 1) await answerCurrent(page);

  const summary = await page.$eval("#round-summary", (el) => el.innerText);
  if (!summary.includes("答對 50／50") || !summary.includes("準確率 100%") || !summary.includes("最長連勝 50")) {
    throw new Error("Summary was wrong:\n" + summary);
  }
  if (!summary.includes("Space")) throw new Error("Summary did not mention Space");
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("sucheng-practice-v1")));
  if (stored.today.correct !== 50 || stored.today.attempted !== 50 || stored.review.length !== 0) {
    throw new Error("Storage after a perfect round: " + JSON.stringify(stored));
  }
  if (stored.nextBlock !== 1) throw new Error("Expected next block 1, got " + stored.nextBlock);

  await page.keyboard.press("Space");
  await page.waitForSelector("#target-char");
  const band = await page.$eval(".band", (el) => el.textContent);
  if (!band.includes("51")) throw new Error("Space did not open the next group: " + band);

  await page.reload({ waitUntil: "networkidle0" });
  await page.waitForSelector("#target-char");
  const afterReload = await page.evaluate(() => JSON.parse(localStorage.getItem("sucheng-practice-v1")).today);
  if (afterReload.correct !== 50 || afterReload.attempted !== 50) {
    throw new Error("Today stats did not survive reload");
  }
  const sw = await page.evaluate(async () => {
    const ready = await navigator.serviceWorker.ready;
    const names = await caches.keys();
    return {
      scope: ready.scope,
      state: ready.active && ready.active.state,
      controller: Boolean(navigator.serviceWorker.controller),
      caches: names,
    };
  });
  if (!sw.controller || sw.state !== "activated") throw new Error("Service worker not controlling: " + JSON.stringify(sw));
  if (!sw.caches.includes("sucheng-static-v3")) throw new Error("Cache was not bumped: " + sw.caches.join(","));

  async function nextTwoLetter() {
    for (let guard = 0; guard < 12; guard += 1) {
      const ch = await readChar(page);
      const code = byChar.get(ch).code;
      if (code.length >= 2) return { ch, code };
      await compose(page, "ok", ch);
      await page.keyboard.press("Space");
      await page.waitForFunction((prev) => {
        const el = document.querySelector("#target-char");
        return el && el.textContent.trim() !== prev;
      }, {}, ch);
    }
    throw new Error("Could not find a two-letter character");
  }

  const target = await readChar(page);
  const wrongChar = target === "的" ? "一" : "的";
  await compose(page, "qq", wrongChar);
  const wrongText = await page.$eval(".retry", (el) => el.textContent.trim());
  if (wrongText !== "× 唔對，再試一次") throw new Error("Wrong message: " + wrongText);
  const reviewAfterMiss = await page.evaluate(() => JSON.parse(localStorage.getItem("sucheng-practice-v1")).review);
  if (!reviewAfterMiss.includes(target)) throw new Error("Miss was not added to review");
  if (await page.$("#candidates")) throw new Error("Wrong answer opened a candidate menu");

  await page.keyboard.press("Escape");
  const cleared = await page.$eval("#answer", (el) => el.value);
  if (cleared) throw new Error("Escape did not clear the input");
  await compose(page, "ok", target);
  const reviewAfterFix = await page.evaluate(() => JSON.parse(localStorage.getItem("sucheng-practice-v1")).review);
  if (reviewAfterFix.includes(target)) throw new Error("A corrected answer stayed in review");
  await page.keyboard.press("Space");
  await page.waitForFunction((prev) => document.querySelector("#target-char").textContent.trim() !== prev, {}, target);

  const hintedItem = await nextTwoLetter();
  const hinted = hintedItem.ch;
  const hintedCode = hintedItem.code;
  await page.keyboard.press("Tab");
  const hint = await page.$eval("#feedback", (el) => el.textContent.trim());
  if (!hint.includes("提示：頭碼係 " + hintedCode[0])) throw new Error("Hint was: " + hint);
  await compose(page, "ok", hinted);
  const hintedReview = await page.evaluate(() => JSON.parse(localStorage.getItem("sucheng-practice-v1")).review);
  if (hintedReview.includes(hinted)) throw new Error("A hint without the full answer was stored as a miss");
  await page.keyboard.press("Space");
  await page.waitForSelector("#target-char");

  const revealedItem = await nextTwoLetter();
  const revealed = revealedItem.ch;
  const revealedCode = revealedItem.code;
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  const answer = await page.$eval("#feedback", (el) => el.textContent.trim());
  if (!answer.includes("答案係 " + revealedCode) || !answer.includes("Space")) {
    throw new Error("Reveal was: " + answer);
  }
  await compose(page, "ok", revealed);
  const kept = await page.evaluate(() => JSON.parse(localStorage.getItem("sucheng-practice-v1")).review);
  if (!kept.includes(revealed)) throw new Error("Revealed character left the review list");
  const keptBanner = await page.$eval("#result-banner", (el) => el.textContent);
  if (!keptBanner.includes("留喺複習") || !keptBanner.includes("Space")) {
    throw new Error("Revealed success banner was: " + keptBanner);
  }
  await page.keyboard.press("Space");

  await page.click("[data-action='review']");
  await page.waitForFunction((char) => document.querySelector("#target-char").textContent.trim() === char, {}, revealed);
  await compose(page, "ok", revealed);
  const clearedEarly = await page.evaluate(() => JSON.parse(localStorage.getItem("sucheng-practice-v1")).review);
  if (clearedEarly.length !== 0) throw new Error("Review list was not cleared: " + clearedEarly.join(""));
  await page.keyboard.press("Space");
  await page.waitForSelector("#round-summary");
  const reviewSummary = await page.$eval("#round-summary", (el) => el.textContent);
  if (!reviewSummary.includes("複習清晒")) throw new Error("Review summary was: " + reviewSummary);

  await page.keyboard.press("?");
  await page.waitForSelector(".overlay:not([hidden])");
  const y = await page.$eval("[data-letter='y'] .key-radical", (el) => el.textContent);
  if (y !== "\u535c" || y === "\u30c8") throw new Error("Y radical is " + y);
  const z = await page.$eval("[data-letter='z'] .key-radical", (el) => el.textContent);
  const x = await page.$eval("[data-letter='x'] .key-radical", (el) => el.textContent);
  if (z !== "重" || x !== "難") throw new Error("Special keys were " + x + z);
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
  if (!byChar.has(offlineChar)) throw new Error("Offline page showed an unknown character");
  const offlineExtra = errors.slice(offlineErrorsBefore);

  if (errors.length) console.log("console/page errors:\n" + errors.join("\n"));
  const pageErrors = errors.filter((item) => item.startsWith("PAGE"));
  const onlineErrors = errors.slice(0, offlineErrorsBefore);
  if (pageErrors.length || onlineErrors.length) {
    throw new Error("Errors before offline:\n" + onlineErrors.concat(pageErrors).join("\n"));
  }
  console.log("ok", JSON.stringify({ sw, offlineChar, offlineConsole: offlineExtra }));
  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
