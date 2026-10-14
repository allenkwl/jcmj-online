/* ═══════════════════════════════════════════════════════════════
   fallen.js — 亡國（一場結算時國庫 < 0，約 14 秒）
   ───────────────────────────────────────────────────────────────
   2026-10-14 使用者：「亡國要專屬動畫」「這次改用 Comfy 來畫」。
   規則見 campaign.js 的 START_GOLD：一場結算時國庫是負的就亡國，這一格存檔刪掉。

   時間軸跟配樂共用（tools/build-fallen-bgm-midi.py 的註解）—— 改一邊，另一邊也要改：
     0.0– 0.9  主公出征的最後一刻（影片第一格就是出征三格的最後一格，接得起來）
     0.9       劍斷（各國是自己的兵器）：鼓聲戛然而止
     0.9– 5.0  踉蹌、跪地（影片）
     3.0– 8.0  灰燼飄落，畫面慢慢褪成灰
     8.0       「○亡」大字砸下：大鑼
     8.6–14.0  戰績：主公、打了幾場、征服幾國、國庫
   點一下跳到最後的戰績，再點一下（或時間到）結束。

   影片：assets/fallen/<國>.mp4 —— tools/build-fallen-art.py 用伺服器上的 ComfyUI 做的：
     FLUX.2 參考出征圖畫「踉蹌劍斷」與「跪地」兩張，LTX-2.5 用出征／踉蹌／跪地三張圖生 5 秒影片。
   影片載不到（或瀏覽器不播）就用 assets/fallen/<國>.webp（跪地那一張）加淡入代替；
   那張也沒有，就用主公原本的立繪（assets/avatar/<國>_big.webp）。
   配樂：assets/audio/fallen-bgm.mp3；沒有就用 fallen-bgm.notes.js 在瀏覽器合成。靜音設定照樣有效。

   用法：MJFallen.play({ kingdom:'qin', name:'秦王', matches:7, conquered:[…], gold:{before, after} }).then(…)
   預覽：devtools/亡國動畫v0.1.html（載遊戲本體的 #fallen）
   ═══════════════════════════════════════════════════════════════ */
(function (root, factory) {
  const api = factory(root.MJKingdoms);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MJFallen = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (K) {
'use strict';

const MP3_URL = 'assets/audio/fallen-bgm.mp3';
const T = { snap: 0.9, gray: 3.0, video: 5.0, slam: 8.0, epitaph: 8.6, hint: 11.5, end: 14.0 };

const CSS = `
#fal-ov{position:fixed;inset:0;z-index:170;display:none;overflow:hidden;cursor:pointer;
  background:radial-gradient(ellipse at 50% 45%,#2a1a10 0%,#120a06 55%,#040201 100%);
  color:#e9dcc4;font-family:'Noto Serif TC','Songti TC',serif;}
#fal-ov.show{display:block;animation:falIn .4s ease;}
@keyframes falIn{from{opacity:0}to{opacity:1}}
#fal-ov .deco{font-family:var(--font-deco,'Noto Serif TC',serif);font-weight:900;}
#fal-ov .f-stage{position:absolute;left:50%;top:47%;width:min(78vh,80vw);aspect-ratio:1;transform:translate(-50%,-50%);
  -webkit-mask-image:radial-gradient(circle at 50% 50%,#000 52%,transparent 71%);
          mask-image:radial-gradient(circle at 50% 50%,#000 52%,transparent 71%);
  transition:filter 4.5s ease,opacity 1.2s ease,transform 1.2s ease;}
#fal-ov .f-stage video,#fal-ov .f-stage img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;}
#fal-ov .f-stage.gray{filter:grayscale(.8) brightness(.8) contrast(1.05);}
#fal-ov .f-stage.back{opacity:.42;transform:translate(-50%,-50%) scale(.94);}
#fal-ov .ash{position:absolute;top:-3%;width:var(--s);height:var(--s);border-radius:50%;pointer-events:none;z-index:3;
  background:var(--c);opacity:.0;animation:falAsh var(--d) linear forwards;}
@keyframes falAsh{0%{opacity:0;transform:translate(0,0)}10%{opacity:var(--o)}
  100%{opacity:0;transform:translate(var(--dx),108vh)}}
#fal-ov .f-title{position:absolute;left:50%;top:44%;transform:translate(-50%,-50%);z-index:6;opacity:0;
  filter:drop-shadow(0 0 22px rgba(160,20,10,.75)) drop-shadow(0 6px 18px rgba(0,0,0,.9));}
#fal-ov .f-title img{height:clamp(70px,24vh,220px);width:auto;display:block;}
#fal-ov .f-title.slam{animation:falSlam .5s cubic-bezier(.3,1.5,.5,1) forwards;}
@keyframes falSlam{from{opacity:0;transform:translate(-50%,-50%) scale(2.6)}to{opacity:1;transform:translate(-50%,-50%) scale(1)}}
#fal-ov .f-title.up{transition:top 1s ease,transform 1s ease;top:24%;transform:translate(-50%,-50%) scale(.72);}
#fal-ov.shake{animation:falShake .5s ease;}
@keyframes falShake{0%,100%{transform:none}20%{transform:translate(-7px,5px)}40%{transform:translate(7px,-4px)}60%{transform:translate(-4px,3px)}80%{transform:translate(3px,-2px)}}
#fal-ov .flashr{position:absolute;inset:0;background:#5a0a06;z-index:9;pointer-events:none;animation:falFlash .7s ease-out forwards;}
@keyframes falFlash{from{opacity:.75}to{opacity:0}}
#fal-ov .f-epi{position:absolute;left:50%;top:60%;transform:translateX(-50%);z-index:7;text-align:center;
  font-size:clamp(13px,3.1vh,22px);line-height:1.9;letter-spacing:.14em;white-space:nowrap;}
#fal-ov .f-epi div{opacity:0;transform:translateY(8px);transition:opacity .9s ease,transform .9s ease;}
#fal-ov .f-epi div.on{opacity:1;transform:none;}
#fal-ov .f-epi .who{font-size:1.35em;color:#f1e3c8;}
#fal-ov .f-epi .red{color:#e0634e;}
#fal-ov .f-epi .last{color:#a99a85;font-size:.9em;letter-spacing:.3em;margin-top:.4em;}
#fal-ov .f-hint{position:absolute;bottom:2%;left:0;right:0;text-align:center;font-size:11px;color:rgba(233,220,196,.35);
  letter-spacing:.25em;z-index:9;opacity:0;transition:opacity .8s;}
#fal-ov .f-hint.on{opacity:1;}
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
const hz = p => 440 * Math.pow(2, (p - 69) / 12);
function env(g, t, a, peak, d, rel) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + a);
  g.gain.setValueAtTime(Math.max(peak, 0.0002), t + Math.max(a, d));
  g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(a, d) + rel);
}
function osc(c, type, f, t, stop) {
  const o = c.createOscillator(); o.type = type; o.frequency.value = f; o.start(t); o.stop(stop); synthSrc.push(o); return o;
}
function noise(c, dur, at) {
  const b = c.createBuffer(1, Math.max(1, Math.floor(c.sampleRate * dur)), c.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const s = c.createBufferSource(); s.buffer = b; s.start(at); synthSrc.push(s); return s;
}
/* 還沒有 MP3 時的合成：每一軌一種音色，時間點跟 MIDI 一模一樣 */
function synthNote(c, t, [st, dur, p, vel, tr]) {
  const v = vel / 127, at = t + st;
  const g = c.createGain(); g.connect(master);
  if (tr === 'drums') {
    if (p === 49 || p === 52 || p === 38) {            // 鈸、中國鈸、小鼓：噪音
      const n = noise(c, p === 38 ? .2 : 1.8, at), f = c.createBiquadFilter();
      f.type = p === 38 ? 'bandpass' : 'highpass'; f.frequency.value = p === 38 ? 1800 : (p === 52 ? 3500 : 6000);
      n.connect(f); f.connect(g); env(g, at, .002, v * .3, .01, p === 38 ? .12 : 1.5); return;
    }
    const o = osc(c, 'sine', p === 35 ? 50 : 62, at, at + 1);
    o.frequency.exponentialRampToValueAtTime(40, at + .35);
    o.connect(g); env(g, at, .004, v, .02, .4); return;
  }
  if (tr === 'timpani') {
    const o = osc(c, 'sine', hz(p), at, at + dur + 1);
    o.frequency.exponentialRampToValueAtTime(hz(p) * .7, at + .5);
    o.connect(g); env(g, at, .006, v * .95, .03, Math.max(.7, dur)); return;
  }
  if (tr === 'gong') {                                  // 大鑼：幾個不成整數倍的泛音，長長地響
    [1, 1.46, 2.31, 3.29, 4.1].forEach((m, k) => {
      const gg = c.createGain(); gg.connect(master);
      const oo = osc(c, 'sine', 70 * m, at, at + 4.5);
      oo.frequency.exponentialRampToValueAtTime(70 * m * .985, at + 3);
      oo.connect(gg); env(gg, at, .015, v * [.6, .35, .2, .12, .08][k], .05, 4.0);
    });
    return;
  }
  if (tr === 'bells') {
    const o = osc(c, 'sine', hz(p), at, at + dur + 1.6);
    const o2 = osc(c, 'sine', hz(p) * 2.76, at, at + 1);
    const g2 = c.createGain(); o2.connect(g2); g2.connect(master); env(g2, at, .005, v * .08, .01, .6);
    o.connect(g); env(g, at, .005, v * .26, .02, dur + 1.2); return;
  }
  if (tr === 'zheng') {
    const o = osc(c, 'triangle', hz(p), at, at + dur + .6);
    o.connect(g); env(g, at, .004, v * .3, .02, dur + .4); return;
  }
  if (tr === 'strings') {
    const o = osc(c, 'sawtooth', hz(p), at, at + dur + .6);
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 700;
    o.connect(f); f.connect(g); env(g, at, .6, v * .07, dur - .4, .6); return;
  }
  if (tr === 'xun') {                                   // 塤：正弦＋慢慢起來＋一點顫音與氣聲
    const o = osc(c, 'sine', hz(p), at, at + dur + .5);
    const lfo = osc(c, 'sine', 5, at, at + dur + .5), lg = c.createGain();
    lg.gain.value = hz(p) * .006; lfo.connect(lg); lg.connect(o.frequency);
    o.connect(g); env(g, at, .18, v * .32, dur - .1, .35);
    const n = noise(c, dur + .3, at), f = c.createBiquadFilter(), ng = c.createGain();
    f.type = 'bandpass'; f.frequency.value = hz(p) * 2; f.Q.value = 3;
    n.connect(f); f.connect(ng); ng.connect(master); env(ng, at, .1, v * .04, dur - .1, .3);
    return;
  }
  if (tr === 'wind') {
    const n = noise(c, dur + .5, at), f = c.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = 500; f.Q.value = .7;
    n.connect(f); f.connect(g); env(g, at, 1.5, v * .12, dur - 2, 1.5); return;
  }
  const o = osc(c, 'triangle', hz(p), at, at + dur + .4);    // bass
  o.connect(g); env(g, at, .05, v * .3, dur, .3);
}
function musicStart(fromSec) {
  musicStop();
  if (!soundOn()) return;
  mp3 = new Audio(MP3_URL);
  mp3.currentTime = fromSec || 0;
  let fell = false;
  const fallback = () => {
    if (fell) return; fell = true; mp3 = null;
    const c = ctx(), notes = window.MJ_FALLEN_NOTES;
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
const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function ensureCss() {
  if (document.getElementById('fal-css')) return;
  const st = document.createElement('style');
  st.id = 'fal-css';
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
/* 灰燼：灰白的小點慢慢往下飄，偶爾一點火星 */
function ash(n, over) {
  for (let i = 0; i < n; i++) later(() => {
    const a = el('ash');
    const ember = Math.random() < .18;
    a.style.left = Math.random() * 100 + '%';
    a.style.setProperty('--s', (ember ? 3 : 2 + Math.random() * 4) + 'px');
    a.style.setProperty('--c', ember ? '#ff9a4a' : '#b8ada0');
    a.style.setProperty('--o', ember ? '.9' : (0.35 + Math.random() * .4).toFixed(2));
    a.style.setProperty('--dx', ((Math.random() - .5) * 120) + 'px');
    a.style.setProperty('--d', (5 + Math.random() * 4) + 's');
    later(() => a.remove(), 9.5);
  }, Math.random() * over);
}

function epitaphLines(o, home) {
  const g = o.gold || {};
  const n = (o.conquered || []).length;
  return [
    ['who deco', esc(o.name || home.kingName || home.name)],
    ['', '征戰 ' + (o.matches || 0) + ' 場　征服 ' + n + ' / 6 國'],
    ['red', '國庫 ' + (typeof g.after === 'number' ? g.after.toLocaleString() : '—') + ' 兩'],
    ['last deco', '社稷傾覆　山河易主'],
  ];
}

function build(o, skipTo) {
  ov.innerHTML = '';
  const home = K.get(o.kingdom) || K.KINGDOMS[0];
  const stage = el('f-stage', ov);
  const still = 'assets/fallen/' + home.id + '.webp';
  // 影片：自動播放要靜音才保證放得出來（配樂另外放），playsinline 給 iPhone
  const vid = document.createElement('video');
  vid.muted = true; vid.playsInline = true; vid.setAttribute('playsinline', ''); vid.preload = 'auto';
  vid.poster = still;
  vid.src = 'assets/fallen/' + home.id + '.mp4';
  let usedStill = false;
  const toStill = () => {
    if (usedStill) return; usedStill = true;
    const img = document.createElement('img'); img.src = still; img.alt = '';
    // 連跪地圖也沒有（新加的國、檔案缺了）→ 用主公原本的立繪，畫面不會空掉（灰階由 .gray 處理）
    img.onerror = () => { img.onerror = null; img.src = 'assets/avatar/' + home.id + '_big.webp'; };
    img.animate([{ opacity: 0, transform: 'translateY(4%) scale(.96)' }, { opacity: 1, transform: 'none' }],
                { duration: 1800, easing: 'ease-out', fill: 'forwards' });
    stage.innerHTML = ''; stage.appendChild(img);
  };
  vid.addEventListener('error', toStill);
  /* 跳到戰績：直接放跪地圖（就是影片的最後一格）。
     ⚠️ 不能用 vid.currentTime = 4.9 —— 影片還沒載到那裡就設，會被忽略，畫面停在第一格的出征姿勢（實測趙王騎在馬上） */
  if (skipTo) {
    const img = document.createElement('img'); img.src = still; img.alt = '';
    img.onerror = () => { img.onerror = null; img.src = 'assets/avatar/' + home.id + '_big.webp'; };
    stage.appendChild(img);
  } else {
    stage.appendChild(vid);
    vid.play().catch(toStill);
  }

  const title = el('f-title', ov, '<img src="assets/titles/fallen-' + home.id + '.webp" alt="' + esc(home.char) + '亡">');
  const epi = el('f-epi', ov);
  const lines = epitaphLines(o, home).map(([cls, html]) => el(cls, epi, html));
  const hint = el('f-hint', ov, '點一下回到標題');

  if (skipTo) {
    stage.classList.add('gray', 'back');
    title.style.opacity = '1'; title.classList.add('up');
    lines.forEach(l => l.classList.add('on'));
    hint.classList.add('on');
    ash(30, 3);
    return;
  }
  later(() => { stage.classList.add('gray'); ash(70, 10); }, T.gray);
  later(() => stage.classList.add('back'), T.slam - 0.4);
  later(() => {
    title.classList.add('slam');
    ov.classList.remove('shake'); void ov.offsetWidth; ov.classList.add('shake');
    el('flashr');
  }, T.slam);
  later(() => {
    // slam 的 animation-fill forwards 會壓住位置：先換成停在終點的樣子再往上移
    title.classList.remove('slam'); title.style.opacity = '1'; void title.offsetWidth; title.classList.add('up');
  }, T.epitaph - 0.1);
  lines.forEach((l, i) => later(() => l.classList.add('on'), T.epitaph + 0.3 + i * 0.75));
  later(() => hint.classList.add('on'), T.hint);
}

/* 點一下：跳到戰績；再點一下（或時間到）：結束 */
function play(o) {
  ensureCss();
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'fal-ov';
    document.body.appendChild(ov);
  }
  stop();
  const home = K.get(o.kingdom);
  if (home) { const i = new Image(); i.src = 'assets/fallen/' + home.id + '.webp'; }
  build(o, false);
  ov.classList.add('show');
  bgmPause();
  musicStart(0);
  return new Promise(resolve => {
    let done = false, skipped = false;
    const startedAt = Date.now();
    const finish = () => {
      if (done) return; done = true;
      ov.removeEventListener('click', onTap);
      stop(); musicStop(); bgmResume();
      ov.classList.remove('show');
      const v = ov.querySelector('video'); if (v) { try { v.pause(); } catch (_) {} }
      resolve();
    };
    const onTap = () => {
      if (skipped || Date.now() - startedAt > T.hint * 1000) { finish(); return; }
      skipped = true;
      stop(); build(o, true);
      later(finish, 6);              // 跳到戰績之後停 6 秒，沒點也會結束
    };
    ov.addEventListener('click', onTap);
    later(finish, T.end + 2.5);
  });
}
function stop() { timers.forEach(clearTimeout); timers = []; }

return { play, T };
});
