/* 線上版回合模型：群主當裁判
   規格：docs/net-turn-model.md

   這支測試回答一個問題：**改成「群主只收回覆、各家自己算」之後，打出來的牌局
   跟現在的中央版是不是一模一樣。** 同一個 seed 各打一次，逐事件比對。

   三道防線：
   1. 每台用戶端拿到的是**自己的視角**：別家手牌與整副牌山都換成一碰就炸的假牌。
      任何決策路徑偷看了別人的牌，測試會直接炸出「偷看了座位 N 的手牌」。
   2. 群主模式的每一個宣告視窗都要問滿三家（群主不知道誰能宣告）。
   3. 每回完一家就把整局序列化再還原一次 —— 模擬群主在宣告視窗開到一半時
      斷線換人、新群主從 Firebase 讀回狀態接手。

   執行： node test/net-turn.test.js                                        */
const F = require('../src/flow.js');
const C = require('../src/claim-arbiter.js');
const S = require('../src/game-state.js');
const AI = require('../src/ai.js');

let pass = 0, fail = 0;
const fails = [];
function ok(cond, name, detail) {
  if (cond) { pass++; }
  else { fail++; fails.push(name + (detail ? '　→ ' + detail : '')); }
}
function eq(a, b, name) { ok(a === b, name, `得到 ${JSON.stringify(a)}，預期 ${JSON.stringify(b)}`); }

let _uid = 7000;
function T(str) {
  return str.trim().split(/\s+/).map(d => {
    const m = d.match(/^(\d+)(.+)$/);
    return m
      ? { suit: m[2], num: +m[1], display: d, isHonor: false, uid: _uid++ }
      : { suit: d, num: 0, display: d, isHonor: true, uid: _uid++ };
  });
}

function newMatch(seed) {
  return S.createMatch({ seed, seats: [0, 1, 2, 3].map(i => ({ name: 'P' + i, isAI: false })) });
}

/* ── 一碰就炸的假牌 ─────────────────────────────────────────
   只有「張數」是公開資訊，所以陣列長度照留，每一張牌本身都是陷阱。 */
function trap(what) {
  const o = {};
  ['display', 'suit', 'num', 'uid', 'isHonor'].forEach(k =>
    Object.defineProperty(o, k, { get() { throw new Error('偷看了' + what); } }));
  return o;
}

/* 座位 seat 的用戶端看得到的東西 */
function viewFor(hand, seat) {
  const v = JSON.parse(JSON.stringify(hand));
  v.seats.forEach((s, i) => {
    if (i !== seat) s.hand = s.hand.map(() => trap(`座位 ${i} 的手牌`));
  });
  v.wall = v.wall.map(() => trap('牌山'));
  return v;
}

/* 模擬 Firebase 往返：序列化，而且 Firebase 會把 null、空陣列、空物件整個吃掉。
   新群主拿到的就是這種殘缺版本，F.normalize 要能補回來。 */
function prune(v) {
  if (Array.isArray(v)) return v.map(prune);
  if (v && typeof v === 'object') {
    const out = {};
    Object.keys(v).forEach(k => {
      const x = prune(v[k]);
      if (x === null || x === undefined) return;
      if (Array.isArray(x) && x.length === 0) return;
      if (x && typeof x === 'object' && !Array.isArray(x) && Object.keys(x).length === 0) return;
      out[k] = x;
    });
    return out;
  }
  return v;
}
function viaFirebase(m) {
  return F.normalize(prune(JSON.parse(JSON.stringify(S.stripUndefined(m)))));
}

/* ── 出牌策略（兩種模式共用，只看傳進來的那份 hand）── */
const POLICY = {
  cheap: {
    discard: (h, s) => h.seats[s].hand.length - 1,
    claim: (h, s, opt) => C.decideClaim(h, s, opt, 2),
  },
  ai: {
    discard: (h, s) => AI.chooseDiscard(h, s, { level: 2 }),
    claim: (h, s, opt) => AI.decideClaim(h, s, opt, { level: 3 }),
  },
};

/* 比對用：拿掉兩種模式本來就不同的東西（宣告視窗的開關）*/
function comparable(events) {
  return events.filter(e => e.t !== 'claimOpen' && e.t !== 'claimResolved');
}

/* ── 中央模式（現行單機的做法）── */
function playCentral(seed, pol) {
  const m = newMatch(seed);
  const ctx = { seatInfo: {}, now: 1, claimTimeoutMs: 8000 };
  let r = F.startMatch(m, ctx);
  const events = r.events.slice();
  let windows = 0, guard = 0;
  while (r.waiting && r.waiting.kind !== 'matchOver' && guard++ < 8000) {
    const w = r.waiting;
    if (w.kind === 'turn') {
      r = w.options.canTsumo
        ? F.submit(m, { type: 'tsumo', seat: w.seat }, ctx)
        : F.submit(m, { type: 'discard', seat: w.seat, tileIndex: pol.discard(m.hand, w.seat) }, ctx);
    } else if (w.kind === 'claim') {
      if (!w.window.responses || !Object.keys(w.window.responses).length) windows++;
      const seat = w.seats[0];
      const d = pol.claim(m.hand, seat, w.window.eligible[String(seat)]);
      r = F.submit(m, { type: 'claim', seat, seq: w.window.seq, decision: d }, ctx);
    } else break;
    if (!r.ok) return { err: `中央模式 seed ${seed} 動作被拒：${r.reason}` };
    events.push(...r.events);
  }
  return { m, events, windows, finished: m.finished };
}

/* ── 群主模式（線上版）──
   群主跑 flow（它是裁判），但**每一個決定都由那一家的用戶端用自己的視角做**。 */
function playHost(seed, pol, opts) {
  const o = opts || {};
  let m = newMatch(seed);
  const ctx = { seatInfo: {}, now: 1, claimTimeoutMs: 8000, announce: true };
  let r = F.startMatch(m, ctx);
  const events = r.events.slice();
  const stats = { windows: 0, askedNot3: 0, askedDiscarder: 0, handoffs: 0 };
  let guard = 0;
  while (r.waiting && r.waiting.kind !== 'matchOver' && guard++ < 12000) {
    const w = r.waiting;
    if (w.kind === 'turn') {
      // 輪到的那一家：自己算能不能自摸、自己挑要打哪張
      const view = viewFor(m.hand, w.seat);
      const opt = F.turnOptions(view, w.seat);
      r = opt.canTsumo
        ? F.submit(m, { type: 'tsumo', seat: w.seat }, ctx)
        : F.submit(m, { type: 'discard', seat: w.seat, tileIndex: pol.discard(view, w.seat) }, ctx);
    } else if (w.kind === 'claim') {
      const win = m.hand.claim;
      if (!Object.keys(win.responses || {}).length) {
        stats.windows++;
        const asked = C.askedSeats(win);
        if (asked.length !== 3) stats.askedNot3++;
        if (asked.indexOf(win.from) >= 0) stats.askedDiscarder++;
      }
      // 一次回一家（真實情況也是各自抵達），每一家只用自己的視角
      const seat = w.seats[0];
      const view = viewFor(m.hand, seat);
      const d = C.selfResponse(view, seat, view.claim, pol.claim);
      r = F.submit(m, { type: 'claim', seat, seq: win.seq, decision: d }, ctx);
    } else break;
    if (!r.ok) return { err: `群主模式 seed ${seed} 動作被拒：${r.reason}` };
    events.push(...r.events);

    // 模擬群主斷線換人：新群主從 Firebase 讀回狀態接手
    if (o.handoff && m.hand && m.hand.phase === 'claim') {
      m = viaFirebase(m);
      stats.handoffs++;
      r = { ok: true, waiting: F.waiting(m, ctx), events: [] };
    }
  }
  return { m, events, stats, finished: m.finished };
}

console.log('═══ 群主模式與中央模式打出一模一樣的牌局 ═══');

function compareRun(seed, polName, handoff) {
  const pol = POLICY[polName];
  let A, B;
  try { A = playCentral(seed, pol); } catch (e) { return `中央模式 seed ${seed} 炸了：${e.message}`; }
  try { B = playHost(seed, pol, { handoff }); } catch (e) { return `群主模式 seed ${seed}：${e.message}`; }
  if (A.err) return A.err;
  if (B.err) return B.err;
  if (!A.finished) return `中央模式 seed ${seed} 沒打完`;
  if (!B.finished) return `群主模式 seed ${seed} 沒打完`;
  const a = comparable(A.events), b = comparable(B.events);
  if (a.length !== b.length) return `seed ${seed}：事件數不同 ${a.length} vs ${b.length}`;
  for (let i = 0; i < a.length; i++) {
    const x = JSON.stringify(a[i]), y = JSON.stringify(b[i]);
    if (x !== y) return `seed ${seed} 第 ${i} 個事件不同：\n    中央 ${x.slice(0, 160)}\n    群主 ${y.slice(0, 160)}`;
  }
  if (B.stats.askedNot3) return `seed ${seed}：有 ${B.stats.askedNot3} 個視窗沒問滿三家`;
  if (B.stats.askedDiscarder) return `seed ${seed}：有視窗問到打牌者自己`;
  return { A, B };
}

let totals = { a: 0, b: 0, handoffs: 0, seeds: 0, hands: 0 };
function sweep(label, polName, seeds, handoff) {
  const t0 = Date.now();
  let broke = null;
  for (const seed of seeds) {
    const res = compareRun(seed, polName, handoff);
    if (typeof res === 'string') { broke = res; break; }
    totals.a += res.A.windows; totals.b += res.B.stats.windows;
    totals.handoffs += res.B.stats.handoffs; totals.seeds++;
    totals.hands += res.A.events.filter(e => e.t === 'handEnd').length;
  }
  ok(!broke, label, broke);
  console.log(`   ${label.split('：')[0]}　${((Date.now() - t0) / 1000).toFixed(1)} 秒`);
}

const range = (a, b) => { const out = []; for (let i = a; i <= b; i++) out.push(i); return out; };
/* 份量：日常跑精簡版（幾秒），改到 claim-arbiter／flow 時用 NET_FULL=1 跑完整版（約兩分半）。
   完整版 2026-09-23 實測：166 場 664 局全數一致，模擬換群主 35,145 次。 */
const FULL = !!process.env.NET_FULL;
const N = FULL ? { cheap: 120, handoff: 40, ai: 6 } : { cheap: 12, handoff: 4, ai: 0 };
sweep(`簡易打法 ${N.cheap} 場：逐事件一致、沒人偷看別人的牌、每個視窗都問滿三家`, 'cheap', range(1, N.cheap), false);
sweep(`簡易打法 ${N.handoff} 場＋每回一家就換一次群主（經 Firebase 往返）：照樣一致`, 'cheap', range(201, 200 + N.handoff), true);
// 真 AI 一場就要十幾秒（每張牌都在算危險度），只在完整版跑
if (N.ai) sweep(`真 AI 打法 ${N.ai} 場（會讀牌河、算危險度）：一致而且沒偷看`, 'ai', range(301, 300 + N.ai), false);
else console.log('   真 AI 打法　略過（NET_FULL=1 才跑）');

console.log(`   ─ 共 ${totals.seeds} 場 ${totals.hands} 局；宣告視窗 中央 ${totals.a} 次 → 群主 ${totals.b} 次` +
            `（多出來的都是「全員秒回 pass」）；模擬換群主 ${totals.handoffs} 次`);

console.log('═══ 任何時刻都只有群主說了算 ═══');

{
  const m = newMatch(55);
  const ctx = { seatInfo: {}, now: 1, claimTimeoutMs: 8000, announce: true };
  const r = F.startMatch(m, ctx);
  eq(r.waiting.kind, 'turn', '開局：群主宣布輪到誰');
  const me = r.waiting.seat;
  const other = (me + 1) % 4;

  let x = F.submit(m, { type: 'discard', seat: other, tileIndex: 0 }, ctx);
  eq(x.ok, false, '沒輪到的人搶著打牌 → 群主拒絕');

  x = F.submit(m, { type: 'discard', seat: me, tileIndex: 0 }, ctx);
  eq(x.ok, true, '輪到的人打牌 → 收下');
  eq(x.waiting.kind, 'claim', '打完一定開宣告視窗（群主不知道誰能鳴，只能問）');
  eq(x.waiting.seats.slice().sort().join(','), [0, 1, 2, 3].filter(s => s !== me).sort().join(','),
     '問的是另外三家');

  const win = m.hand.claim;
  x = F.submit(m, { type: 'claim', seat: me, seq: win.seq, decision: { type: 'pass' } }, ctx);
  eq(x.ok, false, '打牌的人自己不能插嘴');

  x = F.submit(m, { type: 'claim', seat: other, seq: win.seq - 1, decision: { type: 'pass' } }, ctx);
  eq(x.ok, false, '舊視窗的回覆（封包遲到）→ 群主拒絕');

  x = F.submit(m, { type: 'claim', seat: other, seq: win.seq, decision: { type: 'pass', couldRon: false } }, ctx);
  eq(x.ok, true, '被問到的人回覆 → 收下');
  x = F.submit(m, { type: 'claim', seat: other, seq: win.seq, decision: { type: 'pong', couldRon: false } }, ctx);
  eq(x.ok, false, '同一家回兩次 → 第二次拒絕（不能反悔）');
}

console.log('═══ 手慢不會錯過：群主等的是「回齊」，不是時間 ═══');

{
  const m = newMatch(66);
  const ctx = { seatInfo: {}, now: 1000, claimTimeoutMs: 20000, announce: true };
  F.startMatch(m, ctx);
  const h = m.hand;
  h.turn = 0; h.phase = 'discard';
  h.seats[0].hand = T('5萬 1筒 2筒 3筒 4筒 5筒 6筒 7筒 8筒 9筒 1條 2條 3條 東');
  h.seats[2].hand = T('5萬 5萬 9條 9條 1筒 2筒 3筒 4筒 5筒 6筒 7筒 8筒 9筒');   // 碰得到
  [1, 3].forEach(s => { h.seats[s].hand = T('1萬 4萬 7萬 1筒 4筒 7筒 1條 4條 7條 東 南 西 北'); });
  F.submit(m, { type: 'discard', seat: 0, tileIndex: 0 }, ctx);

  // 1、3 家沒東西 → 用戶端秒回 pass
  [1, 3].forEach(s => {
    const view = viewFor(m.hand, s);
    const d = C.selfResponse(view, s, view.claim, () => { throw new Error('沒東西還跳視窗'); });
    eq(d.type, 'pass', `座位 ${s} 沒得鳴：不跳視窗、直接回 pass`);
    F.submit(m, { type: 'claim', seat: s, seq: m.hand.claim.seq, decision: d }, ctx);
  });

  // 2 家還在想 —— 過了 15 秒，群主還是在等他
  const w = F.waiting(m, { now: 1000 + 15000 });
  eq(w.kind, 'claim', '15 秒後群主仍在等');
  eq(w.seats.join(','), '2', '等的就是那個能碰的人');

  const view = viewFor(m.hand, 2);
  const d = C.selfResponse(view, 2, view.claim, (hh, ss, opt) => (opt.pong ? { type: 'pong' } : { type: 'pass' }));
  const r = F.submit(m, { type: 'claim', seat: 2, seq: m.hand.claim.seq, decision: d },
                     Object.assign({}, ctx, { now: 1000 + 15000 }));
  eq(r.ok, true, '他終於按了碰 → 收下');
  eq(m.hand.turn, 2, '碰成立，換他出牌 —— 沒有因為手慢而過水');
}

console.log('═══ 碰代替胡：群主模式照樣過水 ═══');

{
  const m = newMatch(77);
  const ctx = { seatInfo: {}, now: 1, claimTimeoutMs: 8000, announce: true };
  F.startMatch(m, ctx);
  const h = m.hand;
  h.turn = 0; h.phase = 'discard';
  h.seats[0].hand = T('6萬 1筒 2筒 3筒 4筒 5筒 6筒 7筒 8筒 9筒 1條 2條 3條 東');
  // 雙碰聽 6萬／9條，手上兩張 6萬：這張 6萬 胡得了也碰得了
  h.seats[1].hand = T('1萬 2萬 3萬 4萬 5萬 6萬 6萬 6萬 1筒 1筒 1筒 9條 9條');
  [2, 3].forEach(s => { h.seats[s].hand = T('1萬 4萬 7萬 1筒 4筒 7筒 1條 4條 7條 東 南 西 北'); });
  F.submit(m, { type: 'discard', seat: 0, tileIndex: 0 }, ctx);

  const view = viewFor(m.hand, 1);
  const d = C.selfResponse(view, 1, view.claim, () => ({ type: 'pong' }));
  eq(d.couldRon, true, '用戶端自己回報：這張我本來胡得了');
  F.submit(m, { type: 'claim', seat: 1, seq: m.hand.claim.seq, decision: d }, ctx);
  [2, 3].forEach(s => {
    const v = viewFor(m.hand, s);
    F.submit(m, { type: 'claim', seat: s, seq: m.hand.claim.seq,
                  decision: C.selfResponse(v, s, v.claim, () => ({ type: 'pass' })) }, ctx);
  });
  ok(m.hand.seats[1].furitenTemp, '⚠️ 碰成立，而且過水了（群主靠的是他自報的 couldRon）');
  eq(m.hand.seats[1].melds.length, 1, '碰確實成立');
}

{
  // 能胡卻逾時（斷線、發呆）→ 一樣過水，不能變成一條不會過水的路
  const m = newMatch(79);
  const ctx = { seatInfo: {}, now: 1000, claimTimeoutMs: 20000, announce: true };
  F.startMatch(m, ctx);
  const h = m.hand;
  h.turn = 0; h.phase = 'discard';
  h.seats[0].hand = T('3萬 1筒 2筒 3筒 4筒 5筒 6筒 7筒 8筒 9筒 1條 2條 3條 東');
  // ⚠️ 逾時的要是**對家**（座位 2）。若用下家，流程一往下走他就摸牌，
  //    過水本來就該在摸牌時解除 —— 那樣測不出東西。
  h.seats[2].hand = T('1萬 2萬 3萬 4萬 5萬 6萬 7萬 8萬 1筒 1筒 1筒 9條 9條');   // 聽 3萬／6萬
  [1, 3].forEach(s => { h.seats[s].hand = T('1萬 4萬 7萬 1筒 4筒 7筒 1條 4條 7條 東 南 西 北'); });
  F.submit(m, { type: 'discard', seat: 0, tileIndex: 0 }, ctx);
  [1, 3].forEach(s => {
    const v = viewFor(m.hand, s);
    F.submit(m, { type: 'claim', seat: s, seq: m.hand.claim.seq,
                  decision: C.selfResponse(v, s, v.claim, () => ({ type: 'pass' })) }, ctx);
  });
  // 座位 2 一直沒回，20 秒逾時
  const r = F.run(m, Object.assign({}, ctx, { now: 1000 + 20001 }));
  ok(r.waiting && r.waiting.kind !== 'claim', '逾時後群主不再等，流程往下走');
  eq(m.hand.turn, 1, '輪到下家');
  ok(m.hand.seats[2].furitenTemp, '⚠️ 能胡卻逾時 → 群主代算，照樣過水');
}

{
  // 自相矛盾的回覆：說自己不能胡卻喊胡 —— 程式 bug 的警報
  const m = newMatch(78);
  const ctx = { seatInfo: {}, now: 1, claimTimeoutMs: 8000, announce: true };
  const r = F.startMatch(m, ctx);
  F.submit(m, { type: 'discard', seat: r.waiting.seat, tileIndex: 0 }, ctx);
  const seat = m.hand.claim.ask.map(Number)[0];
  const x = F.submit(m, { type: 'claim', seat, seq: m.hand.claim.seq,
                          decision: { type: 'ron', couldRon: false } }, ctx);
  eq(x.ok, false, '喊胡卻自報不能胡 → 群主擋掉');
}

console.log('═══ 斷線代打：統一天下要靠自己 ═══');

const CP = require('../src/campaign.js');

/* 打到 seat 的回合之前的最後一刻（別人的回合），其餘座位用簡易打法 */
function playUntil(m, ctx, stopFn, maxSteps) {
  let r = { waiting: F.waiting(m, ctx) };
  for (let i = 0; i < (maxSteps || 400); i++) {
    if (stopFn(m, r.waiting)) return r;
    const w = r.waiting;
    if (!w || w.kind === 'matchOver') return r;
    if (w.kind === 'turn') {
      const v = viewFor(m.hand, w.seat);
      r = F.turnOptions(v, w.seat).canTsumo
        ? F.submit(m, { type: 'tsumo', seat: w.seat }, ctx)
        : F.submit(m, { type: 'discard', seat: w.seat, tileIndex: v.seats[w.seat].hand.length - 1 }, ctx);
    } else if (w.kind === 'claim') {
      const seat = w.seats[0];
      const v = viewFor(m.hand, seat);
      r = F.submit(m, { type: 'claim', seat, seq: m.hand.claim.seq,
                        decision: C.selfResponse(v, seat, v.claim, () => ({ type: 'pass' })) }, ctx);
    } else return r;
  }
  return r;
}

{
  // 斷線、武將接手，但還沒輪到他就回來了 → 電腦一步都沒動，不算代打
  const m = newMatch(501);
  const ctx = { seatInfo: {}, now: 1, claimTimeoutMs: 8000, announce: true };
  let r = F.startMatch(m, ctx);
  const me = r.waiting.seat;
  const gone = (me + 2) % 4;                       // 對家，離輪到他還有一家
  const ev = F.startSub(m, gone, { general: '田忌', now: 5 });
  eq(ev[0] && ev[0].t, 'subStart', '開始代打會產生廣播事件');
  eq(m.seats[gone].sub.general, '田忌', '名牌要顯示的武將記在狀態裡');
  F.endSub(m, gone);
  eq(m.seats[gone].sub, null, '回來了，代打結束');
  eq(m.seats[gone].subbed, false, '⚠️ 電腦還沒替他出手 → 不算代打，這一場照算');
  ok(CP.creditable(m, gone), '戰果照記');
}

{
  // 電腦真的替他打了一張 → 這一場不算他的，回來也一樣
  const m = newMatch(502);
  const ctx = { seatInfo: {}, now: 1, claimTimeoutMs: 8000, announce: true };
  let r = F.startMatch(m, ctx);
  const gone = (r.waiting.seat + 1) % 4;
  F.startSub(m, gone, { general: '樂毅' });
  const before = m.hand.seats[gone].discards.length;
  r = playUntil(m, ctx, mm => mm.hand.seats[gone].discards.length > before);
  ok(m.hand.seats[gone].discards.length > before, '輪到他時，群主讓武將替他打了');
  ok(!(r.waiting && r.waiting.kind === 'turn' && r.waiting.seat === gone), '群主沒有停下來等斷線的人');
  eq(m.seats[gone].subbed, true, '⚠️ 電腦出手了 → 這一場記為代打');

  const back = F.endSub(m, gone);
  eq(back[0].subbed, true, '回來時的事件告訴他這一場已經不算了（畫面要跟他說）');
  eq(m.seats[gone].sub, null, '回來之後可以自己繼續打');
  eq(m.seats[gone].subbed, true, '但 subbed 不會因為回來就清掉');
  ok(!CP.creditable(m, gone), '戰果不記給他');
  ok([0, 1, 2, 3].filter(x => x !== gone).every(x => CP.creditable(m, x)), '別家照記');

  // 回來之後輪到他，群主要等他自己打
  r = playUntil(m, ctx, (mm, w) => w && w.kind === 'turn' && w.seat === gone);
  ok(r.waiting && r.waiting.kind === 'turn' && r.waiting.seat === gone, '回來之後輪到他，群主等他本人出手');
}

{
  // 換群主（經 Firebase 往返）之後，代打狀態與「這一場不算」都不能掉
  const m = newMatch(503);
  const ctx = { seatInfo: {}, now: 1, claimTimeoutMs: 8000, announce: true };
  let r = F.startMatch(m, ctx);
  const gone = (r.waiting.seat + 1) % 4;
  F.startSub(m, gone, { general: '龐涓' });
  const before = m.hand.seats[gone].discards.length;
  playUntil(m, ctx, mm => mm.hand.seats[gone].discards.length > before);
  const m2 = viaFirebase(m);
  eq(m2.seats[gone].sub && m2.seats[gone].sub.general, '龐涓', '新群主接手：還知道誰在代打');
  eq(m2.seats[gone].subbed, true, '新群主接手：還知道這一場不算他的');
  const others = [0, 1, 2, 3].filter(x => x !== gone);
  ok(others.every(x => m2.seats[x].sub === null && m2.seats[x].subbed === false),
     '沒斷線的人：Firebase 吃掉的 null／false 補回來了');
  const w = F.waiting(m2, ctx);
  ok(!(w && w.kind === 'turn' && w.seat === gone), '新群主也不會停下來等斷線的人');
}

{
  // 代打座位有東西可鳴 → 電腦替他決定要不要碰，也算出手
  const m = newMatch(504);
  const ctx = { seatInfo: {}, now: 1, claimTimeoutMs: 8000, announce: true };
  F.startMatch(m, ctx);
  const h = m.hand;
  h.turn = 0; h.phase = 'discard';
  h.seats[0].hand = T('5萬 1筒 2筒 3筒 4筒 5筒 6筒 7筒 8筒 9筒 1條 2條 3條 東');
  h.seats[2].hand = T('5萬 5萬 9條 9條 1筒 2筒 3筒 4筒 5筒 6筒 7筒 8筒 9筒');
  [1, 3].forEach(x => { h.seats[x].hand = T('1萬 4萬 7萬 1筒 4筒 7筒 1條 4條 7條 東 南 西 北'); });
  F.startSub(m, 2, { general: '廉頗' });
  F.submit(m, { type: 'discard', seat: 0, tileIndex: 0 }, ctx);
  [1, 3].forEach(x => {
    const v = viewFor(m.hand, x);
    if (m.hand.claim) F.submit(m, { type: 'claim', seat: x, seq: m.hand.claim.seq,
      decision: C.selfResponse(v, x, v.claim, () => ({ type: 'pass' })) }, ctx);
  });
  eq(m.seats[2].subbed, true, '碰得到的那一家在代打中 → 電腦替他決定了，記為代打');
}

{
  // 代打座位沒東西可鳴：秒回 pass 不算出手（那不是決定）
  const m = newMatch(505);
  const ctx = { seatInfo: {}, now: 1, claimTimeoutMs: 8000, announce: true };
  F.startMatch(m, ctx);
  const h = m.hand;
  h.turn = 0; h.phase = 'discard';
  h.seats[0].hand = T('5萬 1筒 2筒 3筒 4筒 5筒 6筒 7筒 8筒 9筒 1條 2條 3條 東');
  [1, 2, 3].forEach(x => { h.seats[x].hand = T('1萬 4萬 7萬 1筒 4筒 7筒 1條 4條 7條 東 南 西 北'); });
  F.startSub(m, 2, { general: '王翦' });
  F.submit(m, { type: 'discard', seat: 0, tileIndex: 0 }, ctx);
  eq(m.seats[2].subbed, false, '沒得鳴、只是自動回 pass → 不算代打');
}

console.log('═══ 廣播事件不能帶別人摸到的牌 ═══');

{
  const m = newMatch(88);
  const ctx = { seatInfo: {}, now: 1, claimTimeoutMs: 8000, announce: true };
  const r = F.startMatch(m, ctx);
  const drawEv = r.events.find(e => e.t === 'draw');
  ok(drawEv && drawEv.tile, '前提：原始事件裡 draw 帶著牌');
  const mine = F.eventsFor(r.events, drawEv.seat).find(e => e.t === 'draw');
  ok(mine.tile && mine.tile.display === drawEv.tile.display, '摸牌的本人收到完整事件');
  const others = [0, 1, 2, 3].filter(s => s !== drawEv.seat);
  ok(others.every(s => {
    const e = F.eventsFor(r.events, s).find(x => x.t === 'draw');
    return e && e.seat === drawEv.seat && e.tile === undefined;
  }), '⚠️ 別家只知道「他摸了一張」，不知道是什麼');
  ok(drawEv.tile, 'eventsFor 不能改到原始事件（群主自己還要用）');
}

console.log('\n─────────────────────────');
console.log(`通過 ${pass}　失敗 ${fail}`);
if (fail) { fails.forEach(f => console.log('  ✗ ' + f)); process.exit(1); }
console.log('全部通過 ✓');
