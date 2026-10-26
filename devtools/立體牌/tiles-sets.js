/* ═══════════════════════════════════════════════════════════════
   tiles-sets.js — 兩套牌（豬肝紅／金黃）＋別家的手牌立起來【預覽用，遊戲還沒用】
   ───────────────────────────────────────────────────────────────
   2026-10-26 使用者：「另外三家的手牌雖然玩家看不到，但應該是立起來的才對……橫著的直立和背對的直立」
   「整套牌一起畫，除了現在的豬肝紅，再另外畫一組金黃色……兩套牌都一樣要放發牌測試程式」「我看過再進遊戲」。
   devtools/立體牌v0.3.html、發牌實驗台 v0.7 注入到 iframe 裡的遊戲（#preview）：
     ‧ 牌組：MJTiles.setBodies() 換成 devtools/立體牌/sprites/v3/<組>/（躺著的四種）
     ‧ 別家的手牌（沒有牌、牌背朝上＝只有張數的那一排）換成立著的：
         對家（轉 180°）standV  立著、牌背朝我們
         左家（轉 90°） standH  立著、側面朝我們（象牙白那一半朝左家自己），寬＝厚度、頂端＝牌寬
         右家（轉 270°）standHR 同上左右翻過來
         （使用者：「codex 畫的直立牌寬度太窄小，這樣的視角不對，不論蓋牌或是直立都該一樣寬」——
           Codex 畫的側面只有 185 寬，tools/build-tile-sets.py 整塊拉到 240；中間試過「背對直立轉 90°」，會錯意，撤掉）
       暗槓（有牌、牌背朝上）照舊躺著
     ‧ 左右兩家：寬＝躺著的橫牌（fullH）；每往下一張前進的距離跟躺著時一樣（頂面高），
       立著的牌比較高，下面那張蓋住上面那張的下半截（render.js 的 pack3D 用 data-edge）
   window.MJTileSetBase 給發牌動畫的副本（devtools/發牌動畫/deal-anim-3d-sets.js）用：牌牆跟牌桌同一組
   牌身的圖由 tools/build-tile-sets-v3.py 產生（說明見 sprites/v3/README.md）
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  const T = window.MJTiles;
  if (!T) return;
  const orig = T.__origMake || T.makeTile;
  T.__origMake = orig;

  /* v3（2026-10-26）：整套重畫（6 種同一張圖、同一個鏡頭），立著的照真牌比例 ——
     使用者：「我說的是牌本身的寬，不是指厚度，你把厚度畫得和長度畫一樣就不對了」「可能要整套重畫」。
     側立牌：寬＝厚度（20 mm）、頂端＝牌寬（26 mm，跟躺著的頂面一樣高）、側面＝牌高（35 mm）（tools/build-tile-sets-v3.py） */
  const BASE = 'devtools/立體牌/sprites/v3/';
  const STAND = ['standV', 'standH', 'standHR'];
  const SIDE_W = 137 / 240;     // 側立牌的寬（厚度）÷ 躺著的橫牌的寬（牌長）
  const TOP_H = 139 / 240;      // 頂面／頂端的高 ÷ 躺著的橫牌的寬 —— 躺著、立著一樣（都是牌寬 26 mm）
  let setName = 'maroon', standing = true, IMG = {};

  function load(name) {
    setName = name || 'maroon';
    const dir = BASE + setName + '/';
    window.MJTileSetBase = dir;
    IMG = {};
    const ps = STAND.map(k => new Promise(ok => {
      const im = new Image();
      im.onload = im.onerror = () => ok();
      im.src = dir + k + '.webp';
      IMG[k] = im;
    }));
    ps.push(T.setBodies(dir));
    return Promise.all(ps);
  }

  function makeStand(o) {
    const rot = ((o.rotate || 0) % 360 + 360) % 360;
    const kind = rot === 90 ? 'standH' : rot === 270 ? 'standHR' : 'standV';
    const im = IMG[kind];
    if (!im || !im.complete || !im.naturalWidth) return null;
    const w = o.w || 40, h = o.h || 56;
    const sd = o.thin ? 0 : T.SIDE;
    const fullW = w + sd + 2, fullH = h + sd + 2;
    const side = kind !== 'standV';
    // 對家：寬＝牌寬（同躺著的直牌）；左右：寬＝厚度（躺著的橫牌寬 × 137/240）。高都照圖的比例
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
    if (side) {
      // 一列裡每往下一張前進一個頂端（＝躺著那張的頂面高），下面那張蓋住上面那張的側面
      const step = Math.round(fullH * TOP_H);
      c.dataset.edge = String(Math.max(0, cssH - step));
    }
    return c;
  }

  T.makeTile = function (tile, opts) {
    const o = opts || {};
    if (standing && !tile && o.faceDown && T.bodiesReady()) {
      const c = makeStand(o);
      if (c) return c;
    }
    return orig(tile, opts);
  };

  window.MJTileSets = {
    load,
    get set() { return setName; },
    get standing() { return standing; },
    set standing(v) { standing = !!v; },
  };
})();
