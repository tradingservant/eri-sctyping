/**
 * Desktop browser check. Needs system Chrome and puppeteer-core:
 *   NODE_PATH=/tmp/pptr/node_modules node tests/browser_check.cjs
 * Serves the repo itself; start nothing if http://127.0.0.1:8765 is already up.
 */
const fs = require("fs");
const puppeteer = require("puppeteer-core");

const URL = process.env.SUCHENG_URL || "http://127.0.0.1:8765/";
const PAGE_SIZE = 9;

function indexByCode(characters) {
  const map = new Map();
  for (const entry of characters) {
    const codes = [entry.code].concat(entry.alts || []);
    for (const code of codes) {
      if (!map.has(code)) map.set(code, []);
      const list = map.get(code);
      if (!list.some((item) => item.char === entry.char)) list.push(entry);
    }
  }
  return map;
}

async function readChar(page) {
  return page.$eval("#target-char", (el) => el.textContent.trim());
}

async function pagerText(page) {
  return page.$eval(".candidate-pager", (el) => el.innerText.replace(/\s+/g, " "));
}

async function answerCurrent(page, byCode, codeByChar, options = {}) {
  const before = await readChar(page);
  const code = codeByChar.get(before);
  if (!code) throw new Error("No Sucheng code for " + before);
  const list = byCode.get(code) || [];
  const index = list.findIndex((item) => item.char === before);
  if (index < 0) throw new Error(before + " is missing from candidates for " + code);

  for (const letter of code) await page.keyboard.press(letter);
  await page.waitForSelector("#feedback[data-state='choosing']", { timeout: 4000 });
  const stillChoosing = await page.$eval("#feedback", (el) => el.dataset.state);
  if (stillChoosing !== "choosing") throw new Error("Typing the code completed the question");

  if (options.checkEnter) {
    await page.keyboard.press("Enter");
    const afterEnter = await page.evaluate(() => ({
      state: document.querySelector("#feedback").dataset.state,
      char: document.querySelector("#target-char").textContent.trim(),
    }));
    if (afterEnter.state !== "choosing" || afterEnter.char !== before) {
      throw new Error("Enter advanced while the candidate menu was open");
    }
  }

  const shown = await page.$$eval("#candidates .candidate-char", (els) => els.map((el) => el.textContent));
  const expected = list.slice(0, PAGE_SIZE).map((item) => item.char);
  if (shown.join("") !== expected.join("")) {
    throw new Error("Candidates for " + before + "/" + code + " were " + shown.join("") + " expected " + expected.join(""));
  }
  const outlined = await page.$eval(".candidate.active .candidate-char", (el) => el.textContent);
  if (outlined !== expected[0]) throw new Error("Outlined candidate was " + outlined);

  if (!options.pagingDone && list.length > PAGE_SIZE) {
    fs.mkdirSync("/tmp/shots", { recursive: true });
    fs.mkdirSync("/opt/cursor/artifacts", { recursive: true });
    await page.screenshot({ path: "/tmp/shots/candidate_menu.png" });
    fs.copyFileSync("/tmp/shots/candidate_menu.png", "/opt/cursor/artifacts/candidate_menu.png");
    await page.keyboard.press("=");
    const pageTwo = await pagerText(page);
    if (!pageTwo.includes("第 2／")) throw new Error("Equal did not page: " + pageTwo);
    const pageTwoChars = await page.$$eval("#candidates .candidate-char", (els) => els.map((el) => el.textContent));
    const pageTwoExpected = list.slice(PAGE_SIZE, PAGE_SIZE * 2).map((item) => item.char);
    if (pageTwoChars.join("") !== pageTwoExpected.join("")) {
      throw new Error("Page 2 candidates were " + pageTwoChars.join("") + " expected " + pageTwoExpected.join(""));
    }
    await page.screenshot({ path: "/tmp/shots/candidate_menu_page2.png" });
    fs.copyFileSync("/tmp/shots/candidate_menu_page2.png", "/opt/cursor/artifacts/candidate_menu_page2.png");
    await page.keyboard.press("-");
    await page.keyboard.press("ArrowRight");
    const arrowPage = await pagerText(page);
    if (!arrowPage.includes("第 2／")) throw new Error("ArrowRight did not page: " + arrowPage);
    await page.keyboard.press("PageUp");
    const back = await pagerText(page);
    if (!back.includes("第 1／")) throw new Error("PageUp did not return: " + back);
    await page.keyboard.press("PageDown");
    await page.keyboard.press("ArrowLeft");
    const home = await pagerText(page);
    if (!home.includes("第 1／")) throw new Error("Paging did not clamp home: " + home);
    await page.keyboard.press("PageUp");
    const clamped = await pagerText(page);
    if (!clamped.includes("第 1／")) throw new Error("PageUp wrapped: " + clamped);
    options.pagingDone = true;
  }

  const pageIndex = Math.floor(index / PAGE_SIZE);
  for (let step = 0; step < pageIndex; step += 1) await page.keyboard.press("PageDown");
  const offset = index % PAGE_SIZE;
  if (options.how === "click") {
    await page.click('#candidates button[data-offset="' + offset + '"]');
  } else if (options.how === "numpad") {
    await page.keyboard.press("Numpad" + (offset + 1));
  } else if (offset === 0) {
    await page.keyboard.press("Space");
  } else {
    await page.keyboard.press(String(offset + 1));
  }

  await page.waitForSelector("#feedback[data-state='correct']", { timeout: 4000 });
  if (options.checkSpace) {
    await page.keyboard.press("Space");
    const stayed = await readChar(page);
    if (stayed !== before) throw new Error("Space advanced after a correct answer");
    const state = await page.$eval("#feedback", (el) => el.dataset.state);
    if (state !== "correct") throw new Error("Space cleared a correct answer");
  }
  await page.keyboard.press("Enter");
  await page.waitForFunction((prev) => {
    if (document.querySelector("#round-summary")) return true;
    const el = document.querySelector("#target-char");
    return Boolean(el && el.textContent.trim() !== prev);
  }, { timeout: 3000 }, before);
  return { char: before, code, length: code.length, candidates: list.length };
}

async function pickCorrect(page, byCode, codeByChar) {
  const before = await readChar(page);
  const code = codeByChar.get(before);
  const list = byCode.get(code) || [];
  const index = list.findIndex((item) => item.char === before);
  if (index < 0) throw new Error("Cannot pick " + before);
  for (const letter of code) await page.keyboard.press(letter);
  await page.waitForSelector("#feedback[data-state='choosing']");
  const pageIndex = Math.floor(index / PAGE_SIZE);
  for (let step = 0; step < pageIndex; step += 1) await page.keyboard.press("PageDown");
  const offset = index % PAGE_SIZE;
  if (offset === 0) await page.keyboard.press("Space");
  else await page.keyboard.press(String(offset + 1));
  await page.waitForSelector("#feedback[data-state='correct']");
  return { char: before, code, list };
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

  const data = await page.evaluate(() => fetch("./data/characters.json").then((response) => response.json()));
  const codeByChar = new Map(data.characters.slice(0, data.practiceSize).map((entry) => [entry.char, entry.code]));
  const byCode = indexByCode(data.characters);

  const client = await page.createCDPSession();
  const manifest = await client.send("Page.getAppManifest");
  if (!manifest.data || manifest.errors.length) {
    throw new Error("Manifest problem: " + JSON.stringify(manifest.errors));
  }

  const paging = { pagingDone: false };
  let oneLetter = 0;
  let usedClick = false;
  let usedNumpad = false;
  let sawPager = false;
  for (let index = 0; index < 50; index += 1) {
    const preview = await readChar(page);
    const previewCode = codeByChar.get(preview);
    const previewList = byCode.get(previewCode) || [];
    let how = "keyboard";
    if (!usedClick && previewList.length > 1) {
      how = "click";
      usedClick = true;
    } else if (!usedNumpad && index > 0) {
      how = "numpad";
      usedNumpad = true;
    }
    const result = await answerCurrent(page, byCode, codeByChar, {
      how: how,
      checkEnter: index === 0,
      checkSpace: index === 0,
      pagingDone: paging.pagingDone,
    });
    if (result.candidates > PAGE_SIZE) {
      sawPager = true;
      paging.pagingDone = true;
    }
    if (result.length === 1) oneLetter += 1;
  }
  if (oneLetter < 1) throw new Error("Expected a one-letter code in the first 50");
  if (!sawPager || !paging.pagingDone) throw new Error("Expected a candidate list longer than one page");
  if (!usedClick) throw new Error("Did not click a candidate");

  const summary = await page.$eval("#round-summary", (el) => el.innerText);
  if (!summary.includes("答對 50／50") || !summary.includes("準確率 100%") || !summary.includes("最長連勝 50")) {
    throw new Error("Summary was wrong:\n" + summary);
  }
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("sucheng-practice-v1")));
  if (stored.today.correct !== 50 || stored.today.attempted !== 50 || stored.review.length !== 0) {
    throw new Error("Storage after a perfect round: " + JSON.stringify(stored));
  }
  if (stored.nextBlock !== 1) throw new Error("Expected next block 1, got " + stored.nextBlock);

  await page.keyboard.press("Enter");
  await page.waitForSelector("#target-char");
  const band = await page.$eval(".band", (el) => el.textContent);
  if (!band.includes("51")) throw new Error("Enter did not open the next group: " + band);

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
      script: ready.active && ready.active.scriptURL,
      caches: names,
    };
  });
  if (!sw.controller || sw.state !== "activated") throw new Error("Service worker not controlling: " + JSON.stringify(sw));
  if (!sw.caches.includes("sucheng-static-v2")) throw new Error("Cache was not bumped: " + sw.caches.join(","));

  async function settle(predicate, label) {
    for (let guard = 0; guard < 12; guard += 1) {
      const ch = await readChar(page);
      const code = codeByChar.get(ch);
      const list = byCode.get(code) || [];
      if (predicate(ch, code, list)) return { ch, code, list };
      await answerCurrent(page, byCode, codeByChar, { pagingDone: true });
    }
    throw new Error("Could not find " + label);
  }

  const first = await settle((ch, code, list) => code.length === 2 && list.length >= 2, "a shared two-letter code");
  for (const letter of first.code) await page.keyboard.press(letter);
  await page.waitForSelector("#candidates");
  const reviewBeforeCancel = await page.evaluate(() => JSON.parse(localStorage.getItem("sucheng-practice-v1")).review.slice());
  await page.keyboard.press("Escape");
  const cancelled = await page.evaluate(() => ({
    menu: Boolean(document.querySelector("#candidates")),
    state: document.querySelector("#feedback").dataset.state,
    typed: document.querySelector(".slot-letter").textContent.trim(),
  }));
  if (cancelled.menu || cancelled.state || cancelled.typed) {
    throw new Error("Escape did not close the menu: " + JSON.stringify(cancelled));
  }
  const reviewAfterCancel = await page.evaluate(() => JSON.parse(localStorage.getItem("sucheng-practice-v1")).review);
  if (reviewAfterCancel.join("") !== reviewBeforeCancel.join("")) {
    throw new Error("Closing the menu counted a miss");
  }

  await page.keyboard.press(first.code[0]);
  const typed = await page.$eval(".slot-letter", (el) => el.textContent.trim());
  const radical = await page.$eval(".slot-radical", (el) => el.textContent.trim());
  if (typed !== first.code[0]) throw new Error("First box was " + typed);
  const radicals = await page.evaluate(() => fetch("./data/radicals.json").then((response) => response.json()));
  if (radical !== radicals.map[first.code[0].toLowerCase()]) {
    throw new Error("Radical under " + first.code[0] + " was " + radical);
  }
  await page.keyboard.press("Enter");
  await page.waitForSelector("#feedback[data-state='wrong']");
  await page.keyboard.press("Escape");

  const wrongCode = first.code === "QQ" ? "WW" : "QQ";
  await page.keyboard.press(wrongCode[0]);
  await page.keyboard.press(wrongCode[1]);
  await page.waitForSelector("#feedback[data-state='wrong']");
  const wrongMenu = await page.$("#candidates");
  if (wrongMenu) throw new Error("A wrong code opened the candidate menu");
  const wrongText = await page.$eval(".retry", (el) => el.textContent.trim());
  if (wrongText !== "× 唔對，再試一次") throw new Error("Wrong message: " + wrongText);
  const reviewAfterMiss = await page.evaluate(() => JSON.parse(localStorage.getItem("sucheng-practice-v1")).review);
  if (!reviewAfterMiss.includes(first.ch)) throw new Error("Miss was not added to review");

  for (const letter of first.code) await page.keyboard.press(letter);
  await page.waitForSelector("#candidates");
  const targetIndex = first.list.findIndex((item) => item.char === first.ch);
  const wrongOffset = targetIndex % PAGE_SIZE === 0 ? 1 : 0;
  await page.keyboard.press(String(wrongOffset + 1));
  await page.waitForSelector("#feedback[data-state='wrong']");
  if (await page.$("#candidates")) throw new Error("Wrong candidate left the menu open");

  await pickCorrect(page, byCode, codeByChar);
  const reviewAfterFix = await page.evaluate(() => JSON.parse(localStorage.getItem("sucheng-practice-v1")).review);
  if (reviewAfterFix.includes(first.ch)) throw new Error("A corrected answer stayed in review");
  await page.keyboard.press("Enter");
  await page.waitForFunction((prev) => document.querySelector("#target-char").textContent.trim() !== prev, {}, first.ch);

  const hinted = await settle((ch, code) => code.length === 2, "a character for the hint");
  await page.keyboard.press("Tab");
  const hint = await page.$eval("#feedback", (el) => el.textContent.trim());
  if (!hint.includes("提示：頭碼係 " + hinted.code[0])) throw new Error("Hint was: " + hint);
  await pickCorrect(page, byCode, codeByChar);
  const hintedReview = await page.evaluate(() => JSON.parse(localStorage.getItem("sucheng-practice-v1")).review);
  if (hintedReview.includes(hinted.ch)) throw new Error("A hint without the answer was stored as a miss");
  await page.keyboard.press("Enter");
  await page.waitForSelector("#target-char");

  const revealed = await settle((ch, code) => code.length === 2, "a two-letter character");
  for (const letter of revealed.code) await page.keyboard.press(letter);
  await page.waitForSelector("#candidates");
  await page.keyboard.press("Tab");
  const during = await page.evaluate(() => ({
    menu: Boolean(document.querySelector("#candidates")),
    text: document.querySelector("#feedback").textContent.trim(),
  }));
  if (!during.menu || !during.text.includes("提示：頭碼係 " + revealed.code[0])) {
    throw new Error("Hint during the menu failed: " + JSON.stringify(during));
  }
  await page.keyboard.press("Tab");
  const answer = await page.evaluate(() => ({
    menu: Boolean(document.querySelector("#candidates")),
    text: document.querySelector("#feedback").textContent.trim(),
  }));
  if (answer.menu || !answer.text.includes("答案係 " + revealed.code) || !answer.text.includes("Enter")) {
    throw new Error("Reveal was: " + JSON.stringify(answer));
  }
  await pickCorrect(page, byCode, codeByChar);
  const kept = await page.evaluate(() => JSON.parse(localStorage.getItem("sucheng-practice-v1")).review);
  if (!kept.includes(revealed.ch)) throw new Error("Revealed character left the review list");
  await page.keyboard.press("Enter");
  await page.waitForFunction((prev) => {
    const el = document.querySelector("#target-char");
    return el && el.textContent.trim() !== prev;
  }, {}, revealed.ch);

  await page.click("[data-action='review']");
  await page.waitForFunction((char) => document.querySelector("#target-char").textContent.trim() === char, {}, revealed.ch);
  await pickCorrect(page, byCode, codeByChar);
  const clearedEarly = await page.evaluate(() => JSON.parse(localStorage.getItem("sucheng-practice-v1")).review);
  if (clearedEarly.length !== 0) throw new Error("Review list was not cleared: " + clearedEarly.join(""));
  await page.keyboard.press("Enter");
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
  fs.mkdirSync("/tmp/shots", { recursive: true });
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
  console.log("ok", JSON.stringify({ oneLetter, sw, offlineChar, offlineConsole: offlineExtra, usedClick, usedNumpad, sawPager }));
  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
