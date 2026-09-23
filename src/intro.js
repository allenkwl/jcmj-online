/* ═══════════════════════════════════════════════════════════════
   intro.js — 開場序章（30 秒）
   ───────────────────────────────────────────────────────────────
   六幕：天下大勢 → 七雄列陣 → 四方對峙 → 以牌為兵 → 征服 → 收尾。
   來源是 `開場動畫測試.html`，搬進遊戲時拿掉了測試用的東西：
   起始閘門、播放/暫停/重播/靜音控制列、進度條。
   遊戲裡只需要「播放」跟「跳過」。

   ── 跳過 ──
   照小球貓電鐵的慣例：**A 或 Enter**（手把 A 也通）。
   按鈕一直顯示在右下角，不是藏起來等人找。
   ⚠️ Esc 不接 —— 那是老闆模式。

   ── 配樂 ──
   用 <audio> 放 assets/audio/intro-bgm.mp3，不走遊戲的程序化 BGM
   （那是合成器，放不了現成的曲子）。進場前先把遊戲 BGM 停掉，
   結束時再交還 —— 兩套同時響會很亂。
   靜音狀態沿用遊戲的設定（MJAudio.SFX.isEnabled）。

   ── ⚠️ 只在「開始征途」按下去之後播一次 ──
   不是每次回到標題都播。30 秒的東西看第二次就是折磨，
   而玩家一場打完會回標題好幾次。
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

/* 播放序章。回傳 Promise，播完或被跳過才 resolve。
   opts.force  true＝不管看過沒有都播（設定面板的「重看序章」用） */
function play(opts) {
  const o = opts || {};
  const stage = document.getElementById('intro-ov');
  if (!stage) return Promise.resolve('skip:nodom');
  if (running) return Promise.resolve('skip:running');
  if (!o.force && reduced()) return Promise.resolve('skip:reduced-motion');
  if (!o.force && seen()) return Promise.resolve('skip:seen');

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

  if (audio) {
    audio.currentTime = 0;
    try {
      const A = window.MJAudio;
      audio.muted = !!(A && A.SFX && A.SFX.isEnabled && !A.SFX.isEnabled());
    } catch (_) {}
    audio.play().catch(() => {});            // 沒有使用者手勢就靜靜失敗，動畫照跑
  }

  const t0 = performance.now();
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
    if (hadBgm) { try { window.MJAudio.BGM.play('title', 1.0); } catch (_) {} }
    finish(reason);
  }

  function onKey(e) {
    // 照電鐵的慣例：A 或 Enter 跳過。⚠️ Esc 不接，那是老闆模式。
    if (e.key === 'Enter' || e.key === 'a' || e.key === 'A') {
      e.preventDefault(); e.stopPropagation();
      stop('skipped');
    }
  }
  document.addEventListener('keydown', onKey, true);
  stage.querySelector('#intro-skip').onclick = () => stop('skipped');

  activate(0);
  raf = requestAnimationFrame(frame);
  return done;
}

return { play, isRunning: () => running, hasSeen: seen, reset() { try { localStorage.removeItem(SEEN_KEY); } catch (_) {} } };
});
