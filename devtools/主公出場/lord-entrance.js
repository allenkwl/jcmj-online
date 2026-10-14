/* ═══════════════════════════════════════════════════════════════
   lord-entrance.js — 主公出場・實驗版【遊戲還沒用】
   ───────────────────────────────────────────────────────────────
   ⚠️ 只有 devtools/主公出場v0.1.html 會載入。遊戲本體的中央主公像
      仍是 src/render.js 的 renderCenterLord ＋ 樣式裡的 lordIn 淡入，兩邊互不相干。
      決定採用之後才搬回本體、另存新版。

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
      （實驗台會把樣式裡的 lordIn 關掉來模擬；搬回本體時直接刪掉那一行。）
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
  bigScale: 0.78,    // 大圖的邊長＝畫面短邊 × 這個比例
  bigMax:   720,     // 大圖最大幾像素
  spareHand: true,   // 不蓋到自己的手牌（大圖底邊停在手牌上緣）
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

  // 大圖多大：畫面短邊 × 比例，不超過上限；不蓋到手牌的話，底邊停在手牌上緣
  const vw = innerWidth, vh = innerHeight;
  let big = Math.min(Math.min(vw, vh) * SIZE.bigScale, SIZE.bigMax);
  big = Math.min(big, 2 * cy - 4, 2 * (vw - cx) - 4, 2 * cx - 4);       // 不超出畫面
  if (SIZE.spareHand) {
    const hb = document.getElementById('hand-bottom');
    const r = hb && hb.getBoundingClientRect();
    if (r && r.height) big = Math.min(big, 2 * (r.top - cy) - 4);
  }
  big = Math.max(big, small.width);

  const layer = document.createElement('div');
  layer.className = 'lord-fx';
  Object.assign(layer.style, {
    position: 'fixed', left: (cx - big / 2) + 'px', top: (cy - big / 2) + 'px',
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
        { transform: `scale(${k})`, opacity: op },
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
