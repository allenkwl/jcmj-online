/* ═══════════════════════════════════════════════════════════════
   lord-entrance.js — 牌桌中央的主公出場
   ───────────────────────────────────────────────────────────────
   v1.55 起由 render.js 的 renderCenterLord 呼叫（有載入這一支就用它，沒有就走舊的 playFrames）。
   原型與實驗台：devtools/主公出場/lord-entrance.js、devtools/主公出場v0.1.html。
   ⚠️ 改節奏、大小請先在實驗台調好，再抄回來（兩支要同步）。

   ── 起因（2026-10-14）──
   使用者：「每次輪到玩家，君王動畫會出現兩次」。查到的原因：
     每次重畫牌桌，fitSizes（render.js）量中央區夠不夠放牌河之前，
     會把 #center-lord 暫時 display:none、量完放回去 ——
     元素被拿掉再放回，樣式裡的 animation（lordIn 淡入）就從頭再播一次。
     電腦的回合重畫時剛好換人，看不出來；輪到自己時摸牌那一下重畫，
     同一張臉就再淡入一次。點牌選牌也會重畫，一樣會重播。
   使用者接著提：「放大主公的動畫……動畫放大壓到牌也沒關係，反而有張力」。

   ── 這一版的做法 ──
   1. 淡入不寫在樣式裡，改成換人時由程式呼叫 img.animate() 播一次。
      程式播的動畫不會因為 display:none 被取消重來，重畫幾次都只播那一次。
      （v1.55 起遊戲樣式裡的 animation:lordIn 已經刪掉。）
   2. 輪到自己（可切換成每一家）時播「大」的：
        放大衝出來（蓄勢）→ 出招一閃 → 進攻停住 → 縮回中央、退到牌的下面
      大的那一份畫在另一層（position:fixed，掛在 body 上），
      **不在 #center 裡面，所以完全不影響量版面**；縮回去之後才把中央的小圖亮出來。
   3. 電腦的回合維持小圖（照舊播三格），只是淡入改成第 1 點的做法。
      電腦連打時每 0.65 秒換一家，每家都放大會一直閃（使用者同意先這樣試）。

   ── 前提（同發牌動畫）──
     ‧ 全程點得穿（pointer-events:none），不擋出牌
     ‧ 尊重 prefers-reduced-motion：只換圖、不放大不淡入
     ‧ 前一次還沒播完又換人 → 前一次立刻收掉，不會兩個疊在一起
   ═══════════════════════════════════════════════════════════════ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MJLordEntrance = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
'use strict';

/* ── 節奏（毫秒）── 工具頁的欄位直接改這個物件 */
const T_ = {
  // 大的（輪到自己）
  zoomIn:   180,     // 放大衝出來（第一格：蓄勢）
  hold1:    300,     // 蓄勢停住
  strike:   120,     // 第二格：出招一閃
  hold3:    260,     // 第三格：進攻停在大的狀態
  shrink:   280,     // 縮回中央
  // 小的（電腦的回合）—— 同 render.js 的 WAR_MS ＋ lordIn
  smallHold1: 450,
  smallStrike: 130,
  smallFade:  450,
};

/* ── 尺寸（工具頁也會改）── */
const SIZE = {
  /* 大圖的邊長＝可用高度 × 這個比例。可用高度＝畫面頂端到手牌上緣（spareHand）或到畫面底。
     ⚠️ 原本是「畫面短邊 × 比例」再夾一個 720px 上限、而且以中央為中心往上下長：
        桌機被 720 卡住、手機被手牌卡住，滑桿拉了沒反應
        （2026-10-14 使用者：「大圖大小，調了沒作用？我要再大一點」）。
        現在不設像素上限；往下碰到手牌就改成貼著手牌往上長，上方的空間也用得到。 */
  bigScale: 0.62,   // 2026-10-14 使用者實際玩過之後在全螢幕下調成 62%（82% 太大）
  /* 不蓋到自己的手牌（大圖底邊停在手牌上緣）。預設關：
     2026-10-14 使用者：「蓋到手牌沒關係，這個動畫時間很短」 */
  spareHand: false,
  punch:    1.08,    // 出招那一下多衝出去多少
};

const reduced = () => {
  try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) { return false; }
};
const preload = urls => Promise.all(urls.map(u => new Promise(res => {
  const im = new Image(); im.onload = im.onerror = () => res(); im.src = u;
})));

/* 每個中央主公像節點各自一份狀態：上一輪的計時器、大圖那一層 */
function state(node) {
  if (!node._le) node._le = { tok: 0, timers: [], layer: null };
  return node._le;
}
function stop(node) {
  const s = state(node);
  s.tok++;
  s.timers.forEach(clearTimeout); s.timers = [];
  if (s.layer) { s.layer.remove(); s.layer = null; }
  node.style.visibility = '';
}
function later(node, tok, ms, fn) {
  const s = state(node);
  s.timers.push(setTimeout(() => { if (tok === s.tok) fn(); }, ms));
}

/* 中央的小圖：只放最後一格與名字。不帶樣式動畫 —— 淡入由呼叫的人用 animate() 決定要不要播 */
function paintSmall(node, o, src) {
  node.textContent = '';
  const img = document.createElement('img');
  img.className = 'lord-img';
  img.alt = o.title || '';
  img.src = src;
  node.appendChild(img);
  if (o.color) node.style.setProperty('--k-color', o.color);
  const cap = document.createElement('div');
  cap.className = 'lord-cap';
  cap.textContent = o.title || '';
  node.appendChild(cap);
  return img;
}

/* 程式播的淡入：display:none 不會把它取消重來（樣式動畫會） */
function fadeIn(img, ms) {
  if (!img.animate || !ms) return null;
  return img.animate([
    { opacity: 0, transform: 'scale(.9)' },
    { opacity: 1, transform: 'none' },
  ], { duration: ms, easing: 'ease' });
}

/* ── 小的：照舊播三格（電腦的回合）── */
function playSmall(node, o) {
  const s = state(node), tok = s.tok;
  const f = o.frames;
  const img = paintSmall(node, o, f[0]);
  if (reduced() || f.length < 3) { img.src = f[f.length - 1]; return Promise.resolve('small:static'); }
  fadeIn(img, T_.smallFade);
  return new Promise(res => {
    later(node, tok, T_.smallHold1, () => { img.src = f[1]; });
    later(node, tok, T_.smallHold1 + T_.smallStrike, () => { img.src = f[2]; res('small'); });
  });
}

/* ── 大的：在另一層放大、出招、縮回中央 ── */
function playBig(node, o) {
  const s = state(node), tok = s.tok;
  const f = o.frames;
  const finalImg = paintSmall(node, o, f[f.length - 1]);
  if (reduced() || f.length < 3) return Promise.resolve('big:static');

  // 中央小圖的位置（縮回去的終點）—— 小圖本身先藏起來，縮到位才亮
  const small = finalImg.getBoundingClientRect();
  node.style.visibility = 'hidden';
  const cx = small.left + small.width / 2, cy = small.top + small.height / 2;

  // 大圖多大：可用高度 × 比例。可用高度＝畫面頂端到底邊（不蓋手牌的話，底邊＝手牌上緣）
  const vw = innerWidth, vh = innerHeight, M = 4;
  let bottom = vh - M;
  if (SIZE.spareHand) {
    const hb = document.getElementById('hand-bottom');
    const r = hb && hb.getBoundingClientRect();
    if (r && r.height) bottom = Math.min(bottom, r.top - M);
  }
  let big = (bottom - M) * SIZE.bigScale;
  big = Math.min(big, vw - 2 * M);                                       // 也不能比畫面寬
  big = Math.max(big, small.width);
  // 位置：盡量以中央小圖為中心；往下超過底邊就整個往上推，往上超過畫面頂就往下推
  const bx = Math.min(Math.max(cx - big / 2, M), vw - M - big);
  const by = Math.min(Math.max(cy - big / 2, M), bottom - big);

  const layer = document.createElement('div');
  layer.className = 'lord-fx';
  Object.assign(layer.style, {
    position: 'fixed', left: bx + 'px', top: by + 'px',
    width: big + 'px', height: big + 'px', pointerEvents: 'none', zIndex: '45',
  });
  const img = document.createElement('img');
  img.src = f[0];
  img.alt = '';
  Object.assign(img.style, {
    width: '100%', height: '100%', objectFit: 'contain', display: 'block',
    filter: 'drop-shadow(0 6px 22px rgba(0,0,0,.75)) saturate(1.1)',
  });
  layer.appendChild(img);
  document.body.appendChild(layer);
  s.layer = layer;

  const k = small.width / big;                        // 縮回去的比例
  const dx = cx - (bx + big / 2), dy = cy - (by + big / 2);   // 縮回去要移多少（大圖被推過時中心不在中央）
  const op = parseFloat(getComputedStyle(finalImg).opacity) || 0.82;

  return new Promise(res => {
    // 一、放大衝出來
    if (img.animate) img.animate([
      { opacity: 0, transform: 'scale(.55)' },
      { opacity: 1, transform: 'scale(1.03)', offset: 0.75 },
      { opacity: 1, transform: 'none' },
    ], { duration: T_.zoomIn, easing: 'ease-out' });

    // 二、出招一閃：換第二格、往前衝一下、亮一下
    const t1 = T_.zoomIn + T_.hold1;
    later(node, tok, t1, () => {
      img.src = f[1];
      if (img.animate) img.animate([
        { transform: 'none', filter: img.style.filter },
        { transform: `scale(${SIZE.punch}) translateX(-1.5%)`, filter: img.style.filter + ' brightness(1.35)', offset: 0.4 },
        { transform: 'none', filter: img.style.filter },
      ], { duration: T_.strike + 80, easing: 'ease-out' });
    });

    // 三、進攻停住
    const t2 = t1 + T_.strike;
    later(node, tok, t2, () => { img.src = f[2]; });

    // 四、縮回中央：整層縮到小圖的大小，透明度降到小圖的透明度
    const t3 = t2 + T_.hold3;
    later(node, tok, t3, () => {
      if (layer.animate) layer.animate([
        { transform: 'none', opacity: 1 },
        { transform: `translate(${dx}px,${dy}px) scale(${k})`, opacity: op },
      ], { duration: T_.shrink, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'forwards' });
    });

    // 五、到位：亮出中央的小圖、拿掉大圖那一層
    later(node, tok, t3 + T_.shrink, () => {
      node.style.visibility = '';
      layer.remove(); s.layer = null;
      res('big');
    });
  });
}

/* ── 主流程 ──
   opts:
     node     中央主公像（#center-lord）
     frames   出征三格（K.warFrames）
     title    名字（主公全名或守將稱號）
     color    國色（名字的光暈）
     big      true＝放大版；false＝小的
   回傳 Promise：播完（或被下一次蓋掉之前）resolve。 */
function play(opts) {
  const o = opts || {};
  const node = o.node;
  if (!node || !o.frames || !o.frames.length) return Promise.resolve('skip');
  stop(node);
  // 先把每一格載好再播（理由同 render.js 的 playFrames：手機上第二、三格會閃空白）
  const tok = state(node).tok;
  return Promise.race([preload(o.frames), new Promise(r => setTimeout(r, 1500))]).then(() => {
    if (tok !== state(node).tok) return 'cancelled';
    return o.big ? playBig(node, o) : playSmall(node, o);
  });
}

return { play, stop, T_, SIZE };
});
