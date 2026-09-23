/* ═══════════════════════════════════════════════════════════════
   flow.js — 一局的流程狀態機
   ───────────────────────────────────────────────────────────────
   取代舊版用 59 個 setTimeout 串起來的呼叫鏈：
     pDraw → doDiscard → oppDecide → oppTurn → chkInt → passInt → …

   PLAN 說這一步是「能不能接上網路的分水嶺」，原因很具體：
   setTimeout 鏈把「接下來該發生什麼」這件事藏在**呼叫堆疊**裡。
   堆疊不能序列化、不能傳給別台、斷線重連之後接不回來。
   改成狀態機之後，「接下來該發生什麼」完全由 `hand.phase` + `hand.turn`
   + `hand.claim` 三個 JSON 欄位決定 —— 任何一台讀到同一份狀態，
   算出來的下一步都一樣。

   ── 四個硬性約束 ──
   1. **這個模組裡沒有 setTimeout，一個都沒有。**
      演出節奏是畫面層的事。流程只管「現在該誰做什麼」，
      不管「等 750 毫秒再做」。混在一起就是舊版卡住的原因。
   2. 外部輸入只有一道門：`submit()`。
      人類點按鈕、AI 決策、網路上別台送來的動作，走的是同一道門、
      同一套合法性檢查。線上版不能信任別台，這一點不能有例外。
   3. `run()` 一路推進到「需要外部輸入」或「這局結束」為止。
      線上版由 driver（發牌那台）跑 run()，其他台只重放 events。
   4. AI 不住在這裡。`ctx.chooseDiscard` 是個掛載點，
      第 5 步會把真正的 AI 接上來。

   ── events 是畫面層與網路層的契約 ──
   每一次狀態轉移都吐出 events，形狀對齊電鐵的 cmds 演出指令。
   畫面層拿 events 放動畫，網路層拿 events 廣播。
   狀態本身每幀重述現況（電鐵踩過的坑：送開關指令漏一則就永遠卡住）。
   ═══════════════════════════════════════════════════════════════ */
(function (root, factory) {
  const api = factory(
    typeof require === 'function' ? require('./rules-core.js')    : root.MJRules,
    typeof require === 'function' ? require('./game-state.js')    : root.MJState,
    typeof require === 'function' ? require('./claim-arbiter.js') : root.MJClaim,
    typeof require === 'function' ? require('./scoring.js')       : root.MJScore);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MJFlow = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (R, S, C, SC) {
'use strict';

const SEATS = 4;
const MAX_STEPS = 2000;          // 防跑飛：一局最多 70 摸 + 鳴牌，2000 綽綽有餘

/* ── 這一家輪到自己時能做什麼 ──────────────────────────────
   槓要能補嶺上牌才算數 —— 王牌抽完或活牌山見底就不能槓，
   否則會槓出一個補不到牌的局面。                                */
function turnOptions(hand, seat) {
  const me = hand.seats[seat];
  const canTsumo = R.canWinInHand(me.hand, me.melds);

  const kongs = [];
  const canKongAtAll = hand.rinshanTaken < 4 && !S.isWallEmpty(hand);
  if (canKongAtAll) {
    const cnt = {};
    me.hand.forEach(t => { cnt[t.display] = (cnt[t.display] || 0) + 1; });
    Object.keys(cnt).forEach(d => {
      if (cnt[d] === 4) kongs.push({ kind: 'dark', display: d });
    });
    me.melds.forEach(m => {
      if (m.type !== 'pong') return;
      const d = m.tiles[0].display;
      if (cnt[d] >= 1) kongs.push({ kind: 'added', display: d });
    });
  }

  return { canTsumo, kongs, canDiscard: true };
}

/* ── 現在卡在等什麼 ────────────────────────────────────────
   回 null 代表流程可以自己往前走，不需要任何人輸入。            */
function waiting(match, ctx) {
  const o = withSubs(match, ctx || {});
  if (match.finished) return { kind: 'matchOver' };
  const h = match.hand;
  if (!h) return { kind: 'handPending' };
  if (h.phase === 'over') return { kind: 'handOver', result: h.result };

  if (h.phase === 'claim') {
    const win = h.claim;
    if (!win) return null;                       // 沒開窗就不是在等宣告
    const now = o.now != null ? o.now : Date.now();
    if (C.isSettled(win, now)) return null;
    return { kind: 'claim', window: win, seats: C.pendingSeats(win) };
  }

  if (h.phase === 'discard') {
    const seat = h.turn;
    if (isAI(o, seat)) return null;              // AI 由 run() 直接決定
    return { kind: 'turn', seat, options: turnOptions(h, seat) };
  }

  return null;                                   // 'draw' 一律自動
}

/* ── 斷線代打 ──────────────────────────────────────────────
   規則（2026-09-23 定案）：有人斷線，在電腦接手前回來沒事；
   **一旦電腦替他出過手，這一場的戰果就不記給他** —— 統一天下要靠自己。

   代打中的座位記在 match.seats[i].sub（不是 ctx.seatInfo）：
   牌局狀態會同步給所有人、換群主也跟著走；seatInfo 只活在群主的記憶體裡。
   所以每次 run／waiting 進來都把 sub 座位疊成 AI。                   */
function withSubs(match, o) {
  const seats = (match && match.seats) || [];
  if (!seats.some(st => st && st.sub)) return o;
  const base = o.seatInfo || {};
  const info = Object.assign({}, base);
  seats.forEach((st, i) => {
    if (!st || !st.sub) return;
    info[i] = Object.assign({}, base[i], {
      isAI: true,
      aiLevel: (base[i] && base[i].aiLevel) || st.aiLevel || 2,
    });
  });
  return Object.assign({}, o, { seatInfo: info });
}

/* 電腦真的替這一家出手了 → 這一場不算他的。
   ⚠️ 記在「真的出手」而不是「開始代打」的那一刻：
   人斷線、武將接手，但還沒輪到他就回來了 —— 電腦一步都沒動，那不該算代打。 */
function markSubbed(match, seat) {
  const st = match.seats && match.seats[seat];
  if (st && st.sub && !st.subbed) st.subbed = true;
}

/* 群主呼叫：這一家斷線，由某武將接手。回傳要廣播的事件。 */
function startSub(match, seat, info) {
  const st = match.seats && match.seats[seat];
  if (!st || st.sub) return [];
  const o = info || {};
  st.sub = { general: o.general || '武將', since: o.now != null ? o.now : Date.now() };
  return [{ t: 'subStart', seat, general: st.sub.general }];
}

/* 群主呼叫：這一家回來了。subbed 不清 —— 回來可以繼續打完，但這一場已經不算了。 */
function endSub(match, seat) {
  const st = match.seats && match.seats[seat];
  if (!st || !st.sub) return [];
  const general = st.sub.general;
  st.sub = null;
  return [{ t: 'subEnd', seat, general, subbed: !!st.subbed }];
}

function isAI(ctx, seat) {
  const info = (ctx.seatInfo && ctx.seatInfo[seat]) || {};
  return !!info.isAI;
}
function aiLevelOf(ctx, seat) {
  const info = (ctx.seatInfo && ctx.seatInfo[seat]) || {};
  return info.aiLevel || 2;
}
function kingdomOf(ctx, seat) {
  const info = (ctx.seatInfo && ctx.seatInfo[seat]) || {};
  return info.kingdom || null;
}

/* ── 預設的 AI 棄牌：向聽數貪心 ──────────────────────────
   只看「打掉哪張之後向聽數最小」，同分時偏好打字牌與么九。
   **完全不看別家的手牌** —— 舊版的 aiD 直接 canRon(G.pH,…) 偷看玩家手牌，
   那是第 5 步要拿掉的東西，這裡從一開始就不給它這個能力。
   防守（現物／筋／副露推測）是第 5 步的工作，這裡只有進攻。     */
function defaultChooseDiscard(hand, seat /* , level */) {
  const me = hand.seats[seat];
  const mc = me.melds.length;
  let best = 0, bestSh = Infinity, bestTie = -Infinity;

  for (let i = 0; i < me.hand.length; i++) {
    const rest = [];
    for (let j = 0; j < me.hand.length; j++) if (j !== i) rest.push(me.hand[j].display);
    const sh = R.shantenNum(rest, mc);
    // 同向聽時的偏好：字牌 > 么九 > 中張（越大越先打）
    const t = me.hand[i];
    const tie = t.isHonor ? 2 : (t.num === 1 || t.num === 9) ? 1 : 0;
    if (sh < bestSh || (sh === bestSh && tie > bestTie)) {
      best = i; bestSh = sh; bestTie = tie;
    }
  }
  return best;
}

/* ── events ────────────────────────────────────────────────── */
function ev(list, t, data) { list.push(Object.assign({ t }, data)); return list; }

/* ── 一局結束 ──────────────────────────────────────────────
   計分與點數移轉全部交給 scoring.js —— 這一層只負責「什麼時候結算」。 */
function finishHand(match, events, result, ctx) {
  const h = match.hand;
  h.phase = 'over';
  h.claim = null;

  const opt = { seatInfo: ctx.seatInfo || {} };
  const settled = result.type === 'draw'
    ? SC.settleDraw(match, h, result.tenpai, opt)
    : SC.settleWin(match, h, result, opt);

  result.transfers = settled.transfers;
  result.details = settled.details;
  result.net = SC.applyTransfers(match, settled.transfers);
  h.result = result;

  ev(events, 'handEnd', { handNo: h.handNo, result });
  return events;
}

function winnerRecord(hand, seat, ctx) {
  const me = hand.seats[seat];
  const info = ((ctx || {}).seatInfo || {})[seat] || {};
  const v = SC.handValue(hand, seat, {
    kingdom: info.kingdom, conquered: info.conquered, bet: info.bet,
  });
  return {
    seat,
    special: v.special,
    score: v.total,
    value: v,
    hand: me.hand.map(t => t.display),
    melds: me.melds.map(m => m.type),
  };
}

/* ── 流局 ──────────────────────────────────────────────────
   舊版是「雙方合計摸滿 60 次」的計數器，新版是真實牌山摸完。
   聽牌者的罰符留給第 7 步。                                      */
function exhaustiveDraw(match, events, ctx, reason) {
  const h = match.hand;
  const tenpai = [];
  for (let i = 0; i < SEATS; i++) {
    const s = h.seats[i];
    if (R.isTenpaiHand(s.hand, s.melds)) tenpai.push(i);
  }
  ev(events, 'drawGame', { reason: reason || 'wallEmpty', tenpai });
  return finishHand(match, events, {
    type: 'draw', reason: reason || 'wallEmpty', tenpai, winners: [],
  }, ctx);
}

/* ── 摸牌 ──────────────────────────────────────────────────── */
function doDraw(match, events, ctx) {
  const h = match.hand;
  const seat = h.turn;

  if (h.rinshanPending) {
    const tile = S.drawRinshan(h, seat);
    h.rinshanPending = false;
    if (!tile) return exhaustiveDraw(match, events, ctx, 'noRinshan');
    ev(events, 'rinshan', { seat, tile });
  } else {
    if (S.isWallEmpty(h)) return exhaustiveDraw(match, events, ctx);
    const tile = S.drawTile(h, seat);
    if (!tile) return exhaustiveDraw(match, events, ctx);
    ev(events, 'draw', { seat, tile });
  }

  h.phase = 'discard';
  return events;
}

/* ── 自摸 ──────────────────────────────────────────────────── */
function doTsumo(match, events, ctx, seat) {
  ev(events, 'win', { kind: 'tsumo', seats: [seat] });
  return finishHand(match, events, {
    type: 'tsumo', from: null,
    winners: [winnerRecord(match.hand, seat, ctx)],
  }, ctx);
}

/* ── 自己的槓（暗槓／加槓）────────────────────────────────── */
function doSelfKong(match, events, ctx, seat, kind, display) {
  const h = match.hand;
  const me = h.seats[seat];

  if (kind === 'dark') {
    const tiles = me.hand.filter(t => t.display === display).slice(0, 4);
    if (tiles.length < 4) return null;
    S.applyMeld(h, seat, 'kong_dark', tiles, null);
    ev(events, 'meld', { seat, type: 'kong_dark', display });
  } else {
    const t4 = me.hand.find(t => t.display === display);
    if (!t4) return null;
    S.applyMeld(h, seat, 'kong_added', [t4], null);
    ev(events, 'meld', { seat, type: 'kong_added', display });

    // 加槓要先過搶槓視窗，才能去補嶺上牌
    const win = C.openWindow(h, {
      kongAdded: true,
      now: ctx.now != null ? ctx.now : Date.now(),
      timeoutMs: ctx.claimTimeoutMs,
      announce: !!ctx.announce,
    });
    if (win) {
      h.claim = win;
      h.phase = 'claim';
      ev(events, 'claimOpen', { seq: win.seq, kind: 'kong_added', seats: C.askedSeats(win) });
      return events;
    }
  }

  h.rinshanPending = true;
  h.phase = 'draw';
  return events;
}

/* ── 棄牌 ──────────────────────────────────────────────────── */
function doDiscard(match, events, ctx, seat, tileIndex, opts) {
  const h = match.hand;
  const tile = S.discardTile(h, seat, tileIndex, opts);
  if (!tile) return null;
  ev(events, 'discard', { seat, tile, guarded: !!(opts && opts.guarded) });

  const win = C.openWindow(h, {
    now: ctx.now != null ? ctx.now : Date.now(),
    timeoutMs: ctx.claimTimeoutMs,
    announce: !!ctx.announce,        // 線上群主模式：一律問三家（docs/net-turn-model.md）
  });

  if (!win) {
    // 無牌可宣告者不跳窗 —— 直接輪下一家，這是省下五分鐘空轉的那道閘
    h.claim = null;
    h.turn = S.nextSeat(seat);
    h.phase = 'draw';
    return events;
  }

  h.claim = win;
  h.phase = 'claim';
  ev(events, 'claimOpen', { seq: win.seq, kind: 'discard', seats: C.askedSeats(win) });
  return events;
}

/* ── 關窗裁決 ──────────────────────────────────────────────── */
function settleClaim(match, events, ctx) {
  const h = match.hand;
  const win = h.claim;
  const outcome = C.resolve(win, { multiRon: ctx.multiRon, hand: h });   // hand：逾時者的過水由群主代算
  C.applyDeclinedRonFuriten(h, outcome);
  ev(events, 'claimResolved', { seq: win.seq, outcome });

  const from = win.from;
  const wasKongAdded = win.kind === 'kong_added';
  h.claim = null;

  if (outcome.type === 'abort') {
    return finishHand(match, events, {
      type: 'draw', reason: outcome.reason, seats: outcome.seats, winners: [],
    }, ctx);
  }

  if (outcome.type === 'ron') {
    const tile = win.tile;

    if (wasKongAdded) {
      // 搶槓成立 → 那個槓不算數，加上去的第 4 張退回來給胡牌者。
      // 不還原的話那張牌會同時記在槓裡與贏家手上，牌數就對不起來了。
      const pong = h.seats[from].melds.find(
        mm => mm.type === 'kong_added' && mm.tiles[0].display === tile.display);
      if (pong) {
        const i = pong.tiles.findIndex(x => x.uid === tile.uid);
        if (i >= 0) pong.tiles.splice(i, 1);
        pong.type = 'pong';
      }
      h.lastKongAdded = null;
    } else {
      // 這張牌離開牌河進到贏家手上 —— 標記起來，畫面才不會重複畫，
      // 牌數守恆才算得對。振聽仍然認得它（見 game-state 的 claimedBy）。
      const d = h.seats[from].discards;
      const i = d.findIndex(x => x.uid === tile.uid);
      if (i >= 0) d[i] = Object.assign({}, d[i], { claimedBy: outcome.seats[0] });
    }

    // 多家和（multiRon:'multi'）時同一張牌會進到好幾家手上 —— 實體上不可能，
    // 但計分需要每家都湊滿 14 張。預設的頭跳只有一家，不會碰到這件事。
    outcome.seats.forEach(seat => h.seats[seat].hand.push(tile));
    ev(events, 'win', { kind: wasKongAdded ? 'chankan' : 'ron', seats: outcome.seats, from });
    return finishHand(match, events, {
      type: 'ron', from, chankan: wasKongAdded,
      winners: outcome.seats.map(seat => winnerRecord(h, seat, ctx)),
    }, ctx);
  }

  if (outcome.type === 'meld') {
    const tiles = C.meldTilesFor(h, outcome);
    const type = C.meldTypeFor(outcome.claim.type);
    S.applyMeld(h, outcome.seat, type, tiles, from);
    ev(events, 'meld', { seat: outcome.seat, type, tiles });
    if (type === 'kong_light') h.rinshanPending = true;   // applyMeld 已把 phase 設成 draw
    return events;
  }

  // 全部 pass
  if (wasKongAdded) {
    // 沒人搶槓 → 回去補嶺上牌
    h.lastKongAdded = null;
    h.turn = from;
    h.rinshanPending = true;
    h.phase = 'draw';
    return events;
  }
  h.turn = S.nextSeat(from);
  h.phase = 'draw';
  return events;
}

/* ── AI 的回合決策 ────────────────────────────────────────
   自摸一定胡；暗槓／加槓在初學以外都會開（舊版註解寫 too obvious to miss）；
   其餘交給 ctx.chooseDiscard。                                   */
function aiTakeTurn(match, events, ctx, seat) {
  markSubbed(match, seat);
  const h = match.hand;
  const opt = turnOptions(h, seat);
  if (opt.canTsumo) return doTsumo(match, events, ctx, seat);

  if (opt.kongs.length && aiLevelOf(ctx, seat) > 1) {
    const k = opt.kongs[0];
    const r = doSelfKong(match, events, ctx, seat, k.kind, k.display);
    if (r) return r;
  }

  // 難度傳給棄牌函式 —— ai.js 要靠它決定用哪些防守資訊
  const pick = (ctx.chooseDiscard || defaultChooseDiscard)(h, seat, aiLevelOf(ctx, seat));
  const idx = (pick >= 0 && pick < h.seats[seat].hand.length) ? pick : 0;
  return doDiscard(match, events, ctx, seat, idx);
}

/* ── 推進 ──────────────────────────────────────────────────
   一路走到「需要外部輸入」或「這局結束」為止。
   線上版由 driver 跑這個迴圈，其他台只重放回傳的 events。        */
function run(match, ctx) {
  const o = withSubs(match, ctx || {});
  applyHandLimit(match, o);
  const events = [];
  let steps = 0;

  /* 演出用的煞車。`run()` 預設會一路跑到需要外部輸入為止 ——
     對線上版的 driver 是對的，但單機演出時三家 AI 會在同一個 tick
     全部打完，畫面上三張牌同時冒出來。

     `ctx.pauseAfter` 給一組 event 型別，吐出其中任何一種就先回去，
     讓呼叫端隔一段時間再叫下一次。

     ⚠️ 這**不是**計時器 —— 這裡仍然一個 setTimeout 都沒有。
     停多久是畫面層的事，這一層只提供「停在哪裡」。            */
  const brake = o.pauseAfter;
  const shouldPause = () => {
    if (!brake || !brake.length) return false;
    for (let i = 0; i < events.length; i++) {
      if (brake.indexOf(events[i].t) >= 0) return true;
    }
    return false;
  };

  while (steps++ < (o.maxSteps || MAX_STEPS)) {
    if (match.finished) return { events, waiting: { kind: 'matchOver' } };
    const h = match.hand;
    if (!h) return { events, waiting: { kind: 'handPending' } };

    if (h.phase === 'over') {
      if (o.autoNextHand === false)
        return { events, waiting: { kind: 'handOver', result: h.result } };

      // 連莊判定要在開下一局之前做完 —— 它決定下一局誰坐莊、本場數多少，
      // 以及這一場是不是已經打完了
      const nd = SC.nextDealer(match, h, h.result,
        { renchan: o.renchan, maxHands: o.maxHands });
      match.honba = nd.honba;
      match.dealerRotations = nd.rotations;
      if (nd.dealerKeeps) ev(events, 'renchan', { dealer: nd.dealer, honba: nd.honba });

      if (nd.matchOver) {
        match.finished = true;
        ev(events, 'matchEnd', { standings: SC.standings(match) });
        return { events, waiting: { kind: 'matchOver' } };
      }

      S.startHand(match, Object.assign({}, handOpts(ctx), { dealer: nd.dealer }));
      if (match.finished) {
        ev(events, 'matchEnd', { standings: SC.standings(match) });
        return { events, waiting: { kind: 'matchOver' } };
      }
      initHandFields(match.hand);
      ev(events, 'handStart', {
        handNo: match.hand.handNo, dealer: match.hand.dealer, honba: match.hand.honba,
      });
      continue;
    }

    if (h.phase === 'draw') {
      doDraw(match, events, o);
      if (shouldPause()) return { events, waiting: waiting(match, o) };
      continue;
    }

    if (h.phase === 'discard') {
      const seat = h.turn;
      if (!isAI(o, seat))
        return { events, waiting: { kind: 'turn', seat, options: turnOptions(h, seat) } };
      aiTakeTurn(match, events, o, seat);
      if (shouldPause()) return { events, waiting: waiting(match, o) };
      continue;
    }

    if (h.phase === 'claim') {
      const win = h.claim;
      if (!win) { h.phase = 'draw'; continue; }
      // 代打座位真的有東西可鳴 → 電腦替他做了決定（光是秒回 pass 不算）
      C.pendingSeats(win).forEach(seat => {
        if (match.seats[seat] && match.seats[seat].sub &&
            C.buildOptions(h, seat, { kongAdded: win.kind === 'kong_added' }).any)
          markSubbed(match, seat);
      });
      C.autoRespondAI(h, win, o.seatInfo || {}, o.decideClaim);
      const now = o.now != null ? o.now : Date.now();
      if (!C.isSettled(win, now))
        return { events, waiting: { kind: 'claim', window: win, seats: C.pendingSeats(win) } };
      settleClaim(match, events, o);
      if (shouldPause()) return { events, waiting: waiting(match, o) };
      continue;
    }

    return { events, waiting: null };            // 不認識的 phase，停下來比亂猜好
  }

  throw new Error('flow.run 超過步數上限 —— 狀態機可能有環');
}

/* ── 外部輸入 ──────────────────────────────────────────────
   人類點按鈕、網路上別台送來的動作，都走這裡。
   回傳 {ok, reason?, events, waiting}。ok=false 代表這個動作不合法，
   狀態完全沒有被改動 —— 線上版不能信任別台，所以一律先檢查。    */
function submit(match, action, ctx) {
  const o = ctx || {};
  const h = match.hand;
  const a = action || {};
  const reject = reason => ({ ok: false, reason, events: [], waiting: waiting(match, o) });

  if (!h) return reject('沒有進行中的牌局');

  if (a.type === 'claim') {
    if (h.phase !== 'claim' || !h.claim) return reject('現在沒有開著的宣告視窗');
    if (a.seq != null && a.seq !== h.claim.seq) return reject('宣告視窗已經換過一輪了');
    if (!C.respond(h.claim, a.seat, a.decision)) return reject('這個宣告不合法');
  } else {
    if (h.phase !== 'discard') return reject('現在不是打牌階段');
    if (a.seat !== h.turn) return reject('還沒輪到這一家');

    if (a.type === 'tsumo') {
      const opt = turnOptions(h, a.seat);
      if (!opt.canTsumo) return reject('這手牌不能自摸');
      const events = doTsumo(match, [], o, a.seat);
      return finish(match, events, o);
    }
    if (a.type === 'kong') {
      const opt = turnOptions(h, a.seat);
      const hit = opt.kongs.find(k => k.kind === a.kind && k.display === a.display);
      if (!hit) return reject('這個槓不成立');
      const events = doSelfKong(match, [], o, a.seat, a.kind, a.display);
      if (!events) return reject('這個槓不成立');
      return finish(match, events, o);
    }
    if (a.type === 'discard') {
      const me = h.seats[a.seat];
      if (!(a.tileIndex >= 0 && a.tileIndex < me.hand.length)) return reject('沒有這張牌');
      const events = doDiscard(match, [], o, a.seat, a.tileIndex, { guarded: a.guarded });
      if (!events) return reject('棄牌失敗');
      return finish(match, events, o);
    }
    return reject('不認識的動作：' + a.type);
  }

  return finish(match, [], o);
}

/* 送完動作之後繼續推進，把兩段 events 接起來 */
function finish(match, events, ctx) {
  const r = run(match, ctx);
  return { ok: true, events: events.concat(r.events), waiting: r.waiting };
}

/* ── 一場的開始與名次 ─────────────────────────────────────── */

/* 連莊會讓局數超過 totalHands，所以要把 game-state 那道防跑飛的欄杆放寬。
   真正判斷「打完了沒」的是 scoring.nextDealer，不是這個上限。       */
function applyHandLimit(match, ctx) {
  const o = ctx || {};
  match.handLimit = o.renchan === 'repeat'
    ? (o.maxHands || match.totalHands * 2)
    : match.totalHands;
  return match;
}

function initHandFields(hand) {
  hand.claim = null;
  hand.rinshanPending = false;
  return hand;
}

/* 每一局開牌時要帶給 game-state 的選項（目前只有偏置發牌）。
   ⚠️ 走 ctx 傳而不是寫死在規則層：「誰該拿種子」是戰役層的知識
   （連敗加成看 campaign 的 boost），規則層不該知道那件事。 */
function handOpts(ctx) { return (ctx && ctx.handOptions) || {}; }

function startMatch(match, ctx) {
  applyHandLimit(match, ctx);
  S.startHand(match, handOpts(ctx));
  initHandFields(match.hand);
  const events = [];
  ev(events, 'handStart', {
    handNo: match.hand.handNo, dealer: match.hand.dealer, honba: match.hand.honba,
  });
  const r = run(match, ctx);
  return { events: events.concat(r.events), waiting: r.waiting };
}

/* 名次由 scoring 統一提供，避免兩邊排序規則走鐘 */
const standings = SC.standings;

/* ── Firebase 往返修復 ────────────────────────────────────── */
function normalize(match) {
  S.normalize(match);
  const h = match && match.hand;
  if (h) {
    if (h.claim === undefined) h.claim = null;
    if (h.claim) C.normalizeWindow(h.claim);
    h.rinshanPending = !!h.rinshanPending;
  }
  return match;
}

/* ── 按收件人過濾事件（線上版廣播用）────────────────────────
   ⚠️ `draw` 與 `rinshan` 事件帶著摸到的那張牌。檔案開頭寫著「網路層拿
   events 廣播」—— 照原樣廣播，等於把每一張摸牌發給所有人，
   狀態拆得再乾淨也白費。所以廣播前一定要過這一關：
   摸牌的本人拿到完整事件，其餘三家只知道「某家摸了一張」。

   其他事件都是公開資訊：打出的牌、副露、胡牌攤牌、流局。
   暗槓也是 —— 本作採日本規則，暗槓兩端蓋、中間兩張亮，牌種公開（見 render.js）。
   ⚠️ 哪天改成台灣規則（暗槓整副蓋）的話，kong_dark 的 display 也要加進這裡過濾。 */
const PRIVATE_TILE_EVENTS = { draw: true, rinshan: true };
function eventsFor(events, viewerSeat) {
  return (events || []).map(e => {
    if (!PRIVATE_TILE_EVENTS[e.t] || e.seat === viewerSeat) return e;
    const out = Object.assign({}, e);
    delete out.tile;
    return out;
  });
}

return {
  MAX_STEPS,
  turnOptions, waiting, run, submit, eventsFor, startSub, endSub,
  startMatch, standings, normalize, initHandFields, applyHandLimit,
  defaultChooseDiscard,
};
});
