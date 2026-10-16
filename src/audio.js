/* ═══════════════════════════════════════════════════════════════
   audio.js — 音效與程序化背景音樂
   ───────────────────────────────────────────────────────────────
   SFX：原本由 `tools/build-audio.py` 從舊版單檔搬過來（Web Audio 即時合成）。
   ⚠️ 這個檔早就手改過（BGM 重疊的修正、2026-10-16 整個 BGM 換成音檔），**不要再重跑 build-audio.py**，會把這些洗掉。

   BGM：2026-10-16 起改播 assets/audio/bgm/*.mp3（MIDI → GarageBand 取樣演奏，見 BGM 區塊開頭的說明）。
   場景：title select game tenpai defeat ＋ 七國 qi chu yan han wei zhao qin。牌桌上播哪一首見 src/bgm-scene.js。

   ── 瀏覽器的自動播放限制 ──
   AudioContext 必須在使用者手勢之後才能啟動。呼叫端要在第一次點擊／按鍵時
   叫一次 `resume()`，否則靜悄悄什麼都不會響（不會報錯，很難查）。
   ═══════════════════════════════════════════════════════════════ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.MJAudio = api; root.SFX = api.SFX; root.BGM = api.BGM; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
'use strict';

const SFX = (() => {
  let ctx = null;
  let masterGain = null;
  let enabled = true;
  let volume = 0.7;

  function getCtx() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      masterGain = ctx.createGain();
      masterGain.gain.value = volume;
      masterGain.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  // Low-level: play a tone burst
  function tone(freq, type, attack, decay, sustain, release, duration, gainVal=1, detune=0) {
    if (!enabled) return;
    try {
      const c = getCtx();
      const osc = c.createOscillator();
      const g = c.createGain();
      osc.connect(g); g.connect(masterGain);
      osc.type = type;
      osc.frequency.value = freq;
      osc.detune.value = detune;
      const now = c.currentTime;
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(gainVal, now + attack);
      g.gain.linearRampToValueAtTime(gainVal * sustain, now + attack + decay);
      g.gain.linearRampToValueAtTime(0, now + duration + release);
      osc.start(now);
      osc.stop(now + duration + release + 0.05);
    } catch(e) {}
  }

  function noise(duration, freq=800, q=5, gainVal=0.3) {
    if (!enabled) return;
    try {
      const c = getCtx();
      const bufSize = c.sampleRate * duration;
      const buf = c.createBuffer(1, bufSize, c.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;
      const src = c.createBufferSource();
      src.buffer = buf;
      const filter = c.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = freq;
      filter.Q.value = q;
      const g = c.createGain();
      g.gain.setValueAtTime(gainVal, c.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + duration);
      src.connect(filter); filter.connect(g); g.connect(masterGain);
      src.start(c.currentTime);
    } catch(e) {}
  }

  // ---- Sound definitions ----

  // 摸牌 - soft tile slide
  function draw() {
    tone(600, 'sine', 0.005, 0.04, 0.1, 0.08, 0.1, 0.18);
    noise(0.08, 1200, 8, 0.12);
  }

  // 棄牌 - tile tap/click
  function discard() {
    tone(320, 'triangle', 0.003, 0.03, 0.05, 0.1, 0.12, 0.25);
    noise(0.1, 800, 12, 0.2);
  }

  // 選牌 - light click
  function select() {
    tone(900, 'sine', 0.002, 0.02, 0.1, 0.05, 0.06, 0.12);
  }

  // 碰 - firm double tap
  function pong() {
    tone(280, 'triangle', 0.003, 0.04, 0.2, 0.12, 0.18, 0.4);
    setTimeout(() => tone(320, 'triangle', 0.003, 0.04, 0.2, 0.12, 0.15, 0.35), 80);
  }

  // 吃 - sequence jingle
  function chi() {
    [440, 550, 660].forEach((f, i) =>
      setTimeout(() => tone(f, 'sine', 0.005, 0.05, 0.3, 0.1, 0.15, 0.3), i * 70)
    );
  }

  // 槓 - deep thud + ring
  function kong() {
    tone(180, 'sawtooth', 0.005, 0.06, 0.2, 0.25, 0.3, 0.5);
    tone(880, 'sine', 0.01, 0.05, 0.15, 0.4, 0.5, 0.25);
    noise(0.15, 400, 6, 0.3);
  }

  // 胡牌 - triumphant fanfare
  function win() {
    const fanfare = [
      [523, 0],   // C5
      [659, 120], // E5
      [784, 240], // G5
      [1047, 400], // C6
      [784, 560],
      [1047, 680],
    ];
    fanfare.forEach(([f, delay]) =>
      setTimeout(() => tone(f, 'sine', 0.01, 0.05, 0.6, 0.2, 0.4, 0.5), delay)
    );
    setTimeout(() => noise(0.3, 3000, 3, 0.15), 400);
  }

  // 特殊牌型 - extra flourish on top of win
  function specialWin() {
    win();
    const extra = [523, 659, 784, 880, 1047, 1175, 1319];
    extra.forEach((f, i) =>
      setTimeout(() => tone(f, 'triangle', 0.008, 0.04, 0.5, 0.15, 0.3, 0.35, i*10), 700 + i*90)
    );
  }

  // 敗北 - descending sad motif
  function lose() {
    [440, 392, 349, 294].forEach((f, i) =>
      setTimeout(() => tone(f, 'triangle', 0.01, 0.08, 0.4, 0.3, 0.4, 0.35), i * 180)
    );
  }

  // 平局 - neutral chime
  function draw_game() {
    tone(440, 'sine', 0.01, 0.1, 0.5, 0.5, 0.6, 0.3);
    setTimeout(() => tone(440, 'sine', 0.01, 0.1, 0.5, 0.5, 0.6, 0.2), 350);
  }

  // 一統天下 - grand victory
  function victory() {
    const melody = [523,659,784,659,784,1047,880,1047];
    melody.forEach((f, i) =>
      setTimeout(() => tone(f, 'sine', 0.01, 0.06, 0.7, 0.2, 0.5, 0.6), i * 160)
    );
    setTimeout(() => {
      [523,659,784].forEach((f,i) => setTimeout(() => tone(f,'triangle',0.01,0.06,0.8,0.3,0.6,0.5), i*100));
    }, 1400);
  }

  // 按鈕點擊 - subtle UI click
  function click() {
    tone(700, 'sine', 0.003, 0.03, 0.1, 0.06, 0.07, 0.1);
  }

  // 新回合 - short intro motif
  function newRound() {
    [392, 494, 587].forEach((f, i) =>
      setTimeout(() => tone(f, 'sine', 0.01, 0.05, 0.4, 0.2, 0.3, 0.35), i * 100)
    );
  }

  // 聽牌提示 - alert chime
  function tenpai() {
    tone(880, 'sine', 0.005, 0.04, 0.3, 0.15, 0.25, 0.3);
    setTimeout(() => tone(1100, 'sine', 0.005, 0.04, 0.3, 0.2, 0.3, 0.25), 200);
  }

  // 存檔提示音 - 古鐘輕叩兩聲
  function save() {
    // 第一聲：低沉古鐘
    tone(220, 'sine', 0.005, 0.1, 0.6, 0.8, 1.0, 0.25);
    tone(220, 'triangle', 0.005, 0.1, 0.4, 0.6, 0.8, 0.08, 5);
    // 第二聲：稍高，餘韻
    setTimeout(()=>{
      tone(330, 'sine', 0.005, 0.08, 0.5, 0.9, 0.9, 0.18);
      tone(330, 'triangle', 0.005, 0.08, 0.3, 0.5, 0.7, 0.06, -3);
    }, 320);
  }

  return { draw, discard, select, pong, chi, kong, win, specialWin, lose, draw_game, victory, click, newRound, tenpai, save,
    setEnabled(v) { enabled = v; },
    setVolume(v) { volume = v; if (masterGain) masterGain.gain.value = v; },
    isEnabled() { return enabled; },
  };
})();

const BGM = (() => {
  /* ═══ BGM：播 assets/audio/bgm/*.mp3（2026-10-16 起）═══
     原本這裡是 Web Audio 即時合成的曲子（每一軌一個 setInterval）。計時器晚到的量每軌不一樣而且會累積，
     播一陣子鼓點就跟旋律對不上（使用者回報擇國而立）→ 使用者決定全部 BGM 改成 MIDI、用 GarageBand 的取樣
     演奏成音檔（tools/bgm_midi.py、build-*-bgm-midi.py；試聽台 devtools/BGM試聽台）。

     ‧ 曲目清單：assets/audio/bgm/manifest.js（window.MJ_BGM：src、loopStart、loopEnd）。
       頁面沒載的話這裡自己補載一次 —— src/*.js 是各版共用的，舊版頁面也會跑到這份
     ‧ 無縫循環：檔案前後各多接一小段循環本身的內容，只在 [loopStart, loopEnd) 裡繞（理由見 bgm_midi.py）
     ‧ http(s)：fetch → decodeAudioData → AudioBufferSourceNode.loop（真正無縫）
       雙擊開的 file://：fetch 讀不了本機檔 → 改用 <audio>，播到 loopEnd 就跳回去（接縫可能有一點點頓，只有本機開發會遇到）
     ‧ 換曲是交叉淡化：舊的淡出、新的載好就淡入
     ‧ 對外介面跟原本一樣：play(scene, fade)、stop(fade)、setEnabled、setVolume、isEnabled、getVolume、currentScene */
  let ctx = null;
  let masterGain = null;
  let enabled = true;
  let volume = 0.45;            // 音檔都標準化到 -16 LUFS；BGM 墊在音效底下，不用開滿
  let current = null;           // { scene, stop(fade), setVol() }
  let currentScene = null;
  /* ⚠️ 換曲子時新曲子要等音檔載好才開始，currentScene 要等那一刻才設。
     在那段空檔裡再叫一次 play()（例如開場動畫結束叫一次 play('title')、showScreen 緊接著又叫一次）
     不能建兩份 —— 所以「排定中」的那首也記著（pendingScene），每次排定帶一個序號，
     被後來的 play()／stop() 取代的排定，載好了也不播（2026-09-24 使用者回報過兩首重疊）。 */
  let pendingScene = null, playSeq = 0;
  const loads = {};

  const G = typeof window !== 'undefined' ? window : globalThis;
  const canFetch = typeof location !== 'undefined' && /^https?:$/.test(location.protocol) && typeof fetch === 'function';

  function getCtx() {
    if (!ctx) {
      ctx = new (G.AudioContext || G.webkitAudioContext)();
      masterGain = ctx.createGain();
      masterGain.gain.value = volume;
      masterGain.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  let manifestP = null;
  function manifest() {
    if (G.MJ_BGM) return Promise.resolve(G.MJ_BGM);
    if (!manifestP) manifestP = new Promise(res => {
      try {
        const s = document.createElement('script');
        s.src = 'assets/audio/bgm/manifest.js';
        s.onload = () => res(G.MJ_BGM || {});
        s.onerror = () => res({});
        document.head.appendChild(s);
      } catch (_) { res({}); }
    });
    return manifestP;
  }

  /* 一首曲子 → { entry, buf }（Web Audio）或 { entry }（退回 <audio>）；沒有這首 → null */
  function load(scene) {
    if (!loads[scene]) loads[scene] = manifest().then(m => {
      const entry = m && m[scene];
      if (!entry) return null;
      if (!canFetch) return { entry };
      return fetch(entry.src)
        .then(r => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
        .then(ab => new Promise((res, rej) => getCtx().decodeAudioData(ab, res, rej)))
        .then(buf => ({ entry, buf }))
        .catch(() => ({ entry }));
    });
    return loads[scene];
  }

  function startBuffer(res, fade) {
    const c = getCtx();
    const { buf, entry } = res;
    const src = c.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.loopStart = entry.loopStart;
    src.loopEnd = Math.min(entry.loopEnd, buf.duration);
    const g = c.createGain();
    g.gain.setValueAtTime(0, c.currentTime);
    g.gain.linearRampToValueAtTime(1, c.currentTime + Math.max(0.05, fade));
    src.connect(g); g.connect(masterGain);
    src.start(0, entry.loopStart);
    return {
      stop(f) {
        const t = c.currentTime;
        try { g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(g.gain.value, t); g.gain.linearRampToValueAtTime(0, t + Math.max(0.02, f)); } catch (_) {}
        setTimeout(() => { try { src.stop(); } catch (_) {} try { g.disconnect(); } catch (_) {} }, (Math.max(0.02, f) + 0.1) * 1000);
      },
      setVol() {},              // 音量走 masterGain
    };
  }

  function startElement(res, fade) {
    const { entry } = res;
    const a = new Audio(entry.src);
    let level = 0, target = 1, alive = true;
    const apply = () => { a.volume = Math.max(0, Math.min(1, level * volume)); };
    const ramp = (to, sec, done) => {
      const from = level, t0 = Date.now(), ms = Math.max(20, sec * 1000);
      const step = () => {
        const k = Math.min(1, (Date.now() - t0) / ms);
        level = from + (to - from) * k; apply();
        if (k < 1 && (alive || to === 0)) setTimeout(step, 30); else if (done) done();
      };
      step();
    };
    const watch = () => {             // 播到循環終點就跳回循環起點
      if (!alive) return;
      if (a.currentTime >= entry.loopEnd) a.currentTime -= (entry.loopEnd - entry.loopStart);
      setTimeout(watch, 20);
    };
    a.addEventListener('loadedmetadata', () => { try { a.currentTime = entry.loopStart; } catch (_) {} }, { once: true });
    apply();
    a.play().then(() => { ramp(target, fade); watch(); }).catch(() => {});
    return {
      stop(f) { alive = false; ramp(0, f, () => { try { a.pause(); } catch (_) {} }); },
      setVol() { apply(); },
    };
  }

  function stopCurrent(fadeDur = 1.5) {
    playSeq++;                    // 還在排定中的那首也一起取消
    pendingScene = null;
    if (current) { try { current.stop(fadeDur <= 0 ? 0.02 : fadeDur); } catch (_) {} }
    current = null;
    currentScene = null;
  }

  function play(scene, fadeDur = 1.5) {
    if (!enabled) return;
    if (scene === currentScene && !pendingScene) return;
    if (scene === pendingScene) return;          // 已經排定要播這首了
    stopCurrent(fadeDur);
    const seq = ++playSeq;
    pendingScene = scene;
    try { getCtx(); } catch (_) {}               // 在使用者手勢裡喚醒 AudioContext（iOS 要這樣）
    if (masterGain) { masterGain.gain.cancelScheduledValues(0); masterGain.gain.setValueAtTime(volume, 0); }
    load(scene).then(res => {
      if (seq !== playSeq) return;               // 被後來的 play()／stop() 取代了
      pendingScene = null;
      if (!enabled || !res) return;
      try {
        current = res.buf ? startBuffer(res, fadeDur) : startElement(res, fadeDur);
        currentScene = scene;
      } catch (e) { console.warn('BGM error:', e); }
    });
  }

  function stop(fadeDur = 1.5) {
    stopCurrent(fadeDur);
  }

  return {
    play,
    stop,
    setEnabled(v) {
      enabled = v;
      if (!v) stopCurrent(0.5);
    },
    setVolume(v) {
      volume = v;
      if (masterGain) masterGain.gain.value = v;
      if (current) current.setVol();
    },
    isEnabled() { return enabled; },
    getVolume() { return volume; },
    /* 正在播的（或已經排定、音檔還在載的）那首 —— 動畫讓位時記下來，播完再接回去 */
    currentScene() { return currentScene || pendingScene; },
    /* 先把音檔載好（例如進牌桌前先載國曲），切過去時就不用等 */
    preload(scene) { if (enabled && scene) load(scene); },
  };
})();

/* 讓呼叫端在第一次使用者手勢時喚醒 AudioContext。
   瀏覽器的自動播放限制：手勢之前 AudioContext 會停在 suspended，
   所有聲音都不會響，而且**不會報任何錯**。 */
function resume() {
  const ctxs = [];
  try { if (typeof _actx !== 'undefined' && _actx) ctxs.push(_actx); } catch (e) {}
  try { if (typeof actx !== 'undefined' && actx) ctxs.push(actx); } catch (e) {}
  ctxs.forEach(c => { if (c.state === 'suspended' && c.resume) c.resume().catch(() => {}); });
  return ctxs.length;
}

return { SFX, BGM, resume };
});
