/* ═══════════════════════════════════════════════════════════════
   input.js — 全程鍵盤／手把操作
   ───────────────────────────────────────────────────────────────
   舊版**完全沒有手把支援**（`getGamepads` 一筆都沒有），鍵盤也只有牌桌
   那一段（數字鍵快速棄牌、方向鍵移動選取）。標題、選國、彈窗全都只能用滑鼠。

   這一層把三個畫面統一成同一套：一組「目前可以選的東西」，
   方向鍵／搖桿移動，確定／取消動作。

   ── 設計 ──
   呼叫端只要給一個 `getItems()`，回傳**目前這個畫面該被選的元素陣列**。
   每次重畫之後叫 `refresh()`，這一層會重新抓、盡量保住原本的位置。
   不去記 DOM 結構、不去猜版面 —— 畫面怎麼變都不用改這裡。

   ── 為什麼不用瀏覽器原生的 Tab 焦點 ──
   牌桌上「可選的」是 14 張牌的 canvas，那不是 focusable 元素；
   要一個個加 tabindex 會把 Tab 鍵的語意弄壞（Tab 應該離開遊戲區）。
   而且手把的 D-pad 本來就該是二維移動，不是線性 Tab 序。

   ── 手把 ──
   Gamepad API 沒有事件，只能輪詢。用 requestAnimationFrame 跑，
   沒插手把時 `getGamepads()` 回空陣列，成本近乎零。
   方向要做「按住連發」的節流，否則一次推搖桿會跳過整排。
   ═══════════════════════════════════════════════════════════════ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MJInput = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
'use strict';

const FOCUS_CLASS = 'kbfocus';
const REPEAT_FIRST = 380;    // 按住後第一次連發的延遲
const REPEAT_NEXT = 110;     // 之後每次
const STICK_DEAD = 0.55;     // 搖桿死區

let cfg = { getItems: () => [], onConfirm: null, onCancel: null, onFocus: null };
let items = [];
let idx = -1;
let padOn = false;           // 有沒有偵測到手把
let rafId = null;
const held = {};             // 方向鍵／按鈕的連發計時

/* ── 焦點 ────────────────────────────────────────────────── */
function paint() {
  // 先把「不在目前這批裡」的殘留焦點框清掉。
  // 只 toggle 目前這批的話，換畫面之後舊畫面的框會留著 ——
  // 畫面上會同時看到兩個焦點，用鍵盤的人根本分不出哪個是真的。
  document.querySelectorAll('.' + FOCUS_CLASS).forEach(el => {
    if (items.indexOf(el) < 0) el.classList.remove(FOCUS_CLASS);
  });
  items.forEach((el, i) => el.classList.toggle(FOCUS_CLASS, i === idx));
  const el = items[idx];
  if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  if (cfg.onFocus) cfg.onFocus(el || null, idx);
}

/* 重新抓一次可選項。盡量保住原本選到的那一個 —— 重畫之後元素是新的，
   所以用「位置」而不是「物件」來對齊，位置超出範圍就夾回去。 */
function refresh(keepIdx) {
  const prev = keepIdx != null ? keepIdx : idx;
  items = (cfg.getItems() || []).filter(Boolean);
  if (!items.length) { idx = -1; return; }
  idx = Math.max(0, Math.min(items.length - 1, prev < 0 ? 0 : prev));
  paint();
}

/* 左右移動。

   ⚠️ 環繞是**在同一群組之內**，不是整份清單。
   牌桌上手牌有 14 張，右邊那排功能鈕（交給系統打、退回、設定…）只有幾顆 ——
   一路線性環繞的話，方向鍵按到最右邊那張牌再按一下就跳去按鈕了，
   玩家只是想繞回最左邊那張。要上去按鈕請按**上**。

   群組用 dataset.fgroup 標，沒標的全部算同一組 ——
   所以標題、選國、大廳那些畫面完全不受影響（行為跟以前一樣）。 */
function groupOf(el) { return (el && el.dataset && el.dataset.fgroup) || ''; }

function move(delta) {
  if (!items.length) { refresh(); if (!items.length) return; }
  const g = groupOf(items[idx]);
  const same = [];
  items.forEach((el, i) => { if (groupOf(el) === g) same.push(i); });
  if (same.length < 2) {                    // 這一組只有一個，退回整份環繞
    idx = (idx + delta + items.length) % items.length;
    paint();
    return;
  }
  const at = same.indexOf(idx);
  idx = same[(at + delta + same.length) % same.length];
  paint();
}

/* 上下移動：版面是換行排列的，所以用實際座標找「正上方／正下方最近的那個」，
   不能用固定的每列幾個 —— 選國畫面的每列張數會隨視窗寬度變。 */
function moveVertical(dir) {
  if (items.length < 2) return;
  const cur = items[idx] || items[0];
  const a = cur.getBoundingClientRect();
  const ax = a.left + a.width / 2, ay = a.top + a.height / 2;
  let best = -1, bestScore = Infinity;
  items.forEach((el, i) => {
    if (i === idx) return;
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const dy = (cy - ay) * dir;
    if (dy < 6) return;                       // 不在要去的方向
    const score = dy + Math.abs(cx - ax) * 1.6;   // 垂直近優先，水平偏移次之
    if (score < bestScore) { bestScore = score; best = i; }
  });
  if (best >= 0) { idx = best; paint(); }
  else move(dir);                              // 已經在最上／最下就環繞
}

function confirm() {
  const el = items[idx];
  if (!el) return;
  if (cfg.onConfirm && cfg.onConfirm(el, idx) === true) return;
  el.click();
}
function cancel() { if (cfg.onCancel) cfg.onCancel(); }

/* ── 鍵盤 ────────────────────────────────────────────────── */
const KEY_ACTION = {
  ArrowLeft: () => move(-1), ArrowRight: () => move(1),
  ArrowUp: () => moveVertical(-1), ArrowDown: () => moveVertical(1),
  Enter: confirm, ' ': confirm,
  /* 返回。B 是跟小球貓電鐵對齊的慣例（它的大廳直接把「（B）」寫在按鈕上）。
     ⚠️ Backspace 在牌桌上另有其用 —— KEY_OF 把它指派給第 14 張（剛摸的那張），
     由 beforeKey 先攔，攔不到才會掉到這裡當返回。所以真正一致的返回鍵是 B。
     ⚠️ Esc 不能用：瀏覽器保留給離開全螢幕，而本作那是老闆模式。 */
  b: cancel, B: cancel,
  Backspace: cancel,
};

function onKey(e) {
  if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
  // Esc 不綁 —— 瀏覽器保留給「離開全螢幕」，preventDefault 擋不住，
  // 綁上去會讓人以為是遊戲把全螢幕關掉的。
  /* ⚠️ 呼叫端要**先**攔，順序不能反。

     原本是先查 KEY_ACTION、查不到就 return，beforeKey 排在後面 ——
     但會走到 beforeKey 的鍵，都是已經在 KEY_ACTION 裡的那幾顆，
     等於呼叫端永遠攔不到別的鍵。結果是**牌底下標的數字鍵從來沒作用過**
     （那是原版的主要打牌方式），A 鍵之類的自訂鍵也一樣進不來。 */
  if (cfg.beforeKey && cfg.beforeKey(e) === true) return;
  const fn = KEY_ACTION[e.key];
  if (!fn) return;
  e.preventDefault();
  fn();
}

/* ── 手把 ────────────────────────────────────────────────── */
function repeat(name, active, fn) {
  const now = performance.now();
  if (!active) { delete held[name]; return; }
  const h = held[name];
  if (!h) { held[name] = { at: now, n: 1 }; fn(); return; }
  const wait = h.n === 1 ? REPEAT_FIRST : REPEAT_NEXT;
  if (now - h.at >= wait) { h.at = now; h.n++; fn(); }
}

function pollPads() {
  rafId = requestAnimationFrame(pollPads);
  const pads = (navigator.getGamepads && navigator.getGamepads()) || [];
  let pad = null;
  for (let i = 0; i < pads.length; i++) if (pads[i] && pads[i].connected) { pad = pads[i]; break; }
  if (!pad) { padOn = false; return; }
  if (!padOn) { padOn = true; document.body.classList.add('has-pad'); }

  const b = pad.buttons || [];
  const ax = pad.axes || [];
  const down = i => !!(b[i] && (b[i].pressed || b[i].value > 0.5));

  // D-pad（12–15）與左搖桿都能用
  repeat('left', down(14) || ax[0] < -STICK_DEAD, () => move(-1));
  repeat('right', down(15) || ax[0] > STICK_DEAD, () => move(1));
  repeat('up', down(12) || ax[1] < -STICK_DEAD, () => moveVertical(-1));
  repeat('down', down(13) || ax[1] > STICK_DEAD, () => moveVertical(1));
  // A／Start 確定，B 取消。不連發 —— 確定鍵連發會連按兩次。
  repeat('a', down(0) || down(9), () => { held.a.n = 99; confirm(); });
  repeat('b', down(1), () => { held.b.n = 99; cancel(); });
}

/* ── 進入點 ──────────────────────────────────────────────── */
function init(options) {
  cfg = Object.assign(cfg, options || {});
  document.addEventListener('keydown', onKey);
  /* 滑鼠／手指點了哪一個，鍵盤焦點就跟到那一個。
     不跟的話焦點框留在原地 —— 選國畫面點了趙國，黃框還框著齊國（2026-09-24 使用者回報），
     看起來像選了兩國。用 capture 在 click 之前先對齊，點擊處理裡的 refresh() 就會保住這一個。 */
  document.addEventListener('pointerdown', e => {
    const t = e.target;
    const hit = items.find(el => el === t || (el && el.contains && el.contains(t)));
    if (hit) { idx = items.indexOf(hit); paint(); }
  }, true);
  window.addEventListener('gamepadconnected', () => { padOn = true; document.body.classList.add('has-pad'); });
  if (!rafId) pollPads();
  refresh();
}

/* 把焦點移到指定元素。**回傳有沒有成功** ——
   元素不在目前這批可選項裡（例如彈窗開著、手牌不能選）就會失敗。
   呼叫端常常需要知道：失敗了要留著待會再試，而不是當作已經處理過。 */
function setIndexOf(el) {
  const i = items.indexOf(el);
  if (i < 0) return false;
  idx = i; paint();
  return true;
}
function current() { return items[idx] || null; }
function hasPad() { return padOn; }

return { init, refresh, move, moveVertical, confirm, cancel, current, setIndexOf, hasPad, FOCUS_CLASS };
});
