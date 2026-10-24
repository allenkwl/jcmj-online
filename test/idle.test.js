/* 久久不動的代打（v1.93，docs/host-liveness.md 定案 3、4）：規則層
   ‧ 輪到他 30 秒沒動 → startSub(idle)：電腦替他打，但**戰果照記**（不像斷線那樣 subbed）
   ‧ 到下一局開始還沒回來 → 比照斷線（idleToGone：這一場不記給他），代打照舊，等他自己回來
   執行： node test/idle.test.js                                               */
const S = require('../src/game-state.js');
const F = require('../src/flow.js');

let pass = 0, fail = 0;
const fails = [];
function ok(c, name, d) { if (c) pass++; else { fail++; fails.push(name + (d ? '　→ ' + d : '')); } }
function eq(a, b, name) { ok(a === b, name, `得到 ${JSON.stringify(a)}，預期 ${JSON.stringify(b)}`); }

const mk = () => {
  const m = S.createMatch({ seed: 9, seats: [0, 1, 2, 3].map(i => ({ name: 'P' + i, clientId: i === 1 ? 'u1' : undefined, isAI: i !== 1 })) });
  F.startMatch(m, { seatInfo: { 0: { isAI: true }, 1: {}, 2: { isAI: true }, 3: { isAI: true } }, now: 1, pauseAfter: ['handStart'] });
  return m;
};
const ctx = { seatInfo: { 0: { isAI: true }, 1: {}, 2: { isAI: true }, 3: { isAI: true } }, claimTimeoutMs: 0, now: 1 };

console.log('═══ 久久不動的代打 ═══');
{
  const m = mk();
  const ev = F.startSub(m, 1, { general: '龐涓', now: 5, idle: true });
  ok(ev[0] && ev[0].t === 'subStart' && ev[0].idle === true, 'subStart 事件帶 idle（畫面說「暫離」不說「斷線」）', JSON.stringify(ev));
  ok(m.seats[1].sub && m.seats[1].sub.idle, '座位記著是久久不動的代打');
  // 電腦替他把這一局打完（停在這一局結束）
  const hn = m.hand.handNo;
  let guard = 0;
  while (m.hand.phase !== 'over' && guard++ < 400) F.run(m, Object.assign({}, ctx, { now: 2 + guard, pauseAfter: ['discard', 'handEnd'] }));
  eq(m.hand.handNo, hn, '（前提）還在同一局');
  ok(m.hand.seats[1].discards.length > 0, '（前提）電腦真的替他出過牌');
  eq(!!m.seats[1].subbed, false, '電腦替他出過手：戰果照記（不是斷線）');
  // 進下一局
  F.run(m, Object.assign({}, ctx, { autoNextHand: true, now: 1000, pauseAfter: ['handStart'] }));
  ok(m.hand.handNo === hn + 1 || m.finished, '（前提）進到下一局', m.hand.handNo + ' ' + m.hand.phase);
  if (!m.finished) {
    eq(!!m.seats[1].subbed, true, '下一局開始還沒回來：比照斷線，這一場不記給他');
    ok(m.seats[1].sub && m.seats[1].sub.idle, '代打照舊（還是等他自己回來，不靠在場名單收回）');
  }
  const end = F.endSub(m, 1);
  ok(end[0] && end[0].t === 'subEnd' && end[0].idle === true, 'subEnd 事件帶 idle', JSON.stringify(end));
  eq(m.seats[1].sub, null, '回來了：代打收回');
}
{
  const m = mk();
  F.startSub(m, 1, { general: '龐涓', now: 5 });
  ok(!m.seats[1].sub.idle, '一般斷線的代打沒有 idle');
  F.endSub(m, 1);
  F.startSub(m, 1, { general: '龐涓', now: 6, idle: true });
  F.endSub(m, 1);
  F.idleToGone(m);
  eq(!!m.seats[1].subbed, false, '代打已經收回的人，下一局開始不受影響');
}

console.log('\n─────────────────────────');
console.log(`通過 ${pass}　失敗 ${fail}`);
if (fail) { fails.forEach(f => console.log('  ✗ ' + f)); process.exit(1); }
console.log('全部通過 ✓');
