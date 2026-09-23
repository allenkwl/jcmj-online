/* ═══════════════════════════════════════════════════════════════
   audio.js — 音效與程序化背景音樂
   ───────────────────────────────────────────────────────────────
   ⚠️ 這個檔由 `tools/build-audio.py` 從舊版單檔自動產生，**不要手改**。
      要改請改產生器，這樣舊版更新時可以重跑。

   SFX：184 行　BGM：813 行（來源 L5640–5823 / L5826–6638）

   兩個區塊原樣搬過來，一行沒改 —— 它們是全專案封裝得最乾淨的地方：
   零個 `G.`、零個 `document.`，只有 AudioContext。不依賴遊戲狀態也不依賴 DOM，
   所以兩人版換四人版完全不用動。

   **沒有任何音檔。** 八個場景 + 七國專屬曲全是 Web Audio 即時合成，
   搬過來一個位元組的資產都不用帶。

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
  let ctx = null;
  let masterGain = null;
  let enabled = true;
  let volume = 0.35;
  let currentTrack = null;
  let currentScene = null;
  let stopScheduled = false;

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

  // Fade gain node over `dur` seconds
  function fadeGain(g, from, to, dur) {
    const now = ctx.currentTime;
    g.gain.cancelScheduledValues(now);
    g.gain.setValueAtTime(from, now);
    g.gain.linearRampToValueAtTime(to, now + dur);
  }

  // Low-level tone generator that returns {osc, gain, stop()}
  function makeTone(freq, type, gainVal, detune=0) {
    const c = getCtx();
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    if(detune) osc.detune.value = detune;
    osc.connect(g);
    g.gain.value = gainVal;
    return { osc, gain: g, connect(dest){ g.connect(dest); }, start(){ osc.start(); }, stop(t){ osc.stop(t||0); } };
  }

  // Low-level looping noise band
  function makeNoise(loFreq, hiFreq, gainVal) {
    const c = getCtx();
    const bufSize = c.sampleRate * 2;
    const buf = c.createBuffer(1, bufSize, c.sampleRate);
    const d = buf.getChannelData(0);
    for(let i=0;i<bufSize;i++) d[i] = Math.random()*2-1;
    const src = c.createBufferSource();
    src.buffer = buf; src.loop = true;
    const lo = c.createBiquadFilter(); lo.type='lowpass'; lo.frequency.value=hiFreq;
    const hi = c.createBiquadFilter(); hi.type='highpass'; hi.frequency.value=loFreq;
    const g = c.createGain(); g.gain.value = gainVal;
    src.connect(lo); lo.connect(hi); hi.connect(g);
    return { src, gain: g, connect(dest){ g.connect(dest); }, start(){ src.start(); }, stop(){ try{src.stop();}catch(e){} } };
  }

  // ── TRACK BUILDERS ──────────────────────────────────────────

  // TITLE: 古風 pentatonic drone + slow arp
  function buildTitle(masterG, _ts) {
    const c = getCtx();
    const nodes = [];

    // ── 古琴五聲宮調旋律 D E G A B ──
    const guqinHigh = [293.7, 329.6, 392.0, 440.0, 493.9]; // D4 E4 G4 A4 B4
    const guqinMid  = [146.8, 164.8, 196.0, 220.0, 246.9]; // D3 E3 G3 A3 B3
    const melody = [
      guqinHigh[0], guqinHigh[1], guqinHigh[2], guqinHigh[3], guqinHigh[4],
      guqinHigh[1], guqinMid[2],  guqinMid[1],  guqinMid[0],  null,         // rest
      guqinHigh[0], guqinHigh[2], guqinHigh[3], guqinHigh[4], guqinMid[3],
      guqinMid[0],  null,                                                     // rest + end
    ];
    let melStep = 0;
    const melInterval = setInterval(() => {
      if(_ts.stopped){ clearInterval(melInterval); return; }
      if(!enabled) return;
      const freq = melody[melStep % melody.length];
      melStep++;
      if(!freq) return; // rest
      try {
        const now = c.currentTime;
        const osc1 = c.createOscillator(); const g1 = c.createGain();
        osc1.type = 'triangle'; osc1.frequency.value = freq;
        g1.gain.setValueAtTime(0, now);
        g1.gain.linearRampToValueAtTime(0.13, now + 0.015);
        g1.gain.exponentialRampToValueAtTime(0.001, now + 2.2);
        osc1.connect(g1); g1.connect(masterG);
        osc1.start(now); osc1.stop(now + 2.3);
        // 泛音（五度）
        const osc2 = c.createOscillator(); const g2 = c.createGain();
        osc2.type = 'sine'; osc2.frequency.value = freq * 1.5;
        g2.gain.setValueAtTime(0, now);
        g2.gain.linearRampToValueAtTime(0.025, now + 0.01);
        g2.gain.exponentialRampToValueAtTime(0.001, now + 1.0);
        osc2.connect(g2); g2.connect(masterG);
        osc2.start(now); osc2.stop(now + 1.1);
      } catch(e){}
    }, 900); // 每0.9秒一個音符

    // ── 編鐘：每8秒一次 ──
    let bellCount = 0;
    const bellInterval = setInterval(() => {
      if(_ts.stopped){ clearInterval(bellInterval); return; }
      if(!enabled) return;
      try {
        const now = c.currentTime;
        [[73.4, 0.18], [110, 0.10], [146.8, 0.06]].forEach(([f, gv], i) => {
          const osc = c.createOscillator(); const gain = c.createGain();
          osc.type = 'sine'; osc.frequency.value = f;
          gain.gain.setValueAtTime(0, now + i*0.03);
          gain.gain.linearRampToValueAtTime(gv, now + i*0.03 + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 4.5);
          osc.connect(gain); gain.connect(masterG);
          osc.start(now + i*0.03); osc.stop(now + 4.6);
        });
      } catch(e){}
    }, 8000);
    // 立即打一次鐘
    try {
      const now = c.currentTime;
      [[73.4, 0.18], [110, 0.10], [146.8, 0.06]].forEach(([f, gv], i) => {
        const osc = c.createOscillator(); const gain = c.createGain();
        osc.type = 'sine'; osc.frequency.value = f;
        gain.gain.setValueAtTime(0, now + i*0.03);
        gain.gain.linearRampToValueAtTime(gv, now + i*0.03 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 4.5);
        osc.connect(gain); gain.connect(masterG);
        osc.start(now + i*0.03); osc.stop(now + 4.6);
      });
    } catch(e){}

    // ── 山風環境音 ──
    const wind = makeNoise(60, 400, 0.025);
    wind.connect(masterG); wind.start(); nodes.push(wind);

    // ── 低頻土地共鳴 ──
    const drone = makeTone(36.7, 'sine', 0.04);
    const droneLP = c.createBiquadFilter(); droneLP.type='lowpass'; droneLP.frequency.value=120;
    drone.connect(droneLP); droneLP.connect(masterG);
    drone.start(); nodes.push(drone);

    return { nodes, intervals: [melInterval, bellInterval] };
  }

  // SELECT: 緊張 war drums + rising tension
  function buildSelect(masterG, _ts) {
    const c = getCtx();
    const nodes = [];

    // Bass pulse on beat (D1)
    const drumInterval = setInterval(() => {
      if(_ts.stopped){ clearInterval(drumInterval); return; }
      if(!enabled) return;
      try {
        const now = c.currentTime;
        // Kick drum: pitch drop + noise
        const osc = c.createOscillator();
        const g = c.createGain();
        osc.type = 'sine'; osc.frequency.setValueAtTime(160, now);
        osc.frequency.exponentialRampToValueAtTime(40, now+0.15);
        g.gain.setValueAtTime(0.5, now);
        g.gain.exponentialRampToValueAtTime(0.001, now+0.22);
        osc.connect(g); g.connect(masterG);
        osc.start(now); osc.stop(now+0.25);
        // Snare on beat 3
      } catch(e){}
    }, 480);

    // Snare (offset by half)
    const snareInterval = setInterval(() => {
      if(_ts.stopped){ clearInterval(snareInterval); return; }
      if(!enabled) return;
      try {
        const now = c.currentTime;
        const bufSize = c.sampleRate * 0.12;
        const buf = c.createBuffer(1, bufSize, c.sampleRate);
        const d = buf.getChannelData(0);
        for(let i=0;i<bufSize;i++) d[i] = (Math.random()*2-1) * Math.pow(1-i/bufSize, 2);
        const src = c.createBufferSource(); src.buffer = buf;
        const hp = c.createBiquadFilter(); hp.type='highpass'; hp.frequency.value=1200;
        const g = c.createGain(); g.gain.value = 0.28;
        src.connect(hp); hp.connect(g); g.connect(masterG);
        src.start(now);
      } catch(e){}
    }, 960);

    // Tense melody: minor pentatonic riff
    const riff = [220, 247, 262, 220, 196, 220, 247, 294];
    let ri = 0;
    const riffInterval = setInterval(() => {
      if(_ts.stopped){ clearInterval(riffInterval); return; }
      if(!enabled) return;
      try {
        const osc = c.createOscillator();
        const g = c.createGain();
        const lp = c.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value=900;
        osc.type = 'sawtooth';
        osc.frequency.value = riff[ri % riff.length] * 2;
        const now = c.currentTime;
        g.gain.setValueAtTime(0.08, now);
        g.gain.exponentialRampToValueAtTime(0.001, now+0.38);
        osc.connect(lp); lp.connect(g); g.connect(masterG);
        osc.start(now); osc.stop(now+0.4);
        ri++;
      } catch(e){}
    }, 240);

    // Low rumble
    const rumble = makeNoise(20, 120, 0.06);
    rumble.connect(masterG); rumble.start(); nodes.push(rumble);

    return { nodes, intervals: [drumInterval, snareInterval, riffInterval] };
  }

  // GAME: 戰場 ambient loop — tension, focus
  function buildGame(masterG, _ts) {
    const c = getCtx();
    const nodes = [];

    // Sustained pad: open 5th (A2 + E3) with vibrato
    const padFreqs = [110, 165, 220, 330];
    padFreqs.forEach((f,i) => {
      const osc = c.createOscillator();
      const g = c.createGain();
      const lp = c.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value=500;
      osc.type = 'sawtooth';
      osc.frequency.value = f;
      osc.detune.value = (i%2===0 ? 1:-1) * (3 + i*2);
      g.gain.value = 0.04;
      osc.connect(lp); lp.connect(g); g.connect(masterG);
      osc.start();
      nodes.push({ stop: () => { try{osc.stop();}catch(e){} } });
    });

    // Slow vibrato LFO
    const lfo = c.createOscillator();
    const lfoG = c.createGain(); lfoG.gain.value = 5;
    lfo.frequency.value = 4.2; lfo.type='sine';
    lfo.connect(lfoG);
    padFreqs.forEach((_, i) => { /* connects via osc detune */ });
    lfo.start();
    nodes.push({ stop: () => { try{lfo.stop();}catch(e){} } });

    // Heartbeat low pulse
    const pulseInterval = setInterval(() => {
      if(_ts.stopped){ clearInterval(pulseInterval); return; }
      if(!enabled) return;
      try {
        const now = c.currentTime;
        [0, 0.18].forEach(offset => {
          const o = c.createOscillator();
          const g = c.createGain();
          o.type='sine'; o.frequency.value=55;
          g.gain.setValueAtTime(0, now+offset);
          g.gain.linearRampToValueAtTime(0.22, now+offset+0.04);
          g.gain.exponentialRampToValueAtTime(0.001, now+offset+0.28);
          o.connect(g); g.connect(masterG);
          o.start(now+offset); o.stop(now+offset+0.3);
        });
      } catch(e){}
    }, 1800);

    // Sparse pluck melody — pentatonic
    const melody = [440,494,587,659,587,440,494,392,440,587,659,587,494,440];
    let mi = 0;
    const melodyInterval = setInterval(() => {
      if(_ts.stopped){ clearInterval(melodyInterval); return; }
      if(!enabled) return;
      if(Math.random()<0.45) { mi++; return; } // sparse
      try {
        const now = c.currentTime;
        const osc = c.createOscillator();
        const g = c.createGain();
        const lp = c.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value=2000;
        osc.type='triangle'; osc.frequency.value=melody[mi%melody.length];
        g.gain.setValueAtTime(0.07, now);
        g.gain.exponentialRampToValueAtTime(0.001, now+0.5);
        osc.connect(lp); lp.connect(g); g.connect(masterG);
        osc.start(now); osc.stop(now+0.55);
        mi++;
      } catch(e){}
    }, 500);

    // Wind ambience
    const wind = makeNoise(100, 800, 0.025);
    wind.connect(masterG); wind.start(); nodes.push(wind);

    return { nodes, intervals: [pulseInterval, melodyInterval] };
  }

  // TENPAI: 聽牌緊張音樂 — 急促鼓點 + 高張力旋律 + 心跳低音
  function buildTenpai(masterG, _ts) {
    const c = getCtx();
    const nodes = [];
    const BPM = 160; // faster than game (was ~67 bpm heartbeat)
    const beat = 60 / BPM; // seconds per beat

    // ── Fast war drum: kick on every beat ──
    const drumInterval = setInterval(() => {
      if(_ts.stopped){ clearInterval(drumInterval); return; }
      if(!enabled) return;
      try {
        const now = c.currentTime;
        const o = c.createOscillator();
        const g = c.createGain();
        o.type = 'sine';
        o.frequency.setValueAtTime(180, now);
        o.frequency.exponentialRampToValueAtTime(38, now + 0.12);
        g.gain.setValueAtTime(0.6, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
        o.connect(g); g.connect(masterG);
        o.start(now); o.stop(now + 0.2);
      } catch(e){}
    }, beat * 1000);

    // ── Snare on beat 2 & 4 ──
    const snareInterval = setInterval(() => {
      if(_ts.stopped){ clearInterval(snareInterval); return; }
      if(!enabled) return;
      try {
        const now = c.currentTime;
        const bsz = Math.floor(c.sampleRate * 0.09);
        const buf = c.createBuffer(1, bsz, c.sampleRate);
        const d2 = buf.getChannelData(0);
        for(let i=0;i<bsz;i++) d2[i]=(Math.random()*2-1)*Math.pow(1-i/bsz,1.5);
        const src = c.createBufferSource(); src.buffer = buf;
        const hp = c.createBiquadFilter(); hp.type='highpass'; hp.frequency.value=1800;
        const g = c.createGain(); g.gain.value = 0.35;
        src.connect(hp); hp.connect(g); g.connect(masterG);
        src.start(now);
      } catch(e){}
    }, beat * 2000); // every 2 beats

    // ── Tense tremolo ostinato: repeating minor 2nd figure ──
    // D-Eb repeated fast (classic tension device)
    const ostinNotes = [294, 311, 294, 311, 262, 277, 262, 277];
    let oi = 0;
    const ostinInterval = setInterval(() => {
      if(_ts.stopped){ clearInterval(ostinInterval); return; }
      if(!enabled) return;
      try {
        const now = c.currentTime;
        const o = c.createOscillator();
        const g = c.createGain();
        const lp = c.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value=1200;
        o.type = 'sawtooth';
        o.frequency.value = ostinNotes[oi % ostinNotes.length] * 2;
        g.gain.setValueAtTime(0.09, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
        o.connect(lp); lp.connect(g); g.connect(masterG);
        o.start(now); o.stop(now + 0.16);
        oi++;
      } catch(e){}
    }, beat * 500); // 8th notes at BPM=160

    // ── Rising tension bass line: stepwise descent ──
    const bassNotes = [110, 98, 87, 82, 78, 73, 69, 65];
    let bi = 0;
    const bassInterval = setInterval(() => {
      if(_ts.stopped){ clearInterval(bassInterval); return; }
      if(!enabled) return;
      try {
        const now = c.currentTime;
        const o = c.createOscillator();
        const g = c.createGain();
        const lp = c.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value=350;
        o.type = 'sawtooth';
        o.frequency.value = bassNotes[bi % bassNotes.length];
        g.gain.setValueAtTime(0.18, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + beat * 1.8);
        o.connect(lp); lp.connect(g); g.connect(masterG);
        o.start(now); o.stop(now + beat * 2);
        bi++;
      } catch(e){}
    }, beat * 2000);

    // ── Sustained high drone: adds oppressive brightness ──
    const droneOsc = c.createOscillator();
    const droneG = c.createGain();
    const droneLfo = c.createOscillator();
    const droneLfoG = c.createGain();
    droneOsc.type = 'sawtooth'; droneOsc.frequency.value = 587; // D5
    droneLfo.type = 'sine'; droneLfo.frequency.value = 6; // fast vibrato
    droneLfoG.gain.value = 8;
    droneLfo.connect(droneLfoG); droneLfoG.connect(droneOsc.frequency);
    droneG.gain.value = 0.05;
    droneOsc.connect(droneG); droneG.connect(masterG);
    droneOsc.start(); droneLfo.start();
    nodes.push({ stop(){ try{droneOsc.stop();droneLfo.stop();}catch(e){} } });

    // ── High tension noise rumble ──
    const rumble = makeNoise(60, 200, 0.08);
    rumble.connect(masterG); rumble.start(); nodes.push(rumble);

    return { nodes, intervals: [drumInterval, snareInterval, ostinInterval, bassInterval] };
  }

  // ── KINGDOM BGMs ────────────────────────────────────────────

  // QI 齊國 - 東方大國, 富庶之地: 悠揚五聲音階，水波感，從容不迫
  function buildKingdom_qi(masterG, _ts){
    const c=getCtx(), nodes=[];
    // Pentatonic: D E G A B (商調)
    const penta=[293,330,392,440,494,587,659,587,494,440,392,330,293,330];
    let mi=0;
    const mel=setInterval(()=>{
      if(_ts.stopped){clearInterval(mel);return;}if(!enabled)return;
      try{const now=c.currentTime;const o=c.createOscillator();const g=c.createGain();
        const lp=c.createBiquadFilter();lp.type='lowpass';lp.frequency.value=2200;
        o.type='triangle';o.frequency.value=penta[mi%penta.length];
        g.gain.setValueAtTime(0,now);g.gain.linearRampToValueAtTime(0.11,now+0.06);
        g.gain.exponentialRampToValueAtTime(0.001,now+0.9);
        o.connect(lp);lp.connect(g);g.connect(masterG);o.start(now);o.stop(now+0.95);mi++;}catch(e){}
    },700);
    // Water ripple - gentle noise
    const water=makeNoise(200,800,0.022);water.connect(masterG);water.start();nodes.push(water);
    // Bass drone D2
    [73.4,110].forEach(f=>{const o=c.createOscillator();const g=c.createGain();
      const lp=c.createBiquadFilter();lp.type='lowpass';lp.frequency.value=300;
      o.type='sine';o.frequency.value=f;g.gain.value=0.05;
      o.connect(lp);lp.connect(g);g.connect(masterG);o.start();
      nodes.push({stop(){try{o.stop();}catch(e){}}});});
    return{nodes,intervals:[mel]};
  }

  // CHU 楚國 - 南方霸主, 地廣兵強: 深沉低音, 熱帶感, 強烈節拍
  function buildKingdom_chu(masterG, _ts){
    const c=getCtx(), nodes=[];
    const BPM=105, beat=60/BPM;
    // Heavy tom-like drum
    const drum=setInterval(()=>{
      if(_ts.stopped){clearInterval(drum);return;}if(!enabled)return;
      try{const now=c.currentTime;
        [[0,130,50],[beat*0.5,90,35],[beat*1.5,110,42]].forEach(([off,f0,f1])=>{
          const o=c.createOscillator();const g=c.createGain();
          o.type='sine';o.frequency.setValueAtTime(f0,now+off);
          o.frequency.exponentialRampToValueAtTime(f1,now+off+0.18);
          g.gain.setValueAtTime(0.45,now+off);g.gain.exponentialRampToValueAtTime(0.001,now+off+0.25);
          o.connect(g);g.connect(masterG);o.start(now+off);o.stop(now+off+0.28);});}catch(e){}
    },beat*2000);
    // Pentatonic minor riff (南呂調 Gm pentatonic)
    const riff=[196,220,262,294,349,294,262,220,196,175,196,220];
    let ri=0;
    const mel=setInterval(()=>{
      if(_ts.stopped){clearInterval(mel);return;}if(!enabled)return;
      try{const now=c.currentTime;const o=c.createOscillator();const g=c.createGain();
        const lp=c.createBiquadFilter();lp.type='lowpass';lp.frequency.value=900;
        o.type='sawtooth';o.frequency.value=riff[ri%riff.length];
        g.gain.setValueAtTime(0.07,now);g.gain.exponentialRampToValueAtTime(0.001,now+0.55);
        o.connect(lp);lp.connect(g);g.connect(masterG);o.start(now);o.stop(now+0.6);ri++;}catch(e){}
    },beat*1000);
    const rumble=makeNoise(30,150,0.07);rumble.connect(masterG);rumble.start();nodes.push(rumble);
    return{nodes,intervals:[drum,mel]};
  }

  // YAN 燕國 - 北境寒地, 奇謀迭出: 蕭瑟寒風, 神秘色調, 不規則節奏
  function buildKingdom_yan(masterG, _ts){
    const c=getCtx(), nodes=[];
    // Eerie sustained pads in Lydian mode (mystical)
    const pads=[174.6,220,277,329,440];
    pads.forEach((f,i)=>{
      const o=c.createOscillator();const g=c.createGain();
      const lp=c.createBiquadFilter();lp.type='lowpass';lp.frequency.value=400;
      o.type='sawtooth';o.frequency.value=f;o.detune.value=(i%2===0?1:-1)*7;
      g.gain.value=0.026;o.connect(lp);lp.connect(g);g.connect(masterG);o.start();
      nodes.push({stop(){try{o.stop();}catch(e){}}});});
    // Cold wind
    const wind=makeNoise(300,1800,0.045);wind.connect(masterG);wind.start();nodes.push(wind);
    // Sparse pluck — irregular timing
    const sparse=[277,311,370,415,277,370,311,415,329,277];
    let si=0;
    const pluck=setInterval(()=>{
      if(_ts.stopped){clearInterval(pluck);return;}if(!enabled)return;
      if(Math.random()<0.4){si++;return;}
      try{const now=c.currentTime;const o=c.createOscillator();const g=c.createGain();
        o.type='triangle';o.frequency.value=sparse[si%sparse.length];
        g.gain.setValueAtTime(0.09,now);g.gain.exponentialRampToValueAtTime(0.001,now+0.7);
        o.connect(g);g.connect(masterG);o.start(now);o.stop(now+0.75);si++;}catch(e){}
    },550);
    return{nodes,intervals:[pluck]};
  }

  // HAN 韓國 - 兵器精良, 守城有術: 金屬感, 穩健行軍節奏
  function buildKingdom_han(masterG, _ts){
    const c=getCtx(), nodes=[];
    const BPM=112, beat=60/BPM;
    // March snare
    const snare=setInterval(()=>{
      if(_ts.stopped){clearInterval(snare);return;}if(!enabled)return;
      try{const now=c.currentTime;const bsz=Math.floor(c.sampleRate*0.1);
        const buf=c.createBuffer(1,bsz,c.sampleRate);const d2=buf.getChannelData(0);
        for(let i=0;i<bsz;i++)d2[i]=(Math.random()*2-1)*Math.pow(1-i/bsz,1.8);
        const src=c.createBufferSource();src.buffer=buf;
        const hp=c.createBiquadFilter();hp.type='highpass';hp.frequency.value=1400;
        const g=c.createGain();g.gain.value=0.3;
        src.connect(hp);hp.connect(g);g.connect(masterG);src.start(now);}catch(e){}
    },beat*2000);
    // Metallic melody — A minor (martial)
    const mel=[440,494,523,440,392,440,349,392,440,494,440,392];
    let mi=0;
    const melInt=setInterval(()=>{
      if(_ts.stopped){clearInterval(melInt);return;}if(!enabled)return;
      try{const now=c.currentTime;const o=c.createOscillator();const g=c.createGain();
        const lp=c.createBiquadFilter();lp.type='lowpass';lp.frequency.value=1600;
        o.type='square';o.frequency.value=mel[mi%mel.length];
        g.gain.setValueAtTime(0.06,now);g.gain.exponentialRampToValueAtTime(0.001,now+0.4);
        o.connect(lp);lp.connect(g);g.connect(masterG);o.start(now);o.stop(now+0.45);mi++;}catch(e){}
    },beat*1000);
    const kick=setInterval(()=>{
      if(_ts.stopped){clearInterval(kick);return;}if(!enabled)return;
      try{const now=c.currentTime;const o=c.createOscillator();const g=c.createGain();
        o.type='sine';o.frequency.setValueAtTime(150,now);o.frequency.exponentialRampToValueAtTime(35,now+0.15);
        g.gain.setValueAtTime(0.4,now);g.gain.exponentialRampToValueAtTime(0.001,now+0.2);
        o.connect(g);g.connect(masterG);o.start(now);o.stop(now+0.22);}catch(e){}
    },beat*1000);
    return{nodes:[],intervals:[snare,melInt,kick]};
  }

  // WEI 魏國 - 中原要衝, 四戰之地: 激烈衝突感, 快速交替, 緊張中原
  function buildKingdom_wei(masterG, _ts){
    const c=getCtx(), nodes=[];
    const BPM=130, beat=60/BPM;
    // Fast aggressive drums
    const drum=setInterval(()=>{
      if(_ts.stopped){clearInterval(drum);return;}if(!enabled)return;
      try{const now=c.currentTime;const o=c.createOscillator();const g=c.createGain();
        o.type='sine';o.frequency.setValueAtTime(170,now);o.frequency.exponentialRampToValueAtTime(40,now+0.12);
        g.gain.setValueAtTime(0.55,now);g.gain.exponentialRampToValueAtTime(0.001,now+0.18);
        o.connect(g);g.connect(masterG);o.start(now);o.stop(now+0.2);}catch(e){}
    },beat*1000);
    // Aggressive riff — D Phrygian (harsh)
    const riff=[294,277,262,294,311,294,262,247,262,294,277,262];
    let ri=0;
    const mel=setInterval(()=>{
      if(_ts.stopped){clearInterval(mel);return;}if(!enabled)return;
      try{const now=c.currentTime;const o=c.createOscillator();const g=c.createGain();
        const lp=c.createBiquadFilter();lp.type='lowpass';lp.frequency.value=1100;
        o.type='sawtooth';o.frequency.value=riff[ri%riff.length]*2;
        g.gain.setValueAtTime(0.08,now);g.gain.exponentialRampToValueAtTime(0.001,now+0.28);
        o.connect(lp);lp.connect(g);g.connect(masterG);o.start(now);o.stop(now+0.3);ri++;}catch(e){}
    },beat*500);
    const rumble=makeNoise(50,200,0.06);rumble.connect(masterG);rumble.start();nodes.push(rumble);
    return{nodes,intervals:[drum,mel]};
  }

  // ZHAO 趙國 - 騎射天下第一: 奔騰感, 開闊草原, 律動強勁
  function buildKingdom_zhao(masterG, _ts){
    const c=getCtx(), nodes=[];
    const BPM=120, beat=60/BPM;
    // Galloping triplet kick pattern
    const gallop=setInterval(()=>{
      if(_ts.stopped){clearInterval(gallop);return;}if(!enabled)return;
      try{const now=c.currentTime;
        [0,beat/3,beat*2/3].forEach(off=>{
          const o=c.createOscillator();const g=c.createGain();
          o.type='sine';o.frequency.setValueAtTime(160,now+off);
          o.frequency.exponentialRampToValueAtTime(45,now+off+0.1);
          g.gain.setValueAtTime(off===0?0.5:0.3,now+off);
          g.gain.exponentialRampToValueAtTime(0.001,now+off+0.15);
          o.connect(g);g.connect(masterG);o.start(now+off);o.stop(now+off+0.18);});}catch(e){}
    },beat*1000);
    // Heroic melody — E major (bright, open)
    const hero=[330,370,415,440,494,554,494,440,415,370,330,294,330,370];
    let hi=0;
    const mel=setInterval(()=>{
      if(_ts.stopped){clearInterval(mel);return;}if(!enabled)return;
      try{const now=c.currentTime;const o=c.createOscillator();const g=c.createGain();
        o.type='triangle';o.frequency.value=hero[hi%hero.length];
        g.gain.setValueAtTime(0.1,now);g.gain.exponentialRampToValueAtTime(0.001,now+0.55);
        o.connect(g);g.connect(masterG);o.start(now);o.stop(now+0.6);hi++;}catch(e){}
    },beat*1000);
    // Open fifth drone (E2-B2)
    [82.4,123.5].forEach(f=>{const o=c.createOscillator();const g=c.createGain();
      o.type='sawtooth';o.frequency.value=f;g.gain.value=0.04;
      const lp=c.createBiquadFilter();lp.type='lowpass';lp.frequency.value=350;
      o.connect(lp);lp.connect(g);g.connect(masterG);o.start();
      nodes.push({stop(){try{o.stop();}catch(e){}}});});
    return{nodes,intervals:[gallop,mel]};
  }

  // QIN 秦國 - 虎狼之師, 六合必歸: 帝王威嚴, 重低音, 不可阻擋
  function buildKingdom_qin(masterG, _ts){
    const c=getCtx(), nodes=[];
    const BPM=95, beat=60/BPM;
    // Massive battle drum
    const drum=setInterval(()=>{
      if(_ts.stopped){clearInterval(drum);return;}if(!enabled)return;
      try{const now=c.currentTime;
        const o=c.createOscillator();const g=c.createGain();
        o.type='sine';o.frequency.setValueAtTime(120,now);o.frequency.exponentialRampToValueAtTime(28,now+0.22);
        g.gain.setValueAtTime(0.7,now);g.gain.exponentialRampToValueAtTime(0.001,now+0.3);
        o.connect(g);g.connect(masterG);o.start(now);o.stop(now+0.35);}catch(e){}
    },beat*2000);
    // Imperial brass melody — C major (majestic)
    const brass=[262,294,330,349,392,440,392,349,330,294,262,247,262,294];
    let bi2=0;
    const mel=setInterval(()=>{
      if(_ts.stopped){clearInterval(mel);return;}if(!enabled)return;
      try{const now=c.currentTime;const o=c.createOscillator();const g=c.createGain();
        const lp=c.createBiquadFilter();lp.type='lowpass';lp.frequency.value=800;
        o.type='sawtooth';o.frequency.value=brass[bi2%brass.length];
        g.gain.setValueAtTime(0.09,now);g.gain.exponentialRampToValueAtTime(0.001,now+0.7);
        o.connect(lp);lp.connect(g);g.connect(masterG);o.start(now);o.stop(now+0.75);bi2++;}catch(e){}
    },beat*2000);
    // Heavy rumble
    const rumble=makeNoise(20,100,0.09);rumble.connect(masterG);rumble.start();nodes.push(rumble);
    // Majestic pad C2-G2
    [65.4,98].forEach(f=>{const o=c.createOscillator();const g=c.createGain();
      const lp=c.createBiquadFilter();lp.type='lowpass';lp.frequency.value=250;
      o.type='sawtooth';o.frequency.value=f;g.gain.value=0.06;
      o.connect(lp);lp.connect(g);g.connect(masterG);o.start();
      nodes.push({stop(){try{o.stop();}catch(e){}}});});
    return{nodes,intervals:[drum,mel]};
  }


  // DEFEAT 敗亡 - 悲愴五聲小調，緩慢哀傷
  function buildDefeat(masterG, _ts){
    const c = getCtx();
    const nodes = [];
    const BPM = 52;
    const beat = 60 / BPM;

    // D 五聲小調: D3 F3 G3 A3 C4 D4 F4 A4
    const melodySeq = [293.7, 261.6, 220.0, 196.0, 174.6, 146.8, 174.6, 196.0,
                       220.0, 196.0, 174.6, 146.8, 130.8, 146.8, 174.6, 196.0];
    // 哀傷下行旋律：每2拍一音
    let mi = 0;
    const melInterval = setInterval(() => {
      if(_ts.stopped){ clearInterval(melInterval); return; }
      if(!enabled) return;
      try {
        const now = c.currentTime;
        const freq = melodySeq[mi % melodySeq.length];
        // 「琴聲」: 三角波加緩慢衰減，模擬古琴撥弦
        const osc = c.createOscillator();
        const g   = c.createGain();
        const lp  = c.createBiquadFilter();
        lp.type = 'lowpass'; lp.frequency.value = 1800; lp.Q.value = 1.2;
        osc.type = 'triangle';
        osc.frequency.value = freq;
        g.gain.setValueAtTime(0.22, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + beat * 1.8);
        osc.connect(lp); lp.connect(g); g.connect(masterG);
        osc.start(now); osc.stop(now + beat * 2);
        // 一點泛音：高八度音量很小
        const ov = c.createOscillator();
        const og = c.createGain();
        ov.type = 'sine'; ov.frequency.value = freq * 2;
        og.gain.setValueAtTime(0.04, now);
        og.gain.exponentialRampToValueAtTime(0.001, now + beat * 0.9);
        ov.connect(og); og.connect(masterG);
        ov.start(now); ov.stop(now + beat);
        mi++;
      } catch(e){}
    }, beat * 2000);

    // 低沉持續音 D2 (bass drone)
    const drone = c.createOscillator();
    const droneG = c.createGain();
    const droneLp = c.createBiquadFilter();
    drone.type = 'sine'; drone.frequency.value = 73.4;
    droneLp.type = 'lowpass'; droneLp.frequency.value = 220;
    droneG.gain.value = 0.14;
    drone.connect(droneLp); droneLp.connect(droneG); droneG.connect(masterG);
    drone.start();
    nodes.push({ stop(){ try{drone.stop();}catch(e){} } });

    // 緩慢顫音墊 (慢LFO振幅調製，模擬弦樂)
    const pad = c.createOscillator();
    const padG = c.createGain();
    const lfo  = c.createOscillator();
    const lfoG = c.createGain();
    const padLp = c.createBiquadFilter();
    pad.type = 'sawtooth'; pad.frequency.value = 220;
    padLp.type = 'lowpass'; padLp.frequency.value = 600; padLp.Q.value = 2;
    lfo.type = 'sine'; lfo.frequency.value = 3.2;
    lfoG.gain.value = 0.04;
    lfo.connect(lfoG); lfoG.connect(padG.gain);
    padG.gain.value = 0.06;
    pad.connect(padLp); padLp.connect(padG); padG.connect(masterG);
    pad.start(); lfo.start();
    nodes.push({ stop(){ try{pad.stop();lfo.stop();}catch(e){} } });

    // 慢速低頻撥弦 (每4拍): A2 / D2 / F2 交替
    const bassSeq = [110.0, 73.4, 87.3, 65.4];
    let bi = 0;
    const bassInterval = setInterval(() => {
      if(_ts.stopped){ clearInterval(bassInterval); return; }
      if(!enabled) return;
      try {
        const now = c.currentTime;
        const osc = c.createOscillator();
        const g   = c.createGain();
        const lp  = c.createBiquadFilter();
        lp.type = 'lowpass'; lp.frequency.value = 400;
        osc.type = 'triangle'; osc.frequency.value = bassSeq[bi % bassSeq.length];
        g.gain.setValueAtTime(0.18, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + beat * 3.5);
        osc.connect(lp); lp.connect(g); g.connect(masterG);
        osc.start(now); osc.stop(now + beat * 4);
        bi++;
      } catch(e){}
    }, beat * 4000);

    // 極輕的噪音霧: 低頻遠處戰場餘響
    const rumble = makeNoise(30, 180, 0.025);
    rumble.connect(masterG); rumble.start();
    nodes.push(rumble);

    return { nodes, intervals: [melInterval, bassInterval] };
  }

  // ── TRACK CONTROL ──────────────────────────────────────────

  function stopCurrent(fadeDur=1.5) {
    if(!currentTrack) return;
    const t = currentTrack;
    stopScheduled = true;
    if(t._ts) t._ts.stopped = true; // per-track stop flag
    t.timeouts && t.timeouts.forEach(id=>clearTimeout(id));
    t.intervals && t.intervals.forEach(id=>clearInterval(id));
    if(fadeDur <= 0){
      // 立即停止：同步清除所有 nodes
      t.nodes && t.nodes.forEach(n=>{ try{n.stop&&n.stop();}catch(e){} });
      try{ t.fadeGain && t.fadeGain.disconnect(); } catch(e){}
    } else if(ctx && t.fadeGain) {
      fadeGain(t.fadeGain, t.fadeGain.gain.value, 0, fadeDur);
      setTimeout(() => {
        t.nodes && t.nodes.forEach(n=>{ try{n.stop&&n.stop();}catch(e){} });
        try{ t.fadeGain.disconnect(); } catch(e){}
      }, (fadeDur+0.1)*1000);
    } else {
      t.nodes && t.nodes.forEach(n=>{ try{n.stop&&n.stop();}catch(e){} });
    }
    currentTrack = null;
    currentScene = null;
  }

  function play(scene, fadeDur=1.5) {
    if(!enabled) return;
    if(scene === currentScene) return;
    stopCurrent(fadeDur);
    setTimeout(() => {
      if(!enabled) return;
      stopScheduled = false;
      const _trackState = { stopped: false };
      // 恢復 masterGain 和 AudioContext
      if(masterGain){
        masterGain.gain.cancelScheduledValues(0);
        masterGain.gain.setValueAtTime(volume, 0);
      }
      if(ctx && ctx.state === 'suspended') ctx.resume();
      try {
        const c = getCtx();
        // Per-track fade gain
        const fg = c.createGain();
        fg.gain.value = 0;
        fg.connect(masterGain);
        fadeGain(fg, 0, 1, fadeDur);

        let track;
        if(scene==='title') track = buildTitle(fg, _trackState);
        else if(scene==='select') track = buildSelect(fg, _trackState);
        else if(scene==='game') track = buildGame(fg, _trackState);
        else if(scene==='tenpai') track = buildTenpai(fg, _trackState);
        else if(scene==='qi')    track = buildKingdom_qi(fg, _trackState);
        else if(scene==='chu')   track = buildKingdom_chu(fg, _trackState);
        else if(scene==='yan')   track = buildKingdom_yan(fg, _trackState);
        else if(scene==='han')   track = buildKingdom_han(fg, _trackState);
        else if(scene==='wei')   track = buildKingdom_wei(fg, _trackState);
        else if(scene==='zhao')  track = buildKingdom_zhao(fg, _trackState);
        else if(scene==='qin')   track = buildKingdom_qin(fg, _trackState);
        else if(scene==='defeat') track = buildDefeat(fg, _trackState);
        else return;

        track.fadeGain = fg;
        track._ts = _trackState;
        currentTrack = track;
        currentScene = scene;
      } catch(e){ console.warn('BGM error:', e); }
    }, currentScene ? fadeDur*1000+100 : 0);
  }

  function stop(fadeDur=1.5) {
    stopCurrent(fadeDur);
    if(fadeDur <= 0 && masterGain){
      masterGain.gain.cancelScheduledValues(0);
      masterGain.gain.setValueAtTime(0, 0);
    }
    // 強制暫停整個 AudioContext，確保完全靜音
    if(fadeDur <= 0 && ctx && ctx.state === 'running'){
      ctx.suspend();
    }
  }

  return {
    play,
    stop,
    setEnabled(v) {
      enabled = v;
      if(!v) stopCurrent(0.5);
    },
    setVolume(v) {
      volume = v;
      if(masterGain) masterGain.gain.value = v;
    },
    isEnabled() { return enabled; },
    getVolume() { return volume; },
    currentScene() { return currentScene; },
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
