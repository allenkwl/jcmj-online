/* ═══════════════════════════════════════════════════════════════
   intro.js — 開場序章（30 秒）
   ───────────────────────────────────────────────────────────────
   六幕：天下大勢 → 七雄列陣 → 四方對峙 → 以牌為兵 → 征服 → 收尾。
   來源是 `開場動畫測試.html`（現在是 devtools/開場動畫v0.1.html），搬進遊戲時拿掉了測試用的東西：
   起始閘門、播放/暫停/重播/靜音控制列、進度條。
   遊戲裡只需要「播放」跟「跳過」。

   ── 跳過 ──
   照小球貓電鐵的慣例：**A 或 Enter**（手把 A 也通），2026-09-26 加上空白鍵。
   播放中其他按鍵一律攔下，不往後面的畫面傳（Esc 除外，那是老闆模式）。
   按鈕一直顯示在右下角，不是藏起來等人找。
   ⚠️ Esc 不接 —— 那是老闆模式。

   ── 配樂 ──
   用 <audio> 放 assets/audio/intro-bgm.mp3，不走遊戲的程序化 BGM
   （那是合成器，放不了現成的曲子）。進場前先把遊戲 BGM 停掉，
   結束時再交還 —— 兩套同時響會很亂。
   靜音狀態沿用遊戲的設定（MJAudio.SFX.isEnabled）。

   ── 每次按「開始征途」都播，隨時可以跳過 ──
   2026-09-24 使用者改的：原本只播第一次（看過就記在 localStorage），
   結果看過一次之後就再也看不到，像是動畫不見了。
   改成每次都播，右下角的「跳過序章（Enter / A）」一按就進選國。
   只有回標題不會播 —— 播放點是「開始征途」，不是標題畫面。
   ═══════════════════════════════════════════════════════════════ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MJIntro = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
'use strict';

const DURATION = 30;
const SEEN_KEY = 'jcmj_intro_seen';

const reduced = () => {
  try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) { return false; }
};
const seen = () => { try { return localStorage.getItem(SEEN_KEY) === '1'; } catch (_) { return false; } };
const markSeen = () => { try { localStorage.setItem(SEEN_KEY, '1'); } catch (_) {} };

let running = false;
let stopNow = null;          // 播放中才有：外面要中途停掉（啟動台的「跳到第幾幕」）用

/* 播放序章。回傳 Promise，播完或被跳過才 resolve。
   opts.force  true＝不管看過沒有都播（設定面板的「重看序章」用）
   opts.from   從第幾秒開始（啟動台的開場動畫預覽用來跳幕；遊戲裡不傳＝從頭）
   opts.keepBgm  true＝結束時不要把標題 BGM 放回來（預覽頁不需要標題音樂） */
function play(opts) {
  const o = opts || {};
  const stage = document.getElementById('intro-ov');
  if (!stage) return Promise.resolve('skip:nodom');
  if (running) return Promise.resolve('skip:running');
  if (!o.force && reduced()) return Promise.resolve('skip:reduced-motion');
  // 不再檢查 seen()：每次都播，想跳過按跳過鈕（2026-09-24）。markSeen 仍會記，留著給之後需要時用

  running = true;
  const scenes = [...stage.querySelectorAll('.scene')];
  const audio = document.getElementById('intro-bgm');

  // 遊戲自己的 BGM 先讓位，兩套一起響會很亂
  let hadBgm = false;
  try {
    const A = window.MJAudio;
    hadBgm = !!(A && A.BGM && A.BGM.isEnabled && A.BGM.isEnabled());
    if (A && A.BGM) A.BGM.stop(0.3);
  } catch (_) {}

  stage.classList.add('show');
  scenes.forEach(s => s.classList.remove('active'));
  void stage.offsetWidth;                    // 重置各幕的 CSS animation

  const from = Math.max(0, Math.min(DURATION - 0.1, +o.from || 0));
  if (audio) {
    audio.currentTime = from;
    try {
      const A = window.MJAudio;
      audio.muted = !!(A && A.SFX && A.SFX.isEnabled && !A.SFX.isEnabled());
    } catch (_) {}
    audio.play().catch(() => {});            // 沒有使用者手勢就靜靜失敗，動畫照跑
  }

  const t0 = performance.now() - from * 1000;
  let raf = 0, finish = null;
  const done = new Promise(res => { finish = res; });

  function activate(t) {
    scenes.forEach(s => {
      s.classList.toggle('active', t >= +s.dataset.start && t < +s.dataset.end);
    });
  }

  function frame(now) {
    if (!running) return;
    const t = (now - t0) / 1000;
    if (t >= DURATION) { stop('done'); return; }
    activate(t);
    raf = requestAnimationFrame(frame);
  }

  function stop(reason) {
    if (!running) return;
    running = false;
    cancelAnimationFrame(raf);
    document.removeEventListener('keydown', onKey, true);
    stage.classList.remove('show');
    scenes.forEach(s => s.classList.remove('active'));
    if (audio) { try { audio.pause(); } catch (_) {} }
    markSeen();
    if (hadBgm && !o.keepBgm) { try { window.MJAudio.BGM.play('title', 1.0); } catch (_) {} }
    stopNow = null;
    finish(reason);
  }

  function onKey(e) {
    // ⚠️ Esc 不接、也不攔：那是老闆模式
    if (e.key === 'Escape') return;
    /* 序章播放中，按鍵**一律不往後面的畫面傳**。
       原本只攔跳過鍵，其他鍵（空白、方向鍵）穿過去打到標題／選國畫面的焦點上 ——
       玩家看著序章連按空白，背後已經依序按了開始征途 → 選國 → 強度 → 出兵，
       序章還沒播完就發牌占卜了（2026-09-26 使用者）。 */
    e.stopPropagation();
    // 跳過：Enter、空白、A（照電鐵的慣例是 Enter／A；空白是玩家最直覺會按的）
    // B＝返回，在序章就是跳過（2026-09-26 使用者：所有停下來的地方都要可以按 B 返回）
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'a' || e.key === 'A' || e.key === 'b' || e.key === 'B') {
      e.preventDefault();
      stop('skipped');
    }
  }
  document.addEventListener('keydown', onKey, true);
  stage.querySelector('#intro-skip').onclick = () => stop('skipped');

  stopNow = stop;
  // 焦點馬上換到「跳過」—— 不然手把 A 還停在後面畫面原本的那顆鈕上（主程式的焦點清單播放中只給跳過鈕）
  try { if (window.MJInput) window.MJInput.refresh(0); } catch (_) {}
  activate(from);
  raf = requestAnimationFrame(frame);
  return done;
}

return { play, DURATION, stop(reason) { if (stopNow) stopNow(reason || 'stopped'); }, isRunning: () => running, hasSeen: seen, reset() { try { localStorage.removeItem(SEEN_KEY); } catch (_) {} } };
});
