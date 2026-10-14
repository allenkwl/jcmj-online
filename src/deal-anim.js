/* ═══════════════════════════════════════════════════════════════
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
  else root.MJDealAnim = api;
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
  // 外框 ≈ 17 墩 + 兩邊各一個牌深 + 疊高，換算成牌寬約 20.3 個
  let tw = Math.floor(Math.min(area.width, area.height) * 0.86 / (STACKS + 2 * RATIO + 0.5));
  tw = Math.max(6, Math.min(26, tw));
  const th = Math.round(tw * RATIO);
  const lift = Math.max(2, Math.round(th * 0.2));   // 上層那張往上錯開，看起來是疊兩層
  const g = 2;                                       // 牌牆與中央方框之間的縫
  const L = STACKS * tw;

  /* 牌牆一圈 68 墩，照**順時針**編號（抓牌就是沿這個方向前進）：
       0..16  下（自己的牆）  從右往左
      17..33  左（上家）      從下往上
      34..50  上（對家）      從左往右
      51..67  右（下家）      從上往下
     每道牆的第 0 墩剛好都是「牆主人的右手邊」—— 開門時要從那一端數起。 */
  const BASE = [0, 51, 34, 17];        // 畫面位置 → 那道牆的第 0 墩是全圈第幾墩
  function stackRect(r) {
    const wall = Math.floor(r / STACKS), j = r % STACKS;
    if (wall === 0) return { x: cx + L / 2 - (j + 1) * tw, y: cy + L / 2 + g, w: tw, h: th, v: false };
    if (wall === 1) return { x: cx - L / 2 - th - g, y: cy + L / 2 - (j + 1) * tw, w: th, h: tw, v: true };
    if (wall === 2) return { x: cx - L / 2 + j * tw, y: cy - L / 2 - th - g, w: tw, h: th, v: false };
    return { x: cx + L / 2 + g, y: cy - L / 2 + j * tw, w: th, h: tw, v: true };
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
  const wall = [];
  for (let r = 0; r < RING; r++) {
    const rc = stackRect(r);
    const mk = () => rc.v
      ? T.makeTile(null, { w: tw - 2, h: th - 2, faceDown: true, thin: true, rotate: 90 })
      : T.makeTile(null, { w: tw - 2, h: th - 2, faceDown: true, thin: true });
    const bottom = place(mk(), rc.x, rc.y);
    const top = place(mk(), rc.x, rc.y - lift);
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
  function makeDie(size) {
    const d = document.createElement('div');
    Object.assign(d.style, {
      position: 'fixed', width: size + 'px', height: size + 'px', boxSizing: 'border-box',
      padding: Math.round(size * 0.14) + 'px', borderRadius: Math.round(size * 0.22) + 'px',
      background: 'linear-gradient(145deg,#fffdf6,#e9e1cc)', boxShadow: '0 2px 6px rgba(0,0,0,.45)',
      display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gridTemplateRows: 'repeat(3,1fr)',
      placeItems: 'center', transition: 'transform 90ms', willChange: 'transform',
    });
    layer.appendChild(d);
    return d;
  }
  function setFace(d, n, size) {
    d.textContent = '';
    const red = (n === 1 || n === 4);
    for (let i = 0; i < 9; i++) {
      const cell = document.createElement('div');
      if (PIPS[n].includes(i)) {
        const p = Math.round(size * (n === 1 ? 0.3 : 0.17));
        Object.assign(cell.style, { width: p + 'px', height: p + 'px', borderRadius: '50%',
          background: red ? '#c8261f' : '#1d1a16' });
      }
      d.appendChild(cell);
    }
  }

  (async () => {
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
    const ds = Math.max(14, Math.round(tw * 1.5));
    const mx = cx + dx * L * 0.22, my = cy + dy * L * 0.22;
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
      const el = (rot === 90 || rot === 270)
        ? T.makeTile(null, { w: rect.h - pad, h: rect.w - pad, faceDown: true, rotate: rot })
        : T.makeTile(null, { w: rect.w - pad, h: rect.h - pad, faceDown: true, rotate: rot });
      place(el, rect.x, rect.y);
      el.style.transformOrigin = '0 0';
      el.style.transform = `translate(${sr.left - rect.x}px,${sr.top - rect.y}px) scale(${sr.width / rect.w},${sr.height / rect.h})`;
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
