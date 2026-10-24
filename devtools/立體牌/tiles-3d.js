/* ═══════════════════════════════════════════════════════════════
   tiles-3d.js — 立體麻將牌【實驗中，遊戲還沒用】
   ───────────────────────────────────────────────────────────────
   2026-10-24 使用者：「正面的牌也能畫成立體嗎？遊戲畫面全改成立體麻將牌」。
   只有 devtools/立體牌v0.1.html 會載入：注入到 iframe 裡的遊戲（#preview），
   把 MJTiles.makeTile 換成這一支 —— render.js、發牌動畫呼叫的都是 T.makeTile，換掉就整個畫面都換了。
   原本的留在 MJTiles.__orig2d，MJ3D.off() 換回來。

   ── 做法：牌身用圖、牌面用程式 ──
     牌身：Codex 生的空白立體牌（正投影：左右兩邊平行，一排擺起來從頭到尾貼緊），devtools/立體牌/sprites/
       stand  立著、牌面朝自己（自己的手牌）
       faceV  躺著、牌面朝上、長邊朝遠方（牌河、副露、祥瑞指示牌）　faceH  同上、長邊左右（左右兩家的牌河、副露）
       backV  躺著、牌背朝上（對家的手牌、暗槓）　　　　　　　　　　 backH  同上、長邊左右（左右兩家的手牌）
     牌面：34 種牌照舊用 tiles.js 的 drawFaceInner 畫在牌身的「頂面」上 —— AI 不用畫 34 種 × 好幾個方向
   ⚠️ 元素的外框尺寸照原本的 makeTile 算（版面完全不動），牌身拉到外框大小
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  const T = window.MJTiles;
  if (!T) return;
  const orig = T.__orig2d || T.makeTile;
  T.__orig2d = orig;

  const SPR = 'devtools/立體牌/sprites/';
  /* face：牌面（花色畫在這裡）在圖裡的範圍 [x0, y0, x1, y1]，照切出來的圖量的（sprites/README.md） */
  /* top：頂面佔圖高的比例（其餘＝前緣，一個牌的厚度）—— 一列上下排的牌，下面那張要往上蓋住上面那張的前緣 */
  const BODY = {
    stand: { face: [0.03, 0.216, 0.97, 0.985], top: 1 },
    faceV: { face: [0.02, 0.01, 0.98, 0.70], top: 0.70 },
    faceH: { face: [0.015, 0.02, 0.985, 0.61], top: 0.61 },
    backV: { top: 0.70 },
    backH: { top: 0.59 },
  };
  const IMG = {};
  const loads = Object.keys(BODY).map(k => new Promise(ok => {
    const im = new Image();
    im.onload = () => { ok(); if (window.MJ3D && window.MJ3D.onload) window.MJ3D.onload(); };
    im.onerror = () => ok();
    im.src = SPR + k + '.png';
    IMG[k] = im;
  }));

  function make3D(tile, opts) {
    const o = opts || {};
    const w = o.w || 40, h = o.h || 56;
    const rot = ((o.rotate || 0) % 360 + 360) % 360;
    const thin = !!o.thin;
    const sd = thin ? 0 : T.SIDE;
    const fullW = w + sd + 2, fullH = h + sd + 2;
    const swap = (rot === 90 || rot === 270);
    const cssW = swap ? fullH : fullW, cssH = swap ? fullW : fullH;

    const c = document.createElement('canvas');
    const dpr = Math.min(3, (window.devicePixelRatio || 1));
    c.width = Math.round(cssW * dpr); c.height = Math.round(cssH * dpr);
    c.style.width = cssW + 'px'; c.style.height = cssH + 'px';
    c.className = 'tile' + (o.selected ? ' sel' : '') + (o.faceDown ? ' back' : '') + (o.className ? ' ' + o.className : '');
    const ctx = c.getContext('2d');
    ctx.scale(dpr, dpr);

    // 用哪一種牌身
    let kind;
    if (o.faceDown || !tile) kind = swap ? 'backH' : 'backV';
    else if (!thin && rot === 0) kind = 'stand';
    else kind = swap ? 'faceH' : 'faceV';
    const im = IMG[kind];
    if (!im.complete || !im.naturalWidth) return orig(tile, opts);     // 圖還沒載完：先用原本的

    ctx.drawImage(im, 0, 0, cssW, cssH);
    c.dataset.k3d = kind;
    c.dataset.edge = String(Math.round(cssH * (1 - BODY[kind].top)));

    const f = BODY[kind].face;
    if (f && tile) {
      const fx = cssW * f[0], fy = cssH * f[1], fw = cssW * (f[2] - f[0]), fh = cssH * (f[3] - f[1]);
      ctx.save();
      ctx.translate(fx + fw / 2, fy + fh / 2);
      // 花色的方向：照原本的 rotate（左右兩家的牌河轉 90°／270°、對家的轉 180°）
      if (rot === 90) ctx.rotate(Math.PI / 2);
      else if (rot === 180) ctx.rotate(Math.PI);
      else if (rot === 270) ctx.rotate(-Math.PI / 2);
      const gw = swap ? fh : fw, gh = swap ? fw : fh;
      T.drawFaceInner(ctx, tile, -gw / 2, -gh / 2, gw, gh);
      ctx.restore();
      if (o.selected) {
        T.rrect(ctx, fx + 1, fy + 1, fw - 2, fh - 2, Math.max(3, fw * 0.08));
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

  /* ── 收緊：一列上下排的牌（左右兩家的手牌、牌河、副露）互相蓋住前緣，只露出牌背／牌面 ──
     2026-10-24 使用者：「麻將牌緊連在一起，不會出現側面的立體白邊」。
     遊戲的版面每張之間留 1px、每張都露出完整的前緣；這裡在立體模式下把直向排列的牌往上疊一個前緣高，
     z-index 照畫面上的高度（越下面越前面）。⚠️ 只在這個預覽裡做，接進遊戲時要改在 layout／CSS */
  /* ⚠️ 只排牌桌上的牌：發牌動畫（#deal-anim）裡的牌是自己定位的（position:fixed），
     被改成 relative 會一張張往下排（2026-10-24 發牌實驗台 v0.4 實測：自己的牌落到手牌那一排下面去） */
  const onTable = c => !c.closest('#deal-anim') && getComputedStyle(c).position !== 'fixed';
  function pack() {
    const doc = document;
    const tiles = [...doc.querySelectorAll('canvas.tile[data-k3d]')].filter(onTable);
    tiles.forEach(c => {
      const par = c.parentElement;
      if (!par) return;
      const dir = getComputedStyle(par).flexDirection;
      const e = Number(c.dataset.edge) || 0;
      c.style.marginTop = ''; c.style.marginBottom = '';
      if (dir === 'column' && c !== par.firstElementChild) c.style.marginTop = (-e) + 'px';
      if (dir === 'column-reverse' && c !== par.firstElementChild) c.style.marginBottom = (-e) + 'px';
    });
    // 疊的順序：照畫面上的高度
    tiles.forEach(c => {
      c.style.position = 'relative';
      c.style.zIndex = String(Math.round(c.getBoundingClientRect().top) + 1000);
    });
  }
  let packT = null;
  const mo = new MutationObserver(() => {
    if (T.makeTile !== make3D) return;
    clearTimeout(packT); packT = setTimeout(pack, 0);
  });
  mo.observe(document.body, { childList: true, subtree: true });

  T.makeTile = make3D;
  window.MJ3D = {
    pack,
    ready: Promise.all(loads),          // 牌身的圖都載完（還沒載完時 makeTile 會先用原本平面的）
    on() { T.makeTile = make3D; },
    off() { T.makeTile = orig; },
    get active() { return T.makeTile === make3D; },
    onload: null,
  };
})();
