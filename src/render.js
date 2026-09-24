/* ═══════════════════════════════════════════════════════════════
   render.js — 把 flow 的狀態畫成四方版面
   ───────────────────────────────────────────────────────────────
   舊版是上下兩方（`.mja` 的 grid-area 只有 oz/oav/pb/pz/pav），
   四人版要重排成四方，而且左右兩家的牌要橫著擺。

   座位對應（永遠以「我」為座位 0 的視角旋轉，所以畫面上的
   下／右／上／左固定，跟實際座位索引無關）：

        ┌──────────── 對家 (me+2) ────────────┐
        │                                     │
      上家                中央                下家
     (me+3)            牌河與場況            (me+1)
        │                                     │
        └──────────── 自己 (me) ─────────────┘

   ── 職責邊界 ──
   只讀狀態、只畫畫面。任何「接下來該怎樣」都不在這裡 ——
   點擊事件往外拋 callback，由 mj4.html 的控制層轉成 flow.submit()。
   ═══════════════════════════════════════════════════════════════ */
(function (root, factory) {
  const api = factory(root.MJTiles, root.MJState, root.MJFlow, root.MJKingdoms, root.MJFortune,
                      root.MJLayout);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MJRender = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (T, S, F, K, Fo, L) {
'use strict';

const SEATS = 4;

/* 尺寸表。PLAN 的版面預算：左右兩家各 95px，中央給自己的手牌，
   自己的手牌在 iPhone SE 上是 35px、15 Pro Max 上是 43px。      */
const SIZE = {
  own:      { w: 40, h: 56 },   // 自己的手牌
  ownMeld:  { w: 26, h: 36 },   // 自己的副露
  river:    { w: 24, h: 33 },   // 牌河
  oppHand:  { w: 18, h: 25 },   // 別家的手牌背（由 fitSizes 算，這裡只是初值）
  oppMeld:  { w: 17, h: 24 },   // 別家的副露（同上）
};

/* 畫面上的四個位置 → 相對座位偏移 */
const POS = { bottom: 0, right: 1, top: 2, left: 3 };
/* 各位置的旋轉角度 */
const ROT = { bottom: 0, right: 270, top: 180, left: 90 };

function seatAt(mySeat, pos) { return (mySeat + POS[pos]) % SEATS; }

function el(tag, cls, parent) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (parent) parent.appendChild(e);
  return e;
}
function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

/* ── 一列牌 ────────────────────────────────────────────────── */
function renderRow(container, tiles, opts) {
  const o = opts || {};
  clear(container);
  (tiles || []).forEach((t, i) => {
    const c = T.makeTile(t, {
      w: o.w, h: o.h, rotate: o.rotate, thin: o.thin,
      faceDown: o.faceDown, selected: o.selected === i, dim: o.dim,
    });
    // 剛摸進來的那張跟牌組拉開一點 —— 狀態層刻意不把它排進去，
    // 畫面也要讓它看得出來是分開的（麻將的摸切慣例）
    if (o.gapBeforeLast && i === tiles.length - 1) c.classList.add('just-drawn');
    if (o.onClick) {
      c.style.cursor = 'pointer';
      c.addEventListener('click', () => o.onClick(i, t));
    }
    // 鍵盤提示，跟原版一樣標在牌下面
    if (o.keyLabels && o.keyLabels[i]) {
      const wrap = el('div', 'ph-wrap');
      if (c.classList.contains('just-drawn')) {
        c.classList.remove('just-drawn');
        wrap.classList.add('just-drawn');
      }
      wrap.appendChild(c);
      const lbl = el('div', 'ph-key', wrap);
      lbl.textContent = o.keyLabels[i];
      container.appendChild(wrap);
      return;
    }
    container.appendChild(c);
  });
}

/* ── 副露 ──────────────────────────────────────────────────
   暗槓**兩端**兩張蓋著、中間兩張亮 —— 日式正統，舊兩人版（renderMelds 的
   `i===0||i===3`）也是這樣。牌種是公開的，別家看得到槓了什麼。

   ⚠️ 移植時曾經畫反成「中間蓋、兩端亮」。牌種一樣看得到所以規則沒壞，
   但熟日麻的人一眼就覺得怪。本作採日本規則（十三張），不是台灣十六張 ——
   台灣的暗槓是整副蓋著、攤牌才翻，那是另一套，不要混用。          */
function renderMelds(container, melds, opts) {
  const o = opts || {};
  clear(container);
  (melds || []).forEach(m => {
    const grp = el('div', 'meld-group', container);
    m.tiles.forEach((t, i) => {
      const down = (m.type === 'kong_dark') && (i === 0 || i === 3);
      grp.appendChild(T.makeTile(t, {
        w: o.w, h: o.h, rotate: o.rotate, thin: true, faceDown: down,
      }));
    });
  });
}

/* ── 牌河 ──────────────────────────────────────────────────
   被鳴走的那張不畫（它在別人的副露裡），用 visibleDiscards 濾掉。
   一列六張，這是雀魂／天鳳的慣例。                               */
function renderRiver(container, hand, seat, pos) {
  clear(container);
  const tiles = S.visibleDiscards(hand, seat);
  const rot = ROT[pos];
  const sz = SIZE.river;
  const perRow = RIVER_PER_ROW;
  for (let i = 0; i < tiles.length; i += perRow) {
    const row = el('div', 'river-row', container);
    tiles.slice(i, i + perRow).forEach(t => {
      row.appendChild(T.makeTile(t, { w: sz.w, h: sz.h, rotate: rot, thin: true }));
    });
  }
}

/* ── 一家的名牌 ───────────────────────────────────────────── */
function renderNameplate(node, match, hand, seat, mySeat) {
  const m = match.seats[seat];
  clear(node);
  const isDealer = hand.dealer === seat;
  const isTurn = hand.turn === seat && hand.phase !== 'over';
  const kd = K && K.get(m.kingdom);

  node.classList.toggle('is-turn', isTurn);
  node.classList.toggle('is-me', seat === mySeat);

  // 主公的大頭貼。圖是 tools/build-avatars.py 從舊版的 KING_AVATARS 壓出來的
  // 96px WebP（約 4 KB）—— 直接用 1024px 的原圖等於為了 22px 下載 200 KB。
  if (kd) {
    const av = el('img', 'np-avatar', node);
    const g = asGeneral(m);
    av.src = K.avatarUrl(kd.id, false, g);
    av.alt = g ? K.generalTitle(kd.id) : (kd.kingName || kd.name);
    av.title = av.alt;
    av.loading = 'lazy';
    if (kd.color) node.style.setProperty('--k-color', kd.color);
  }

  const wind = el('span', 'np-wind' + (isDealer ? ' dealer' : ''), node);
  wind.textContent = S.seatWind(hand, seat);

  const name = el('span', 'np-name', node);
  name.textContent = m.name;
  // 斷線代打中：名牌換成武將，主公像轉灰（CSS .np-sub）
  node.classList.toggle('np-sub', !!m.sub);
  if (m.sub) {
    // 「代打」拆成獨立標籤：.np-name 有 max-width（給長暱稱用的），
    // 寫在一起會被截成「田忌（代…」
    name.textContent = m.sub.general;
    el('span', 'np-subtag', node).textContent = '代打';
    node.title = (kd ? kd.name : '') + '主公斷線，現由' + m.sub.general + '代打';
  } else {
    node.removeAttribute('title');
  }

  const sc = el('span', 'np-score', node);
  sc.textContent = m.matchScore;

  if (kd) {
    const c = el('span', 'np-kingdom', node);
    c.textContent = kd.char;
  }

  /* 已征服的領地：本國字後面接一串小字（韓秦…）。使用者：「在對戰畫面每個主公後寫，已征服領地」。
     ⚠️ Firebase 會把陣列存成物件，讀回來先整理。守將沒有領地，不寫 */
  const cq = m.conquered ? (Array.isArray(m.conquered) ? m.conquered : Object.keys(m.conquered).map(k => m.conquered[k])) : [];
  if (cq.length) {
    const chips = el('span', 'np-conq', node);
    chips.textContent = cq.map(id => (K && K.get(id) || {}).char || '').join('');
    chips.title = '已征服：' + cq.map(id => (K && K.get(id) || {}).name || id).join('、');
  }
  // 缺席的成員：座位保留、由他那一國的武將代打（docs/online-campaign.md 第三節）
  if (m.absentOf && !m.sub) {
    el('span', 'np-subtag', node).textContent = '缺席';
    node.title = (m.absentOf.name || '') + ' 缺席，由' + m.name + '代打';
  }
}

/* ── 牌桌中央的主公 ────────────────────────────────────────
   輪到誰就秀那一國的主公。被牌擋到一部分沒關係 —— 它是氣氛，不是資訊，
   所以擺在最底層（z-index 0）、透明度壓低，牌一定畫在它上面。      */
/* ── 出征三格動畫 ──────────────────────────────────────────
   換人時播一次：蓄勢停一下、出招一閃、進攻停住（docs/character-design.md 第四節）。
   ⚠️ 只在「換人」時播，不循環 —— 中央每輪都換人，一直動會搶走看牌的注意力。
   ⚠️ 要先預載。第一次播到才去抓圖的話，第二、三格還沒到，畫面會閃空白。 */
const WAR_MS = [450, 130];                 // 第一、二格停多久；第三格停住

/* 這個座位畫守將還是主公：電腦座位、斷線代打中 → 守將；真人 → 主公。 */
const asGeneral = st => !!(st && (st.isAI || st.sub));
const warPreloaded = new Set();
function preloadWar(match) {
  if (typeof Image === 'undefined' || !K.warFrames) return;
  (match.seats || []).forEach(st => {
    const id = st && st.kingdom;
    const key = id + (asGeneral(st) ? ':g' : '');
    if (!id || warPreloaded.has(key)) return;
    warPreloaded.add(key);
    K.warFrames(id, asGeneral(st)).concat(K.calmUrl ? [K.calmUrl(id, asGeneral(st))] : [])
      .forEach(u => { const im = new Image(); im.src = u; });   // 平靜姿勢也預載：結算框會用
  });
}
const reducedMotion = () => typeof matchMedia === 'function'
  && matchMedia('(prefers-reduced-motion: reduce)').matches;

/* 依序播 frames，durs[i] 是第 i 格停多久，最後一格停住。
   計時器掛在 node 上：同一個 node 再播一次會先清掉上一輪，不會兩輪疊在一起。 */
function playFrames(node, img, frames, durs) {
  clearTimeout(node._warTimer);
  clearTimeout(node._warWait);
  const tok = node._warTok = (node._warTok || 0) + 1;
  if (!frames.length) return;
  const last = frames[frames.length - 1];
  if (frames.length < 2 || reducedMotion()) { img.src = last; return; }
  /* ⚠️ 先把每一格都載好才開始播。
     原本一開始就照時間換 src，手機上圖還沒下載完：那一格就是空白、或直接被下一格蓋掉 ——
     已經看過的國有動畫、第一次點的國沒有（2026-09-24 使用者回報「有的有動畫，有的沒有」）。
     網路太慢也不要一直空著：最多等 1.5 秒，就直接停在最後一格。 */
  let started = false;
  const run = () => {
    if (started || tok !== node._warTok) return;
    started = true;
    clearTimeout(node._warWait);
    let i = 0;
    img.src = frames[0];
    const next = () => {
      if (tok !== node._warTok) return;
      i++;
      img.src = frames[i];
      if (i < frames.length - 1) node._warTimer = setTimeout(next, durs[i]);
    };
    node._warTimer = setTimeout(next, durs[0]);
  };
  Promise.all(frames.map(u => new Promise(res => {
    const im = new Image();
    im.onload = im.onerror = () => res();
    im.src = u;
  }))).then(run);
  node._warWait = setTimeout(() => {
    if (started || tok !== node._warTok) return;
    started = true;
    img.src = last;
  }, 1500);
}
function playWar(node, img, frames) {
  if (frames.length < 3) { clearTimeout(node._warTimer); if (frames.length) img.src = frames[frames.length - 1]; return; }
  playFrames(node, img, frames, WAR_MS);
}

function renderCenterLord(node, match, hand) {
  if (!node || !K) return;
  preloadWar(match);
  const seat = hand.turn;
  const m = match.seats[seat];
  const kd = K.get(m && m.kingdom);
  const g = asGeneral(m);
  const url = kd && K.avatarUrl(kd.id, true, g);

  if (!url || hand.phase === 'over') {
    clearTimeout(node._warTimer);
    node.removeAttribute('data-k'); clear(node); return;
  }
  // 鍵要含「是不是守將」—— 真人斷線換成守將代打時，同一國也要換圖重播
  const key = kd.id + (g ? ':g' : '');
  if (node.getAttribute('data-k') === key) return;     // 同一位就不重畫，避免閃（動畫也不會重播）

  node.setAttribute('data-k', key);
  clear(node);
  const img = el('img', 'lord-img', node);
  const title = g ? K.generalTitle(kd.id) : (kd.kingName || kd.name);
  img.alt = title;
  playWar(node, img, K.warFrames ? K.warFrames(kd.id, g) : [url]);
  if (kd.color) node.style.setProperty('--k-color', kd.color);
  const cap = el('div', 'lord-cap', node);
  cap.textContent = title;
}

/* ── 場況 ──────────────────────────────────────────────────── */
function renderCenterInfo(node, match, hand) {
  clear(node);
  const a = el('div', 'ci-round', node);
  a.textContent = (hand.roundWind || '東') + ' ' + hand.handNo + ' 局';
  if (hand.honba) {
    const b = el('div', 'ci-honba', node);
    b.textContent = hand.honba + ' 本場';
  }
  const c = el('div', 'ci-wall', node);
  c.textContent = '餘 ' + S.liveWallCount(hand);
}

/* ── 自己這一手的狀態 ──────────────────────────────────────
   聽牌了沒、在做什麼牌型、還差幾張、聽哪幾張。

   **只算自己那一家。** 舊版的聽牌橫幅還會顯示「⚠️ 敵方疑似聽牌」，
   那是直接讀對手手牌（`isTenpaiHand(G.oH, G.oM)`）—— 兩人單機版辦得到，
   四人線上版辦不到也不該有。這裡只看 hand.seats[mySeat]。

   為什麼要做：實測公平發牌的起手是 3～4 向聽，而一局只有約 10 巡，
   有一半的人整局不會聽牌。對不會打麻將的人，那是
   「我坐在這裡兩分鐘，什麼都沒發生」。這一條是給他一個看得懂的目標。 */
function renderSelfInfo(node, hand, seat) {
  if (!node) return;
  clear(node);
  const me = hand.seats[seat];
  if (!me || hand.phase === 'over') { node.className = 'selfinfo'; return; }

  const tenpai = R_isTenpai(me);
  node.className = 'selfinfo' + (tenpai ? ' tenpai' : '');

  if (tenpai) {
    const t = el('span', 'si-tenpai', node);
    t.textContent = '🎯 聽牌';
    const waits = (Fo ? Fo.analyze(me.hand, me.melds).waits : []);
    if (waits.length) {
      const w = el('span', 'si-waits', node);
      w.textContent = '等 ' + waits.join('、');
    }
    return;
  }

  if (!Fo) return;
  const a = Fo.analyze(me.hand, me.melds);
  const sh = el('span', 'si-shanten', node);
  sh.textContent = a.shanten + ' 向聽';

  const h = a.hints && a.hints[0];
  if (h) {
    const g = el('span', 'si-goal' + (h.away <= Fo.CLOSE ? ' near' : ''), node);
    g.textContent = h.name + '　還差 ' + h.away + ' 張';
  }
}

/* 用 flow 那邊同一套判定，避免兩處各寫一次 */
function R_isTenpai(seatState) {
  const R = (typeof require === 'function')
    ? require('./rules-core.js')
    : (typeof globalThis !== 'undefined' ? globalThis.MJRules : null);
  return !!(R && R.isTenpaiHand(seatState.hand, seatState.melds));
}

/* ── 尺寸自適應 ────────────────────────────────────────────
   舊版的 `applyScale()` 只要算兩方，四人版要同時滿足：

     ‧ 自己的 14 張手牌要排得進中央欄的寬度
     ‧ 對家與自己的牌河（各最多三列）加上中央資訊牌，
       要塞得進中央區的高度 —— 塞不下就會溢出去壓到手牌

   所以先量真實的可用空間再決定牌張尺寸，不寫死。
   PLAN 的版面預算（iPhone SE 手牌 35px、15 Pro Max 43px）是這個算式的結果。 */
/* 所有可調的數字都在 `src/layout.js`（給 devtools/對戰畫面編輯器 拉的）。
   L 沒載到就用這裡的備援值 —— 測試在 node 裡跑，不一定會載 layout。 */
const FALLBACK = {
  own:   { min: 26, max: 92, maxHeightPct: 0.20, meldOfHand: 0.65 },
  river: { min: 14, max: 46, perRow: 6, maxRows: 3 },
  opp:   { min: 16, max: 64, ofOwn: 0.60, meldOfHand: 0.92 },
};
function tune() { return (L && L.TUNE) || FALLBACK; }

const RATIO = 56 / 40;
const RIVER_RATIO = 33 / 24;

/* 這幾個是 API 的一部分（別的模組與測試在讀），維持匯出。
   值改成從 layout 讀 —— 編輯器改完不用重載模組。 */
const RIVER_PER_ROW = tune().river.perRow;   // 六張一列，雀魂／天鳳的慣例
const RIVER_MAX_ROWS = tune().river.maxRows; // 一家最多 18 張棄牌
const LIMITS = {
  own:   { get min() { return tune().own.min; },   get max() { return tune().own.max; },   ratio: RATIO },
  river: { get min() { return tune().river.min; }, get max() { return tune().river.max; }, ratio: RIVER_RATIO },
  opp:   { get min() { return tune().opp.min; },   get max() { return tune().opp.max; },   ratio: RATIO },
};




function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

/* 迭代過程中累計的「再縮一點」量。
   ⚠️ 一定要累計。每次 fitSizes 都從量到的空間重新推算尺寸，
   如果只在當次減 2，下一輪重算又會加回來 —— 迭代會卡在「算出來 -2」
   這個固定點上，永遠縮不下去（實測就是這樣漏了四張牌被壓到）。 */
let _riverShrink = 0;
/* 牌河縮到下限之後還是塞不下時，改去跟**自己的手牌**要空間。
   ⚠️ 沒有這一段的話，手機橫式（844×390）會固定溢出 6px ——
   牌河已經卡在 river.min，再怎麼迭代也縮不動，而手牌完全不受影響。
   小螢幕上手牌本來就該讓一點，不然四家的河會互相壓到。 */
let _ownShrink = 0;

/* 目前四家裡最多的人用到幾列。開局只有一列，牌就可以畫大一點；
   累積到三列才需要縮到最小。取四家的最大值而不是各自算 ——
   四家的河尺寸不一致會很難讀。                                   */
function riverRowsInUse(hand) {
  if (!hand) return RIVER_MAX_ROWS;
  let rows = 1;
  for (let i = 0; i < SEATS; i++) {
    const n = S.visibleDiscards(hand, i).length;
    rows = Math.max(rows, Math.ceil(n / RIVER_PER_ROW) || 1);
  }
  return Math.min(RIVER_MAX_ROWS, rows);
}

function fitSizes(dom, hand) {
  const mid = dom.mid;
  if (!mid) return false;
  const before = SIZE.own.w + ',' + SIZE.river.h;
  const shrinkBefore = _ownShrink + '/' + _riverShrink;

  // 自己的手牌：受寬度（14 張要排得下）與高度（不能吃掉整個牌桌）雙重限制
  const ownByWidth = Math.floor((mid.clientWidth - 8) / 14) - 2;
  const ownByHeight = Math.floor(mid.clientHeight * tune().own.maxHeightPct / LIMITS.own.ratio);
  const ownW = clamp(Math.min(ownByWidth, ownByHeight) - _ownShrink,
                     LIMITS.own.min, LIMITS.own.max);
  SIZE.own.w = ownW;
  SIZE.own.h = Math.round(ownW * LIMITS.own.ratio);
  SIZE.ownMeld.w = Math.round(ownW * tune().own.meldOfHand);
  SIZE.ownMeld.h = Math.round(SIZE.ownMeld.w * LIMITS.own.ratio);

  // 牌河：照**實際用到的列數**算，不是照上限三列算 ——
  // 開局只有一列的時候把整個高度預算塞給那一列，牌就看得清楚；
  // 打到三列才縮到最小。
  const rows = riverRowsInUse(hand);

  // 高度：中央區扣掉對家區、自己區與中央資訊牌，平分給上下各 rows 列
  const topH = dom.zones.top.wrap ? dom.zones.top.wrap.offsetHeight : 0;
  const botH = dom.zones.bottom.wrap ? dom.zones.bottom.wrap.offsetHeight : 0;
  // 中央留給動畫的方形空間 —— 場況資訊已經移到上方資訊列，
  // 這裡量的是那塊**刻意空著**的舞台，牌河不能吃掉它
  const infoH = dom.centerStage ? dom.centerStage.offsetHeight : 82;
  const hAvail = mid.clientHeight - topH - botH - infoH - 22;
  const rvByHeight = Math.floor(hAvail / (rows * 2)) - 1;

  // 寬度：左右兩家各 rows 欄，加上中央資訊牌要塞得進中央區
  const infoW = dom.centerStage ? dom.centerStage.offsetWidth : 150;
  const wLeft = mid.clientWidth - infoW - 24;
  const rvByWidth = Math.floor(wLeft / (rows * 2) * LIMITS.river.ratio);

  let riverH = clamp(Math.min(rvByHeight, rvByWidth),
                     LIMITS.river.min, LIMITS.river.max);

  // 保險：算式是照「量到的區塊高度」推的，字體行高、邊框、gap 都會讓它差一兩像素。
  // 中央區真的塞不下時（scrollHeight 超過 clientHeight）就再降一級，
  // 由外層的迭代重跑。沒有這一道，三列牌河會壓到對家與自己的手牌。
  /* 自己的手牌那一排太寬 —— 橫向溢出。
     ⚠️ ownByWidth 用的是「(寬 − 8) / 14 − 2」這種粗估，
     但牌與牌的間隔現在是可調的（layout 的 gap.hand），
     摸切那張的額外間隔也完全沒算進去。四家牌河全滿又沒人副露時，
     實測 #mid 可用 1223px、實際要 1269px，橫向擠出去 46px。

     與其去湊公式（間隔一改就又不準），直接把量到的溢出丟進收縮迴路。 */
  const mm = dom.mid;
  if (mm) {
    const wide = mm.scrollWidth - mm.clientWidth;
    if (wide > 1) _ownShrink += Math.max(1, Math.ceil(wide / 14));
  }

  const c = dom.center;
  if (c) {
    // ⚠️ 退的量要照**實際超出多少**算，不能每輪固定退 2px。
    // 固定 2px 的話 iPhone SE 需要退 31px → 要 16 輪才收斂，
    // 迭代上限之內收不完，畫面就停在「還在溢出」的中途狀態。
    /* ⚠️ 量的時候先把主公像拿掉。它是 absolute、尺寸跟著 vmin 走（手機上 148px），
       中央一矮它就「溢出」—— scrollHeight 會把它算進去，於是被當成牌河塞不下，
       牌河縮到底之後就一路縮自己的手牌（2026-09-24 實測 iPhone 橫式：手牌從 47px 被壓到 32px）。
       主公像是氣氛、本來就允許被擋到一部分，#center 的 overflow:hidden 會把多的裁掉，不該拿來擠牌。 */
    const lord = c.querySelector('#center-lord');
    const lordDisp = lord ? lord.style.display : '';
    if (lord) lord.style.display = 'none';
    const deficit = Math.max(c.scrollHeight - c.clientHeight, c.scrollWidth - c.clientWidth);
    if (lord) lord.style.display = lordDisp;
    if (deficit > 1) {
      if (riverH - _riverShrink > LIMITS.river.min) {
        _riverShrink += Math.max(2, Math.ceil(deficit / Math.max(1, rows * 2)));
      } else {
        // 牌河縮到底了 → 換自己的手牌讓。deficit 是高度，換算成牌寬要除長寬比
        _ownShrink += Math.max(1, Math.ceil(deficit / LIMITS.own.ratio));
      }
    }
  }
  riverH = Math.max(LIMITS.river.min, riverH - _riverShrink);

  SIZE.river.h = riverH;
  SIZE.river.w = Math.round(riverH / LIMITS.river.ratio);

  // 別家的牌：原本寫死 18/20，所以螢幕一大就只有別家沒跟著長 ——
  // 而且 oppMeld(20) 比 oppHand(18) 大，看起來像「吃碰的牌比手上的牌大」。
  // 改成跟著自己的手牌等比縮放，再受兩側／上方實際放得下的量限制。
  //
  // 左右兩家的手牌是直的（旋轉 90°），所以一張牌吃掉的是**垂直**空間 w；
  // 上家是橫的，吃掉的是水平空間。兩邊都要留副露的位置，
  // 所以除的是 18 而不是 13（13 張手牌 + 最多約 5 張副露的餘裕）。
  const sideH = dom.zones.left.wrap ? dom.zones.left.wrap.clientHeight : mid.clientHeight;
  const topW  = dom.zones.top.wrap  ? dom.zones.top.wrap.clientWidth  : mid.clientWidth;
  const oppW = clamp(Math.min(Math.round(ownW * tune().opp.ofOwn),
                              Math.floor(sideH / 18),
                              Math.floor(topW / 20)),
                     LIMITS.opp.min, LIMITS.opp.max);
  SIZE.oppHand.w = oppW;
  SIZE.oppHand.h = Math.round(oppW * LIMITS.opp.ratio);
  SIZE.oppMeld.w = Math.max(LIMITS.opp.min - 2, Math.round(oppW * tune().opp.meldOfHand));
  SIZE.oppMeld.h = Math.round(SIZE.oppMeld.w * LIMITS.opp.ratio);

  /* 還要不要再跑一輪。

     ⚠️ 不能只看「尺寸有沒有變」。溢出是在這個函式的**最後**才累加進
     _ownShrink／_riverShrink 的，而那一輪算出來的尺寸還沒反映它 ——
     只看尺寸的話會回 false、外層直接 break，累加的收縮永遠套不上去。
     實測：牌河全滿又沒人副露時，手牌停在 84px、橫向擠出 46px 不動。
     所以只要這一輪動過收縮量，就得再跑一輪。 */
  const changed = before !== (SIZE.own.w + ',' + SIZE.river.h);
  return changed || shrinkBefore !== (_ownShrink + '/' + _riverShrink);
}

/* ── 攤牌 ──────────────────────────────────────────────────
   別家的手牌平常只畫張數。局結束、而且這一家是**贏家**時攤開來 ——
   真實牌桌上胡牌本來就要亮牌給大家看。

   ⚠️ 攤的是 `hand.result` 裡的那一份（flow.js 的 `winnerRecord` 抓的），
   **不是** `hand.seats[seat].hand`。兩者在單機看起來一樣，
   但線上版用戶端手上只有結果裡的那一份 —— 直接讀座位手牌的話，
   單機測起來完全正常，接線之後就變成把別人的手牌送到每一台上。
   這一層刻意不去碰別家的手牌，就是為了不留這個洞。 */
function revealedOf(hand, seat) {
  if (!hand || hand.phase !== 'over') return null;
  const r = hand.result;
  if (!r || !r.winners) return null;
  const w = r.winners.filter(x => x && x.seat === seat)[0];
  if (!w || !w.hand || !w.hand.length) return null;
  return w.hand.map(tileOf);
}

/* result 存的是 display 字串（純 JSON，為了原樣丟上 Firebase）。
   要畫之前轉回牌物件。 */
function tileOf(d) {
  const m = /^(\d)(.)$/.exec(d);
  return m ? { suit: m[2], num: +m[1], display: d, isHonor: false }
           : { suit: d, num: 0, display: d, isHonor: true };
}

/* ── 整個畫面 ──────────────────────────────────────────────
   ui: { mySeat, selected, onTileClick }
   每次都重畫全部 —— 這是電鐵踩過坑換來的作法：
   「每幀重述現況」而不是「送差異指令」，漏一幀會自動修正，
   而指令漏一則就永遠對不回來。四人麻將的畫面小，重畫成本無所謂。 */
function renderAll(dom, match, ui) {
  const hand = match.hand;
  if (!hand) return;
  const mySeat = (ui && ui.mySeat) || 0;

  // 迭代到尺寸穩定為止。手牌與牌河的高度互相牽制 ——
  // 手牌變大，留給牌河的就變少；牌河變小，區塊高度又變了。
  // 一趟算不出來（第一趟量到的高度會被第二趟的新尺寸推翻），
  // 硬推公式又會跟實際的字體行高、邊框對不上，所以量到不動為止。
  // 實測兩趟就收斂，上限抓三趟純粹是防呆。
  _riverShrink = 0;
  _ownShrink = 0;
  for (let i = 0; i < 14; i++) {      // 兩種縮法各自要跑幾輪，上限放寬
    paint(dom, match, ui, mySeat);
    if (!fitSizes(dom, hand)) break;
  }
  paint(dom, match, ui, mySeat);
}

function paint(dom, match, ui, mySeat) {
  const hand = match.hand;

  ['bottom', 'right', 'top', 'left'].forEach(pos => {
    const seat = seatAt(mySeat, pos);
    const z = dom.zones[pos];
    const rot = ROT[pos];

    renderNameplate(z.name, match, hand, seat, mySeat);
    renderRiver(z.river, hand, seat, pos);

    if (pos === 'bottom') {
      renderMelds(z.melds, hand.seats[seat].melds, SIZE.ownMeld);
      const me = hand.seats[seat];
      renderRow(z.hand, me.hand, {
        w: SIZE.own.w, h: SIZE.own.h,
        selected: ui && ui.selected,
        onClick: ui && ui.onTileClick,
        keyLabels: ui && ui.keyLabels,
        gapBeforeLast: me.hand.length === S.baseHandSize(me) + 1,
      });
    } else {
      renderMelds(z.melds, hand.seats[seat].melds,
                  { w: SIZE.oppMeld.w, h: SIZE.oppMeld.h, rotate: rot });
      /* 別家的手牌只畫張數，不畫內容 —— 線上版根本拿不到，
         單機版也刻意不畫，免得日後接線時忘了這裡有洞。
         例外：胡牌的那一家在局末攤牌（見 revealedOf 的說明）。 */
      const shown = revealedOf(hand, seat);
      if (shown) {
        renderRow(z.hand, shown, {
          w: SIZE.oppHand.w, h: SIZE.oppHand.h, rotate: rot, thin: true,
        });
      } else {
        const backs = new Array(hand.seats[seat].hand.length).fill(null);
        renderRow(z.hand, backs, {
          w: SIZE.oppHand.w, h: SIZE.oppHand.h, rotate: rot,
          thin: true, faceDown: true,
        });
      }
    }
  });

  renderCenterInfo(dom.centerInfo, match, hand);
  renderCenterLord(dom.centerLord, match, hand);
  renderSelfInfo(dom.selfInfo, hand, mySeat);
}

return {
  SIZE, POS, ROT, seatAt, fitSizes, riverRowsInUse,
  RIVER_PER_ROW, RIVER_MAX_ROWS, LIMITS,
  renderRow, renderMelds, renderRiver, renderNameplate, renderCenterInfo, renderCenterLord,
  revealedOf,
  renderSelfInfo,
  renderAll, el, clear,
  asGeneral, playFrames, WAR_MS,
};
});
