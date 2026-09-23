/* ═══════════════════════════════════════════════════════════════
   tiles.js — 牌面繪製（含旋轉）
   ───────────────────────────────────────────────────────────────
   舊版的牌殼與牌背是程序繪製的（`drawShell` / `drawBack` / `draw3DSides`），
   那部分照搬。但**牌面不是** —— `drawWan` / `drawTong` / `drawTiao` /
   `drawHonor` 走的都是 `ctx.drawImage`，圖就是那 12 MB base64。

   PLAN 把「牌面 Canvas 繪製」列在保值資產裡，實際讀下去只對了一半。

   所以這裡的萬／筒／條／字用**程序畫**（舊版的文字 fallback 路徑加強版）：
     ‧ 現在就能改版面，不用扛 12 MB
     ‧ 階段四拆圖之後，把圖塞進 `setFaceImages()` 就會自動改走圖片路徑

   ── 旋轉 ──
   四人版的左右兩家要橫著擺，這是舊版沒有的能力。
   做法是把 canvas 的長寬對調，再 translate + rotate 之後照原尺寸畫 ——
   所以繪製程式完全不用知道自己被轉了幾度。
   ═══════════════════════════════════════════════════════════════ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MJTiles = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
'use strict';

const NUM_CH = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
const SIDE = 3;                                  // 3D 側面厚度

/* 階段四拆圖之後把 {'1萬': Image, …} 餵進來就會改走圖片 */
let FACE_IMAGES = null;
function setFaceImages(map) { FACE_IMAGES = map || null; }

function rrect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/* ── 3D 側面（舊版 draw3DSides，原樣搬過來）────────────────── */
function draw3DSides(ctx, x, y, w, h, sd) {
  if (!sd) return;
  ctx.beginPath();
  ctx.moveTo(x, y + h); ctx.lineTo(x + sd, y + h + sd);
  ctx.lineTo(x + w + sd, y + h + sd); ctx.lineTo(x + w, y + h);
  ctx.closePath();
  const bg = ctx.createLinearGradient(x, y + h, x, y + h + sd);
  bg.addColorStop(0, '#7a5018'); bg.addColorStop(1, '#3a2008');
  ctx.fillStyle = bg; ctx.fill();

  ctx.beginPath();
  ctx.moveTo(x + w, y); ctx.lineTo(x + w + sd, y + sd);
  ctx.lineTo(x + w + sd, y + h + sd); ctx.lineTo(x + w, y + h);
  ctx.closePath();
  const rg = ctx.createLinearGradient(x + w, y, x + w + sd, y);
  rg.addColorStop(0, '#9a6828'); rg.addColorStop(1, '#5a3810');
  ctx.fillStyle = rg; ctx.fill();
}

/* ── 牌殼（象牙白）── */
function drawShell(ctx, x, y, w, h, sel, thin) {
  const sd = thin ? 0 : SIDE;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,.55)';
  ctx.shadowBlur = sel ? 14 : 5;
  ctx.shadowOffsetY = sel ? 8 : 3;
  if (!thin) draw3DSides(ctx, x, y, w, h, sd);
  rrect(ctx, x, y, w, h, thin ? 3 : 5);
  const fg = ctx.createLinearGradient(x, y, x, y + h);
  fg.addColorStop(0, '#ffffff');
  fg.addColorStop(0.12, '#fefef8');
  fg.addColorStop(0.65, '#f8f4e8');
  fg.addColorStop(1, '#ede4c8');
  ctx.fillStyle = fg; ctx.fill();
  ctx.restore();

  if (!thin) {
    ctx.save();
    rrect(ctx, x, y, w, h, 5); ctx.clip();
    const hl = ctx.createLinearGradient(x, y, x, y + h * 0.38);
    hl.addColorStop(0, 'rgba(255,255,255,.6)');
    hl.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = hl; ctx.fillRect(x, y, w, h * 0.38);
    ctx.restore();
  }
  rrect(ctx, x, y, w, h, thin ? 3 : 5);
  ctx.strokeStyle = 'rgba(160,110,40,.55)'; ctx.lineWidth = thin ? 1 : 1.5; ctx.stroke();
  rrect(ctx, x + 1, y + 1, w - 2, h - 2, thin ? 2 : 4);
  ctx.strokeStyle = 'rgba(255,255,255,.8)'; ctx.lineWidth = thin ? 0.5 : 1; ctx.stroke();
}

/* ── 牌背 ── */
function drawBack(ctx, x, y, w, h, thin) {
  const sd = thin ? 0 : SIDE;
  if (!thin) draw3DSides(ctx, x, y, w, h, sd);
  rrect(ctx, x, y, w, h, thin ? 3 : 5);
  const g = ctx.createLinearGradient(x, y, x + w, y + h);
  g.addColorStop(0, '#3c1a08'); g.addColorStop(1, '#1e0c04');
  ctx.fillStyle = g; ctx.fill();

  rrect(ctx, x + 2, y + 2, w - 4, h - 4, 3);
  ctx.strokeStyle = 'rgba(160,80,20,.45)'; ctx.lineWidth = 1; ctx.stroke();

  ctx.save();
  rrect(ctx, x + 2, y + 2, w - 4, h - 4, 3); ctx.clip();
  ctx.strokeStyle = 'rgba(100,45,10,.22)'; ctx.lineWidth = 1;
  for (let i = -h; i < w + h; i += 6) {
    ctx.beginPath(); ctx.moveTo(x + i, y); ctx.lineTo(x + i + h, y + h); ctx.stroke();
  }
  ctx.restore();
}

/* ── 萬子 ── */
function drawWan(ctx, tile, x, y, w, h) {
  const cx = x + w / 2;
  const n = tile.num;
  if (!n || !NUM_CH[n]) return;
  ctx.save();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  // 上半：漢字數字（紅），下半：萬（黑）—— 傳統牌面的排法
  ctx.fillStyle = '#b4342a';
  ctx.font = `bold ${Math.round(h * 0.34)}px 'Noto Serif TC','Songti TC',serif`;
  ctx.fillText(NUM_CH[n], cx, y + h * 0.33);
  ctx.fillStyle = '#1a1a1a';
  ctx.font = `bold ${Math.round(h * 0.30)}px 'Noto Serif TC','Songti TC',serif`;
  ctx.fillText('萬', cx, y + h * 0.70);
  ctx.restore();
}

/* 筒子的點陣排列（傳統擺法） */
const TONG_LAYOUT = {
  1: [[0.5, 0.5]],
  2: [[0.5, 0.30], [0.5, 0.70]],
  3: [[0.28, 0.25], [0.5, 0.5], [0.72, 0.75]],
  4: [[0.32, 0.30], [0.68, 0.30], [0.32, 0.70], [0.68, 0.70]],
  5: [[0.30, 0.28], [0.70, 0.28], [0.5, 0.5], [0.30, 0.72], [0.70, 0.72]],
  6: [[0.32, 0.25], [0.68, 0.25], [0.32, 0.5], [0.68, 0.5], [0.32, 0.75], [0.68, 0.75]],
  7: [[0.28, 0.20], [0.50, 0.26], [0.72, 0.32], [0.32, 0.56], [0.68, 0.56], [0.32, 0.80], [0.68, 0.80]],
  8: [[0.32, 0.18], [0.68, 0.18], [0.32, 0.39], [0.68, 0.39], [0.32, 0.61], [0.68, 0.61], [0.32, 0.82], [0.68, 0.82]],
  9: [[0.26, 0.22], [0.5, 0.22], [0.74, 0.22], [0.26, 0.5], [0.5, 0.5], [0.74, 0.5], [0.26, 0.78], [0.5, 0.78], [0.74, 0.78]],
};
const TONG_COLOR = {
  1: '#b4342a', 2: '#1f6f3f', 3: '#1f4f8f', 4: '#1f6f3f',
  5: '#b4342a', 6: '#1f4f8f', 7: '#1f6f3f', 8: '#1f4f8f', 9: '#b4342a',
};

function drawTong(ctx, tile, x, y, w, h) {
  const n = tile.num;
  const pts = TONG_LAYOUT[n];
  if (!pts) return;
  const r = Math.max(2, Math.min(w, h) * (n === 1 ? 0.22 : n <= 4 ? 0.115 : 0.095));
  const col = TONG_COLOR[n] || '#1f4f8f';
  pts.forEach(([px, py]) => {
    const ccx = x + w * px, ccy = y + h * py;
    ctx.beginPath(); ctx.arc(ccx, ccy, r, 0, Math.PI * 2);
    const g = ctx.createRadialGradient(ccx - r * 0.3, ccy - r * 0.3, r * 0.1, ccx, ccy, r);
    g.addColorStop(0, '#ffffff'); g.addColorStop(0.45, col); g.addColorStop(1, '#0d2a1a');
    ctx.fillStyle = g; ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = Math.max(0.5, r * 0.12); ctx.stroke();
  });
}

/* 條子：一條是雀鳥，其餘是竹節 */
const TIAO_LAYOUT = {
  2: [[0.5, 0.30], [0.5, 0.70]],
  3: [[0.5, 0.24], [0.32, 0.64], [0.68, 0.64]],
  4: [[0.33, 0.30], [0.67, 0.30], [0.33, 0.70], [0.67, 0.70]],
  5: [[0.30, 0.26], [0.70, 0.26], [0.5, 0.5], [0.30, 0.74], [0.70, 0.74]],
  6: [[0.32, 0.26], [0.5, 0.26], [0.68, 0.26], [0.32, 0.74], [0.5, 0.74], [0.68, 0.74]],
  7: [[0.5, 0.18], [0.32, 0.46], [0.5, 0.46], [0.68, 0.46], [0.32, 0.80], [0.5, 0.80], [0.68, 0.80]],
  8: [[0.32, 0.20], [0.5, 0.20], [0.68, 0.20], [0.32, 0.50], [0.68, 0.50], [0.32, 0.80], [0.5, 0.80], [0.68, 0.80]],
  9: [[0.28, 0.22], [0.5, 0.22], [0.72, 0.22], [0.28, 0.5], [0.5, 0.5], [0.72, 0.5], [0.28, 0.78], [0.5, 0.78], [0.72, 0.78]],
};
const TIAO_COLOR = {
  2: '#1f6f3f', 3: '#1f6f3f', 4: '#1f6f3f', 5: '#b4342a',
  6: '#1f6f3f', 7: '#b4342a', 8: '#1f6f3f', 9: '#1f6f3f',
};

function bambooStick(ctx, cx, cy, w, h, col) {
  const bw = Math.max(1.5, w), bh = Math.max(4, h);
  rrect(ctx, cx - bw / 2, cy - bh / 2, bw, bh, bw * 0.4);
  const g = ctx.createLinearGradient(cx - bw / 2, cy, cx + bw / 2, cy);
  g.addColorStop(0, '#0d3a22'); g.addColorStop(0.4, col); g.addColorStop(1, '#0d3a22');
  ctx.fillStyle = g; ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,.3)'; ctx.lineWidth = 0.6; ctx.stroke();
}

function drawTiao(ctx, tile, x, y, w, h) {
  const n = tile.num;
  if (n === 1) {
    // 一條：孔雀，用一個簡化的鳥形
    const cx = x + w / 2, cy = y + h / 2;
    ctx.save();
    ctx.fillStyle = '#1f6f3f';
    ctx.beginPath();
    ctx.ellipse(cx, cy + h * 0.06, w * 0.16, h * 0.20, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cy - h * 0.18, w * 0.10, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#b4342a'; ctx.lineWidth = Math.max(1, w * 0.05);
    ctx.beginPath();
    ctx.moveTo(cx, cy + h * 0.24);
    ctx.lineTo(cx - w * 0.13, cy + h * 0.38);
    ctx.moveTo(cx, cy + h * 0.24);
    ctx.lineTo(cx + w * 0.13, cy + h * 0.38);
    ctx.stroke();
    ctx.restore();
    return;
  }
  const pts = TIAO_LAYOUT[n];
  if (!pts) return;
  const col = TIAO_COLOR[n] || '#1f6f3f';
  const bw = w * 0.11, bh = h * (n >= 7 ? 0.20 : n >= 4 ? 0.26 : 0.30);
  pts.forEach(([px, py]) => bambooStick(ctx, x + w * px, y + h * py, bw, bh, col));
}

/* ── 字牌 ── */
const HONOR_COLOR = { '中': '#b4342a', '發': '#1f6f3f', '白': '#1f4f8f' };

function drawHonor(ctx, tile, x, y, w, h) {
  const d = tile.display;
  const cx = x + w / 2, cy = y + h / 2;
  if (d === '白') {
    // 白板：空框
    rrect(ctx, x + w * 0.20, y + h * 0.16, w * 0.60, h * 0.68, 3);
    ctx.strokeStyle = '#1f4f8f';
    ctx.lineWidth = Math.max(1, w * 0.045);
    ctx.stroke();
    return;
  }
  ctx.save();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = HONOR_COLOR[d] || '#1a1a1a';
  ctx.font = `bold ${Math.round(h * 0.52)}px 'Noto Serif TC','Songti TC',serif`;
  ctx.fillText(d, cx, cy + h * 0.02);
  ctx.restore();
}

/* ── 牌面總入口 ── */
function drawFaceInner(ctx, tile, x, y, w, h) {
  if (FACE_IMAGES && FACE_IMAGES[tile.display]) {
    const img = FACE_IMAGES[tile.display];
    if (img.complete && img.naturalWidth > 0) {
      const pad = Math.max(2, w * 0.08);
      ctx.save();
      rrect(ctx, x + pad, y + pad, w - pad * 2, h - pad * 2, 3);
      ctx.clip();
      ctx.drawImage(img, x + pad, y + pad, w - pad * 2, h - pad * 2);
      ctx.restore();
      return;
    }
  }
  if (tile.isHonor) drawHonor(ctx, tile, x, y, w, h);
  else if (tile.suit === '萬') drawWan(ctx, tile, x, y, w, h);
  else if (tile.suit === '筒') drawTong(ctx, tile, x, y, w, h);
  else drawTiao(ctx, tile, x, y, w, h);
}

/* ── 做一張牌的 canvas 元素 ────────────────────────────────
   opts:
     w, h       正面朝上時的寬高
     rotate     0 / 90 / 180 / 270（左右兩家用 90 / 270）
     faceDown   畫牌背
     selected   選取框
     thin       薄版（牌河、副露用，不畫 3D 側面）
   canvas 的長寬會依旋轉角度對調，所以版面直接照元素尺寸排就好。   */
function makeTile(tile, opts) {
  const o = opts || {};
  const w = o.w || 40, h = o.h || 56;
  const rot = ((o.rotate || 0) % 360 + 360) % 360;
  const thin = !!o.thin;
  const sd = thin ? 0 : SIDE;

  const fullW = w + sd + 2, fullH = h + sd + 2;
  const swap = (rot === 90 || rot === 270);

  const c = document.createElement('canvas');
  const dpr = Math.min(3, (window.devicePixelRatio || 1));
  const cssW = swap ? fullH : fullW;
  const cssH = swap ? fullW : fullH;
  c.width = Math.round(cssW * dpr);
  c.height = Math.round(cssH * dpr);
  c.style.width = cssW + 'px';
  c.style.height = cssH + 'px';
  c.className = 'tile' + (o.selected ? ' sel' : '') + (o.className ? ' ' + o.className : '');

  const ctx = c.getContext('2d');
  ctx.scale(dpr, dpr);

  // 轉過去之後照原尺寸畫 —— 繪製程式完全不知道自己被轉了
  ctx.save();
  if (rot === 90) { ctx.translate(cssW, 0); ctx.rotate(Math.PI / 2); }
  else if (rot === 180) { ctx.translate(cssW, cssH); ctx.rotate(Math.PI); }
  else if (rot === 270) { ctx.translate(0, cssH); ctx.rotate(-Math.PI / 2); }

  if (o.faceDown) {
    drawBack(ctx, 1, 1, w, h, thin);
  } else {
    drawShell(ctx, 1, 1, w, h, o.selected, thin);
    drawFaceInner(ctx, tile, 1, 1, w, h);
    if (o.selected) {
      rrect(ctx, 1, 1, w, h, thin ? 3 : 5);
      ctx.strokeStyle = 'rgba(231,76,60,.45)'; ctx.lineWidth = 4; ctx.stroke();
      ctx.strokeStyle = '#e74c3c'; ctx.lineWidth = 2; ctx.stroke();
    }
    if (o.dim) {
      rrect(ctx, 1, 1, w, h, thin ? 3 : 5);
      ctx.fillStyle = 'rgba(20,10,0,.45)'; ctx.fill();
    }
  }
  ctx.restore();
  return c;
}

return {
  SIDE, NUM_CH, setFaceImages,
  rrect, draw3DSides, drawShell, drawBack,
  drawWan, drawTong, drawTiao, drawHonor, drawFaceInner,
  makeTile,
};
});
