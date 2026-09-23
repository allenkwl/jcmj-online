/* ═══════════════════════════════════════════════════════════════
   layout.js — 牌桌版面的所有可調數值
   ───────────────────────────────────────────────────────────────
   這些數字原本散在 `render.js` 裡（LIMITS／OPP_OF_OWN／OWN_HAND_MAX_H…）
   和 `mj4.html` 的 CSS 裡（主公像大小、中央舞台）。要調一次版面
   得同時改兩個檔案的六個地方，而且改完只能重開遊戲用肉眼看。

   集中到這裡之後，`devtools/對戰畫面編輯器` 就能即時拉動它們，
   調好再把整份 TUNE 貼回來。

   ⚠️ 這個檔案**是給人改的**，不是產生器的輸出。
      要改就直接改 TUNE 裡的數字，或用編輯器產生一份貼回來。

   ── 尺寸是怎麼算出來的 ──
   牌的大小不是寫死的，是每次重畫時**量**出來的（見 render.js 的 fitSizes）：
   手牌受「14 張要排得下」與「不能吃掉整個牌桌高度」雙重限制，
   牌河受「上下放得下幾列」與「左右塞不塞得進中央區」限制。
   這裡給的是那些算式的**上下限與比例**。

   所以把 own.max 調大，小螢幕不會變（它被寬度擋住），
   但大螢幕會跟著長 —— 2000px 寬的螢幕原本卡在 44px，整桌看起來空蕩蕩。
   ═══════════════════════════════════════════════════════════════ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MJLayout = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
'use strict';

/* 牌面的長寬比（高 ÷ 寬）。四種牌共用同一個比例，
   不然旋轉 90° 的左右家會跟自己的手牌看起來不是同一副牌。 */
const TILE_RATIO = 56 / 40;

const TUNE = {
  /* ── 自己的手牌 ──────────────────────────────────────── */
  own: {
    min: 22,          // iPhone SE 橫式（667×375）靠這個；26 的話中央區會溢出 22px
    max: 92,          // 大螢幕的上限。原本 44，2000px 寬的螢幕整桌很空
    maxHeightPct: 0.2,   // 最多吃掉牌桌高度的幾成（只用寬度算，寬螢幕會長到把牌河擠爆）
    meldOfHand: 0.65,     // 自己的副露相對於手牌
  },

  /* ── 牌河 ────────────────────────────────────────────── */
  river: {
    min: 12,          // 手機橫式靠這個下限；再高就會擠不下四家的河
    max: 46,
    perRow: 6,        // 六張一列，雀魂／天鳳的慣例
    maxRows: 3,       // 一家最多 18 張棄牌
  },

  /* ── 別家（上／左／右）─────────────────────────────────
     別家的牌只看張數（背面）與做什麼牌（副露），所以比自己的小是對的，
     但要**跟著一起縮放**。原本寫死 18/20，大螢幕上只有別家沒長大，
     而且副露(20) 比手牌背(18) 大，看起來像「吃碰的牌比手上的大」。 */
  opp: {
    min: 16,
    max: 64,
    ofOwn: 0.6,      // 相對於自己的手牌
    meldOfHand: 0.92, // 副露相對於手牌背。>1 會變成「吃碰的比手上的大」
  },

  /* ── 牌桌本身的外框 ───────────────────────────────────
     ⚠️ 原本寫死 max-height:760px / max-width:1200px 置中。
     那個上限是為了擋 iPad 直式（768×1024）把中央拉成一條長條，
     理由成立，但用**絕對像素**擋，大螢幕就一起被罰了 ——
     2000×1300 的螢幕上桌子只占中間 1200×760，上下各空 250px，
     玩家的反應是「下方的空白有什麼用途嗎？」（沒有）。

     改成「高度不超過寬度的 arCap 倍」：窄高的螢幕照樣被壓扁，
     寬螢幕放行。maxW/maxH 只當最後的保險。 */
  table: {
    maxW: 1700,
    maxH: 1150,
    arCap: 0.72,      // 高 ≤ 寬 × 這個比例（iPad 直式 768 寬 → 最高 553）
  },

  /* ── 四家牌河那一圈 ───────────────────────────────────
     ⚠️ 原本寫死 `#center{max-width:520px}`。

     `#rv-left{justify-self:start}` 早就在貼邊了，而且註解寫著設計本意是
     「各家的河靠向自己那一側」—— 但 #center 被夾成 520px 又置中，
     所以「貼 #center 左緣」在 1223px 寬的牌桌上離左家的手牌還有 350px。
     左右兩家的河看起來像孤兒（玩家的原話：兩側的牌太靠中間）。

     那個上限的理由（註解寫的）是「寬螢幕上不要散成一條長橫線，牌桌該是方的」
     —— 理由成立，但牌桌的方正現在已經由 table.arCap 顧了，
     這裡只要別完全放開就好。調小＝四家的河往中央擠成一圈，
     調大＝各自靠回自己的手牌，中間讓給主公像。 */
  center: {
    maxW: 1100,
  },

  /* ── 中央舞台 ─────────────────────────────────────────
     刻意留白，之後放和牌演出／征服結算的動畫。
     牌河不能吃掉它，所以它變大，牌就會變小。 */
  stage: {
    minW: 72, vw: 16, maxW: 120,      // clamp(minW, vw vw, maxW)
    minH: 26, vh: 9,  maxH: 52,
  },

  /* ── 主公像 ──────────────────────────────────────────── */
  lord: {
    // 牌河圈讓出中間之後，兩排河之間有 800px 上下可用，
    // vmin 26 只長到 255px（在 982 高的螢幕上），撐不滿。
    minW: 90, vmin: 38, maxW: 380,    // clamp(minW, vmin vmin, maxW)
    opacity: 0.82,                    // 太淡看不到（.5 實測幾乎不見），太濃會搶走牌的注意力
    capSize: 11,                      // 名字的字級
  },

  /* ── 間距 ────────────────────────────────────────────── */
  gap: {
    hand: 2,          // 手牌之間
    river: 1,         // 牌河之間
    zone: 6,          // 各區塊之間
  },
};

/* 把會影響 CSS 的那幾項寫成 CSS 變數掛在 <html> 上。
   render.js 管得到 canvas 的尺寸，但主公像、中央舞台、間距是 CSS 畫的 ——
   編輯器要能即時看到效果，就得有一條從 TUNE 到 CSS 的路。

   `vp`（可選）：把 vw／vh／vmin 換算成 px 再寫出去。
   ⚠️ 編輯器需要這個 —— 它的預覽是一個 div，但 vw/vmin 永遠是對**視窗**算的，
   不給 vp 的話「模擬 iPhone」看到的中央舞台與牌桌外框其實是桌機尺寸算出來的，
   調好了到手機上還是不對。遊戲本身不傳，照常用真的視窗單位。 */
function applyCSS(t, root, vp) {
  const T = t || TUNE;
  const el = root || (typeof document !== 'undefined' && document.documentElement);
  if (!el) return;
  const set = (k, v) => el.style.setProperty(k, v);
  set('--center-maxw', `${T.center.maxW}px`);
  const u = (n, unit) => {
    if (!vp) return n + unit;
    const base = unit === 'vw' ? vp.w : unit === 'vh' ? vp.h : Math.min(vp.w, vp.h);
    return (n * base / 100) + 'px';
  };
  set('--table-maxw', `min(100%, ${T.table.maxW}px)`);
  set('--table-maxh', `min(100%, ${T.table.maxH}px, ${u(T.table.arCap * 100, 'vw')})`);
  set('--stage-w', `clamp(${T.stage.minW}px, ${u(T.stage.vw, 'vw')}, ${T.stage.maxW}px)`);
  set('--stage-h', `clamp(${T.stage.minH}px, ${u(T.stage.vh, 'vh')}, ${T.stage.maxH}px)`);
  set('--lord-w', `clamp(${T.lord.minW}px, ${u(T.lord.vmin, 'vmin')}, ${T.lord.maxW}px)`);
  set('--lord-opacity', String(T.lord.opacity));
  set('--lord-cap', `${T.lord.capSize}px`);
  set('--gap-hand', `${T.gap.hand}px`);
  set('--gap-river', `${T.gap.river}px`);
  set('--gap-zone', `${T.gap.zone}px`);
}

/* 深拷貝一份，編輯器要拿去改而不動到正在用的那份 */
function clone(t) { return JSON.parse(JSON.stringify(t || TUNE)); }

/* 就地換掉現用的那份（編輯器即時預覽用）。
   不是整個物件換掉 —— render.js 在載入時就抓了 TUNE 的參照。 */
function set(next) {
  Object.keys(next || {}).forEach(k => {
    if (TUNE[k] && typeof TUNE[k] === 'object') Object.assign(TUNE[k], next[k]);
    else TUNE[k] = next[k];
  });
  applyCSS(TUNE);
  return TUNE;
}

/* 產生可以貼回這個檔案的那一段 */
function toSource(t) {
  const T = t || TUNE;
  const num = v => (Number.isInteger(v) ? String(v) : String(v));
  const grp = (name, obj, notes) => {
    const lines = Object.keys(obj).map(k => `    ${k}: ${num(obj[k])},`);
    return `  ${name}: {\n${lines.join('\n')}\n  },`;
  };
  return 'const TUNE = {\n'
    + ['own', 'river', 'opp', 'table', 'center', 'stage', 'lord', 'gap'].map(k => grp(k, T[k])).join('\n\n')
    + '\n};';
}

return { TUNE, TILE_RATIO, applyCSS, clone, set, toSource };
});
