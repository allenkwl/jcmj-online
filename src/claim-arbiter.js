/* ═══════════════════════════════════════════════════════════════
   claim-arbiter.js — 宣告仲裁（吃碰槓胡的收集與裁決）
   ───────────────────────────────────────────────────────────────
   兩人版等於沒有這一層：只有一個對手，天然沒有衝突，
   `chkInt`（問玩家）與 `oppDecide`（AI 自己決定）是兩條各自獨立的分岔。
   四人版一張棄牌會同時被三家看到，就必須有人來裁決誰先誰後。

   這個模組負責：
     ‧ 這張牌，每一家各自能宣告什麼（含振聽、吃僅限下家、鐵騎護送）
     ‧ 收集三家的意向，逾時自動 pass
     ‧ 優先權裁決：胡 > 槓/碰 > 吃
     ‧ 多家同時胡的處理（三種策略可選）

   刻意不做的事：
     ‧ 實際把副露放進狀態　→ game-state.js 的 applyMeld
     ‧ 什麼時候開窗、關窗後接什麼　→ flow.js（第 4 步）
     ‧ AI 該不該碰的深入評估　→ 第 5 步會重寫 decideClaim

   ── 三個設計約束 ──
   1. 視窗物件必須是純 JSON（要能直接丟進 Firebase）
      座位索引一律用**字串鍵的物件**而不是陣列 —— Firebase 收到稀疏陣列
      會自己轉成物件，用陣列的話本機與線上兩邊形狀會不一致。
   2. 無牌可宣告者不跳窗
      一局約 60 次打牌，每次都讓三家等滿逾時的話，光空轉就多出五分鐘。
      openWindow() 在沒有任何人能宣告時直接回 null。
   3. buildOptions 一次只算一家
      線上版每台只能算自己那家（算別家等於偷看手牌）。
      算全場是發牌那台（driver）的特權，openWindow 的 seats 參數要明確傳。
   ═══════════════════════════════════════════════════════════════ */
(function (root, factory) {
  const api = factory(
    typeof require === 'function' ? require('./rules-core.js') : root.MJRules,
    typeof require === 'function' ? require('./game-state.js') : root.MJState);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MJClaim = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (R, S) {
'use strict';

const SEATS = 4;

/* 預設逾時。延遲預算抓全 pass 最快 0.6 秒、含思考約 2.1 秒（見 PLAN），
   8 秒給的是「人在想」的餘裕，不是網路餘裕。AI 不吃這個值，即答。 */
const DEFAULT_TIMEOUT_MS = 8000;

/* 多家同時胡的策略 —— 這是規則選擇，不是技術問題，三種都留著：
     'head'   頭跳：只有離打牌者最近的那家成立（預設）
     'multi'  多家和：全部成立，各自計分
     'abort3' 兩家和成立，三家和流局
   預設選頭跳的理由：一局只有一個贏家，計分與一場四局的排名都不用改，
   而且玩家不會遇到「我胡了但分被別人分走」這種要解釋的狀況。      */
const DEFAULT_MULTI_RON = 'head';

/* ── 這一家能宣告什麼 ──────────────────────────────────────
   回傳純 JSON。`any` 是給 openWindow 判斷要不要跳窗用的。

   注意 guarded（魏國鐵騎）擋的是吃碰槓，**不擋榮和** —— 技能描述是
   「對手無法吃碰」，舊版 doDiscard 的實作也是先擋鳴牌再單獨判榮和。 */
function buildOptions(hand, seat, opts) {
  const o = opts || {};
  const none = { ron: false, pong: false, kong: false, chi: [], any: false };

  const src = o.kongAdded ? hand.lastKongAdded : hand.lastDiscard;
  if (!src) return none;
  if (src.seat === seat) return none;              // 自己打的牌不能自己鳴

  const me = hand.seats[seat];
  const tile = src.tile;

  // 榮和（含振聽判定）
  const ron = R.canRonWith(me.hand, me.melds, tile, me.discards,
                           { temporary: me.furitenTemp });

  // 搶槓視窗只問榮和 —— 加槓的那張牌不在牌河也不在手裡，碰吃槓都無從談起
  if (o.kongAdded) {
    return { ron, pong: false, kong: false, chi: [], any: ron };
  }

  if (src.guarded) {
    return { ron, pong: false, kong: false, chi: [], any: ron };
  }

  let same = 0;
  me.hand.forEach(t => { if (t.display === tile.display) same++; });

  const pong = same >= 2;
  const kong = same >= 3;
  const chi = R.canChiSeat(src.seat, seat, SEATS)
    ? R.findAllChi(me.hand, tile)
    : [];

  return { ron, pong, kong, chi, any: ron || pong || kong || chi.length > 0 };
}

/* ── 開窗 ──────────────────────────────────────────────────
   seats：要問哪幾家。單機傳 [0,1,2,3]（自己那家會被 buildOptions 濾掉）；
   線上由 driver 傳。沒有人能宣告就回 null —— **這就是不跳窗的那道閘**。 */
function openWindow(hand, opts) {
  const o = opts || {};
  const kongAdded = !!o.kongAdded;
  const src = kongAdded ? hand.lastKongAdded : hand.lastDiscard;
  if (!src) return null;

  /* ── 群主模式（線上版，docs/net-turn-model.md）──
     群主是裁判，**不看任何人的手牌**，所以它不知道誰能宣告 ——
     一律問另外三家，由各家用自己的手牌算、自己回報。

     ⚠️ 所以這個模式下視窗**一定會開**，「無牌可宣告者不跳窗」
     改由各家用戶端負責：自己算出沒東西就秒回 pass、不跳視窗。
     群主等的是「三家都回齊」，不是等一個固定秒數 —— 手慢的人不會錯過。 */
  if (o.announce) {
    return {
      seq: src.seq,
      kind: kongAdded ? 'kong_added' : 'discard',
      from: src.seat,
      tile: src.tile,
      guarded: !kongAdded && !!src.guarded,
      announce: true,
      ask: [0, 1, 2, 3].filter(x => x !== src.seat).map(String),
      eligible: {},                                // 群主不知道，也不該知道
      responses: {},
      openedAt: o.now != null ? o.now : Date.now(),
      timeoutMs: o.timeoutMs != null ? o.timeoutMs : DEFAULT_TIMEOUT_MS,
    };
  }

  const ask = o.seats || [0, 1, 2, 3];
  const eligible = {};
  let anyone = false;

  ask.forEach(seat => {
    const opt = buildOptions(hand, seat, { kongAdded });
    if (!opt.any) return;
    delete opt.any;                                // 視窗裡不需要這個衍生欄位
    eligible[String(seat)] = opt;
    anyone = true;
  });

  if (!anyone) return null;

  return {
    seq: src.seq,                                  // 對齊 lastDiscard/lastKongAdded
    kind: kongAdded ? 'kong_added' : 'discard',
    from: src.seat,
    tile: src.tile,
    guarded: !kongAdded && !!src.guarded,
    eligible,
    responses: {},
    openedAt: o.now != null ? o.now : Date.now(),
    timeoutMs: o.timeoutMs != null ? o.timeoutMs : DEFAULT_TIMEOUT_MS,
  };
}

/* ── 收意向 ────────────────────────────────────────────────
   decision：
     {type:'pass'}
     {type:'ron'}
     {type:'pong'}
     {type:'kong'}
     {type:'chi', nums:[3,4,5]}
   回傳 false 代表這個宣告不合法（沒被問到、或宣告了做不到的事）。
   線上版不能信任別台送來的東西，一律在這裡擋掉。                  */
function respond(win, seat, decision) {
  const key = String(seat);
  if (win.announce) return respondAnnounced(win, key, decision || { type: 'pass' });
  const opt = win.eligible[key];
  if (!opt) return false;                          // 沒被問到的人不能插嘴
  if (win.responses[key]) return false;            // 一家只能回一次

  const d = decision || { type: 'pass' };
  if (d.type === 'pass') { win.responses[key] = { type: 'pass' }; return true; }
  if (d.type === 'ron'  && !opt.ron)  return false;
  if (d.type === 'pong' && !opt.pong) return false;
  if (d.type === 'kong' && !opt.kong) return false;
  if (d.type === 'chi') {
    const nums = d.nums || [];
    const ok = opt.chi.some(c => c.length === nums.length &&
                                 c.every((n, i) => n === nums[i]));
    if (!ok) return false;
    win.responses[key] = { type: 'chi', nums: nums.slice() };
    return true;
  }
  win.responses[key] = { type: d.type };
  return true;
}

/* 群主模式收意向。

   decision 要多帶一個 `couldRon`：**這一家本來能不能胡這張牌**。
   群主看不到手牌，只能聽各家自己講 —— 它決定兩件事：
     ‧ 喊了胡，自己卻說不能胡 → 自相矛盾，擋掉（那是程式 bug，不是作弊）
     ‧ 能胡卻碰了／過了 → 進 declinedRon，吃過水（見 resolve）

   前提：程式是我們自己的，信任各家回報（docs/net-turn-model.md）。
   這裡只擋**用公開資訊就驗得出來**的錯 —— 吃只有下家、護送的牌不能鳴、
   搶槓只能胡。驗不了的（手上到底有沒有那兩張）就信。             */
function respondAnnounced(win, key, d) {
  if (win.ask.indexOf(key) < 0) return false;      // 打牌的人自己不能插嘴
  if (win.responses[key]) return false;            // 一家只能回一次

  const couldRon = !!d.couldRon;
  const onlyRon = win.kind === 'kong_added' || win.guarded;
  const allowed = onlyRon ? ['pass', 'ron'] : ['pass', 'ron', 'pong', 'kong', 'chi'];
  if (allowed.indexOf(d.type) < 0) return false;
  if (d.type === 'ron' && !couldRon) return false;

  if (d.type === 'chi') {
    if (!R.canChiSeat(win.from, Number(key), SEATS)) return false;   // 吃只有下家
    const nums = d.nums || [];
    if (nums.length !== 3) return false;
    win.responses[key] = { type: 'chi', nums: nums.slice(), couldRon };
    return true;
  }
  win.responses[key] = { type: d.type, couldRon };
  return true;
}

/* 這個視窗問了哪幾家（字串鍵）。
   中央模式＝算出有資格的那幾家；群主模式＝打牌者以外的三家。 */
function askedKeys(win) {
  return win.announce ? (win.ask || []) : Object.keys(win.eligible || {});
}
function askedSeats(win) { return askedKeys(win).map(Number); }

/* 還沒回應的座位 */
function pendingSeats(win) {
  return askedKeys(win)
    .filter(k => !win.responses[k])
    .map(Number);
}

function isTimedOut(win, now) {
  return (now != null ? now : Date.now()) - win.openedAt >= win.timeoutMs;
}

/* 全員到齊，或逾時 —— 電鐵年度結算那套「各自寫一格、全員到齊、逾時自動」 */
function isSettled(win, now) {
  return pendingSeats(win).length === 0 || isTimedOut(win, now);
}

/* 逾時的人視同 pass。裁決前呼叫，讓 resolve 看到的是完整的一份。 */
function fillTimeouts(win, hand) {
  /* ⚠️ 群主模式下逾時的人沒有自報 couldRon。**能胡卻逾時也要過水**，
     否則斷線或發呆反而變成一條不會過水的路。
     群主的程式持有完整牌局（docs/net-turn-model.md 第五節），所以由群主代算：
     傳 hand 進來就用 buildOptions 補上。不傳（只有視窗、沒有牌局）就只能當 false。 */
  askedKeys(win).forEach(k => {
    if (win.responses[k]) return;
    if (!win.announce) { win.responses[k] = { type: 'pass', timedOut: true }; return; }
    const couldRon = hand
      ? !!buildOptions(hand, Number(k), { kongAdded: win.kind === 'kong_added' }).ron
      : false;
    win.responses[k] = { type: 'pass', timedOut: true, couldRon };
  });
  return win;
}

/* 離打牌者多遠（1=下家 … 3=上家）。頭跳與碰吃衝突都靠這個排序。 */
function distance(win, seat) {
  return (seat - win.from + SEATS) % SEATS;
}

/* ── 裁決 ──────────────────────────────────────────────────
   優先權：胡 > 槓/碰 > 吃。

   為什麼碰贏吃：碰可以來自任何一家，吃只有下家能吃。
   如果讓吃贏，下家等於握有一票否決權，別家永遠碰不到自己想要的牌。

   為什麼槓與碰之間不需要排序：**同一張牌最多只有一家能碰或槓**。
   一種牌只有 4 張，場上已經打出 1 張，剩 3 張；要兩家都能碰就得 2+2=4 張，
   湊不出來。所以碰／槓的衝突在合法牌況下不存在，下面那段依距離排序
   純粹是防呆（狀態被改壞時不要當掉），不是活的規則邏輯。
   test/claim-arbiter.test.js 有一項把這個不變量測出來。

   回傳：
     {type:'pass'}
     {type:'ron',  seats:[2], declinedRon:[...]}
     {type:'meld', seat:2, claim:{type:'pong'|'kong'|'chi', nums?}, declinedRon:[...]}
     {type:'abort', reason:'sankaho', seats:[...]}
   `declinedRon` 是「本來可以榮和卻沒胡」的人 —— 他們要吃同巡振聽，
   由 applyDeclinedRonFuriten() 落到狀態上。                        */
function resolve(win, opts) {
  const policy = (opts && opts.multiRon) || DEFAULT_MULTI_RON;
  fillTimeouts(win, opts && opts.hand);

  /* couldRon：這一家本來能不能胡。中央模式從 eligible 查；
     群主模式看不到手牌，用各家自己回報的。其餘裁決邏輯兩種模式完全共用 ——
     優先權只看「誰喊了什麼、離打牌者多遠」，本來就不需要看手牌。 */
  const entries = askedKeys(win).map(k => {
    const res = win.responses[k] || { type: 'pass' };
    return {
      seat: Number(k),
      res,
      couldRon: win.announce ? !!res.couldRon : !!(win.eligible[k] && win.eligible[k].ron),
    };
  });

  // 本來可以榮和卻沒宣告的（含**用碰代替胡**）—— 不管最後誰成立，這些人都過水
  const declinedRon = entries
    .filter(e => e.couldRon && e.res.type !== 'ron')
    .map(e => e.seat)
    .sort((a, b) => a - b);

  const rons = entries.filter(e => e.res.type === 'ron')
                      .map(e => e.seat)
                      .sort((a, b) => distance(win, a) - distance(win, b));

  if (rons.length) {
    if (rons.length >= 3 && policy === 'abort3')
      return { type: 'abort', reason: 'sankaho', seats: rons, declinedRon };
    if (policy === 'head')
      return { type: 'ron', seats: [rons[0]], declinedRon };
    return { type: 'ron', seats: rons, declinedRon };
  }

  // 槓/碰：離打牌者近的優先（實務上不會撞，見上面的註解）
  const melds = entries.filter(e => e.res.type === 'kong' || e.res.type === 'pong')
                       .sort((a, b) => distance(win, a.seat) - distance(win, b.seat));
  if (melds.length) {
    const m = melds[0];
    return { type: 'meld', seat: m.seat, claim: { type: m.res.type }, declinedRon };
  }

  const chi = entries.find(e => e.res.type === 'chi');
  if (chi) {
    return {
      type: 'meld', seat: chi.seat,
      claim: { type: 'chi', nums: chi.res.nums.slice() },
      declinedRon,
    };
  }

  return { type: 'pass', declinedRon };
}

/* ── 把裁決結果落到狀態上 ────────────────────────────────── */

/* 同巡振聽：可以榮和卻放過的人，在摸到下一張牌之前不能胡。
   沒有這一條的話，玩家可以放過一張再等下一家打同一張 —— 白吃的。 */
function applyDeclinedRonFuriten(hand, outcome) {
  (outcome.declinedRon || []).forEach(seat => S.setTemporaryFuriten(hand, seat, true));
  return hand;
}

/* 把裁決的副露換算成 game-state.applyMeld 要的牌陣列。
   吃拿到的是數字組合（[3,4,5]），要翻回手上那兩張實牌。          */
function meldTilesFor(hand, outcome) {
  if (outcome.type !== 'meld') return null;
  const seat = outcome.seat;
  const me = hand.seats[seat];
  const src = hand.lastDiscard;
  if (!src) return null;
  const tile = src.tile;

  if (outcome.claim.type === 'chi') {
    // nums 是三個相異的數字（例如 [3,4,5]），其中剛好一個是別人打的那張，
    // 另外兩個要從自己手上挑出實牌。
    const tiles = [tile];
    const used = new Set([tile.uid]);
    outcome.claim.nums.forEach(n => {
      if (n === tile.num) return;
      const t = me.hand.find(x =>
        x.suit === tile.suit && x.num === n && !used.has(x.uid));
      if (t) { used.add(t.uid); tiles.push(t); }
    });
    tiles.sort((a, b) => a.num - b.num);
    return tiles;
  }

  const need = outcome.claim.type === 'kong' ? 3 : 2;
  const tiles = [tile];
  for (const t of me.hand) {
    if (tiles.length - 1 >= need) break;
    if (t.display === tile.display) tiles.push(t);
  }
  return tiles;
}

/* game-state 的副露型別名稱與宣告名稱不同，這裡轉一次 */
function meldTypeFor(claimType) {
  if (claimType === 'kong') return 'kong_light';
  return claimType;                                // 'pong' | 'chi'
}

/* ── AI 的宣告決策 ────────────────────────────────────────
   從舊版的 oppDecide / aiShouldPong / aiShouldChi 搬過來並參數化 ——
   舊版三個函式全部直接讀全域 `G.oH` `G.oM`，三家 AI 會共用同一副手牌。

   分級沿用舊版：
     1 初學　不吃不碰（但有胡就胡）
     2 普通　只在向聽數真的改善時才鳴
     3 高手　積極碰槓

   ⚠️ 第 5 步（AI 改造）會重寫這裡的評估，現在先求行為與舊版一致。 */
function decideClaim(hand, seat, options, level) {
  const opt = options || buildOptions(hand, seat);
  if (opt.ron) return { type: 'ron' };              // 有得胡一定胡，三級都一樣
  if (!opt.pong && !opt.kong && !opt.chi.length) return { type: 'pass' };

  const lv = level || 2;
  if (lv <= 1) return { type: 'pass' };

  const me = hand.seats[seat];
  const disp = me.hand.map(t => t.display);
  const mc = me.melds.length;
  const cur = R.shantenNum(disp, mc);
  const tile = hand.lastDiscard.tile;

  if (lv >= 3) {
    if (opt.kong) return { type: 'kong' };
    if (opt.pong) return { type: 'pong' };
    if (opt.chi.length) return { type: 'chi', nums: opt.chi[0] };
    return { type: 'pass' };
  }

  // 普通：模擬鳴牌後的向聽數，真的變好才鳴
  if (opt.kong || opt.pong) {
    const take = opt.kong ? 3 : 2;
    let removed = 0;
    const after = me.hand.filter(t => {
      if (t.display === tile.display && removed < take) { removed++; return false; }
      return true;
    }).map(t => t.display);
    if (R.shantenNum(after, mc + 1) < cur)
      return { type: opt.kong ? 'kong' : 'pong' };
  }

  // 已經聽牌就不吃 —— 吃下去會把聽口拆掉
  if (opt.chi.length && cur > 0) {
    for (const nums of opt.chi) {
      // 吃掉的是 nums 裡除了別人打的那張以外的兩個數字，各拿一張
      const need = nums.filter(n => n !== tile.num);
      const after = [];
      me.hand.forEach(t => {
        const i = (t.suit === tile.suit) ? need.indexOf(t.num) : -1;
        if (i >= 0) { need.splice(i, 1); return; }
        after.push(t.display);
      });
      if (R.shantenNum(after, mc + 1) < cur) return { type: 'chi', nums };
    }
  }

  return { type: 'pass' };
}

/* 把一個視窗裡所有 AI 座位的意向一次填完。
   isAI 由呼叫端提供（match.seats[i].isAI），這個模組不認識 match。

   decide 可以換掉 —— 第 5 步的 `ai.js` 有完整版（會看威脅度決定要不要鳴）。
   不傳就用本檔的 decideClaim，行為與舊版兩人局一致。                */
function autoRespondAI(hand, win, seatInfo, decide) {
  askedKeys(win).forEach(k => {
    const seat = Number(k);
    const info = (seatInfo && seatInfo[seat]) || {};
    if (!info.isAI) return;
    if (win.responses[k]) return;
    /* 群主模式：AI 座位由群主代跑，跟真人用戶端走**同一套**「自己算、自己報」——
       用 selfResponse，不要在這裡另寫一份。 */
    if (win.announce) {
      respond(win, seat, selfResponse(hand, seat, win, (h, s, opt) => decide
        ? decide(h, s, opt, info.aiLevel)
        : decideClaim(h, s, opt, info.aiLevel)));
      return;
    }
    const d = decide
      ? decide(hand, seat, win.eligible[k], info.aiLevel)
      : decideClaim(hand, seat, win.eligible[k], info.aiLevel);
    respond(win, seat, d);
  });
  return win;
}

/* ── 用戶端：用自己的手牌回覆一個群主模式的視窗 ──
   **這是線上版每一台要跑的東西。** 只讀 hand.seats[seat] 與公開資訊
   （lastDiscard／lastKongAdded），別家的手牌一張都不碰 ——
   test/net-turn.test.js 會把別家手牌換成一碰就炸的假牌來驗這件事。

   choose(hand, seat, opt) → decision：真人就是跳視窗等他按，AI 就是 decideClaim。
   沒東西可宣告時**不呼叫 choose**、直接回 pass —— 這就是「不跳窗」。     */
function selfResponse(hand, seat, win, choose) {
  const opt = buildOptions(hand, seat, { kongAdded: win.kind === 'kong_added' });
  if (!opt.any) return { type: 'pass', couldRon: false };
  const d = choose(hand, seat, opt) || { type: 'pass' };
  return Object.assign({}, d, { couldRon: !!opt.ron });
}

/* ── Firebase 往返修復 ──────────────────────────────────── */
/* Firebase 看到鍵全是數字（"1"、"2"、"3"）的物件，會存成**陣列**，
   沒有的鍵變成 null 洞：{ "2": {...} } 讀回來是 [null, null, {...}]。
   直接拿去 Object.keys 會掃到那些 null（2026-09-24 連線實測：用戶端一收到宣告視窗就炸）。
   轉回以座位為鍵的物件、丟掉 null。 */
function seatMap(x) {
  const out = {};
  if (!x || typeof x !== 'object') return out;
  Object.keys(x).forEach(k => { if (x[k] != null) out[k] = x[k]; });
  return out;
}

function normalizeWindow(win) {
  if (!win) return win;
  win.eligible = seatMap(win.eligible);
  win.responses = seatMap(win.responses);
  Object.keys(win.eligible).forEach(k => {
    const e = win.eligible[k];
    e.chi = e.chi || [];
    e.ron = !!e.ron; e.pong = !!e.pong; e.kong = !!e.kong;
  });
  if (win.guarded == null) win.guarded = false;
  // 群主模式：Firebase 會把空物件整個吃掉，responses 裡的 false 也可能不見
  if (win.announce) {
    win.ask = (win.ask || []).map(String);
    Object.keys(win.responses).forEach(k => {
      win.responses[k].couldRon = !!win.responses[k].couldRon;
    });
  }
  return win;
}

return {
  DEFAULT_TIMEOUT_MS, DEFAULT_MULTI_RON,
  buildOptions, openWindow,
  respond, pendingSeats, askedSeats, isTimedOut, isSettled, fillTimeouts,
  selfResponse,
  resolve,
  applyDeclinedRonFuriten, meldTilesFor, meldTypeFor,
  decideClaim, autoRespondAI,
  normalizeWindow,
};
});
