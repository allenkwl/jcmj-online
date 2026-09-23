/* flow 的驗證測試
   這一層最怕的不是算錯，是「卡住」與「牌變多變少」——
   所以主力是一整場打到底、每次停下來都驗一次不變量。
   執行： node test/flow.test.js                                  */
const F = require('../src/flow.js');
const C = require('../src/claim-arbiter.js');
const S = require('../src/game-state.js');
const R = require('../src/rules-core.js');
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
const fails = [];
function ok(cond, name, detail) {
  if (cond) { pass++; }
  else { fail++; fails.push(name + (detail ? '　→ ' + detail : '')); }
}
function eq(a, b, name) { ok(a === b, name, `得到 ${JSON.stringify(a)}，預期 ${JSON.stringify(b)}`); }

let _uid = 5000;
function T(str) {
  return str.trim().split(/\s+/).map(d => {
    const m = d.match(/^(\d+)(.+)$/);
    return m
      ? { suit: m[2], num: +m[1], display: d, isHonor: false, uid: _uid++ }
      : { suit: d, num: 0, display: d, isHonor: true, uid: _uid++ };
  });
}

const allAI = lv => ({
  0: { isAI: true, aiLevel: lv || 2 }, 1: { isAI: true, aiLevel: lv || 2 },
  2: { isAI: true, aiLevel: lv || 2 }, 3: { isAI: true, aiLevel: lv || 2 },
});

/* 測流程正確性不需要真的 AI 想牌。
   defaultChooseDiscard 一次要算 14 個向聽數（約 8ms），跑上百場就是好幾分鐘。
   注入「打最後一張」之後每場從 1.7 秒降到毫秒級，而且因為打得更亂，
   反而會撞出更多宣告視窗。真 AI 的路徑另外用少數幾場覆蓋。          */
const cheapDiscard = (hand, seat) => hand.seats[seat].hand.length - 1;

function newMatch(seed) {
  return S.createMatch({
    seed, seats: [0, 1, 2, 3].map(i => ({ name: 'P' + i, isAI: true })),
  });
}

/* ── 不變量 ──────────────────────────────────────────────── */
function checkInvariants(match) {
  const h = match.hand;
  if (!h || h.phase === 'over') return null;

  const seen = [];
  h.seats.forEach(s => {
    seen.push(...s.hand);
    s.melds.forEach(m => seen.push(...m.tiles));
    seen.push(...s.discards.filter(t => t.claimedBy == null));
  });
  // 牌山剩幾張不能寫成 wall.length - drawIdx。
  // 嶺上牌是從 wall 的**尾端**取的，取走之後那張仍然留在陣列裡
  // （wall 是「這副牌原本的順序」，留著才能事後用 seed 核對發牌），
  // 只有 deadWallStart 往前移。照陣列長度算會把嶺上牌重複計一次。
  const remain = S.liveWallCount(h) + S.DEAD_WALL;
  if (seen.length + remain !== 136)
    return `牌數不對：場上 ${seen.length} + 牌山 ${remain} = ${seen.length + remain}`;

  const uids = seen.map(t => t.uid);
  if (new Set(uids).size !== uids.length) return '場上出現重複的牌';

  for (let i = 0; i < 4; i++) {
    const s = h.seats[i];
    const base = S.baseHandSize(s);
    if (s.hand.length !== base && s.hand.length !== base + 1)
      return `座位 ${i} 手牌 ${s.hand.length} 張，應該是 ${base} 或 ${base + 1}`;
  }
  // 輪到誰打牌，那家就該是多一張的狀態
  if (h.phase === 'discard') {
    const s = h.seats[h.turn];
    if (s.hand.length !== S.baseHandSize(s) + 1)
      return `輪到座位 ${h.turn} 打牌，但手上只有 ${s.hand.length} 張`;
  }
  return null;
}

console.log('═══ 沒有 setTimeout ═══');

{
  // 這是整個第 4 步的意義所在，用測試釘死：流程層一旦混進計時器，
  // 「接下來該發生什麼」就又躲回呼叫堆疊裡，線上版接不上。
  // 註解裡本來就會提到 setTimeout（說明為什麼不用它），所以先剝註解再驗。
  const strip = f => fs.readFileSync(path.join(__dirname, '../src/' + f), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
  const timer = /\b(setTimeout|setInterval|requestAnimationFrame)\s*\(/;
  ok(!timer.test(strip('flow.js')), 'flow.js 裡沒有任何計時器呼叫');
  ok(!timer.test(strip('game-state.js')), '狀態層沒有計時器呼叫');
  ok(!timer.test(strip('claim-arbiter.js')), '仲裁層沒有計時器呼叫');
  ok(!timer.test(strip('rules-core.js')), '規則層沒有計時器呼叫');
}

console.log('═══ 一場四局跑得完 ═══');

{
  const m = newMatch(2024);
  const r = F.startMatch(m, { seatInfo: allAI(), now: 1, claimTimeoutMs: 0 });
  eq(r.waiting.kind, 'matchOver', '四局打完，一場結束');
  ok(m.finished, 'match.finished 立起來');
  eq(m.handNo, 4, '打了四局');

  const kinds = {};
  r.events.forEach(e => { kinds[e.t] = (kinds[e.t] || 0) + 1; });
  eq(kinds.handStart, 4, '四次開局');
  eq(kinds.handEnd, 4, '四次結算');
  eq(kinds.matchEnd, 1, '一次散場');
  ok(kinds.draw > 50, '摸牌 events 有出來', `只有 ${kinds.draw} 次`);

  const st = F.standings(m);
  eq(st.length, 4, '名次有四個人');
  ok(st[0].score >= st[3].score, '名次由高到低');
  eq(st.reduce((n, x) => n + x.score, 0), 0, '整場的分數是零和');
}

console.log('═══ 真 AI 打完一整場 ═══');

{
  // 上面那些迴圈用的是便宜的棄牌策略，這一項確認真的 AI（向聽數貪心）
  // 也能從頭打到尾 —— 第 5 步會換掉它，但介面不變。
  const m = newMatch(555);
  const t0 = Date.now();
  const r = F.startMatch(m, { seatInfo: allAI(), now: 1, claimTimeoutMs: 0 });
  const ms = Date.now() - t0;
  eq(r.waiting.kind, 'matchOver', '真 AI 打得完一整場');
  eq(m.seats.reduce((n, s) => n + s.matchScore, 0), 0, '總分零和');
  ok(ms < 10000, '一場在十秒內算完', `花了 ${ms}ms`);
}

console.log('═══ 全程不變量（60 場）═══');

{
  let broke = null;
  for (let seed = 1; seed <= 60 && !broke; seed++) {
    const m = newMatch(seed);
    // 座位 0 當人類，才有機會在每一個停頓點檢查狀態
    const si = { 1: { isAI: true, aiLevel: 2 }, 2: { isAI: true, aiLevel: 3 }, 3: { isAI: true, aiLevel: 1 } };
    // 逾時要給足，否則視窗開了立刻關，人類根本輪不到宣告
    const ctx = { seatInfo: si, now: 1, claimTimeoutMs: 8000, chooseDiscard: cheapDiscard };
    let r = F.startMatch(m, ctx);
    let guard = 0;

    while (r.waiting && r.waiting.kind !== 'matchOver' && guard++ < 3000) {
      const bad = checkInvariants(m);
      if (bad) { broke = `seed ${seed}：${bad}`; break; }

      const w = r.waiting;
      if (w.kind === 'turn') {
        const o = w.options;
        if (o.canTsumo) r = F.submit(m, { type: 'tsumo', seat: w.seat }, ctx);
        else r = F.submit(m, {
          type: 'discard', seat: w.seat, tileIndex: cheapDiscard(m.hand, w.seat),
        }, ctx);
      } else if (w.kind === 'claim') {
        const seat = w.seats[0];
        const opt = w.window.eligible[String(seat)];
        const dec = opt.ron ? { type: 'ron' }
          : opt.pong ? { type: 'pong' }
          : opt.chi.length ? { type: 'chi', nums: opt.chi[0] }
          : { type: 'pass' };
        r = F.submit(m, { type: 'claim', seat, decision: dec }, ctx);
      } else break;

      if (!r.ok && r.reason) { broke = `seed ${seed}：動作被拒 —— ${r.reason}`; break; }
    }
    if (guard >= 3000) broke = `seed ${seed}：跑不完，可能卡住`;
    if (!broke && !m.finished) broke = `seed ${seed}：停在 ${JSON.stringify(r.waiting)}`;
  }
  ok(!broke, '60 場全程牌數守恆、手牌張數正確、不卡住', broke);
}

console.log('═══ 停在該停的地方 ═══');

{
  // 沒有任何 AI → 開局摸完就該停下來等座位 0（莊家）
  const m = newMatch(77);
  const r = F.startMatch(m, { seatInfo: {}, now: 1 });
  eq(r.waiting.kind, 'turn', '停下來等人打牌');
  eq(r.waiting.seat, m.hand.dealer, '等的是莊家');
  eq(m.hand.seats[m.hand.dealer].hand.length, 14, '莊家已經摸到第 14 張');
  ok(r.waiting.options.canDiscard, '可以打牌');
  eq(r.events.filter(e => e.t === 'discard').length, 0, '還沒有人打牌');
}

{
  // 三家 AI + 座位 2 是人類 → 停在座位 2
  const m = newMatch(88);
  const si = { 0: { isAI: true, aiLevel: 2 }, 1: { isAI: true, aiLevel: 2 }, 3: { isAI: true, aiLevel: 2 } };
  const r = F.startMatch(m, { seatInfo: si, now: 1, claimTimeoutMs: 8000 });
  ok(r.waiting.kind === 'turn' ? r.waiting.seat === 2
     : r.waiting.kind === 'claim' ? r.waiting.seats.includes(2)
     : r.waiting.kind === 'matchOver',
     '只會停在座位 2 頭上', JSON.stringify(r.waiting));
}

console.log('═══ submit 的合法性檢查 ═══');

{
  const m = newMatch(99);
  const ctx = { seatInfo: {}, now: 1 };
  const r = F.startMatch(m, ctx);
  const me = r.waiting.seat;
  const other = (me + 1) % 4;

  let x = F.submit(m, { type: 'discard', seat: other, tileIndex: 0 }, ctx);
  eq(x.ok, false, '還沒輪到的人不能打牌');
  eq(m.hand.seats[other].hand.length, 13, '被拒的動作沒有改到狀態');

  x = F.submit(m, { type: 'discard', seat: me, tileIndex: 99 }, ctx);
  eq(x.ok, false, '打一張不存在的牌會被拒');

  x = F.submit(m, { type: 'tsumo', seat: me }, ctx);
  eq(x.ok, false, '不能胡的時候宣告自摸會被拒');

  x = F.submit(m, { type: 'kong', seat: me, kind: 'dark', display: '9筒' }, ctx);
  eq(x.ok, false, '槓不成立會被拒');

  x = F.submit(m, { type: '亂講', seat: me }, ctx);
  eq(x.ok, false, '不認識的動作會被拒');

  x = F.submit(m, { type: 'claim', seat: me, decision: { type: 'pass' } }, ctx);
  eq(x.ok, false, '沒開宣告視窗時送宣告會被拒');

  x = F.submit(m, { type: 'discard', seat: me, tileIndex: 0 }, ctx);
  eq(x.ok, true, '合法的棄牌收得下');
  ok(x.events.some(e => e.t === 'discard'), '吐出棄牌 event');
}

console.log('═══ 不跳窗就直接輪下一家 ═══');

{
  const m = newMatch(101);
  const ctx = { seatInfo: {}, now: 1 };
  F.startMatch(m, ctx);
  const h = m.hand;
  const me = h.turn;

  // 讓其他三家手上什麼都鳴不到
  [1, 2, 3].forEach(k => {
    const s = (me + k) % 4;
    h.seats[s].hand = T('1萬 4萬 7萬 1筒 4筒 7筒 1條 4條 7條 東 南 西 北');
  });
  // 打一張沒人要的牌
  h.seats[me].hand[0] = T('9萬')[0];
  const r = F.submit(m, { type: 'discard', seat: me, tileIndex: 0 }, ctx);

  ok(!r.events.some(e => e.t === 'claimOpen'), '沒有人能宣告就不開窗');
  eq(m.hand.turn, (me + 1) % 4, '直接輪到下一家');
  ok(m.hand.seats[(me + 1) % 4].hand.length === 14, '下一家已經摸過牌');
}

console.log('═══ 碰之後跳過中間的座位 ═══');

{
  const m = newMatch(202);
  const ctx = { seatInfo: {}, now: 1, claimTimeoutMs: 8000 };
  F.startMatch(m, ctx);
  const h = m.hand;
  h.turn = 0; h.phase = 'discard';
  h.seats[0].hand = T('5萬 1筒 2筒 3筒 4筒 5筒 6筒 7筒 8筒 9筒 1條 2條 3條 東');
  h.seats[1].hand = T('1萬 4萬 7萬 1筒 4筒 7筒 1條 4條 7條 東 南 西 北');
  h.seats[2].hand = T('5萬 5萬 9條 9條 1筒 2筒 3筒 4筒 5筒 6筒 7筒 8筒 9筒');
  h.seats[3].hand = T('1萬 4萬 7萬 1筒 4筒 7筒 1條 4條 7條 東 南 西 北');

  const r = F.submit(m, { type: 'discard', seat: 0, tileIndex: 0 }, ctx);
  eq(r.waiting.kind, 'claim', '開了宣告視窗等座位 2');
  eq(r.waiting.seats.join(','), '2', '只有座位 2 被問到');

  const r2 = F.submit(m, { type: 'claim', seat: 2, decision: { type: 'pong' } }, ctx);
  eq(m.hand.turn, 2, '碰完輪到座位 2');
  eq(m.hand.phase, 'discard', '碰完要打牌');
  eq(m.hand.seats[2].melds[0].type, 'pong', '副露記了一個碰');
  eq(m.hand.seats[1].hand.length, 13, '座位 1 被跳過，沒有摸牌');
  ok(r2.events.some(e => e.t === 'meld' && e.seat === 2), '吐出副露 event');
}

console.log('═══ 槓要補嶺上牌 ═══');

{
  const m = newMatch(303);
  const ctx = { seatInfo: {}, now: 1, claimTimeoutMs: 8000 };
  F.startMatch(m, ctx);
  const h = m.hand;
  h.turn = 0; h.phase = 'discard';
  h.seats[0].hand = T('7筒 7筒 7筒 7筒 1萬 2萬 3萬 4萬 5萬 6萬 1條 2條 3條 東');

  const liveBefore = S.liveWallCount(h);
  const opts = F.turnOptions(h, 0);
  ok(opts.kongs.some(k => k.kind === 'dark' && k.display === '7筒'), '四張同牌列出暗槓');

  const r = F.submit(m, { type: 'kong', seat: 0, kind: 'dark', display: '7筒' }, ctx);
  eq(r.ok, true, '暗槓成立');
  ok(r.events.some(e => e.t === 'rinshan'), '補了嶺上牌');
  eq(m.hand.seats[0].melds[0].type, 'kong_dark', '副露記了暗槓');
  eq(m.hand.phase, 'discard', '補完牌要打牌');
  eq(m.hand.turn, 0, '還是自己的回合');
  eq(S.liveWallCount(m.hand), liveBefore - 1, '開槓讓可摸張數少一張');
  eq(m.hand.rinshanPending, false, '嶺上旗標用完就清掉');
  ok(!checkInvariants(m), '槓完牌數仍然守恆', checkInvariants(m));
}

{
  // 牌山空了不能槓
  const m = newMatch(304);
  const ctx = { seatInfo: {}, now: 1 };
  F.startMatch(m, ctx);
  const h = m.hand;
  h.seats[0].hand = T('7筒 7筒 7筒 7筒 1萬 2萬 3萬 4萬 5萬 6萬 1條 2條 3條 東');
  h.drawIdx = h.deadWallStart;                   // 活牌山見底
  eq(F.turnOptions(h, 0).kongs.length, 0, '沒牌可補就不給槓');
}

console.log('═══ 搶槓 ═══');

{
  const m = newMatch(404);
  // autoNextHand:false —— 否則這局一結束 run() 就開下一局，
  // m.hand 會換成新的一局，讀到的 result 是 null
  const ctx = { seatInfo: {}, now: 1, claimTimeoutMs: 8000, autoNextHand: false };
  F.startMatch(m, ctx);
  const h = m.hand;
  h.turn = 0; h.phase = 'discard';
  h.seats[0].melds = [{ type: 'pong', tiles: T('6萬 6萬 6萬'), from: 2 }];
  h.seats[0].hand = T('6萬 1筒 2筒 3筒 4筒 5筒 6筒 7筒 8筒 9筒 東');
  h.seats[1].hand = T('1萬 2萬 3萬 4萬 5萬 6萬 7萬 8萬 1筒 1筒 1筒 9條 9條');
  h.seats[2].hand = T('1萬 4萬 7萬 1筒 4筒 7筒 1條 4條 7條 東 南 西 北');
  h.seats[3].hand = T('1萬 4萬 7萬 1筒 4筒 7筒 1條 4條 7條 東 南 西 北');

  const r = F.submit(m, { type: 'kong', seat: 0, kind: 'added', display: '6萬' }, ctx);
  eq(r.waiting.kind, 'claim', '加槓先開搶槓視窗');
  eq(r.waiting.window.kind, 'kong_added', '視窗種類是加槓');
  ok(!r.events.some(e => e.t === 'rinshan'), '還沒補嶺上牌');

  const r2 = F.submit(m, { type: 'claim', seat: 1, decision: { type: 'ron' } }, ctx);
  const winEv = r2.events.find(e => e.t === 'win');
  eq(winEv.kind, 'chankan', '搶槓成立');
  eq(m.hand.result.type, 'ron', '結算是榮和');
  ok(m.hand.result.chankan, '結算記得這是搶槓');
  eq(m.hand.seats[0].melds[0].type, 'pong', '被搶的槓退回成碰');
  eq(m.hand.seats[0].melds[0].tiles.length, 3, '加上去的那張還給胡牌者');
  eq(m.hand.seats[1].hand.length, 14, '胡牌者手上 14 張');
}

{
  // 沒人搶槓 → 照常補嶺上牌
  const m = newMatch(405);
  const ctx = { seatInfo: {}, now: 1, claimTimeoutMs: 8000 };
  F.startMatch(m, ctx);
  const h = m.hand;
  h.turn = 0; h.phase = 'discard';
  h.seats[0].melds = [{ type: 'pong', tiles: T('6萬 6萬 6萬'), from: 2 }];
  h.seats[0].hand = T('6萬 1筒 2筒 3筒 4筒 5筒 6筒 7筒 8筒 9筒 東');
  [1, 2, 3].forEach(s => { h.seats[s].hand = T('1萬 4萬 7萬 1筒 4筒 7筒 1條 4條 7條 東 南 西 北'); });

  const r = F.submit(m, { type: 'kong', seat: 0, kind: 'added', display: '6萬' }, ctx);
  ok(r.events.some(e => e.t === 'rinshan'), '沒人能搶就直接補嶺上牌');
  eq(m.hand.turn, 0, '還是加槓那家的回合');
  eq(m.hand.phase, 'discard', '補完要打牌');
  eq(m.hand.seats[0].melds[0].type, 'kong_added', '槓成立');
}

console.log('═══ 流局 ═══');

{
  const m = newMatch(505);
  const ctx = { seatInfo: allAI(), now: 1, claimTimeoutMs: 0, autoNextHand: false };
  F.startMatch(m, ctx);
  const h = m.hand;
  // 把牌山推到只剩一張，且四家都做不出牌
  h.drawIdx = h.deadWallStart - 1;
  [0, 1, 2, 3].forEach(s => {
    h.seats[s].hand = T('1萬 4萬 7萬 1筒 4筒 7筒 1條 4條 7條 東 南 西 北');
    h.seats[s].melds = [];
  });
  h.phase = 'draw';
  const r = F.run(m, ctx);
  const dg = r.events.find(e => e.t === 'drawGame');
  ok(dg, '牌山摸完會流局');
  eq(dg.reason, 'wallEmpty', '流局原因是牌山見底');
  eq(m.hand.result.type, 'draw', '結算是流局');
  eq(m.hand.result.winners.length, 0, '流局沒有贏家');
  ok(Array.isArray(m.hand.result.tenpai), '記下誰聽牌（第 7 步算罰符要用）');
}

console.log('═══ 連莊接上流程 ═══');

{
  // 預設不連莊：莊家每局輪一位，固定四局
  const m = newMatch(1111);
  const r = F.startMatch(m, {
    seatInfo: allAI(), now: 1, claimTimeoutMs: 0, chooseDiscard: cheapDiscard,
  });
  const dealers = r.events.filter(e => e.t === 'handStart').map(e => e.dealer);
  eq(dealers.join(''), '0123', '不連莊：四局莊家輪一圈');
  eq(r.events.filter(e => e.t === 'renchan').length, 0, '沒有連莊事件');
}

{
  // 連莊模式：一場打到莊家輪滿一圈，局數會超過四局
  const m = newMatch(1111);
  const r = F.startMatch(m, {
    seatInfo: allAI(), now: 1, claimTimeoutMs: 0,
    renchan: 'repeat', chooseDiscard: cheapDiscard,
  });
  eq(r.waiting.kind, 'matchOver', '連莊模式也結束得了');
  ok(m.handNo >= 4, '至少打滿四局', `只有 ${m.handNo} 局`);
  ok(m.dealerRotations >= 4 || m.handNo >= 8, '不是輪滿一圈就是打到硬上限');

  const starts = r.events.filter(e => e.t === 'handStart');
  const renchans = r.events.filter(e => e.t === 'renchan');
  // 連莊時下一局的莊家不變、本場數遞增
  renchans.forEach(rc => { ok(rc.honba >= 1, '連莊事件帶著本場數'); });
  ok(starts.every(e => e.honba != null), '每局開始都帶本場數');
}

{
  // 一場打完的總分仍然零和（點數移轉不會憑空生出分數）
  let broke = null;
  for (let seed = 1; seed <= 40 && !broke; seed++) {
    const m = newMatch(seed);
    F.startMatch(m, {
      seatInfo: allAI(), now: 1, claimTimeoutMs: 0,
      renchan: 'repeat', chooseDiscard: cheapDiscard,
    });
    const sum = m.seats.reduce((n, s) => n + s.matchScore, 0);
    if (sum !== 0) broke = `seed ${seed}：總分 ${sum}`;
  }
  ok(!broke, '40 場連莊模式，每場總分都是 0', broke);
}

console.log('═══ 逾時自動 pass ═══');

{
  const m = newMatch(606);
  const ctx = { seatInfo: {}, now: 1000, claimTimeoutMs: 8000 };
  F.startMatch(m, ctx);
  const h = m.hand;
  h.turn = 0; h.phase = 'discard';
  h.seats[0].hand = T('5萬 1筒 2筒 3筒 4筒 5筒 6筒 7筒 8筒 9筒 1條 2條 3條 東');
  h.seats[1].hand = T('1萬 4萬 7萬 1筒 4筒 7筒 1條 4條 7條 東 南 西 北');
  h.seats[2].hand = T('5萬 5萬 9條 9條 1筒 2筒 3筒 4筒 5筒 6筒 7筒 8筒 9筒');
  h.seats[3].hand = T('1萬 4萬 7萬 1筒 4筒 7筒 1條 4條 7條 東 南 西 北');

  const r = F.submit(m, { type: 'discard', seat: 0, tileIndex: 0 }, ctx);
  eq(r.waiting.kind, 'claim', '座位 2 可以碰，視窗開著等他');

  // 時間過了，沒人回應 → 自動 pass 並繼續
  const r2 = F.run(m, { seatInfo: {}, now: 1000 + 9000, claimTimeoutMs: 8000 });
  eq(m.hand.turn, 1, '逾時視同 pass，輪到下一家');
  ok(r2.events.some(e => e.t === 'claimResolved'), '吐出裁決 event');
  eq(r2.events.find(e => e.t === 'claimResolved').outcome.type, 'pass', '裁決結果是過');
}

console.log('═══ 逾時 0 = 不給宣告機會 ═══');

{
  // claimTimeoutMs:0 的視窗開了就立刻逾時 —— 這是「單機速打」那種模式，
  // 全 AI 時無所謂（AI 在檢查逾時之前就即答了），但有人類參與時
  // 等於剝奪宣告機會。寫成測試免得日後誤用。
  const m = newMatch(611);
  const ctx = { seatInfo: {}, now: 1, claimTimeoutMs: 0 };
  F.startMatch(m, ctx);
  const h = m.hand;
  h.turn = 0; h.phase = 'discard';
  h.seats[0].hand = T('5萬 1筒 2筒 3筒 4筒 5筒 6筒 7筒 8筒 9筒 1條 2條 3條 東');
  h.seats[2].hand = T('5萬 5萬 9條 9條 1筒 2筒 3筒 4筒 5筒 6筒 7筒 8筒 9筒');
  [1, 3].forEach(s => { h.seats[s].hand = T('1萬 4萬 7萬 1筒 4筒 7筒 1條 4條 7條 東 南 西 北'); });

  const r = F.submit(m, { type: 'discard', seat: 0, tileIndex: 0 }, ctx);
  ok(r.events.some(e => e.t === 'claimOpen'), '視窗有開');
  ok(r.events.some(e => e.t === 'claimResolved'), '但同一步就關掉了');
  eq(m.hand.turn, 1, '座位 2 沒碰成，直接輪下一家');
  eq(r.waiting.kind, 'turn', '不會停在宣告視窗');
}

console.log('═══ 放過榮和的振聽落到狀態上 ═══');

{
  // 放過的必須是**離打牌者遠的那家**才看得出效果。
  // 如果是下家放過，他緊接著就輪到自己摸牌，同巡振聽當場就解除了 ——
  // 那是正確行為，不是 bug，只是測不到東西。這裡讓對家（座位 2）放過。
  const m = newMatch(707);
  const ctx = { seatInfo: {}, now: 1, claimTimeoutMs: 8000 };
  F.startMatch(m, ctx);
  const h = m.hand;
  h.turn = 0; h.phase = 'discard';
  h.seats[0].hand = T('6萬 1筒 2筒 3筒 4筒 5筒 6筒 7筒 8筒 9筒 1條 2條 3條 東');
  h.seats[2].hand = T('1萬 2萬 3萬 4萬 5萬 6萬 7萬 8萬 1筒 1筒 1筒 9條 9條');
  [1, 3].forEach(x => { h.seats[x].hand = T('1萬 4萬 7萬 1筒 4筒 7筒 1條 4條 7條 東 南 西 北'); });

  const r = F.submit(m, { type: 'discard', seat: 0, tileIndex: 0 }, ctx);
  eq(r.waiting.seats.join(','), '2', '只有對家能榮和');
  const r2 = F.submit(m, { type: 'claim', seat: 2, decision: { type: 'pass' } }, ctx);
  eq(r2.events.find(e => e.t === 'claimResolved').outcome.declinedRon.join(','), '2',
     '裁決記下座位 2 放過了榮和');
  ok(m.hand.seats[2].furitenTemp, '放過榮和的人吃同巡振聽');

  // 座位 1 摸完打出同一張 —— 座位 2 這一巡不能胡
  eq(r2.waiting.seat, 1, '輪到座位 1');
  h.seats[1].hand[h.seats[1].hand.length - 1] = T('6萬')[0];
  const r3 = F.submit(m, {
    type: 'discard', seat: 1, tileIndex: h.seats[1].hand.length - 1,
  }, ctx);
  // 座位 2 是座位 1 的下家，仍然會因為「可以吃」而被問到 ——
  // 要驗的是他這一巡**不能胡**，不是完全不被問。
  eq(r3.waiting.kind, 'claim', '座位 2 因為吃得到而被問');
  eq(r3.waiting.window.eligible['2'].ron, false, '同巡振聽期間不能榮和');
  ok(r3.waiting.window.eligible['2'].chi.length > 0, '但吃還是可以');

  // 等他自己摸過牌，振聽就解除
  ok(!m.hand.seats[2].furitenTemp || m.hand.turn !== 2, '摸牌後解除（由 drawTile 負責）');
}

console.log('═══ 同一份狀態算出同一個結果 ═══');

{
  // 線上版的地基：任何一台讀到同一份狀態，算出來的下一步都要一樣
  const sig = seed => {
    const m = newMatch(seed);
    const r = F.startMatch(m, { seatInfo: allAI(), now: 1, claimTimeoutMs: 0 });
    return r.events.map(e => e.t + (e.seat != null ? e.seat : '')).join('|');
  };
  eq(sig(1234), sig(1234), '同種子同結果');
  ok(sig(1234) !== sig(4321), '不同種子不同結果');
}

console.log('═══ Firebase 往返 ═══');

{
  const m = newMatch(808);
  const ctx = { seatInfo: {}, now: 1, claimTimeoutMs: 8000 };
  F.startMatch(m, ctx);
  const h = m.hand;
  h.turn = 0; h.phase = 'discard';
  h.seats[0].hand = T('5萬 1筒 2筒 3筒 4筒 5筒 6筒 7筒 8筒 9筒 1條 2條 3條 東');
  h.seats[2].hand = T('5萬 5萬 9條 9條 1筒 2筒 3筒 4筒 5筒 6筒 7筒 8筒 9筒');
  [1, 3].forEach(s => { h.seats[s].hand = T('1萬 4萬 7萬 1筒 4筒 7筒 1條 4條 7條 東 南 西 北'); });
  F.submit(m, { type: 'discard', seat: 0, tileIndex: 0 }, ctx);
  eq(m.hand.phase, 'claim', '停在宣告視窗');

  // 整份狀態是純 JSON
  let bad = null;
  (function walk(v, p) {
    if (bad) return;
    if (v === undefined) { bad = p + ' 是 undefined'; return; }
    if (typeof v === 'function') { bad = p + ' 是 function'; return; }
    if (v instanceof Set || v instanceof Map) { bad = p + ' 是 Set/Map'; return; }
    if (v && typeof v === 'object') Object.keys(v).forEach(k => walk(v[k], p + '.' + k));
  })(m, 'match');
  ok(!bad, '開著宣告視窗的狀態是純 JSON', bad);

  // 模擬 Firebase：序列化、空陣列消失、然後另一台接手
  const wire = JSON.parse(JSON.stringify(S.stripUndefined(m)));
  wire.hand.seats.forEach(s => {
    if (s.melds.length === 0) delete s.melds;
    if (s.discards.length === 0) delete s.discards;
  });
  delete wire.hand.claim.responses;

  const back = F.normalize(wire);
  const w = F.waiting(back, { now: 1 });
  eq(w.kind, 'claim', '另一台接手後知道在等宣告');
  eq(w.seats.join(','), '2', '知道在等誰');

  const r = F.submit(back, { type: 'claim', seat: 2, decision: { type: 'pong' } },
                     { seatInfo: {}, now: 1, claimTimeoutMs: 8000 });
  eq(r.ok, true, '往返後動作還送得進去');
  eq(back.hand.turn, 2, '往返後流程繼續往前走');
}

{
  // 視窗序號對不上的動作要擋掉（封包亂序／重送）
  const m = newMatch(909);
  const ctx = { seatInfo: {}, now: 1, claimTimeoutMs: 8000 };
  F.startMatch(m, ctx);
  const h = m.hand;
  h.turn = 0; h.phase = 'discard';
  h.seats[0].hand = T('5萬 1筒 2筒 3筒 4筒 5筒 6筒 7筒 8筒 9筒 1條 2條 3條 東');
  h.seats[2].hand = T('5萬 5萬 9條 9條 1筒 2筒 3筒 4筒 5筒 6筒 7筒 8筒 9筒');
  [1, 3].forEach(s => { h.seats[s].hand = T('1萬 4萬 7萬 1筒 4筒 7筒 1條 4條 7條 東 南 西 北'); });
  F.submit(m, { type: 'discard', seat: 0, tileIndex: 0 }, ctx);

  const stale = F.submit(m, { type: 'claim', seat: 2, seq: 999, decision: { type: 'pong' } }, ctx);
  eq(stale.ok, false, '序號對不上的宣告會被擋掉');
  const good = F.submit(m, { type: 'claim', seat: 2, seq: m.hand.claim.seq, decision: { type: 'pong' } }, ctx);
  eq(good.ok, true, '序號對得上就收');
}

console.log('═══ 魏「鐵騎」：guarded 從 submit 一路走到仲裁器 ═══');

/* ⚠️ 這是接線上唯一沒被測到的接縫。
   兩端本來都有測：`claim-arbiter.test.js` 驗「被護送的棄牌擋得住吃碰」，
   `game-state` 的 discardTile 收得到 opts.guarded。
   但中間這一段 —— mj4.html 的 submit 把 guarded 放進 action、
   flow.js 再從 a.guarded 取出來轉交 doDiscard —— 一直沒有人走過。
   漏掉的話症狀是「按了技能、提示也跳了，別家照樣碰」，畫面上看不出原因。 */
function guardProbe(guarded) {
  const m = newMatch(1234);
  const ctx = { seatInfo: {}, now: 1 };
  const r = F.startMatch(m, ctx);
  const me = r.waiting.seat;
  const next = (me + 1) % 4;

  // 讓下家手上一定有一對，「碰」才成立 —— 不然兩組都不開視窗，測了等於沒測
  const tile = m.hand.seats[me].hand[0];
  const pair = T(tile.display + ' ' + tile.display);
  m.hand.seats[next].hand.splice(0, 2, pair[0], pair[1]);

  const a = { type: 'discard', seat: me, tileIndex: m.hand.seats[me].hand.indexOf(tile) };
  if (guarded) a.guarded = true;
  const x = F.submit(m, a, ctx);
  return { m, x, me, next };
}

{
  const { m, x } = guardProbe(true);
  eq(x.ok, true, '帶 guarded 的棄牌收得下');
  eq(m.hand.lastDiscard.guarded, true,
     '⚠️ guarded 走完了 submit → flow → discardTile，落在 lastDiscard 上');
  eq(m.hand.claim, null, '⚠️ 護送之下，手上有對子的下家連宣告視窗都不會開');
  eq(x.waiting.kind, 'turn', '直接輪到下一家摸牌');
}

{
  // 對照組：同一個 seed、同一個局面，只差沒護送
  const { m, x, next } = guardProbe(false);
  eq(m.hand.lastDiscard.guarded, false, '沒帶 guarded 就是 false');
  ok(m.hand.claim && m.hand.claim.eligible
     && m.hand.claim.eligible[next] && m.hand.claim.eligible[next].pong === true,
     '對照組：不護送就碰得到（確認上一條不是假通過）',
     JSON.stringify(m.hand.claim && m.hand.claim.eligible));
}

console.log('\n─────────────────────────');
console.log(`通過 ${pass}　失敗 ${fail}`);
if (fail) { fails.forEach(f => console.log('  ✗ ' + f)); process.exit(1); }
console.log('全部通過 ✓');
