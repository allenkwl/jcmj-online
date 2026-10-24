/* ═══════════════════════════════════════════════════════════════
   devtools/發牌動畫/deal-anim-3d.js — 發牌實驗台用的**副本**（v0.5 起跟 src/deal-anim-3d.js 同一份內容）
   在實驗台調好（T_ 等）要抄回 src/deal-anim-3d.js 才會上線；實驗台注入時會蓋掉 iframe 裡遊戲的 MJDealAnim3D。
   ───────────────────────────────────────────────────────────────
   以下是遊戲那一支的說明：
   deal-anim-3d.js — 發牌動畫・立體版（v1.95 起遊戲用這一支；原型在 devtools/發牌動畫/deal-anim-3d.js、實驗台 v0.4）
   ───────────────────────────────────────────────────────────────
   2026-10-24 使用者：「發牌動畫的牌畫得有點醜，能畫成立體的嗎？」「參考一下小球貓電鐵的骰子」→ 實驗台看過 →
   「發牌動畫後，變回平面？」（牌桌也要是立體牌）→「好，接進遊戲吧」。
   掛在 MJDealAnim3D。主程式在牌桌是立體牌（MJTiles.bodiesReady()）時用這一支，否則照舊用 src/deal-anim.js ——
   共用模組沒有版號，舊版頁面呼叫的仍是 MJDealAnim，不受影響。
   跟 deal-anim.js 不一樣的只有**畫法**：
     ‧ 牌牆、飛出去的牌：牌桌同一組立體牌背（assets/tiles3d/backV、backH）；只有直的、橫的兩種，
       一排緊貼、左右兩道下面那張蓋住上面那張的前緣、兩層疊就是上層墊一個牌的厚度（使用者：「全部應該只畫兩種麻將牌」）
     ‧ 落點：牌桌上每一張的位置與大小（牌桌已經是立體牌、render.js 收緊過）—— 結束時露出來的那一張跟剛落下的完全疊在一起
     ‧ 骰子：小球貓電鐵同一種畫風的六面圖（assets/dice/die1～6，一點、四點紅）
   流程、節奏（T_）、開門算法照 deal-anim.js。⚠️ 改節奏兩支要同步。
   ───────────────────────────────────────────────────────────────
   以下是 deal-anim.js 原本的說明：
   deal-anim.js — 發牌動畫（牌牆＋擲骰）
   ───────────────────────────────────────────────────────────────
   v1.54 起換成這一版（2026-10-14 使用者在實驗台看過之後：「幫我整合進遊戲」）。
   原型在 devtools/發牌動畫/deal-anim-wall.js，實驗台 devtools/發牌動畫v0.2.html；
   之前的舊版（牌從中央噴出去）留在 devtools/發牌動畫/deal-anim-lab.js 可以對照。
   ⚠️ 改節奏請先在實驗台調好，再把 T_ 抄回來（兩支要同步）。

   ── 為什麼要換 ──
   舊版是 53 張牌背從牌桌中央往四個方向噴出去，比較像撲克發牌。
   使用者：「過去麻將遊戲的發牌動畫會先秀出整理好的麻將牌，像是電動麻將桌
   整理好擺桌上，再來是一家一次拿四張，依先發順序拿……原先這動畫怪怪的」。

   ── 新版流程（照真實牌桌）──
     1. 牌牆升起：四道牌牆，每道 17 墩、每墩疊兩張，共 136 張
     2. 莊家擲兩顆骰子，點數決定開門的位置（見下方「開門」）
     3. 從開門處依序抓牌：從莊家開始逆時針，每家一次 4 張，轉三圈＝12 張
     4. 每家再補 1 張到 13 張（莊家若畫面上是 14 張，最後再補一張＝開局第一摸）
     5. 剩下的牌牆淡出（打牌時牌桌本來就不畫牌牆，只有「餘 N」）、自己理牌

   自己的牌**抓到就立起來**（看得到、還是亂的），最後才理牌 ——
   真實牌桌就是這樣；舊版是全部蓋著最後一起翻。

   ── 開門（日本麻將的算法，跟遊戲規則同一套）──
     ‧ 點數總和從莊家數 1、逆時針數下去（下家 2、對家 3、上家 4、莊家 5⋯），
       數到的那一家的牌牆開門
     ‧ 在那道牆從「牆主人的右手邊」數過去同樣的墩數，從下一墩開始抓
     ‧ 抓牌沿牌牆**順時針**前進
   骰子**完全不影響拿到什麼牌** —— 牌早就用亂數洗好了，這裡純粹是儀式：
   讓開門的位置每局不同，看起來才像真的在打牌。

   ── ⚠️ 只是畫面，不碰規則 ──
   程式裡真正的發牌是一張一張輪流發的（game-state 的 startHand：13 圈、每圈每家 1 張）。
   動畫畫成「一次抓 4 張」沒有關係：別家都是牌背；自己的牌最後排出來
   就是真正的手牌（從 hand 讀、照畫面上量到的位置排）。
   偏向發牌、連線同步、發牌結果都不受影響。

   ── ⚠️ 長度要壓在 8 秒內 ──
   遊戲本體呼叫發牌動畫時有一道 8 秒保險（v1.53 以前是 7 秒）：超過 8 秒還沒結束就直接開占卜，
   會蓋在動畫上（為了分頁在背景、計時器被節流時不要卡死）。
   預設節奏實測約 5.9 秒；T_ 調長之後要看工具頁顯示的實際秒數（超過 6.5 秒會警告）。

   ── 遊戲本體這一側（maybeAskFortune 呼叫 run 的地方）──
     ‧ 主公像在**呼叫 run() 之前**就藏起來（中間隔一個 setTimeout，主公的出場動作會閃一下 ——
       2026-10-14 使用者：「一開始的主公動畫不要顯示，直接開始浮出四道牆」）
     ‧ 7 秒保險放寬成 8 秒：動畫約 5.9 秒，分頁被節流時要留餘裕
     ‧ seed 用「這一場的 id＋局數」—— 連線時四台算出同一組骰子。
       ⚠️ 不能用 match.seed：連線版公開給其他台的牌局會把 seed 刪掉（推得出整副牌山）

   ── 沿用舊版的四個前提 ──
     1. 可跳過 —— 任意鍵或點一下（Esc 除外，那是老闆模式）
     2. 四局都用同一個速度
     3. #preview 完全跳過
     4. 尊重 prefers-reduced-motion
   ═══════════════════════════════════════════════════════════════ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MJDealAnim3D = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
'use strict';

/* 畫面位置 0 下（自己）1 右（下家）2 上（對家）3 左（上家），同 render.js 的 POS */
const ZONES = ['hand-bottom', 'hand-right', 'hand-top', 'hand-left'];
const ROT = [0, 270, 180, 90];          // 同 render.js 的 ROT
const STACKS = 17;                      // 每道牌牆 17 墩 × 2 張 × 4 道 = 136
const RING = STACKS * 4;
const RATIO = 56 / 40;                  // 牌的長寬比，同 tiles.js

/* ── 節奏（毫秒）── 數值集中在這裡，工具頁的欄位直接改這個物件。
   要留在 8 秒保險之內（見檔頭），而且要留餘裕：分頁在背景時計時器會被節流。
   第一版估 6.0 秒、實測 6.30 秒（計時器與收尾的零頭），只剩 0.7 秒太薄 ——
   每手間隔 190→170、骰子 650→600，實測約 5.9 秒。 */
const T_ = {
  riseStagger: 8,     // 牌牆升起：同一道牆每墩之間的間隔
  riseDur:   340,     // 每墩升起的時間
  riseTail:  120,     // 升完到擲骰之間的停頓
  diceRoll:  600,     // 骰子滾動
  diceHold:  280,     // 骰子停住、亮點數
  markDur:   260,     // 開門處亮一下
  grabGap:   170,     // 每一手（4 張或 1 張）之間的間隔
  flyDur:    300,     // 牌從牌牆飛到手上
  landFlip:  110,     // 自己的牌落手後立起來（翻面的單邊）
  beforeSort: 260,    // 全部到手、開始理牌之前的停頓（讓玩家看到是亂的）
  sortDur:   480,     // 理牌補間
  wallFade:  360,     // 剩下的牌牆淡出（跟理牌同時）
  sortTail:  120,
};

/* ── 立體版的圖（相對於遊戲頁，也就是專案根目錄）── */
const SPR = 'assets/dice/';
/* 牌牆、飛出去的牌：跟牌桌同一組牌身（devtools/立體牌/sprites/ 的牌背，2026-10-24 定案的那一組）——
   使用者：「發牌動畫後，變回平面？」：動畫跟牌桌要是同一種牌，結束時才不會換一種樣子 */
const BODY = 'assets/tiles3d/';
const IMG = { tileV: BODY + 'backV.webp', tileH: BODY + 'backH.webp' };
for (let n = 1; n <= 6; n++) IMG['die' + n] = SPR + 'die' + n + '.webp';
/* ── 只有兩種牌：直的（tileV，長邊朝遠方）、橫的（tileH，長邊左右）──
   2026-10-24 使用者：「麻將牌緊連在一起，不會出現側面的立體白邊」「全部應該只畫兩種麻將牌，直的和橫的，
   牌和牌相連自然只看到背面，兩層疊在一起也一樣」。
   圖＝頂面（牌背）＋看得到的前緣（一個牌的厚度）。照切出來的圖量（sprites/README.md）：
     ASPECT  高÷寬　　TOP  頂面佔圖高的比例（其餘是前緣＝牌的厚度）
   排法：
     ‧ 左右排（上下兩道牆、對家的手牌）：一張貼一張
     ‧ 上下排（左右兩道牆、上家下家的手牌）：每往下一張只前進「頂面高」，下面那張蓋住上面那張的前緣 ——
       只有最靠近自己的那張露出側面
     ‧ 疊兩層：上層往上墊一個牌的厚度（前緣高），同一張圖
   牌的大小統一（橫的牌寬＝直的牌寬 × 4/3），所以左右兩道牆會比上下兩道短 —— 就是斜著看桌面的透視 */
const ASPECT = { tileV: 340 / 240, tileH: 207 / 240 };   // 立體牌的 backV、backH（devtools/立體牌/sprites/README.md）
const TOP = { tileV: 0.735, tileH: 0.676 };
const LONG = 4 / 3;                      // 長邊÷短邊
function preload() {
  return Promise.all(Object.values(IMG).map(src => new Promise(ok => {
    const im = new Image(); im.onload = im.onerror = () => ok(); im.src = src;
  })));
}
const ready = preload();
function sprite(kind, w) {
  const im = document.createElement('img');
  im.src = IMG[kind];
  im.draggable = false;
  im.style.width = w + 'px';
  im.style.height = Math.round(w * ASPECT[kind]) + 'px';
  return im;
}

/* 骰子的點：3×3 的格子，第幾格有點。中國骰子的一點和四點是紅的。 */
const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };

function sfx(name) {
  try {
    const A = window.MJAudio || (window.MJ && window.MJ.audio);
    const S = A && A.SFX;
    if (S && typeof S[name] === 'function') S[name]();
  } catch (_) {}
}

const reduced = () => {
  try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) { return false; }
};

/* 量一排手牌裡每一張的位置（視窗座標）。同舊版。 */
function measure(id) {
  const box = document.getElementById(id);
  if (!box) return [];
  return [...box.children].map(ch => {
    const c = ch.tagName === 'CANVAS' ? ch : ch.querySelector('canvas');
    if (!c) return null;
    const r = c.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  }).filter(Boolean);
}

/* 可以給種子的亂數 —— 連線時要讓每一台看到同一組骰子，就從牌局帶種子進來 */
function mulberry32(a) {
  return () => {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function shuffled(n, rnd) {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* 最近一次的開門資訊，給工具頁顯示用 */
let lastInfo = null;

/* ── 主流程 ────────────────────────────────────────────────
   opts:
     match     讀自己的手牌（hand.seats[mySeat].hand）與莊家（hand.dealer）
     mySeat    自己的座位
     dealer    莊家座位（不給就讀 hand.dealer）
     seed      骰子的種子（不給就用 Math.random；連線版要給，四台才看到同一組骰子）
     preview   #preview 模式 → 直接不跑
   回傳 Promise，動畫結束（或被跳過）才 resolve。                 */
function run(opts) {
  const o = opts || {};
  if (o.preview) return Promise.resolve('skip:preview');
  if (reduced()) return Promise.resolve('skip:reduced-motion');

  const hand = o.match && o.match.hand;
  if (!hand) return Promise.resolve('skip:nohand');
  const T = window.MJTiles;
  if (!T || !T.makeTile) return Promise.resolve('skip:notiles');

  // 動畫開始前先量好每一家每一張的最終位置
  const targets = ZONES.map(measure);
  if (!targets[0].length) return Promise.resolve('skip:notrendered');

  const mySeat = o.mySeat || 0;
  const dealer = o.dealer != null ? o.dealer : (hand.dealer != null ? hand.dealer : mySeat);
  const posOf = s => (((s - mySeat) % 4) + 4) % 4;
  const rnd = o.seed != null ? mulberry32(o.seed) : Math.random;

  /* makeTile 會在指定的寬高之外再加厚度邊。不寫死厚度，拿一張探針牌量 ——
     tiles.js 改了厚度，這裡自動跟著對。 */
  const probe = T.makeTile(null, { w: 40, h: 56, faceDown: true });
  const pad = parseFloat(probe.style.width) - 40;

  /* ── 牌牆的位置：擺在中央區（四家牌河的那一塊），照那塊的大小決定牌多大 ── */
  const area = (document.getElementById('center') || document.getElementById('mid') || document.body)
    .getBoundingClientRect();
  const cx = area.left + area.width / 2;
  const cy = area.top + area.height / 2;
  /* 立體版的尺寸（見檔頭「只有兩種牌」）：
       tw  直的牌寬（上下兩道牆每墩的寬）　 wH  橫的牌寬＝tw×4/3（左右兩道牆的牌寬）
       fV／fH  頂面高　 eV／eH  前緣高（一個牌的厚度）　 sH  左右兩道牆每墩往下前進多少＝橫的牌的頂面高
     外框：寬 17tw＋兩邊各一張橫的牌；高 17sH＋上下各一張直的牌（含兩層疊高） */
  const fit = t => {
    const wH = t * LONG, hV = t * ASPECT.tileV, hH = wH * ASPECT.tileH;
    return { W: STACKS * t + 2 * wH + 6, H: STACKS * hH * TOP.tileH + 2 * (hV + hV * (1 - TOP.tileV)) + 6 };
  };
  let tw = 26;
  while (tw > 6 && (fit(tw).W > area.width * 0.86 || fit(tw).H > area.height * 0.86)) tw--;
  const wH = Math.round(tw * LONG);
  const hV = Math.round(tw * ASPECT.tileV), hH = Math.round(wH * ASPECT.tileH);
  const fV = Math.round(hV * TOP.tileV), eV = hV - fV;
  const fH = Math.round(hH * TOP.tileH), eH = hH - fH;
  const sH = fH;
  const th = fV;                                     // 給後面沿用的名字（骰子位置等）
  const g = 2;                                       // 牌牆與中央方框之間的縫
  const L = STACKS * tw, LV = STACKS * sH;

  /* 牌牆一圈 68 墩，照**順時針**編號（抓牌就是沿這個方向前進）：
       0..16  下（自己的牆）  從右往左
      17..33  左（上家）      從下往上
      34..50  上（對家）      從左往右
      51..67  右（下家）      從上往下
     每道牆的第 0 墩剛好都是「牆主人的右手邊」—— 開門時要從那一端數起。 */
  const BASE = [0, 51, 34, 17];        // 畫面位置 → 那道牆的第 0 墩是全圈第幾墩
  /* 立體版：回傳這一墩**下層那張牌頂面的左上角**（x, y）與用哪一種牌 */
  function stackRect(r) {
    const wall = Math.floor(r / STACKS), j = r % STACKS;
    if (wall === 0) return { x: cx + L / 2 - (j + 1) * tw, y: cy + LV / 2 + g, w: tw, h: fV, v: false };
    if (wall === 1) return { x: cx - L / 2 - wH - g, y: cy + LV / 2 - (j + 1) * sH, w: wH, h: sH, v: true };
    if (wall === 2) return { x: cx - L / 2 + j * tw, y: cy - LV / 2 - fV - eV - g, w: tw, h: fV, v: false };
    return { x: cx + L / 2 + g, y: cy - LV / 2 + j * sH, w: wH, h: sH, v: true };
  }

  const layer = document.createElement('div');
  layer.id = 'deal-anim';
  document.body.appendChild(layer);

  /* 真的牌與中央主公像先藏起來（理由同舊版：版面要留著、主公像代表「輪到誰」）。 */
  const hidden = ZONES.map(id => document.getElementById(id))
    .concat([document.getElementById('center-lord')])
    .filter(Boolean);
  hidden.forEach(e => e.style.visibility = 'hidden');

  // ⚠️ 拿副本（理由同舊版：動畫跑好幾秒，原陣列可能被改）
  const myTiles = hand.seats[mySeat] ? hand.seats[mySeat].hand.slice() : [];

  function place(el, x, y) {
    el.className += ' da-tile';
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    layer.appendChild(el);
    return el;
  }

  /* ── 做牌牆：每墩兩張，下層先放、上層往上錯開疊在上面 ── */
  /* 立體版：一墩＝兩張寫實的牌疊起來。圖的底邊對齊這一墩的底邊；
     上層往上錯開一個牌的厚度。z-index 照畫面上的高度（越下面越前面，左右兩道牆才會一張蓋住上一張的前緣） */
  const wall = [];
  for (let r = 0; r < RING; r++) {
    const rc = stackRect(r);
    const kind = rc.v ? 'tileH' : 'tileV';
    const w = rc.v ? wH : tw + 1;                     // 直的多 1px：相鄰兩張貼緊、不留縫
    const up = rc.v ? eH : eV;                        // 上層墊一個牌的厚度
    const bottom = place(sprite(kind, w), rc.x, rc.y);
    const top = place(sprite(kind, w), rc.x, rc.y - up);
    // 越下面越前面：下面那張蓋住上面那張的前緣；同一墩上層蓋下層
    bottom.style.zIndex = String(Math.round(rc.y) * 2);
    top.style.zIndex = String(Math.round(rc.y) * 2 + 1);
    [bottom, top].forEach(el => { el.style.opacity = '0'; el.style.transform = 'translateY(8px)'; });
    wall.push({ rc, top, bottom });
  }

  /* ── 跳過與收尾 ── */
  let skipped = false, finish = null, diceTimer = null;
  const done = new Promise(res => { finish = res; });
  function cleanup(reason) {
    if (skipped) return;
    skipped = true;
    clearInterval(diceTimer);
    document.removeEventListener('keydown', onSkip, true);
    document.removeEventListener('pointerdown', onSkip, true);
    layer.remove();
    hidden.forEach(e => e.style.visibility = '');
    finish(reason);
  }
  function onSkip(e) {
    if (e && e.type === 'keydown' && e.key === 'Escape') return;   // Esc 留給老闆模式
    cleanup('skipped');
  }
  document.addEventListener('keydown', onSkip, true);
  document.addEventListener('pointerdown', onSkip, true);

  /* ── 骰子 ── */
  /* 立體版：骰子是六面圖（一張圖＝一顆擺好某一面朝上的骰子），換面就是換圖 */
  function makeDie(size) {
    const d = document.createElement('img');
    d.draggable = false;
    Object.assign(d.style, {
      position: 'fixed', width: size + 'px', height: 'auto', zIndex: '100000',
      filter: 'drop-shadow(0 3px 4px rgba(0,0,0,.5))', transition: 'transform 90ms', willChange: 'transform',
    });
    layer.appendChild(d);
    return d;
  }
  function setFace(d, n) { d.src = IMG['die' + n]; }

  (async () => {
    await Promise.race([ready, sleep(1500)]);      // 圖還沒載完（第一次）就等一下，最多 1.5 秒
    if (skipped) return;
    // ── 一、牌牆升起：四道同時，從各自的右手邊往左一墩一墩冒出來 ──
    sfx('newRound');
    wall.forEach((s, r) => {
      const j = r % STACKS;
      setTimeout(() => {
        if (skipped) return;
        [s.bottom, s.top].forEach(el => {
          el.style.transition = `opacity ${T_.riseDur}ms ease-out, transform ${T_.riseDur}ms cubic-bezier(.2,.8,.3,1)`;
          el.style.opacity = '1';
          el.style.transform = 'none';
        });
      }, j * T_.riseStagger);
    });
    await sleep(STACKS * T_.riseStagger + T_.riseDur + T_.riseTail);
    if (skipped) return;

    // ── 二、莊家擲骰 ──
    const d1 = 1 + Math.floor(rnd() * 6), d2 = 1 + Math.floor(rnd() * 6), total = d1 + d2;
    const wallSeat = (dealer + total - 1) % 4;                       // 從莊家數 1、逆時針
    const r0 = (BASE[posOf(wallSeat)] + total) % RING;               // 牆主右手邊數 total 墩，下一墩開始抓
    lastInfo = { dice: [d1, d2], total, dealer, wallSeat, startStack: r0 };

    // 骰子擺在牌牆裡面、靠莊家那一側
    const DIR = [[0, 1], [1, 0], [0, -1], [-1, 0]];
    const [dx, dy] = DIR[posOf(dealer)];
    const ds = Math.max(22, Math.round(tw * 2.1));        // 立體版的骰子大一點（圖有透視，同寬看起來比較小）
    const mx = cx + dx * L * 0.22, my = cy + dy * LV * 0.22;
    const ox = dy !== 0 ? ds * 0.7 : 0, oy = dx !== 0 ? ds * 0.7 : 0;   // 兩顆並排，垂直於莊家方向
    const dice = [makeDie(ds), makeDie(ds)];
    dice[0].style.left = (mx - ox - ds / 2) + 'px'; dice[0].style.top = (my - oy - ds / 2) + 'px';
    dice[1].style.left = (mx + ox - ds / 2) + 'px'; dice[1].style.top = (my + oy - ds / 2) + 'px';
    let tick = 0;
    diceTimer = setInterval(() => {
      if (skipped) return;
      dice.forEach(d => {
        setFace(d, 1 + Math.floor(Math.random() * 6), ds);      // 滾動中的點數只是看的，不用種子
        d.style.transform = `translate(${(Math.random() - .5) * ds * .5}px,${(Math.random() - .5) * ds * .5}px) rotate(${(Math.random() - .5) * 70}deg)`;
      });
      if (tick++ % 2 === 0) sfx('click');
    }, 70);
    await sleep(T_.diceRoll);
    clearInterval(diceTimer);
    if (skipped) return;
    setFace(dice[0], d1, ds); setFace(dice[1], d2, ds);
    dice.forEach(d => { d.style.transition = 'transform 140ms ease-out'; d.style.transform = 'none'; });
    sfx('discard');

    // 點數總和亮在骰子旁邊
    const lbl = document.createElement('div');
    lbl.textContent = String(total);
    lbl.style.zIndex = '100001';
    Object.assign(lbl.style, {
      position: 'fixed', left: (mx - ds) + 'px', top: (my - ds * 2.1) + 'px', width: (ds * 2) + 'px',
      textAlign: 'center', font: `700 ${Math.round(ds * 0.9)}px/1 'Songti TC',serif`, color: '#ffd766',
      textShadow: '0 1px 4px rgba(0,0,0,.8)', opacity: '0', transition: 'opacity 160ms',
    });
    if (dy === -1) lbl.style.top = (my + ds * 1.2) + 'px';        // 莊家在上方時，數字放骰子下面
    layer.appendChild(lbl);
    void lbl.offsetWidth; lbl.style.opacity = '1';
    await sleep(T_.diceHold);
    if (skipped) return;

    // ── 三、開門處亮一下 ──
    const glow = 'drop-shadow(0 0 3px #ffd766) drop-shadow(0 0 6px #ffd766)';
    [wall[r0], wall[(r0 + 1) % RING]].forEach(s => { s.top.style.filter = glow; s.bottom.style.filter = glow; });
    await sleep(T_.markDur);
    if (skipped) return;
    [wall[r0], wall[(r0 + 1) % RING]].forEach(s => { s.top.style.filter = ''; s.bottom.style.filter = ''; });
    [...dice, lbl].forEach(el => { el.style.transition = 'opacity 200ms'; el.style.opacity = '0'; });

    // ── 四、抓牌：從莊家開始逆時針，每家 4 張轉三圈，再每家補 1 張 ──
    const order = [0, 1, 2, 3].map(i => (dealer + i) % 4);
    const remain = {};
    order.forEach(s => { remain[s] = targets[posOf(s)].length; });
    const plan = [];
    for (let round = 0; round < 3; round++) order.forEach(s => {
      const n = Math.min(4, remain[s]);
      if (n > 0) { plan.push({ seat: s, n }); remain[s] -= n; }
    });
    // 補牌：每家 1 張；莊家畫面上若是 14 張，會再多補一輪（＝開局第一摸）
    while (order.some(s => remain[s] > 0)) order.forEach(s => {
      if (remain[s] > 0) { plan.push({ seat: s, n: 1 }); remain[s]--; }
    });

    // 從開門處往順時針一張一張拿：每墩先拿上層、再拿下層
    let taken = 0;
    function takeFromWall() {
      const s = wall[(r0 + Math.floor(taken / 2)) % RING];
      const el = (taken % 2 === 0) ? s.top : s.bottom;
      taken++;
      return el;
    }

    /* 落點（立體版）：別家的手牌照「緊貼」重排 ——
         對家（一排左右）：一張貼一張，整排置中在原本的位置
         上家、下家（一排上下）：橫的牌，每張往下前進「頂面高」，整排置中
       自己：照遊戲手牌的位置（落手後要翻成遊戲的牌） */
    /* 牌桌也是立體牌（tiles.js 的 setBodies；render.js 畫的時候就收緊了）：牌桌上每一張的位置、大小就是落點 ——
       動畫結束時露出來的那一張，跟剛落下的那一張完全疊在一起，不會跳 */
    const table3d = !!(T.bodiesReady && T.bodiesReady());
    const landing = targets.map((rs, pos) => {
      if (!rs.length) return [];
      if (table3d) return rs.map(r => ({ x: r.x, y: r.y, w: r.w, h: r.h }));
      if (pos === 0) return rs.map(r => ({ x: r.x, y: r.y + (r.h - Math.round(r.w * ASPECT.tileV)) / 2, w: r.w }));
      const xs = rs.map(r => r.x), ys = rs.map(r => r.y);
      const midX = (Math.min(...xs) + Math.max(...rs.map(r => r.x + r.w))) / 2;
      const midY = (Math.min(...ys) + Math.max(...rs.map(r => r.y + r.h))) / 2;
      const order = rs.map((r, i) => i);
      if (pos === 2) {
        const w = Math.min(...rs.map(r => r.w)) + 4;               // 牌寬照原本的，加一點補掉遊戲手牌之間的縫
        order.sort((a, b) => rs[a].x - rs[b].x);
        const out = [];
        order.forEach((i, n) => { out[i] = { x: midX - rs.length * w / 2 + n * w, y: rs[i].y, w: w + 1 }; });
        return out;
      }
      const w = Math.max(...rs.map(r => r.w));
      const step = Math.round(w * ASPECT.tileH * TOP.tileH);
      const total = (rs.length - 1) * step + Math.round(w * ASPECT.tileH);
      order.sort((a, b) => rs[a].y - rs[b].y);
      const out = [];
      order.forEach((i, n) => { out[i] = { x: midX - w / 2, y: midY - total / 2 + n * step, w }; });
      return out;
    });

    // 自己的牌：抓到時落在「到手的順序」位置（亂的），理牌時才移到真正的位置
    const perm = shuffled(targets[0].length, rnd);
    const slotN = [0, 0, 0, 0];
    const mine = [];                    // {el, k} k = 到手的順序

    function flyOne(srcEl, pos, delay) {
      const k = slotN[pos]++;
      const rect = targets[pos][k];
      if (!rect) return;
      const sr = srcEl.getBoundingClientRect();
      const rot = ROT[pos];
      /* 立體版：飛出去的牌也是那兩種牌，落點照「緊貼」重排（landing）。
         自己的牌落手後照舊翻成遊戲的牌（正面，位置照遊戲的手牌） */
      const kind = (rot === 90 || rot === 270) ? 'tileH' : 'tileV';
      const ld = landing[pos][k];
      const el = sprite(kind, ld.w);
      const ew = ld.w, eh = ld.h || Math.round(ld.w * ASPECT[kind]), ex = ld.x, ey = ld.y;
      if (ld.h) el.style.height = ld.h + 'px';         // 照牌桌那一張的大小（牌桌的立體牌是拉到原本的外框）
      place(el, ex, ey);
      el.style.zIndex = String(100000 + Math.round(ey));   // 蓋在牌牆上；左右兩家下面那張蓋住上面那張
      el.style.transformOrigin = '0 0';
      el.style.transform = `translate(${sr.left - ex}px,${sr.top - ey}px) scale(${sr.width / ew},${sr.height / eh})`;
      el.style.opacity = '0';
      setTimeout(() => {
        if (skipped) return;
        srcEl.style.transition = 'opacity 90ms'; srcEl.style.opacity = '0';
        el.style.opacity = '1';
        void el.offsetWidth;            // ⚠️ 不用 rAF：分頁在背景時不會觸發（同舊版的教訓）
        el.style.transition = `transform ${T_.flyDur}ms cubic-bezier(.25,.8,.3,1)`;
        el.style.transform = 'none';
      }, delay);
      if (pos === 0) {
        const rec = { el, k };
        mine.push(rec);
        // 落手之後立起來：收成一條、換成正面、再展開
        setTimeout(() => {
          if (skipped) return;
          rec.el.style.transition = `transform ${T_.landFlip}ms ease-in`;
          rec.el.style.transformOrigin = '50% 50%';
          rec.el.style.transform = 'scaleX(0.02)';
          setTimeout(() => {
            if (skipped) return;
            const t = myTiles[perm[k]];
            const face = T.makeTile(t || null, { w: rect.w - pad, h: rect.h - pad, faceDown: !t });
            face.className += ' da-tile';
            face.style.left = rect.x + 'px'; face.style.top = rect.y + 'px';
            face.style.zIndex = '99999';
            face.style.transform = 'scaleX(0.02)';
            layer.replaceChild(face, rec.el);
            rec.el = face;
            void face.offsetWidth;
            face.style.transition = `transform ${T_.landFlip}ms ease-out`;
            face.style.transform = 'none';
          }, T_.landFlip);
        }, delay + T_.flyDur);
      }
    }

    plan.forEach((step, i) => {
      const t0 = i * T_.grabGap;
      const pos = posOf(step.seat);
      for (let m = 0; m < step.n; m++) flyOne(takeFromWall(), pos, t0 + m * 20);
      // 一手一聲：落到手上的那一刻響（不是每張都響 —— 53 張各響一次會變成雜訊）
      setTimeout(() => { if (!skipped) sfx(pos === 0 ? 'select' : 'discard'); }, t0 + T_.flyDur * 0.8);
    });
    const lastLand = (plan.length - 1) * T_.grabGap + 3 * 20 + T_.flyDur + T_.landFlip * 2;
    await sleep(lastLand);
    if (skipped) return;

    // ── 五、牌牆淡出、自己理牌（同時）──
    await sleep(T_.beforeSort);
    if (skipped) return;
    wall.forEach(s => [s.top, s.bottom].forEach(el => {
      if (el.style.opacity === '0') return;
      el.style.transition = `opacity ${T_.wallFade}ms ease-in, transform ${T_.wallFade}ms ease-in`;
      el.style.opacity = '0';
      el.style.transform = 'translateY(6px)';
    }));
    mine.forEach(rec => {
      const from = targets[0][rec.k], to = targets[0][perm[rec.k]];
      if (!from || !to) return;
      rec.el.style.transition = `transform ${T_.sortDur}ms cubic-bezier(.3,.7,.2,1)`;
      rec.el.style.transform = `translate(${to.x - from.x}px,${to.y - from.y}px)`;
    });
    sfx('draw');
    await sleep(Math.max(T_.sortDur, T_.wallFade) + T_.sortTail);
    cleanup('done');
  })().catch(e => { try { console.warn('[deal-anim]', e); } catch (_) {} cleanup('error'); });

  return done;
}

return { run, T_, get lastInfo() { return lastInfo; } };
});
