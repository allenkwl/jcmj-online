/* ═══════════════════════════════════════════════════════════════
   tiles-sets.js — 兩套牌（豬肝紅／金黃）＋別家的手牌立起來【預覽用，遊戲還沒用】
   ───────────────────────────────────────────────────────────────
   2026-10-26 使用者：「另外三家的手牌雖然玩家看不到，但應該是立起來的才對……橫著的直立和背對的直立」
   「整套牌一起畫，除了現在的豬肝紅，再另外畫一組金黃色……兩套牌都一樣要放發牌測試程式」「我看過再進遊戲」。
   devtools/立體牌v0.3.html、發牌實驗台 v0.7 注入到 iframe 裡的遊戲（#preview）：
     ‧ 牌組：MJTiles.setBodies() 換成 devtools/立體牌/sprites/v2/<組>/（躺著的四種）
     ‧ 別家的手牌（沒有牌、牌背朝上＝只有張數的那一排）換成立著的：
         對家（轉 180°）standV  立著、牌背朝我們
         左家（轉 90°） standH  standV 轉 90°（看到整面牌背，牌的頂端朝左家自己）
         右家（轉 270°）standHR standV 轉 −90°
         （第一版是側面朝我們、只看得到厚度 —— 使用者：「直立的牌寬度太窄（左右兩家用的牌）」）
       暗槓（有牌、牌背朝上）照舊躺著
     ‧ 左右兩家一列的長度跟躺著的時候一樣（使用者：「左右兩家的牌寬不管是直立還是躺下都是一樣寬」）：
       每張沿著那一列的高度＝躺著那張每往下前進的距離（頂面高），一張貼一張、不疊
   window.MJTileSetBase 給發牌動畫的副本（devtools/發牌動畫/deal-anim-3d-sets.js）用：牌牆跟牌桌同一組
   牌身的圖由 tools/build-tile-sets.py 產生（sprites/v2/README 見那支的說明）
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  const T = window.MJTiles;
  if (!T) return;
  const orig = T.__origMake || T.makeTile;
  T.__origMake = orig;

  const BASE = 'devtools/立體牌/sprites/v2/';
  const STAND = ['standV', 'standH', 'standHR'];
  const BACKH = { w: 240, h: 207, top: 0.676 };      // 躺著的橫牌（assets/tiles3d/backH）：算一列的間距用
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
    // 對家：寬＝牌寬（同躺著的直牌）；左右：高＝躺著那張一列裡每張的間距，寬照圖的比例
    const step = Math.round(fullH * BACKH.h / BACKH.w * BACKH.top);
    const cssH = side ? step : Math.round(fullW * im.naturalHeight / im.naturalWidth);
    const cssW = side ? Math.round(step * im.naturalWidth / im.naturalHeight) : fullW;
    const c = document.createElement('canvas');
    const dpr = Math.min(3, (window.devicePixelRatio || 1));
    c.width = Math.round(cssW * dpr); c.height = Math.round(cssH * dpr);
    c.style.width = cssW + 'px'; c.style.height = cssH + 'px';
    c.className = 'tile tile3d back stand' + (o.className ? ' ' + o.className : '');
    const ctx = c.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.drawImage(im, 0, 0, cssW, cssH);
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
