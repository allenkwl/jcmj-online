/* ═══════════════════════════════════════════════════════════════
   enfeoff.js — 分封領地（一場打完的動畫）
   ───────────────────────────────────────────────────────────────
   一場打完，前三名各征服一國（docs/campaign.md 第二節）。在天下形勢地圖上演出：

     名次從後往前，第一名壓軸。每一位拿到封地的主公：
       ① 字幕「第二名　阿明（韓）　出兵燕國⋯」，被征服的那一國發光
       ② 從**自己的本國**出兵，沿弧線衝過去、揚起煙塵，播出征三格（蓄勢→出招→進攻）
       ③ 抵達：一閃、蓋上紅色「征服」大印、插上本國的旗，那一國換上主公的顏色
       ④ 換成平靜姿勢，縮成頭像留在那一國上
     墊底的主公：「此戰未得寸土」。電腦守將不是主公，不演。

   用法：
     MJEnfeoff.play({
       lords:  [{ name, home, conquered }],       // 名冊上的主公（conquered＝**這一場之前**的征服地）
       awards: [{ rank, name, gained }],          // 這一場的結果；gained 是 null＝沒有封地
     }).then(() => …)                             // 播完（或點一下跳過之後）才 resolve

   地圖座標 MAP_POS 也給主程式的天下形勢地圖用（同一張圖，兩邊一定要一致）。
   預覽頁：devtools/分封動畫v0.1.html
   ═══════════════════════════════════════════════════════════════ */
(function (root, factory) {
  const api = factory(root.MJKingdoms);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MJEnfeoff = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (K) {
'use strict';

const MAP_URL = 'assets/map/warring-states.webp';
/* 各國區塊的中心（佔圖寬高的百分比）。圖是 Codex 畫的、刻意不放字，國名與頭像都疊上去。
   ⚠️ 換地圖的話這組座標要跟著重量 */
const MAP_POS = {
  qin: [19, 42], zhao: [47.5, 17], yan: [73, 17], qi: [73, 40],
  wei: [53, 41], han: [36.5, 40], chu: [51, 66],
};
const RANK = ['', '第一名', '第二名', '第三名', '第四名'];

const CSS = `
#enf-ov{position:fixed;inset:0;z-index:160;background:rgba(4,10,7,.96);display:none;
  flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:8px 12px;cursor:pointer;
  color:#e8dcc0;font-family:'Noto Serif TC','Songti TC',serif;}
#enf-ov.show{display:flex;animation:enfIn .35s ease;}
@keyframes enfIn{from{opacity:0}to{opacity:1}}
#enf-ov .enf-title{font-family:var(--font-deco,'Noto Serif TC',serif);font-weight:900;font-size:clamp(20px,5vh,34px);
  color:#c9a44c;letter-spacing:.35em;text-shadow:0 2px 10px rgba(0,0,0,.8);}
#enf-ov .enf-sub{font-size:clamp(10px,2vh,13px);color:rgba(232,220,192,.6);letter-spacing:.3em;margin-top:-4px;}
#enf-ov .enf-map{position:relative;width:min(94vw,calc((100vh - 130px) * 1.5),1100px);aspect-ratio:3/2;
  border-radius:10px;overflow:hidden;box-shadow:0 10px 40px rgba(0,0,0,.75),0 0 0 1px rgba(201,164,76,.5);}
#enf-ov .enf-map > img.bg{position:absolute;inset:0;width:100%;height:100%;display:block;filter:saturate(.85) brightness(.92);}
#enf-ov .seal{position:absolute;transform:translate(-50%,-50%);font-family:var(--font-deco,'Noto Serif TC',serif);font-weight:900;
  font-size:clamp(13px,3.2vh,24px);line-height:1;color:#fff4d6;width:1.7em;height:1.7em;
  display:flex;align-items:center;justify-content:center;border-radius:50%;
  background:rgba(40,22,10,.6);border:2px solid rgba(255,236,190,.5);text-shadow:0 1px 2px #000;z-index:2;
  transition:background .4s,border-color .4s,box-shadow .4s;}
#enf-ov .seal.owned{background:var(--kc);border-color:#f3cf6e;box-shadow:0 0 12px rgba(243,207,110,.8);}
#enf-ov .owners{position:absolute;transform:translate(-50%,0);display:flex;gap:2px;z-index:3;}
#enf-ov .owners img{width:clamp(20px,5vh,38px);height:clamp(20px,5vh,38px);border-radius:50%;
  background:#f3e6c4;border:2px solid var(--kc,#f3cf6e);box-shadow:0 2px 6px rgba(0,0,0,.6);}
#enf-ov .owners img.new{animation:enfBadge .5s cubic-bezier(.2,1.6,.4,1) both;}
@keyframes enfBadge{from{transform:scale(0)}to{transform:scale(1)}}
#enf-ov .glow{position:absolute;transform:translate(-50%,-50%);width:34%;aspect-ratio:1;border-radius:50%;
  background:radial-gradient(circle,var(--kc) 0%,transparent 62%);mix-blend-mode:screen;opacity:0;z-index:1;pointer-events:none;}
#enf-ov .glow.on{animation:enfGlow 1.1s ease-in-out infinite alternate;}
#enf-ov .glow.won{animation:none;opacity:.55;transition:opacity .6s;}
@keyframes enfGlow{from{opacity:.15}to{opacity:.55}}
#enf-ov .lord{position:absolute;width:30%;aspect-ratio:1;transform:translate(-50%,-78%);z-index:5;pointer-events:none;
  filter:drop-shadow(0 8px 14px rgba(0,0,0,.8));}
#enf-ov .lord img{width:100%;height:100%;object-fit:contain;display:block;}
#enf-ov .lord.flip img{transform:scaleX(-1);}
#enf-ov .dust{position:absolute;width:5%;aspect-ratio:1;border-radius:50%;background:rgba(214,190,140,.55);
  transform:translate(-50%,-50%);z-index:4;pointer-events:none;animation:enfDust .7s ease-out forwards;}
@keyframes enfDust{from{opacity:.8;transform:translate(-50%,-50%) scale(.4)}to{opacity:0;transform:translate(-50%,-80%) scale(1.8)}}
#enf-ov .flash{position:absolute;inset:0;background:radial-gradient(circle at var(--fx) var(--fy),rgba(255,245,210,.95),transparent 45%);
  z-index:6;pointer-events:none;animation:enfFlash .45s ease-out forwards;}
@keyframes enfFlash{from{opacity:1}to{opacity:0}}
#enf-ov .stamp{position:absolute;transform:translate(-50%,-50%) rotate(-10deg);z-index:7;pointer-events:none;
  font-family:var(--font-deco,'Noto Serif TC',serif);font-weight:900;font-size:clamp(20px,6vh,44px);color:#c0281c;letter-spacing:.05em;
  border:4px solid #c0281c;border-radius:6px;padding:.05em .25em;background:rgba(255,240,215,.2);
  animation:enfStamp .5s cubic-bezier(.3,1.5,.5,1) both;mix-blend-mode:multiply;}
#enf-ov .stamp.fade{transition:opacity .6s;opacity:0;}
@keyframes enfStamp{from{opacity:0;transform:translate(-50%,-50%) rotate(-18deg) scale(2.4)}
  to{opacity:1;transform:translate(-50%,-50%) rotate(-10deg) scale(1)}}
#enf-ov .flag{position:absolute;z-index:4;pointer-events:none;transform:translate(-2px,-100%);
  width:3px;height:clamp(26px,7vh,52px);background:linear-gradient(#6b4a1a,#3a2508);
  animation:enfFlag .4s ease-out both;transform-origin:bottom;}
#enf-ov .flag::after{content:attr(data-c);position:absolute;left:3px;top:0;
  width:clamp(18px,4.6vh,34px);height:clamp(13px,3.4vh,25px);background:var(--kc);color:#fff;
  font-family:var(--font-deco,'Noto Serif TC',serif);font-weight:900;font-size:clamp(10px,2.4vh,18px);display:flex;align-items:center;justify-content:center;
  clip-path:polygon(0 0,100% 0,85% 50%,100% 100%,0 100%);animation:enfWave 1.2s ease-in-out infinite alternate;transform-origin:left;}
@keyframes enfFlag{from{transform:translate(-2px,-100%) scaleY(0)}to{transform:translate(-2px,-100%) scaleY(1)}}
@keyframes enfWave{from{transform:skewY(-4deg)}to{transform:skewY(4deg)}}
#enf-ov .enf-cap{min-height:2.6em;text-align:center;font-size:clamp(13px,3vh,19px);letter-spacing:.12em;}
#enf-ov .enf-cap .rank{font-family:var(--font-deco,'Noto Serif TC',serif);font-weight:900;color:#c9a44c;margin-right:.6em;}
#enf-ov .enf-cap .who{color:#fff4d6;}
#enf-ov .enf-cap .got{color:#f3cf6e;font-weight:700;}
#enf-ov .enf-cap .none{color:rgba(232,220,192,.6);}
#enf-ov .enf-cap.in{animation:enfCap .4s ease both;}
@keyframes enfCap{from{opacity:0;transform:translateY(8px)}to{opacity:1}}
#enf-ov .enf-hint{font-size:10px;color:rgba(232,220,192,.4);letter-spacing:.2em;}
`;

/* ── 音效（使用者：「分封領地是不是也該有 BGM？或音效」）──────────────
   全部程序合成，不另外放音檔：
     出兵　戰鼓兩響　　行軍　急促鼓點　　抵達　重擊＋銅鑼（蓋印那一下）
     沒有封地　一聲低沉的鼓　　全部播完　一段號角（五聲音階）
   播的時候遊戲的 BGM 先淡出讓位，播完接回原本那首。靜音設定（MJAudio.SFX）照樣有效。
   ⚠️ iOS 只准在使用者手勢裡把 AudioContext 叫醒 —— 分封是牌局自己跑到的，不是手勢，
      所以在第一次點畫面時就先建好、叫醒，之後播的時候直接用。 */
let actx = null, master = null;
function audioOn() {
  try { return !window.MJAudio || !window.MJAudio.SFX || window.MJAudio.SFX.isEnabled(); } catch (_) { return true; }
}
function ctx() {
  if (!actx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    actx = new AC();
    master = actx.createGain();
    master.gain.value = 0.55;
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
function noise(c, dur) {
  const b = c.createBuffer(1, Math.max(1, Math.floor(c.sampleRate * dur)), c.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const n = c.createBufferSource();
  n.buffer = b;
  return n;
}
/* 一聲鼓：音高快速下滑的正弦波＋一點噪音（鼓皮） */
function drum(at, pitch, vol) {
  if (!audioOn()) return;
  const c = ctx(); if (!c) return;
  const t = c.currentTime + (at || 0);
  const o = c.createOscillator(), g = c.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(pitch || 110, t);
  o.frequency.exponentialRampToValueAtTime((pitch || 110) * 0.45, t + 0.25);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol || 0.9, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
  o.connect(g); g.connect(master);
  o.start(t); o.stop(t + 0.5);
  const n = noise(c, 0.08), ng = c.createGain(), f = c.createBiquadFilter();
  f.type = 'lowpass'; f.frequency.value = 1200;
  ng.gain.setValueAtTime((vol || 0.9) * 0.35, t);
  ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
  n.connect(f); f.connect(ng); ng.connect(master);
  n.start(t);
}
/* 銅鑼：幾個不成倍數的泛音，長長地響 */
function gong(at) {
  if (!audioOn()) return;
  const c = ctx(); if (!c) return;
  const t = c.currentTime + (at || 0);
  [[172, .5], [251, .32], [398, .22], [566, .14], [803, .08]].forEach(([f, v]) => {
    const o = c.createOscillator(), g = c.createGain();
    o.type = 'sine'; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.6);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + 2.7);
  });
}
/* 號角：鋸齒波過低通，五聲音階往上走、最後停在主音 */
function horn(at) {
  if (!audioOn()) return;
  const c = ctx(); if (!c) return;
  const t0 = c.currentTime + (at || 0);
  const notes = [[392, 0, .22], [440, .22, .22], [523, .44, .22], [587, .66, .3], [784, .98, .9]];
  notes.forEach(([f, st, d]) => {
    const o = c.createOscillator(), g = c.createGain(), lp = c.createBiquadFilter();
    o.type = 'sawtooth'; o.frequency.value = f;
    lp.type = 'lowpass'; lp.frequency.value = 1500;
    const t = t0 + st;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.22, t + 0.04);
    g.gain.setValueAtTime(0.22, t + d * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.25);
    o.connect(lp); lp.connect(g); g.connect(master);
    o.start(t); o.stop(t + d + 0.3);
  });
  drum(0.98 + (at || 0), 90, 0.8);
}
const SND = {
  go()     { drum(0, 120, .9); drum(0.22, 100, .9); },
  march(ms) { for (let i = 0; i < 7; i++) drum(i * ms / 7000, 150 + (i % 2) * 20, .5); },
  arrive() { drum(0, 70, 1); gong(0.05); },
  none()   { drum(0, 60, .6); },
  finale() { horn(0); },
};

/* 遊戲的 BGM 先讓位，播完接回去 */
let bgmWas = null;
function bgmPause() {
  try {
    const B = window.MJAudio && window.MJAudio.BGM;
    if (!B) return;
    bgmWas = B.currentScene();
    if (bgmWas) B.stop(0.6);
  } catch (_) {}
}
function bgmResume() {
  try {
    const B = window.MJAudio && window.MJAudio.BGM;
    if (B && bgmWas) B.play(bgmWas, 1.0);
  } catch (_) {}
  bgmWas = null;
}

let ov = null, mapEl = null, capEl = null;
let timers = [];
let finishing = null;           // 目前這一段的「跳到結果」

function ensureDom() {
  if (ov) return;
  const st = document.createElement('style');
  st.textContent = CSS;
  document.head.appendChild(st);
  ov = document.createElement('div');
  ov.id = 'enf-ov';
  // 標題是魏碑做成的圖（assets/titles/，tools/build-titles.py）—— 魏碑是 macOS 字型，不能當網頁字型
  ov.innerHTML = '<div class="enf-title"><img class="ttl" src="assets/titles/enfeoff.webp" alt="分封領地" style="height:1.25em;width:auto;vertical-align:middle"></div><div class="enf-sub">— 打敗誰，就拿誰的地 —</div>'
    + '<div class="enf-map"><img class="bg" src="' + MAP_URL + '" alt=""></div>'
    + '<div class="enf-cap"></div><div class="enf-hint">點一下跳到結果</div>';
  document.body.appendChild(ov);
  mapEl = ov.querySelector('.enf-map');
  capEl = ov.querySelector('.enf-cap');
  ov.addEventListener('click', () => { if (finishing) finishing(); });
}

const later = (fn, ms) => { const t = setTimeout(fn, ms); timers.push(t); return t; };
const pos = id => MAP_POS[id] || [50, 50];
const kc = id => (K.get(id) || {}).color || '#c9a44c';
const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function stop() {
  timers.forEach(clearTimeout); timers = [];
  if (mapEl && mapEl.getAnimations) mapEl.getAnimations({ subtree: true }).forEach(a => { try { a.cancel(); } catch (_) {} });
}

/* 地圖：各國的印＋擁有者的頭像 */
function paintMap(lords) {
  mapEl.querySelectorAll(':scope > :not(img.bg)').forEach(n => n.remove());
  const owners = {};
  lords.forEach(l => [l.home].concat(l.conquered || []).forEach((id, j) => {
    (owners[id] = owners[id] || []).push({ l, home: j === 0, fresh: l.fresh === id });
  }));
  K.KINGDOMS.forEach(k => {
    const [x, y] = pos(k.id);
    const own = owners[k.id] || [];
    const s = document.createElement('div');
    s.className = 'seal' + (own.length ? ' owned' : '');
    s.dataset.k = k.id;
    s.style.left = x + '%'; s.style.top = y + '%';
    const first = own.find(o => o.home) || own[0];
    if (first) s.style.setProperty('--kc', kc(first.l.home));
    s.textContent = k.char;
    mapEl.appendChild(s);
    if (own.length) {
      const o = document.createElement('div');
      o.className = 'owners';
      o.style.left = x + '%'; o.style.top = 'calc(' + y + '% + 2.1vh)';
      own.forEach(w => {
        const im = document.createElement('img');
        im.src = K.avatarUrl(w.l.home);
        im.style.setProperty('--kc', kc(w.l.home));
        if (w.fresh) im.className = 'new';
        o.appendChild(im);
      });
      mapEl.appendChild(o);
    }
  });
}

function caption(html) {
  capEl.className = 'enf-cap';
  void capEl.offsetWidth;
  capEl.className = 'enf-cap in';
  capEl.innerHTML = html;
}

/* 一位主公的出征 */
function playOne(lords, a, done) {
  const lord = lords.find(l => l.name === a.name);
  if (!a.gained || !lord) {
    SND.none();
    caption(`<span class="rank">${RANK[a.rank] || ''}</span><span class="who">${esc(a.name)}</span>　<span class="none">此戰未得寸土</span>`);
    later(done, 1600);
    return;
  }
  const g = K.get(a.gained), home = K.get(lord.home);
  caption(`<span class="rank">${RANK[a.rank] || ''}</span><span class="who">${esc(a.name)}（${home.char}）</span>　出兵${g.name}⋯`);
  SND.go();

  const [tx, ty] = pos(g.id), [hx, hy] = pos(home.id);
  const glow = document.createElement('div');
  glow.className = 'glow on';
  glow.style.left = tx + '%'; glow.style.top = ty + '%';
  glow.style.setProperty('--kc', kc(home.id));
  mapEl.appendChild(glow);

  const sp = document.createElement('div');
  sp.className = 'lord' + (tx < hx ? ' flip' : '');     // 往左打就轉身
  const img = document.createElement('img');
  sp.appendChild(img);
  const frames = K.warFrames(home.id, false);
  img.src = frames[0];
  sp.style.left = hx + '%'; sp.style.top = hy + '%';
  mapEl.appendChild(sp);

  const MARCH = 1300, START = 550;
  const mx = (hx + tx) / 2, my = Math.min(hy, ty) - 8;   // 弧線行軍：中途抬高一點，像翻山越嶺
  later(() => {
    img.src = frames[1];
    SND.march(MARCH);
    sp.animate([
      { left: hx + '%', top: hy + '%' },
      { left: mx + '%', top: my + '%', offset: .5 },
      { left: tx + '%', top: ty + '%' },
    ], { duration: MARCH, easing: 'ease-in', fill: 'forwards' });
    for (let i = 1; i <= 6; i++) later(() => {
      const t = i / 7;
      const x = (1 - t) * (1 - t) * hx + 2 * (1 - t) * t * mx + t * t * tx;
      const y = (1 - t) * (1 - t) * hy + 2 * (1 - t) * t * my + t * t * ty;
      const d = document.createElement('div');
      d.className = 'dust';
      d.style.left = x + '%'; d.style.top = (y + 1) + '%';
      mapEl.appendChild(d);
      later(() => d.remove(), 800);
    }, MARCH * i / 7);
  }, START);
  later(() => { img.src = frames[2]; }, START + 380);

  const ARRIVE = START + MARCH;
  later(() => {
    const f = document.createElement('div');
    f.className = 'flash';
    f.style.setProperty('--fx', tx + '%'); f.style.setProperty('--fy', ty + '%');
    mapEl.appendChild(f);
    later(() => f.remove(), 500);
    SND.arrive();
    const st = document.createElement('div');
    st.className = 'stamp';
    st.textContent = '征服';
    st.style.left = tx + '%'; st.style.top = (ty - 1) + '%';
    mapEl.appendChild(st);
    const fl = document.createElement('div');
    fl.className = 'flag';
    fl.dataset.c = home.char;
    fl.style.setProperty('--kc', kc(home.id));
    fl.style.left = (tx + 4) + '%'; fl.style.top = (ty + 2) + '%';
    mapEl.appendChild(fl);
    glow.className = 'glow won';
    const seal = mapEl.querySelector('.seal[data-k="' + g.id + '"]');
    if (seal) { seal.classList.add('owned'); seal.style.setProperty('--kc', kc(home.id)); }
    caption(`<span class="rank">${RANK[a.rank] || ''}</span><span class="who">${esc(a.name)}（${home.char}）</span>　征服 <span class="got">${g.name}</span>！`);
  }, ARRIVE);
  later(() => { img.src = K.calmUrl(home.id, false); }, ARRIVE + 350);
  later(() => {
    sp.animate([{ opacity: 1, transform: 'translate(-50%,-78%) scale(1)' },
                { opacity: 0, transform: 'translate(-50%,-40%) scale(.25)' }],
               { duration: 450, easing: 'ease-in', fill: 'forwards' });
    const s = mapEl.querySelector('.stamp'); if (s) s.classList.add('fade');
  }, ARRIVE + 1500);
  later(() => {
    sp.remove();
    lord.conquered = (lord.conquered || []).concat([g.id]);
    lord.fresh = g.id;
    const keep = [...mapEl.querySelectorAll('.glow.won,.flag')];
    paintMap(lords);
    keep.forEach(n => mapEl.appendChild(n));
    done();
  }, ARRIVE + 1950);
}

function preload(lords) {
  lords.forEach(l => K.warFrames(l.home, false).concat([K.calmUrl(l.home, false)])
    .forEach(u => { const i = new Image(); i.src = u; }));
}

function summaryHtml(awards) {
  const got = awards.filter(a => a.gained).sort((a, b) => a.rank - b.rank);
  return got.length
    ? got.map(a => `<span class="who">${esc(a.name)}</span> <span class="got">${(K.get(a.gained) || {}).char || ''}</span>`).join('　·　')
    : '<span class="none">此戰無人得地</span>';
}

/* 播一次。回傳 Promise：播完、或點一下跳到結果之後再停 1.5 秒才 resolve */
function play(o) {
  ensureDom();
  stop();
  const lords = JSON.parse(JSON.stringify(o.lords || []));
  const awards = (o.awards || []).filter(a => !a.ai);
  const order = awards.slice().sort((a, b) => b.rank - a.rank);   // 名次從後往前，第一名壓軸
  preload(lords);
  paintMap(lords);
  capEl.innerHTML = '';
  ov.classList.add('show');
  bgmPause();

  return new Promise(resolve => {
    let over = false;
    const end = () => {
      if (over) return;
      over = true;
      finishing = null;
      later(() => { ov.classList.remove('show'); stop(); bgmResume(); resolve(); }, o.holdMs != null ? o.holdMs : 2200);
    };
    // 跳到結果：直接畫出最後的樣子
    finishing = () => {
      if (over) { stop(); ov.classList.remove('show'); bgmResume(); resolve(); return; }
      stop();
      awards.forEach(a => {
        const l = lords.find(x => x.name === a.name);
        if (l && a.gained && (l.conquered || []).indexOf(a.gained) < 0) { l.conquered = (l.conquered || []).concat([a.gained]); l.fresh = a.gained; }
      });
      paintMap(lords);
      caption(summaryHtml(awards));
      if (awards.some(a => a.gained)) SND.finale();
      end();
    };
    let i = 0;
    const next = () => {
      if (i >= order.length) {
        caption(summaryHtml(awards));
        if (awards.some(a => a.gained)) SND.finale();
        end();
        return;
      }
      playOne(lords, order[i++], () => later(next, 400));
    };
    later(next, 700);
  });
}

return { play, MAP_POS, MAP_URL };
});
