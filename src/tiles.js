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

/* ── 牌面圖：先處理一次再用 ──────────────────────────────
   2026-10-14 使用者：「牌面的外觀看起來像是套版的，可以把顏色調好避免斷層嗎？
   套上去的圖可以再大一點，因為當初我提供的圖就是原本牌面的大小」。
   原因有兩個：
     1. 圖是偏冷的白／灰（數字牌約 240–250；字牌是實拍，邊緣有灰色陰影、四角是深色），
        牌殼是暖色的象牙白漸層 —— 一張白卡片貼在象牙色的框裡，看得出一圈接縫。
     2. 圖四邊各縮了 8%，再自己切一個圓角 —— 更像「框裡放一張圖」。
   做法：
     ‧ 圖的白先拉到純白（color-dodge 除以 0.95，等於調色階的白點），
       再用 multiply 疊到牌殼上：白的地方直接透出牌殼自己的象牙漸層，墨色、紅綠照舊。
       接縫就沒了，整副牌的底色也一致（原本數字牌和字牌的白不一樣）。
     ‧ 四邊留 6.5%（原本 8%）；字牌的實拍四邊先裁掉 5%（深色的角與陰影）。
       v1.59 先改成 3%，使用者看了覺得太滿（「手牌好像改得太大一點」）——
       3%／5%／6.5%／8% 並排比過，選 6.5%：四周留一圈象牙邊，跟實體牌的比例最像。
   ⚠️ 不用 getImageData 調色：雙擊開（file://）時圖片算跨來源，讀像素會丟 SecurityError。
      color-dodge／multiply 都是合成運算，不讀像素，file:// 也能用。 */
const FACE_PREP = new WeakMap();
const WHITE_POINT = 0.95;            // 原圖亮到這個比例就當成純白
function prepFace(img, isHonor) {
  let c = FACE_PREP.get(img);
  if (c) return c;
  const crop = isHonor ? 0.05 : 0.015;
  const sw = img.naturalWidth, sh = img.naturalHeight;
  const sx = Math.round(sw * crop), sy = Math.round(sh * crop);
  const cw = sw - sx * 2, ch = sh - sy * 2;
  c = document.createElement('canvas');
  c.width = cw; c.height = ch;
  const g = c.getContext('2d');
  g.drawImage(img, sx, sy, cw, ch, 0, 0, cw, ch);
  g.globalCompositeOperation = 'color-dodge';
  const k = Math.round(255 * (1 - WHITE_POINT));
  g.fillStyle = `rgb(${k},${k},${k})`;
  g.fillRect(0, 0, cw, ch);
  FACE_PREP.set(img, c);
  return c;
}

/* ── 牌面總入口 ── */
function drawFaceInner(ctx, tile, x, y, w, h) {
  if (FACE_IMAGES && FACE_IMAGES[tile.display]) {
    const img = FACE_IMAGES[tile.display];
    if (img.complete && img.naturalWidth > 0) {
      const pad = Math.max(1.5, w * 0.065);
      ctx.save();
      rrect(ctx, x + pad, y + pad, w - pad * 2, h - pad * 2, 3);
      ctx.clip();
      ctx.globalCompositeOperation = 'multiply';
      ctx.drawImage(prepFace(img, !!tile.isHonor), x + pad, y + pad, w - pad * 2, h - pad * 2);
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
  // 立體牌（v1.95）：主程式開了（setBodies）、圖都載完，而且不是自己的手牌 → 用立體的牌身
  if (BODIES && bodiesReady() && !isOwnStanding(tile, o)) {
    if (STAND_ON && !tile && o.faceDown) { const st = makeStand(o); if (st) return st; }
    return make3D(tile, o);
  }
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
  // back：蓋著的牌（canvas 從外面看不出正反面 —— 觀戰的端對端測試靠它確認四家都攤開了，v1.80）
  c.className = 'tile' + (o.selected ? ' sel' : '') + (o.faceDown ? ' back' : '') + (o.className ? ' ' + o.className : '');

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

/* ── 立體牌（v1.95，devtools/立體牌/、docs 見 devtools/立體牌/sprites/README.md）────────────
   2026-10-24 使用者：「正面的牌也能畫成立體嗎？遊戲畫面全改成立體麻將牌」→ 預覽看過、定案後：「好，接進遊戲吧」。
   牌身用圖、牌面用程式：Codex 生的空白立體牌（正投影、真牌厚度、側面褐白各半），34 種牌面照舊用 drawFaceInner 畫在頂面上。
     faceV  躺著、牌面朝上、長邊朝遠方（牌河、副露、祥瑞指示牌）　faceH  同上、長邊左右（左右兩家）
     backV  躺著、牌背朝上（對家的手牌、暗槓）　　　　　　　　　　 backH  同上、長邊左右（左右兩家的手牌）
   ‧ **自己的手牌（立著、牌面朝自己）維持原本平面的** —— 使用者：「玩家手牌改立體會變小，玩家的手牌不要改吧」
   ‧ 只有主程式呼叫 setBodies() 才開：共用模組沒有版號，還開著舊版頁面的人照舊是平面
   ‧ 元素外框照原本 makeTile 算（版面不動），牌身拉到外框大小；data-edge＝前緣（牌的厚度）的高，
     render.js 用它把上下排的一列牌收緊（下面那張蓋住上面那張的前緣）
   ‧ face：牌面在圖裡的範圍 [x0,y0,x1,y1]；top：頂面佔圖高（其餘是前緣）—— 照圖量的，換圖要重量
   ‧ v2.15 起牌身是 v3（devtools/立體牌/sprites/v3/README.md：整套同一個鏡頭重畫）：faceV 240×342（頂面 252）、faceH 240×206（頂面 139） */
const BODY = {
  faceV: { file: 'faceV', face: [0.02, 0.01, 0.98, 0.737], top: 0.737 },
  faceH: { file: 'faceH', face: [0.015, 0.02, 0.985, 0.675], top: 0.675 },
  backV: { file: 'backV', top: 0.737 },
  backH: { file: 'backH', top: 0.675 },
};
/* ── 兩套牌＋別家的手牌立起來（v2.15，devtools/立體牌/sprites/v3/README.md）──
   2026-10-26 使用者：「另外三家的手牌……應該是立起來的才對」「整套牌一起畫……再另外畫一組金黃色，
   可以在統一五國後，在最後要打最後一國改用金黃色牌」「只有打最後一國的玩家會看到黃金牌，連線模式也一樣」。
   ‧ setBodySets({ maroon: 'assets/tiles3d/', gold: 'assets/tiles3d-gold/' }, { stand: true })：兩套一起預先載好，
     useBodySet('gold') 即時切換（不會有「圖還沒載完、先畫平面」的空檔）
   ‧ stand：別家的手牌（沒有牌、牌背朝上＝只有張數的那一排）畫成立著的：
       對家（轉 180°）standV  立著、牌背朝我們（頂端＝厚度、牌背＝牌高）
       左家（轉 90°） standH  立著、側面朝我們：寬＝厚度、頂端＝牌寬（跟躺著的頂面一樣高）、側面＝牌高
       右家（轉 270°）standHR 同上左右翻過來
     暗槓（有牌、牌背朝上）照舊躺著。左右兩家一列每往下一張前進一個頂端（＝躺著時的頂面高），下面那張蓋住上面那張的側面
   ‧ 舊版頁面只呼叫 setBodies() —— 一套、四種躺著的，跟以前一樣（共用模組沒有版號） */
const STAND = {
  standV:  { file: 'standV' },
  standH:  { file: 'standH' },
  standHR: { file: 'standHR' },
};
const SIDE_W = 137 / 240;     // 側立牌的寬（厚度）÷ 躺著的橫牌的寬（牌長）
const TOP_H = 139 / 240;      // 頂面／頂端的高 ÷ 躺著的橫牌的寬（躺著、立著一樣：都是牌寬 26 mm）
let BODIES = null;
let BODY_SETS = null;         // { 名字: { base, imgs（還沒載就是 null） } }（setBodySets 才有）
let BODY_KINDS = null;        // 每一套要載哪幾種牌身
let ON_SET_LOAD = null;       // 晚載的那一套載完時叫一下（主程式重畫）
let BODY_SET = null;          // 現在用哪一套
let STAND_ON = false;
let BODIES_ON = true;          // 開發工具（devtools/立體牌、發牌實驗台）切平面／立體對照用
function use3D(on) { BODIES_ON = on !== false; }
function loadSet(base, kinds) {
  const imgs = {};
  const p = Promise.all(Object.keys(kinds).map(k => new Promise(ok => {
    const im = new Image();
    im.onload = im.onerror = () => ok();
    im.src = base + kinds[k].file + '.webp';
    imgs[k] = im;
  })));
  return { imgs, ready: p };
}
function setBodies(base) {
  const s = loadSet(base, BODY);
  BODIES = s.imgs;
  return s.ready;
}
/* opts.eager：一開始就載的那幾套（預設全部）；其餘第一次 useBodySet 才載（v2.16：七國各一套，每人只用得到自己那一國）。
   opts.onLoad(name)：晚載的那一套載完時叫 —— 主程式重畫，syncTileSet 就換得過去 */
function setBodySets(sets, opts) {
  const o = opts || {};
  STAND_ON = !!o.stand;
  BODY_KINDS = Object.assign({}, BODY, STAND_ON ? STAND : {});
  ON_SET_LOAD = o.onLoad || null;
  BODY_SETS = {};
  Object.keys(sets).forEach(name => { BODY_SETS[name] = { base: sets[name], imgs: null, ready: null }; });
  const eager = o.eager || Object.keys(sets);
  const ps = eager.map(ensureSet);
  BODY_SET = null;
  useBodySet(eager[0]);
  return Promise.all(ps);
}
function ensureSet(name) {
  const st = BODY_SETS && BODY_SETS[name];
  if (!st) return Promise.resolve();
  if (!st.imgs) {
    const s = loadSet(st.base, BODY_KINDS);
    st.imgs = s.imgs;
    st.ready = s.ready.then(() => { if (ON_SET_LOAD) try { ON_SET_LOAD(name); } catch (_) {} });
  }
  return st.ready;
}
function setLoaded(name) {
  const st = BODY_SETS && BODY_SETS[name];
  return !!(st && st.imgs && Object.keys(BODY).every(k => st.imgs[k] && st.imgs[k].complete && st.imgs[k].naturalWidth > 0));
}
/* 換一套（回傳有沒有換：一樣就 false，呼叫端不用重畫）。那一套還沒載完：先開始載、這次不換（照舊用現在這套） */
function useBodySet(name) {
  if (!BODY_SETS || !BODY_SETS[name] || BODY_SET === name) return false;
  ensureSet(name);
  if (BODY_SET && !setLoaded(name)) return false;
  BODY_SET = name;
  BODIES = BODY_SETS[name].imgs;
  return true;
}
function bodySet() { return BODY_SET; }
/* 現在這一套的圖在哪（發牌動畫的牌牆跟牌桌用同一套）；沒有 setBodySets 就是 null */
function bodyBase() { return BODY_SET && BODY_SETS ? BODY_SETS[BODY_SET].base : null; }
function standOn() { return STAND_ON && BODIES_ON; }
function bodiesReady() {
  return BODIES_ON && !!BODIES && Object.keys(BODY).every(k => BODIES[k] && BODIES[k].complete && BODIES[k].naturalWidth > 0);
}
/* 別家立著的手牌（v2.15）：沒有牌、牌背朝上、setBodySets 開了 stand。圖還沒載完就回 null（照舊躺著） */
function makeStand(o) {
  const rot = ((o.rotate || 0) % 360 + 360) % 360;
  const kind = rot === 90 ? 'standH' : rot === 270 ? 'standHR' : 'standV';
  const im = BODIES && BODIES[kind];
  if (!im || !im.complete || !im.naturalWidth) return null;
  const w = o.w || 40, h = o.h || 56;
  const sd = o.thin ? 0 : SIDE;
  const fullW = w + sd + 2, fullH = h + sd + 2;
  const side = kind !== 'standV';
  // 對家：寬＝牌寬（同躺著的直牌）；左右：寬＝厚度（躺著的橫牌寬 × 137/240）。高照圖的比例
  const cssW = side ? Math.round(fullH * SIDE_W) : fullW;
  const cssH = Math.round(cssW * im.naturalHeight / im.naturalWidth);
  const c = document.createElement('canvas');
  const dpr = Math.min(3, (window.devicePixelRatio || 1));
  c.width = Math.round(cssW * dpr); c.height = Math.round(cssH * dpr);
  c.style.width = cssW + 'px'; c.style.height = cssH + 'px';
  c.className = 'tile tile3d back stand' + (o.className ? ' ' + o.className : '');
  const ctx = c.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.drawImage(im, 0, 0, cssW, cssH);
  // 左右兩家一列：每往下一張前進一個頂端，下面那張蓋住上面那張的側面（render.js 的 pack3D 用 data-edge）
  if (side) c.dataset.edge = String(Math.max(0, cssH - Math.round(fullH * TOP_H)));
  return c;
}
function isOwnStanding(tile, o) {
  const rot = ((o.rotate || 0) % 360 + 360) % 360;
  return !o.faceDown && !!tile && !o.thin && rot === 0;
}
function make3D(tile, o) {
  const w = o.w || 40, h = o.h || 56;
  const rot = ((o.rotate || 0) % 360 + 360) % 360;
  const sd = o.thin ? 0 : SIDE;
  const fullW = w + sd + 2, fullH = h + sd + 2;
  const swap = (rot === 90 || rot === 270);
  const kind = (o.faceDown || !tile) ? (swap ? 'backH' : 'backV') : (swap ? 'faceH' : 'faceV');
  const cssW = swap ? fullH : fullW;
  /* 照圖的真實比例畫（寬照原本的框，高照圖），不塞進原本平面牌的框 —— 那個框是給平面牌的，
     頂面加前緣塞進去，頂面會被壓扁（2026-10-24 使用者：「兩側的牌壓得太扁」「直的不要太扁，再拉長一點點，讓牌面多顯示一點」）。
     左右兩家一列互相疊著（render.js 的 pack3D），間距由「頂面高」決定 */
  const im = BODIES[kind];
  const cssH = Math.round(cssW * im.naturalHeight / im.naturalWidth);
  const c = document.createElement('canvas');
  const dpr = Math.min(3, (window.devicePixelRatio || 1));
  c.width = Math.round(cssW * dpr); c.height = Math.round(cssH * dpr);
  c.style.width = cssW + 'px'; c.style.height = cssH + 'px';
  c.className = 'tile tile3d' + (o.selected ? ' sel' : '') + (o.faceDown ? ' back' : '') + (o.className ? ' ' + o.className : '');
  const ctx = c.getContext('2d');
  ctx.scale(dpr, dpr);

  ctx.drawImage(im, 0, 0, cssW, cssH);
  c.dataset.edge = String(Math.round(cssH * (1 - BODY[kind].top)));

  const f = BODY[kind].face;
  if (f && tile) {
    const fx = cssW * f[0], fy = cssH * f[1], fw = cssW * (f[2] - f[0]), fh = cssH * (f[3] - f[1]);
    ctx.save();
    ctx.translate(fx + fw / 2, fy + fh / 2);
    // 花色的方向照原本的 rotate（左右兩家轉 90°／270°、對家轉 180°）
    if (rot === 90) ctx.rotate(Math.PI / 2);
    else if (rot === 180) ctx.rotate(Math.PI);
    else if (rot === 270) ctx.rotate(-Math.PI / 2);
    const gw = swap ? fh : fw, gh = swap ? fw : fh;
    drawFaceInner(ctx, tile, -gw / 2, -gh / 2, gw, gh);
    ctx.restore();
    if (o.selected) {
      rrect(ctx, fx + 1, fy + 1, fw - 2, fh - 2, Math.max(3, fw * 0.08));
      ctx.strokeStyle = 'rgba(231,76,60,.45)'; ctx.lineWidth = 4; ctx.stroke();
      ctx.strokeStyle = '#e74c3c'; ctx.lineWidth = 2; ctx.stroke();
    }
  }
  if (o.dim) {
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = 'rgba(20,10,0,.45)'; ctx.fillRect(0, 0, cssW, cssH);
    ctx.globalCompositeOperation = 'source-over';
  }
  return c;
}

return {
  SIDE, NUM_CH, setFaceImages, setBodies, bodiesReady, use3D,
  setBodySets, useBodySet, bodySet, bodyBase, standOn, ensureSet, setLoaded,
  rrect, draw3DSides, drawShell, drawBack,
  drawWan, drawTong, drawTiao, drawHonor, drawFaceInner,
  makeTile,
};
});
