/* ═══════════════════════════════════════════════════════════════
   unify.js — 天下一統（統一天下的慶祝動畫，約 24 秒）
   ───────────────────────────────────────────────────────────────
   時間軸跟配樂共用（tools/build-unify-bgm-midi.py 的註解）—— 改一邊，另一邊也要改：
     0.0– 4.0  天下歸一：本國＋六國一國一國染上主公的顏色
     4.0– 7.5  天下一統：大字砸下、畫面一震，主公出征三格
     7.5–13.0  詔書：「奉天承運……」，主公平靜下來
    13.0–18.0  六國來朝：被征服的六國君主一位一位出現
    18.0–24.0  慶功：金光、煙火，「恭喜主公」，22 秒定音

   用法：
     MJUnify.play({ name: '齊威王', kingdom: 'qi', conquered: [六國], matches: 12 }).then(() => …)
   點一下跳到最後的慶功畫面，再點一下結束。

   配樂：assets/audio/unify-bgm.mp3（MIDI 在 GarageBand 轉好之後放這裡）。
   還沒有 MP3 的時候，用 assets/audio/unify-bgm.notes.js 的音符在瀏覽器合成（聽起來比較陽春，但時間點一樣）。
   播的時候遊戲 BGM 讓位，靜音設定照樣有效。
   預覽頁：devtools/統一天下動畫v0.1.html。v1.21 起接進遊戲（單機 showUnified、連線 netSettleMatch）
   ═══════════════════════════════════════════════════════════════ */
(function (root, factory) {
  const api = factory(root.MJKingdoms);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MJUnify = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (K) {
'use strict';

const MAP_URL = 'assets/map/warring-states.webp';
const MP3_URL = 'assets/audio/unify-bgm.mp3';
const MAP_POS = (typeof window !== 'undefined' && window.MJEnfeoff && window.MJEnfeoff.MAP_POS) || {
  qin: [19, 42], zhao: [47.5, 17], yan: [73, 17], qi: [73, 40],
  wei: [53, 41], han: [36.5, 40], chu: [51, 66],
};
const T = { title: 4.0, edict: 7.5, court: 13.0, fete: 18.0, final: 22.0, end: 24.0 };

const CSS = `
#uni-ov{position:fixed;inset:0;z-index:170;display:none;overflow:hidden;cursor:pointer;
  background:radial-gradient(ellipse at 50% 40%,#3a2a0e 0%,#140d05 55%,#050302 100%);
  color:#fff4d6;font-family:'Noto Serif TC','Songti TC',serif;}
#uni-ov.show{display:block;animation:uniIn .5s ease;}
@keyframes uniIn{from{opacity:0}to{opacity:1}}
#uni-ov .deco{font-family:var(--font-deco,'ZCOOL QingKe HuangYou','Noto Serif TC',serif);}
#uni-ov .u-map{position:absolute;left:50%;top:50%;width:min(92vw,calc(92vh * 1.5),1100px);aspect-ratio:3/2;
  transform:translate(-50%,-50%);border-radius:10px;overflow:hidden;box-shadow:0 0 60px rgba(243,207,110,.35);
  transition:transform 1.2s ease,opacity 1.2s ease,filter 1.2s ease;}
#uni-ov .u-map img.bg{position:absolute;inset:0;width:100%;height:100%;filter:saturate(.8) brightness(.85);}
#uni-ov .u-map.back{transform:translate(-50%,-50%) scale(.82);opacity:.22;filter:blur(2px);}
#uni-ov .seal{position:absolute;transform:translate(-50%,-50%);font-size:clamp(13px,3.2vh,24px);line-height:1;
  width:1.7em;height:1.7em;display:flex;align-items:center;justify-content:center;border-radius:50%;z-index:2;
  background:rgba(40,22,10,.6);border:2px solid rgba(255,236,190,.5);text-shadow:0 1px 2px #000;
  transition:background .3s,box-shadow .3s,transform .3s;}
#uni-ov .seal.won{background:var(--kc);border-color:#f3cf6e;box-shadow:0 0 16px rgba(243,207,110,.95);
  transform:translate(-50%,-50%) scale(1.25);}
#uni-ov .glow{position:absolute;transform:translate(-50%,-50%);width:38%;aspect-ratio:1;border-radius:50%;
  background:radial-gradient(circle,var(--kc) 0%,transparent 62%);mix-blend-mode:screen;opacity:0;z-index:1;
  animation:uniGlow .6s ease-out forwards;}
@keyframes uniGlow{from{opacity:0;transform:translate(-50%,-50%) scale(.4)}to{opacity:.6;transform:translate(-50%,-50%) scale(1)}}

#uni-ov .u-title{position:absolute;left:50%;top:15%;transform:translate(-50%,-50%);z-index:6;white-space:nowrap;
  font-size:clamp(34px,11vh,96px);letter-spacing:.2em;color:#f3cf6e;
  text-shadow:0 0 18px rgba(243,207,110,.8),0 4px 0 #6b3a08,0 8px 24px rgba(0,0,0,.9);opacity:0;}
#uni-ov .u-title.slam{animation:uniSlam .55s cubic-bezier(.3,1.6,.5,1) forwards;}
@keyframes uniSlam{from{opacity:0;transform:translate(-50%,-50%) scale(3)}to{opacity:1;transform:translate(-50%,-50%) scale(1)}}
#uni-ov.shake{animation:uniShake .45s ease;}
@keyframes uniShake{0%,100%{transform:none}20%{transform:translate(-6px,4px)}40%{transform:translate(6px,-4px)}60%{transform:translate(-4px,2px)}80%{transform:translate(3px,-2px)}}

#uni-ov .u-lord{position:absolute;left:50%;bottom:4%;height:66%;aspect-ratio:1;transform:translateX(-50%);z-index:5;
  opacity:0;transition:left 1s ease,height 1s ease,opacity .5s;filter:drop-shadow(0 10px 20px rgba(0,0,0,.8));}
#uni-ov .u-lord.on{opacity:1;}
#uni-ov .u-lord.side{left:26%;height:60%;}
#uni-ov .u-lord img{width:100%;height:100%;object-fit:contain;}
#uni-ov .u-halo{position:absolute;left:50%;top:50%;width:120%;aspect-ratio:1;transform:translate(-50%,-50%);z-index:-1;
  background:radial-gradient(circle,rgba(255,224,140,.55) 0%,transparent 60%);animation:uniHalo 3s linear infinite;}
@keyframes uniHalo{from{transform:translate(-50%,-50%) rotate(0)}to{transform:translate(-50%,-50%) rotate(360deg)}}

#uni-ov .u-edict{position:absolute;right:5%;top:50%;transform:translateY(-50%);z-index:6;
  width:min(46vw,520px);height:min(70vh,440px);overflow:hidden;clip-path:inset(0 0 0 100%);
  background:linear-gradient(90deg,#b9924f,#f1ddb0 6%,#f6e7c3 50%,#f1ddb0 94%,#b9924f);
  border-radius:6px;box-shadow:0 10px 30px rgba(0,0,0,.7);color:#3b1e08;
  display:flex;flex-direction:row-reverse;justify-content:center;align-items:flex-start;gap:1.1em;padding:1.2em 1.4em;
  font-size:clamp(14px,3.6vh,26px);line-height:1.5;transition:clip-path 1.1s ease;}
#uni-ov .u-edict.open{clip-path:inset(0 0 0 0);}
/* ⚠️ 直書只給每一行，不要給整個容器 —— 給容器的話 flex 的主軸也跟著變直的，
   一行一行會變成由下往上疊、字變成橫排（第一版就是這樣，「奉天承運」變成「運承天奉」） */
#uni-ov .u-edict span{writing-mode:vertical-rl;opacity:0;transition:opacity .6s;}
#uni-ov .u-edict span.on{opacity:1;}
#uni-ov .u-edict .head{color:#8a1c10;font-size:1.2em;}
#uni-ov .u-edict .seal-red{color:#b3261a;border:3px solid #b3261a;border-radius:4px;padding:.05em .15em;font-size:.9em;align-self:flex-end;}

#uni-ov .u-court{position:absolute;left:0;right:0;bottom:8%;display:flex;justify-content:center;gap:2.2%;z-index:6;}
#uni-ov .u-court .v{width:min(12vw,110px);text-align:center;opacity:0;transform:translateY(20px);transition:opacity .5s,transform .5s;}
#uni-ov .u-court .v.on{opacity:1;transform:translateY(0) rotate(-4deg);}
#uni-ov .u-court .v img{width:100%;aspect-ratio:1;border-radius:50%;object-fit:cover;background:#2a1a08;
  border:3px solid var(--kc);filter:saturate(.75) brightness(.9);box-shadow:0 4px 12px rgba(0,0,0,.7);}
#uni-ov .u-court .v div{font-size:clamp(10px,2.2vh,15px);color:#f3cf6e;margin-top:3px;}
#uni-ov .u-cap{position:absolute;left:0;right:0;top:4%;text-align:center;z-index:7;font-size:clamp(16px,4.6vh,34px);
  letter-spacing:.3em;color:#f3cf6e;opacity:0;transition:opacity .6s;text-shadow:0 2px 10px #000;}
#uni-ov .u-cap.on{opacity:1;}

#uni-ov .u-fete{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);z-index:8;text-align:center;opacity:0;transition:opacity .8s;}
#uni-ov .u-fete.on{opacity:1;}
#uni-ov .u-fete .big{font-size:clamp(30px,10vh,86px);letter-spacing:.25em;color:#f3cf6e;
  text-shadow:0 0 24px rgba(243,207,110,.9),0 4px 0 #6b3a08;animation:uniPulse 1.4s ease-in-out infinite alternate;}
#uni-ov .u-fete .small{font-size:clamp(13px,3vh,22px);letter-spacing:.2em;margin-top:.6em;color:#fff4d6;}
@keyframes uniPulse{from{transform:scale(1)}to{transform:scale(1.06)}}
#uni-ov .spark{position:absolute;width:6px;height:6px;border-radius:50%;z-index:7;pointer-events:none;
  background:var(--c);box-shadow:0 0 8px var(--c);animation:uniSpark var(--d) ease-out forwards;}
@keyframes uniSpark{from{opacity:1;transform:translate(0,0) scale(1)}to{opacity:0;transform:translate(var(--dx),var(--dy)) scale(.3)}}
#uni-ov .gold{position:absolute;top:-4%;width:5px;height:12px;border-radius:2px;z-index:7;pointer-events:none;
  background:linear-gradient(#fff2b0,#d4a02a);animation:uniFall var(--d) linear forwards;}
@keyframes uniFall{to{transform:translateY(112vh) rotate(540deg)}}
#uni-ov .flashw{position:absolute;inset:0;background:#fff6d8;z-index:9;pointer-events:none;animation:uniFlash .6s ease-out forwards;}
@keyframes uniFlash{from{opacity:.9}to{opacity:0}}
#uni-ov .u-hint{position:absolute;bottom:1.5%;left:0;right:0;text-align:center;font-size:10px;color:rgba(255,244,214,.35);letter-spacing:.2em;z-index:9;}
`;

/* ── 配樂 ───────────────────────────────────────────────── */
let actx = null, master = null, synthSrc = [], mp3 = null;
function soundOn() {
  try { return !window.MJAudio || !window.MJAudio.SFX || window.MJAudio.SFX.isEnabled(); } catch (_) { return true; }
}
function ctx() {
  if (!actx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    actx = new AC();
    master = actx.createGain();
    master.gain.value = 0.42;
    master.connect(actx.destination);
  }
  if (actx.state === 'suspended' && actx.resume) actx.resume().catch(() => {});
  return actx;
}
if (typeof document !== 'undefined') {
  const wake = () => { try { ctx(); } catch (_) {} };
  document.addEventListener('pointerdown', wake, { passive: true });
  document.addEventListener('keydown', wake);
}
const hz = p => 440 * Math.pow(2, (p - 69) / 12);
function env(g, t, a, peak, d, rel) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + a);
  g.gain.setValueAtTime(Math.max(peak, 0.0002), t + Math.max(a, d));
  g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(a, d) + rel);
}
function osc(c, type, f, t, stop) {
  const o = c.createOscillator(); o.type = type; o.frequency.value = f; o.start(t); o.stop(stop); return o;
}
function noiseBuf(c, dur) {
  const b = c.createBuffer(1, Math.max(1, Math.floor(c.sampleRate * dur)), c.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const s = c.createBufferSource(); s.buffer = b; return s;
}
/* 還沒有 MP3 時的陽春合成：每一軌一種音色，時間點跟 MIDI 一模一樣 */
function synthNote(c, t, [st, dur, p, vel, tr]) {
  const v = vel / 127, at = t + st;
  const g = c.createGain(); g.connect(master);
  let o;
  if (tr === 'drums' || tr === 'timpani') {
    if (p === 49 || p === 42 || p === 38) {            // 鈸、踩鈸、小鼓：噪音
      const n = noiseBuf(c, p === 49 ? 1.6 : .2), f = c.createBiquadFilter();
      f.type = p === 38 ? 'bandpass' : 'highpass'; f.frequency.value = p === 38 ? 1800 : 6000;
      n.connect(f); f.connect(g); n.start(at);
      env(g, at, .002, v * (p === 49 ? .35 : .3), .01, p === 49 ? 1.4 : .12);
      synthSrc.push(n); return;
    }
    o = osc(c, 'sine', tr === 'timpani' ? hz(p) : (p === 36 ? 62 : 120), at, at + .9);
    o.frequency.exponentialRampToValueAtTime((tr === 'timpani' ? hz(p) : 90) * .55, at + .35);
    env(g, at, .005, v * .95, .02, tr === 'timpani' ? .7 : .35);
  } else if (tr === 'gong') {
    [1, 1.46, 2.31, 3.29].forEach((m, k) => {
      const gg = c.createGain(); gg.connect(master);
      const oo = osc(c, 'sine', 110 * m, at, at + 3.2);
      oo.connect(gg); env(gg, at, .02, v * [.5, .3, .18, .1][k], .05, 2.8); synthSrc.push(oo);
    });
    return;
  } else if (tr === 'bells') {
    o = osc(c, 'sine', hz(p), at, at + dur + 1.6);
    const o2 = osc(c, 'sine', hz(p) * 2.76, at, at + 1);
    const g2 = c.createGain(); o2.connect(g2); g2.connect(master); env(g2, at, .005, v * .08, .01, .6);
    env(g, at, .005, v * .28, .02, dur + 1.2); synthSrc.push(o2);
  } else if (tr === 'zheng') {
    o = osc(c, 'triangle', hz(p), at, at + dur + .6);
    env(g, at, .004, v * .32, .02, dur + .4);
  } else if (tr === 'brass') {
    o = osc(c, 'sawtooth', hz(p), at, at + dur + .3);
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1700;
    o.connect(f); f.connect(g); env(g, at, .05, v * .16, dur, .2); synthSrc.push(o); return;
  } else if (tr === 'strings') {
    o = osc(c, 'sawtooth', hz(p), at, at + dur + .5);
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900;
    o.connect(f); f.connect(g); env(g, at, .35, v * .07, dur - .2, .4); synthSrc.push(o); return;
  } else {                                              // bass
    o = osc(c, 'triangle', hz(p), at, at + dur + .4);
    env(g, at, .05, v * .3, dur, .3);
  }
  o.connect(g);
  synthSrc.push(o);
}
function musicStart(fromSec) {
  musicStop();
  if (!soundOn()) return;
  // 有 MP3（GarageBand 轉好的）就用 MP3；沒有就合成
  mp3 = new Audio(MP3_URL);
  mp3.currentTime = fromSec || 0;
  let fell = false;
  const fallback = () => {
    if (fell) return; fell = true; mp3 = null;
    const c = ctx(), notes = window.MJ_UNIFY_NOTES;
    if (!c || !notes) return;
    const t = c.currentTime + 0.05 - (fromSec || 0);
    notes.forEach(n => { if (n[0] >= (fromSec || 0) - 0.01) synthNote(c, t, n); });
  };
  mp3.addEventListener('error', fallback);
  mp3.play().catch(fallback);
}
function musicStop() {
  if (mp3) { try { mp3.pause(); } catch (_) {} mp3 = null; }
  synthSrc.forEach(s => { try { s.stop(); } catch (_) {} });
  synthSrc = [];
}
let bgmWas = null;
function bgmPause() {
  try { const B = window.MJAudio && window.MJAudio.BGM; if (B) { bgmWas = B.currentScene(); if (bgmWas) B.stop(0.5); } } catch (_) {}
}
function bgmResume() {
  try { const B = window.MJAudio && window.MJAudio.BGM; if (B && bgmWas) B.play(bgmWas, 1); } catch (_) {}
  bgmWas = null;
}

/* ── 畫面 ───────────────────────────────────────────────── */
let ov = null, timers = [];
const later = (fn, sec) => { const t = setTimeout(fn, sec * 1000); timers.push(t); return t; };
const kc = id => (K.get(id) || {}).color || '#c9a44c';
const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function ensureCss() {
  if (document.getElementById('uni-css')) return;
  const st = document.createElement('style');
  st.id = 'uni-css';
  st.textContent = CSS;
  document.head.appendChild(st);
}
function el(cls, parent, html) {
  const e = document.createElement('div');
  e.className = cls;
  if (html != null) e.innerHTML = html;
  (parent || ov).appendChild(e);
  return e;
}
function sparks(x, y, n, colors) {
  for (let i = 0; i < n; i++) {
    const s = el('spark');
    const a = Math.random() * Math.PI * 2, r = 80 + Math.random() * 160;
    s.style.left = x + '%'; s.style.top = y + '%';
    s.style.setProperty('--c', colors[i % colors.length]);
    s.style.setProperty('--dx', Math.cos(a) * r + 'px');
    s.style.setProperty('--dy', Math.sin(a) * r + 'px');
    s.style.setProperty('--d', (0.9 + Math.random() * 0.6) + 's');
    later(() => s.remove(), 1.6);
  }
}
function goldRain(n) {
  for (let i = 0; i < n; i++) later(() => {
    const g = el('gold');
    g.style.left = Math.random() * 100 + '%';
    g.style.setProperty('--d', (2.2 + Math.random() * 1.8) + 's');
    later(() => g.remove(), 4.2);
  }, Math.random() * 5.5);
}

function build(o) {
  ov.innerHTML = '';
  const home = K.get(o.kingdom) || K.KINGDOMS[0];
  const order = [home.id].concat((o.conquered || []).filter(id => id !== home.id)).slice(0, 7);
  const colors = [kc(home.id), '#f3cf6e', '#fff4d6', '#ff9a5a'];

  // ① 天下歸一
  const map = el('u-map', ov, '<img class="bg" src="' + MAP_URL + '" alt="">');
  K.KINGDOMS.forEach(k => {
    const [x, y] = MAP_POS[k.id] || [50, 50];
    const s = el('seal deco', map, k.char);
    s.style.left = x + '%'; s.style.top = y + '%';
    s.dataset.k = k.id;
  });
  order.forEach((id, i) => later(() => {
    const s = map.querySelector('.seal[data-k="' + id + '"]');
    const [x, y] = MAP_POS[id] || [50, 50];
    if (s) { s.style.setProperty('--kc', kc(home.id)); s.classList.add('won'); }
    const g = el('glow', map);
    g.style.left = x + '%'; g.style.top = y + '%';
    g.style.setProperty('--kc', kc(home.id));
  }, 0.4 + i * 0.5));

  // ② 天下一統
  const title = el('u-title deco', ov, '天下一統');
  const lord = el('u-lord', ov, '<div class="u-halo"></div><img alt="">');
  const img = lord.querySelector('img');
  const frames = K.warFrames(home.id, false);
  later(() => map.classList.add('back'), T.title - 0.2);
  later(() => {
    title.classList.add('slam');
    ov.classList.remove('shake'); void ov.offsetWidth; ov.classList.add('shake');
    el('flashw');
    sparks(50, 15, 36, colors);
  }, T.title + 0.2);
  later(() => { img.src = frames[0]; lord.classList.add('on'); }, T.title + 0.3);
  later(() => { img.src = frames[1]; }, T.title + 0.9);
  later(() => { img.src = frames[2]; }, T.title + 1.3);

  // ③ 詔書
  const lordName = esc(o.name || (home.kingName || home.name));
  const edict = el('u-edict deco', ov,
    '<span class="head">奉天承運</span>'
    + '<span>' + lordName + '</span>'
    + '<span>以麻將之道　征服六合</span>'
    + '<span>席捲八荒　天下一統</span>'
    + '<span>' + (o.matches ? '歷經 ' + o.matches + ' 場征戰' : '萬世太平') + '</span>'
    + '<span class="seal-red">天下一統</span>');
  later(() => {
    img.src = K.calmUrl(home.id, false);
    lord.classList.add('side');
    // ⚠️ slam 的 animation-fill forwards 會一直壓住 opacity：先把動畫換成淡出
    title.classList.remove('slam');
    title.style.opacity = '1';
    title.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 600, fill: 'forwards' });
  }, T.edict);
  later(() => edict.classList.add('open'), T.edict + 0.3);
  [...edict.children].forEach((s, i) => later(() => s.classList.add('on'), T.edict + 1.0 + i * 0.75));

  // ④ 六國來朝
  const cap = el('u-cap deco', ov, '六國來朝');
  const court = el('u-court', ov);
  later(() => { edict.style.transition = 'opacity .6s'; edict.style.opacity = '0'; lord.classList.remove('side'); lord.style.height = '52%'; lord.style.bottom = '30%'; cap.classList.add('on'); }, T.court);
  order.slice(1).forEach((id, i) => {
    const k = K.get(id);
    const v = el('v', court, '<img src="assets/avatar/' + id + '_bust.webp" alt=""><div>' + (k ? k.name : '') + '</div>');
    v.style.setProperty('--kc', kc(id));
    later(() => v.classList.add('on'), T.court + 0.4 + i * 0.6);
  });

  // ⑤ 慶功
  const fete = el('u-fete', ov, '<div class="big deco">恭喜主公</div><div class="small">' + lordName + '　統一天下</div>');
  later(() => {
    cap.classList.remove('on'); court.style.transition = 'opacity .6s'; court.style.opacity = '.35';
    lord.style.opacity = '.35'; fete.classList.add('on'); goldRain(60);
  }, T.fete);
  [18.6, 19.5, 20.3, 21.1].forEach((t, i) => later(() => sparks(20 + i * 20, 25 + (i % 2) * 20, 28, colors), t));
  later(() => { el('flashw'); sparks(50, 50, 60, colors); ov.classList.remove('shake'); void ov.offsetWidth; ov.classList.add('shake'); }, T.final);
  el('u-hint', ov, '點一下跳到最後');
}

/* 點一下：跳到慶功；再點一下（或時間到）：結束 */
function play(o) {
  ensureCss();
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'uni-ov';
    document.body.appendChild(ov);
  }
  stop();
  const K0 = K.get(o.kingdom);
  // 先抓圖，第一次播才不會閃白
  if (K0) K.warFrames(K0.id, false).concat([K.calmUrl(K0.id, false)]).forEach(u => { const i = new Image(); i.src = u; });
  build(o);
  ov.classList.add('show');
  bgmPause();
  musicStart(0);
  return new Promise(resolve => {
    let done = false, skipped = false;
    const finish = () => {
      if (done) return; done = true;
      ov.removeEventListener('click', onTap);
      stop(); musicStop(); bgmResume();
      ov.classList.remove('show');
      resolve();
    };
    const onTap = () => {
      if (skipped || Date.now() - startedAt > T.fete * 1000) { finish(); return; }
      skipped = true;
      // 跳到慶功：重排畫面，從 18 秒開始
      stop(); build(Object.assign({}, o));
      [...ov.querySelectorAll('.seal')].forEach(s => { s.style.setProperty('--kc', kc(o.kingdom)); });
      ov.querySelector('.u-map').classList.add('back');
      stop();
      const fete = ov.querySelector('.u-fete'); fete.classList.add('on');
      goldRain(50);
      later(() => { el('flashw'); sparks(50, 50, 60, [kc(o.kingdom), '#f3cf6e', '#fff4d6']); }, T.final - T.fete);
      later(finish, T.end - T.fete + 1.5);
      musicStart(T.fete);
    };
    const startedAt = Date.now();
    ov.addEventListener('click', onTap);
    later(finish, T.end + 1.5);
  });
}
function stop() { timers.forEach(clearTimeout); timers = []; }

return { play, T };
});
