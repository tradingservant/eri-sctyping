"use strict";

const ROUND_SIZE = 50;
const ADVANCE_MS = 700;
const STORAGE_KEY = "sucheng-practice-v1";

const practiceEl = document.getElementById("practice");
const sideEl = document.getElementById("side");
const topStatsEl = document.getElementById("top-stats");
const overlayEl = document.getElementById("overlay");
const mapKeysEl = document.getElementById("map-keys");
const mapLegendEl = document.getElementById("map-legend");
const liveEl = document.getElementById("live");
const catcherEl = document.getElementById("catcher");

let pool = [];
let allByChar = new Map();
let radicalMap = {};
let radicalGroups = [];
let radicalRows = [];

let store = emptyStore();
let paused = null;
let ignoreInput = false;

const state = {
  kind: "practice",
  mode: "question",
  block: 0,
  round: [],
  index: 0,
  typed: "",
  outcome: null,
  counted: false,
  hintLevel: 0,
  revealed: false,
  notice: "",
  session: freshSession(),
  timer: null,
  pendingAdvance: false,
};

function emptyStore() {
  return {
    review: [],
    misses: {},
    today: { date: todayKey(), correct: 0, attempted: 0 },
    nextBlock: 0,
  };
}

function freshSession() {
  return { correct: 0, attempted: 0, streak: 0, best: 0, missed: [] };
}

function todayKey() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return now.getFullYear() + "-" + month + "-" + day;
}

function loadStore() {
  let next = emptyStore();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        next.review = Array.isArray(parsed.review)
          ? parsed.review.filter((item) => typeof item === "string" && [...item].length === 1)
          : [];
        next.misses = {};
        if (parsed.misses && typeof parsed.misses === "object") {
          for (const [char, count] of Object.entries(parsed.misses)) {
            const number = Number(count);
            if ([...char].length === 1 && number > 0) next.misses[char] = number;
          }
        }
        if (Number.isInteger(parsed.nextBlock) && parsed.nextBlock >= 0) {
          next.nextBlock = parsed.nextBlock;
        }
        if (parsed.today && parsed.today.date === todayKey()) {
          next.today = {
            date: todayKey(),
            correct: Number(parsed.today.correct) || 0,
            attempted: Number(parsed.today.attempted) || 0,
          };
        }
      }
    }
  } catch (error) {
    next = emptyStore();
  }
  return next;
}

function saveStore() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch (error) {
    /* Private mode can block storage. Practice still works for this visit. */
  }
}

function esc(text) {
  return String(text).replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[ch]);
}

function radicalsFor(code) {
  return [...String(code).toLowerCase()].map((letter) => radicalMap[letter] || "").join("");
}

function isCorrect(entry, typed) {
  const value = typed.toUpperCase();
  if (value === entry.code) return true;
  return Array.isArray(entry.alts) && entry.alts.includes(value);
}

function blockCount() {
  return Math.max(1, Math.ceil(pool.length / ROUND_SIZE));
}

function shuffle(list) {
  const copy = list.slice();
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    const hold = copy[index];
    copy[index] = copy[swap];
    copy[swap] = hold;
  }
  return copy;
}

function takeBlock(block) {
  const blocks = blockCount();
  const index = ((block % blocks) + blocks) % blocks;
  const start = index * ROUND_SIZE;
  const slice = pool.slice(start, start + ROUND_SIZE);
  if (slice.length < ROUND_SIZE) {
    for (const item of pool) {
      if (slice.length >= ROUND_SIZE) break;
      if (!slice.some((entry) => entry.char === item.char)) slice.push(item);
    }
  }
  return { index, round: shuffle(slice) };
}

function current() {
  if (state.mode !== "question") return null;
  return state.round[state.index] || null;
}

function resetCard() {
  state.typed = "";
  state.outcome = null;
  state.counted = false;
  state.hintLevel = 0;
  state.revealed = false;
  state.notice = "";
}

function clearTimer() {
  if (state.timer) {
    clearTimeout(state.timer);
    state.timer = null;
  }
}

function startPractice(block) {
  clearTimer();
  state.pendingAdvance = false;
  const taken = takeBlock(block);
  state.kind = "practice";
  state.mode = "question";
  state.block = taken.index;
  state.round = taken.round;
  state.index = 0;
  state.session = freshSession();
  resetCard();
  render();
  focusCatcher();
}

function buildReviewRound() {
  const round = [];
  const seen = new Set();
  for (const char of store.review) {
    if (seen.has(char)) continue;
    const entry = allByChar.get(char);
    if (!entry) continue;
    seen.add(char);
    round.push(entry);
  }
  return shuffle(round);
}

function capturePause() {
  return {
    kind: state.kind,
    mode: state.mode,
    block: state.block,
    round: state.round,
    index: state.index,
    session: state.session,
    typed: state.typed,
    outcome: state.outcome,
    counted: state.counted,
    hintLevel: state.hintLevel,
    revealed: state.revealed,
  };
}

function startReview() {
  const round = buildReviewRound();
  if (!round.length) return false;
  if (state.kind !== "review") {
    clearTimer();
    paused = capturePause();
  }
  clearTimer();
  state.pendingAdvance = false;
  state.kind = "review";
  state.mode = "question";
  state.round = round;
  state.index = 0;
  state.session = freshSession();
  resetCard();
  render();
  focusCatcher();
  return true;
}

function exitReview() {
  clearTimer();
  const snap = paused;
  paused = null;
  if (!snap) {
    startPractice(store.nextBlock || 0);
    return;
  }
  state.kind = snap.kind;
  state.mode = snap.mode;
  state.block = snap.block;
  state.round = snap.round;
  state.index = snap.index;
  state.session = snap.session;
  state.typed = snap.typed;
  state.outcome = snap.outcome;
  state.counted = snap.counted;
  state.hintLevel = snap.hintLevel;
  state.revealed = snap.revealed;
  state.notice = "";
  if (state.outcome === "correct" && state.mode === "question") scheduleAdvance();
  render();
  focusCatcher();
}

function addReview(char) {
  store.review = [char].concat(store.review.filter((item) => item !== char));
}

function removeReview(char) {
  store.review = store.review.filter((item) => item !== char);
}

function recordMiss(entry) {
  if (state.counted) return;
  state.counted = true;
  state.session.attempted += 1;
  state.session.streak = 0;
  if (!state.session.missed.includes(entry.char)) state.session.missed.push(entry.char);
  addReview(entry.char);
  store.misses[entry.char] = (store.misses[entry.char] || 0) + 1;
  store.today.attempted += 1;
  saveStore();
}

function recordHit(entry) {
  if (!state.counted) {
    state.counted = true;
    state.session.attempted += 1;
    state.session.correct += 1;
    state.session.streak += 1;
    if (state.session.streak > state.session.best) state.session.best = state.session.streak;
    store.today.attempted += 1;
    store.today.correct += 1;
  }
  if (!state.revealed) removeReview(entry.char);
  saveStore();
}

function scheduleAdvance() {
  clearTimer();
  state.timer = setTimeout(() => {
    state.timer = null;
    if (!overlayEl.hidden) {
      state.pendingAdvance = true;
      return;
    }
    if (state.outcome === "correct" && state.mode === "question") advance();
  }, ADVANCE_MS);
}

function advance() {
  clearTimer();
  state.pendingAdvance = false;
  if (state.mode !== "question") return;
  state.index += 1;
  resetCard();
  if (state.index >= state.round.length) {
    finishRound();
    return;
  }
  render();
}

function finishRound() {
  clearTimer();
  if (state.kind === "practice") {
    store.nextBlock = (state.block + 1) % blockCount();
    saveStore();
  }
  state.mode = "summary";
  render();
}

function submit() {
  const entry = current();
  if (!entry || !state.typed) return;
  if (isCorrect(entry, state.typed)) {
    const kept = state.revealed;
    state.outcome = "correct";
    recordHit(entry);
    announce("答對。" + entry.char + " 係 " + state.typed + (kept ? "。留喺複習" : ""));
    scheduleAdvance();
  } else {
    state.outcome = "wrong";
    recordMiss(entry);
    announce("唔對，再試一次");
  }
  render();
}

function onLetter(letter) {
  if (!overlayEl.hidden || state.mode !== "question") return;
  state.notice = "";
  if (state.outcome === "correct") {
    advance();
    onLetter(letter);
    return;
  }
  const entry = current();
  if (!entry) return;
  if (state.typed.length >= entry.code.length) {
    state.typed = "";
    if (state.outcome === "wrong") state.outcome = null;
  }
  state.typed += letter.toUpperCase();
  render();
  if (state.typed.length >= entry.code.length) submit();
}

function showHint() {
  const entry = current();
  if (!entry || state.mode !== "question" || state.outcome === "correct") return;
  if (entry.code.length === 1 || state.hintLevel >= 1) {
    state.hintLevel = 2;
    state.revealed = true;
    state.outcome = "revealed";
    recordMiss(entry);
    announce("答案係 " + entry.code);
  } else {
    state.hintLevel = 1;
    state.outcome = "hint";
    announce("頭碼係 " + entry.code[0]);
  }
  render();
}

function onEscape() {
  if (!overlayEl.hidden) {
    closeMap();
    return;
  }
  if (state.mode !== "question" || state.outcome === "correct") return;
  state.typed = "";
  state.notice = "";
  render();
}

function onSpace() {
  if (!overlayEl.hidden) return;
  if (state.mode === "summary") {
    if (state.kind === "practice") nextGroup();
    else if (store.review.length) startReview();
    else exitReview();
    return;
  }
  if (state.outcome === "correct") {
    advance();
    return;
  }
  const entry = current();
  if (entry && !state.counted) recordMiss(entry);
  advance();
}

function onEnter() {
  if (!overlayEl.hidden) return;
  if (state.mode === "summary" || state.outcome === "correct") {
    onSpace();
    return;
  }
  if (state.typed) submit();
}

function nextGroup() {
  startPractice(state.block + 1);
}

function onRestart() {
  if (state.kind === "review") startReview();
  else startPractice(state.block);
}

function onReviewClick() {
  if (state.kind === "review") {
    exitReview();
    return;
  }
  if (!startReview()) {
    state.notice = "未有要複習嘅字。打錯嘅字會出現喺度。";
    render();
  }
}

function openMap() {
  clearTimer();
  if (state.outcome === "correct" && state.mode === "question") state.pendingAdvance = true;
  overlayEl.hidden = false;
  document.body.classList.add("map-open");
}

function closeMap() {
  overlayEl.hidden = true;
  document.body.classList.remove("map-open");
  if (state.pendingAdvance && state.outcome === "correct" && state.mode === "question") {
    state.pendingAdvance = false;
    scheduleAdvance();
  }
  focusCatcher();
}

function toggleMap() {
  if (overlayEl.hidden) openMap();
  else closeMap();
}

function focusCatcher() {
  if (!overlayEl.hidden) return;
  catcherEl.focus({ preventScroll: true });
}

function announce(text) {
  liveEl.textContent = text;
}

function normalizeLetter(char) {
  if (!char) return null;
  const code = char.codePointAt(0);
  if (code >= 0xff21 && code <= 0xff3a) return String.fromCharCode(code - 0xff21 + 65);
  if (code >= 0xff41 && code <= 0xff5a) return String.fromCharCode(code - 0xff41 + 97);
  if (/^[a-zA-Z]$/.test(char)) return char.toUpperCase();
  return null;
}

function accuracy(correct, attempted) {
  if (!attempted) return "—";
  return Math.round((correct / attempted) * 100) + "%";
}

function topMisses(limit) {
  return Object.entries(store.misses)
    .filter((pair) => pair[1] > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-Hant"))
    .slice(0, limit);
}

function render() {
  renderTop();
  renderPractice();
  renderSide();
}

function renderTop() {
  const session = state.session;
  const parts = [
    "答對 " + session.correct + "／" + session.attempted,
    "準確率 " + accuracy(session.correct, session.attempted),
    "連勝 " + session.streak,
  ];
  topStatsEl.innerHTML = parts
    .map((part, index) => (index ? '<span class="sep" aria-hidden="true"></span>' : "") + "<span>" + esc(part) + "</span>")
    .join("");
}

function renderPractice() {
  if (state.mode === "summary") {
    practiceEl.innerHTML = renderSummary();
    return;
  }
  const entry = current();
  if (!entry) {
    practiceEl.innerHTML = '<p class="loading">未有題目</p>';
    return;
  }
  const length = entry.code.length;
  const prompt = length === 1 ? "輸入速成碼（一碼）" : "輸入速成碼（頭尾兩碼）";
  let slots = "";
  for (let index = 0; index < length; index += 1) {
    const letter = state.typed[index] || "";
    const radical = letter ? radicalsFor(letter) : "";
    const tone = state.outcome === "wrong" && letter ? " bad" : state.outcome === "correct" ? " good" : "";
    slots +=
      '<div class="slot' + tone + '">' +
      '<div class="slot-letter">' + esc(letter) + "</div>" +
      '<div class="slot-radical">' + esc(radical) + "</div>" +
      "</div>";
  }
  practiceEl.innerHTML =
    '<p class="hanzi" id="target-char">' + esc(entry.char) + "</p>" +
    '<p class="prompt">' + prompt + "</p>" +
    '<p class="hint-line">請用英文輸入</p>' +
    '<div class="slots" id="slots">' + slots + "</div>" +
    '<div class="feedback" id="feedback" data-state="' + esc(state.outcome || "") + '">' +
    renderFeedback(entry) +
    "</div>";
}

function renderFeedback(entry) {
  if (state.outcome === "correct") {
    const shown = state.typed.toUpperCase();
    let text = "✓ 答對！ " + entry.char + " = " + shown + "（" + radicalsFor(shown) + "）";
    if (state.revealed) text += "　留喺複習";
    return '<div class="banner ok">' + esc(text) + "</div>";
  }
  if (state.outcome === "revealed") {
    return (
      '<div class="banner revealed">答案係 ' +
      esc(entry.code) +
      "（" +
      esc(radicalsFor(entry.code)) +
      "）。撳 Space 去下一題</div>"
    );
  }
  if (state.outcome === "hint") {
    const letter = entry.code[0];
    return '<div class="banner hint">提示：頭碼係 ' + esc(letter) + "（" + esc(radicalsFor(letter)) + "）</div>";
  }
  if (state.outcome === "wrong") {
    return '<button type="button" class="retry" data-action="retry">× 唔對，再試一次</button>';
  }
  if (state.notice) return '<div class="banner note">' + esc(state.notice) + "</div>";
  return "";
}

function renderSummary() {
  const session = state.session;
  const reviewLeft = store.review.length;
  let title = "呢組完成喇";
  let extra = "";
  let actions = "";
  if (state.kind === "review") {
    title = reviewLeft ? "呢輪複習完成" : "複習清晒喇";
    extra = reviewLeft ? "<p>仲有 " + reviewLeft + " 個字未打啱。</p>" : "<p>打錯嘅字已經清走。</p>";
    actions =
      (reviewLeft ? '<button type="button" class="btn btn-solid" data-action="continue-review">繼續複習</button>' : "") +
      '<button type="button" class="btn btn-ghost" data-action="exit-review">返去練習</button>';
  } else {
    actions =
      '<button type="button" class="btn btn-solid" data-action="next-group">下一組</button>' +
      '<button type="button" class="btn btn-ghost" data-action="repeat-group">再練呢組</button>' +
      '<button type="button" class="btn btn-review' + (reviewLeft ? " has-items" : "") + '" data-action="review"' +
      (reviewLeft ? "" : " disabled") + ">複習打錯嘅字（" + reviewLeft + "）</button>";
  }
  const missed = session.missed
    .map((char) => '<span class="missed-chip">' + esc(char) + "</span>")
    .join("");
  const missedBlock = session.missed.length
    ? '<p>頭一次打錯</p><div class="missed-row">' + missed + "</div>"
    : "<p>呢組冇打錯。</p>";
  return (
    '<div class="summary" id="round-summary">' +
    "<h3>" + title + "</h3>" +
    '<p class="summary-score">答對 ' + session.correct + "／" + session.attempted +
    "　·　準確率 " + accuracy(session.correct, session.attempted) +
    "　·　最長連勝 " + session.best + "</p>" +
    extra +
    missedBlock +
    '<div class="summary-actions">' + actions + "</div>" +
    "</div>"
  );
}

function renderSide() {
  const progress = progressNumbers();
  const reviewCount = store.review.length;
  const reviewLabel = state.kind === "review" ? "返去練習" : "複習（" + reviewCount + "）";
  const reviewClass = "btn btn-review" + (state.kind !== "review" && reviewCount ? " has-items" : "");
  const misses = topMisses(5)
    .map((pair) => "<span>" + esc(pair[0]) + " ×" + pair[1] + "</span>")
    .join("");
  const today = store.today;
  sideEl.innerHTML =
    "<h2>" + (state.kind === "review" ? "複習" : "今次練習") + "</h2>" +
    '<div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="' + progress.total +
    '" aria-valuenow="' + progress.current + '"><span style="width:' + progress.pct + '%"></span></div>' +
    '<p class="progress-label">第 ' + progress.current + " 題／共 " + progress.total + " 題</p>" +
    '<p class="band">' + esc(bandLabel()) + "</p>" +
    '<div class="side-actions">' +
    '<button type="button" class="btn btn-ghost" data-action="map"><span>睇字根表</span><kbd>?</kbd></button>' +
    '<button type="button" class="' + reviewClass + '" data-action="review">' + reviewLabel + "</button>" +
    '<button type="button" class="btn btn-solid" data-action="restart">重新開始</button>' +
    "</div>" +
    '<div class="today">' +
    "<h3>今日</h3>" +
    "<p>練咗 " + today.attempted + " 題　·　準確率 " + accuracy(today.correct, today.attempted) + "</p>" +
    "<h3>最常打錯</h3>" +
    (misses ? '<div class="today-misses">' + misses + "</div>" : "<p>未有打錯紀錄</p>") +
    "</div>";
}

function progressNumbers() {
  const total = Math.max(1, state.round.length);
  if (state.mode === "summary") return { current: total, total: total, pct: 100 };
  const currentNumber = Math.min(total, state.index + 1);
  return { current: currentNumber, total: total, pct: Math.round((currentNumber / total) * 100) };
}

function bandLabel() {
  if (state.kind === "review") return "打錯嘅字";
  const start = state.block * ROUND_SIZE + 1;
  const end = Math.min(pool.length, start + state.round.length - 1);
  return "第 " + start + "–" + end + " 個常用字";
}

function buildMap() {
  const groupOf = {};
  for (const group of radicalGroups) {
    for (const letter of group.letters) groupOf[letter] = group.id;
  }
  const rows = radicalRows.map((row) => {
    const keys = [...row].map((letter) => {
      const radical = radicalMap[letter] || "";
      const group = groupOf[letter] || "special";
      return (
        '<div class="key ' + esc(group) + '" data-letter="' + esc(letter) + '">' +
        '<span class="key-letter">' + esc(letter.toUpperCase()) + "</span>" +
        '<span class="key-radical">' + esc(radical) + "</span>" +
        "</div>"
      );
    }).join("");
    return '<div class="key-row">' + keys + "</div>";
  }).join("");
  mapKeysEl.innerHTML = '<div class="map-board-inner">' + rows + "</div>";
  mapLegendEl.innerHTML = radicalGroups.map((group) => (
    '<div class="legend-item ' + esc(group.id) + '">' +
    "<strong>" + esc(group.name) + "</strong>" +
    "<span>" + esc(group.sample) + "</span>" +
    "</div>"
  )).join("");
}

function showLoadError() {
  practiceEl.innerHTML = '<p class="loading">載入唔到字表。請連上網路，重新開一次呢頁。</p>';
}

function validateData(chars, radicals) {
  if (!chars || !Array.isArray(chars.characters) || !chars.characters.length) {
    throw new Error("empty character list");
  }
  const map = radicals && radicals.map;
  if (!map || map.y !== "\u535c" || map.z !== "\u91cd" || map.x !== "\u96e3") {
    throw new Error("radical map mismatch");
  }
  for (const letter of "abcdefghijklmnopqrstuvwxyz") {
    if (typeof map[letter] !== "string" || [...map[letter]].length !== 1) {
      throw new Error("missing radical");
    }
  }
}

function boot(chars, radicals) {
  validateData(chars, radicals);
  const size = Math.min(chars.characters.length, Number(chars.practiceSize) || chars.characters.length);
  pool = chars.characters.slice(0, size);
  allByChar = new Map(chars.characters.map((entry) => [entry.char, entry]));
  radicalMap = radicals.map;
  radicalGroups = radicals.groups;
  radicalRows = radicals.rows;
  store = loadStore();
  store.review = store.review.filter((char) => allByChar.has(char));
  buildMap();
  startPractice(store.nextBlock || 0);
}

async function init() {
  try {
    const [charResponse, radicalResponse] = await Promise.all([
      fetch("./data/characters.json"),
      fetch("./data/radicals.json"),
    ]);
    if (!charResponse.ok || !radicalResponse.ok) throw new Error("fetch failed");
    const chars = await charResponse.json();
    const radicals = await radicalResponse.json();
    boot(chars, radicals);
  } catch (error) {
    showLoadError();
  }
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
}

document.addEventListener("keydown", (event) => {
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  if (event.isComposing || event.key === "Process") return;

  if (event.key === "Escape") {
    event.preventDefault();
    onEscape();
    return;
  }
  if (!overlayEl.hidden) {
    if (event.key === "?" || event.key === "？") {
      event.preventDefault();
      closeMap();
    }
    return;
  }
  if (event.key === "Tab") {
    event.preventDefault();
    showHint();
    return;
  }
  if (event.key === " " || event.code === "Space") {
    event.preventDefault();
    onSpace();
    return;
  }
  if (event.key === "Enter") {
    event.preventDefault();
    onEnter();
    return;
  }
  if (event.key === "Backspace") {
    event.preventDefault();
    if (state.mode === "question" && state.outcome !== "correct" && state.typed) {
      state.typed = state.typed.slice(0, -1);
      if (state.outcome === "wrong") state.outcome = null;
      render();
    }
    return;
  }
  if (event.key === "?" || event.key === "？") {
    event.preventDefault();
    toggleMap();
    return;
  }
  const letter = normalizeLetter(event.key);
  if (!letter || event.repeat) return;
  event.preventDefault();
  ignoreInput = true;
  onLetter(letter);
  setTimeout(() => {
    ignoreInput = false;
  }, 0);
}, true);

catcherEl.addEventListener("input", () => {
  const value = catcherEl.value;
  catcherEl.value = "";
  if (ignoreInput) {
    ignoreInput = false;
    return;
  }
  for (const char of value) {
    const letter = normalizeLetter(char);
    if (letter) onLetter(letter);
  }
});

document.body.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]");
  if (!button || button.disabled) return;
  const action = button.dataset.action;
  if (action === "map") openMap();
  else if (action === "close-map") closeMap();
  else if (action === "review") onReviewClick();
  else if (action === "restart" || action === "repeat-group") onRestart();
  else if (action === "retry") onEscape();
  else if (action === "next-group") nextGroup();
  else if (action === "continue-review") startReview();
  else if (action === "exit-review") exitReview();
});

overlayEl.addEventListener("click", (event) => {
  if (event.target === overlayEl) closeMap();
});

practiceEl.addEventListener("pointerdown", (event) => {
  if (event.target.closest("button")) return;
  focusCatcher();
});

init();
