/* 宣戰（v1.92，docs/dora-and-declare.md 第三節、第十一節定案）的規則、計分、電腦
   執行： node test/declare.test.js                                          */
const S = require('../src/game-state.js');
const F = require('../src/flow.js');
const C = require('../src/claim-arbiter.js');
const SC = require('../src/scoring.js');
const AI = require('../src/ai.js');
const SK = require('../src/skills.js');

let pass = 0, fail = 0;
const fails = [];
function ok(cond, name, detail) {
  if (cond) { pass++; }
  else { fail++; fails.push(name + (detail ? '　→ ' + detail : '')); }
}
function eq(a, b, name) { ok(a === b, name, `得到 ${JSON.stringify(a)}，預期 ${JSON.stringify(b)}`); }

let _uid = 50000;
function T(str) {
  return str.trim().split(/\s+/).map(d => {
    const m = d.match(/^(\d+)(.+)$/);
    return m ? { suit: m[2], num: +m[1], display: d, isHonor: false, uid: _uid++ }
             : { suit: d, num: 0, display: d, isHonor: true, uid: _uid++ };
  });
}
const SAFE = '1筒 3筒 5筒 7筒 9筒 1條 3條 5條 7條 9條 北 中 白';
/* 輪到座位 0 打牌，手牌 mine（14 張）；別家拿安全牌 */
function table(mine, opts) {
  const o = opts || {};
  const m = S.createMatch({ seed: 5, seats: [0, 1, 2, 3].map(i => ({ name: 'P' + i })) });
  S.startHand(m, { dealer: 0 });
  const h = m.hand;
  h.seats.forEach((st, i) => { st.hand = T(i === 0 ? mine : SAFE); st.melds = []; st.discards = []; });
  if (o.melds) h.seats[0].melds = o.melds;
  h.turn = 0; h.phase = 'discard';
  if (o.live != null) h.drawIdx = h.deadWallStart - o.live;
  return { m, h };
}
const ctx = { seatInfo: { 0: {}, 1: { isAI: true }, 2: { isAI: true }, 3: { isAI: true } }, claimTimeoutMs: 0, now: 1,
              chooseDiscard: (hand, seat) => hand.seats[seat].hand.length - 1, pauseAfter: ['discard'] };
const TENPAI14 = '1萬 2萬 3萬 4萬 5萬 6萬 7萬 8萬 9萬 東 東 東 南 西';   // 打南（聽西）或打西（聽南）都聽

console.log('═══ 能不能宣戰 ═══');
{
  const { h } = table(TENPAI14);
  const c = F.declareTiles(h, 0).map(i => h.seats[0].hand[i].display).sort().join(',');
  eq(c, '南,西', '打掉後聽牌的那幾張可以拿來宣戰（南、西）');
  eq(F.turnOptions(h, 0).declare.length, 2, 'turnOptions 也給宣戰的選項');
  eq(F.declareTiles(table('1萬 2萬 3萬 4萬 5萬 6萬 7萬 8萬 1筒 東 東 西 南 北').h, 0).length, 0, '打哪張都不聽：不能宣戰');
  eq(F.declareTiles(table(TENPAI14, { live: 3 }).h, 0).length, 0, '活牌山剩 3 張：不能宣戰');
  eq(F.declareTiles(table(TENPAI14, { live: 4 }).h, 0).length, 2, '活牌山剩 4 張：可以');
}
console.log('═══ 宣戰之後 ═══');
{
  const { m, h } = table(TENPAI14);
  const iN = h.seats[0].hand.findIndex(t => t.display === '1萬');
  eq(F.submit(m, { type: 'declare', seat: 0, tileIndex: iN }, ctx).ok, false, '打掉後不聽的那張不能拿來宣戰');
  const iS = h.seats[0].hand.findIndex(t => t.display === '南');
  const r = F.submit(m, { type: 'declare', seat: 0, tileIndex: iS }, ctx);
  ok(r.ok, '宣戰成功', r.reason);
  ok(r.events.some(e => e.t === 'declare' && e.seat === 0), '廣播 declare 事件');
  ok(h.seats[0].declared && h.seats[0].declared.menzen === true, '記下宣戰、門清');
  eq(h.seats[0].discards.slice(-1)[0].display, '南', '宣戰同時打出那一張');
  eq(F.declareTiles(h, 0).length, 0, '已經宣戰過：不能再宣');
  // 輪回座位 0：鎖手
  h.turn = 0; h.phase = 'discard'; h.seats[0].hand.push(T('5筒')[0]);
  const opt = F.turnOptions(h, 0);
  eq(opt.kongs.length, 0, '宣戰後不能槓');
  eq(opt.onlyIndex, h.seats[0].hand.length - 1, '只能打剛摸的那張');
  eq(F.submit(m, { type: 'discard', seat: 0, tileIndex: 0 }, ctx).ok, false, '打別張：拒絕');
  h.turn = 0; h.phase = 'discard';
  ok(F.submit(m, { type: 'discard', seat: 0, tileIndex: h.seats[0].hand.length - 1 }, ctx).ok, '打剛摸的那張：可以');
}
{
  // 有吃碰：不是門清
  const meld = [{ type: 'pong', tiles: T('白 白 白') }];
  const { m, h } = table('1萬 2萬 3萬 4萬 5萬 6萬 7萬 8萬 9萬 南 西', { melds: meld });
  const i = h.seats[0].hand.findIndex(t => t.display === '南');
  ok(F.submit(m, { type: 'declare', seat: 0, tileIndex: i }, ctx).ok, '有碰也能宣戰（不要求門清）');
  eq(h.seats[0].declared.menzen, false, '有碰：不是門清');
}
console.log('═══ 宣戰後的技能 ═══');
{
  const { h } = table(TENPAI14);
  const han = SK.createState('han'), zhao = SK.createState('zhao'), yan = SK.createState('yan');
  ok(SK.canUse(han, h, 0).ok, '（前提）還沒宣戰：韓的換牌可以用');
  h.seats[0].declared = { at: 0, menzen: true };
  eq(SK.canUse(han, h, 0).why, '宣戰之後不能換牌', '宣戰後：韓的換牌不能用');
  ok(!SK.canUse(zhao, h, 0).ok, '宣戰後：趙的換牌也不能用');
  ok(SK.canUse(yan, h, 0).ok, '宣戰後：燕的窺探（只看不換）照樣能用');
}
console.log('═══ 宣告視窗：鎖手、振聽升級 ═══');
{
  const { h } = table(TENPAI14);
  h.seats[1].declared = { at: 0, menzen: true };
  h.seats[1].hand = T('1萬 2萬 3萬 4萬 5萬 6萬 7萬 8萬 9萬 東 東 南 南');   // 聽東、南（雙碰）
  h.lastDiscard = { seat: 0, tile: T('南')[0], seq: 1 };
  const o = C.buildOptions(h, 1);
  ok(o.ron && !o.pong && !o.kong && !o.chi.length, '宣戰的人：可以榮和，不能碰／槓／吃', JSON.stringify(o));
  C.applyDeclinedRonFuriten(h, { declinedRon: [1] });
  ok(h.seats[1].furitenLocked, '放過榮和 → 永久振聽');
  h.seats[1].furitenTemp = false;                       // 摸牌解除同巡振聽
  h.lastDiscard = { seat: 2, tile: T('東')[0], seq: 2 };
  ok(!C.buildOptions(h, 1).ron, '摸過牌（同巡振聽解除）仍然不能榮和');
  // 沒宣戰的人放過：只有同巡振聽
  const t2 = table(TENPAI14).h;
  C.applyDeclinedRonFuriten(t2, { declinedRon: [2] });
  ok(!t2.seats[2].furitenLocked, '沒宣戰的人放過榮和：不會永久振聽');
}
console.log('═══ 計分：裏祥瑞、宣戰加成、押金 ═══');
{
  const WIN = '1萬 2萬 3萬 4萬 5萬 6萬 7萬 8萬 9萬 東 東 東 南 南';
  const mk = (declared, menzen) => {
    const { m, h } = table(WIN);
    h.doraShown = T('1筒');                             // 表祥瑞 2筒：手上沒有
    h.wall[h.doraBase + 1] = T('8萬')[0];                // 裏指示牌 8萬 → 裏祥瑞 9萬：手上一張
    if (declared) h.seats[0].declared = { at: 0, menzen };
    return { m, h };
  };
  const a = SC.handValue(mk(false).h, 0, {});
  const b = SC.handValue(mk(true, true).h, 0, {});
  const c = SC.handValue(mk(true, false).h, 0, {});
  eq(a.ura, 0, '沒宣戰：不翻裏祥瑞');
  eq(b.ura, 1, '宣戰胡：裏祥瑞 1（裏指示牌 8萬 → 9萬）');
  eq(b.uraIndicators.join(','), '8萬', '結果帶著裏指示牌（給結算畫面翻開）');
  eq(b.total - a.total, SC.DORA_PTS + SC.DECLARE_PTS + SC.DECLARE_MENZEN_PTS, '門清宣戰：多 裏祥瑞 20＋宣戰 30＋門清 20');
  eq(c.total - a.total, SC.DORA_PTS + SC.DECLARE_PTS, '非門清宣戰：多 裏祥瑞 20＋宣戰 30');
  // 善守不打折宣戰那一段
  const pay = (decl, payer) => { const t = mk(decl, true);
    const r = SC.settleWin(t.m, t.h, { type: 'ron', from: 2, winners: [{ seat: 0 }] }, { seatInfo: { 2: { kingdom: payer } } });
    return r.transfers.reduce((n, x) => n + x.pts, 0); };
  eq(pay(true, 'qi') - pay(false, 'qi'), SC.DORA_PTS + SC.DECLARE_PTS + SC.DECLARE_MENZEN_PTS, '齊放槍：宣戰那一段不打折');
  // 押金
  const t = mk(true, true);
  t.h.seats[2].declared = { at: 0, menzen: true };
  const sk = SC.settleStakes(t.m, t.h, { type: 'ron', from: 2, winners: [{ seat: 0 }] }, {});
  eq(sk.stakes.filter(x => x.declare).map(x => x.seat).join(','), '0,2', '宣戰的兩家各押 50 進彩池');
  eq(sk.paid.reduce((n, p) => n + p.pts, 0), 2 * SC.DECLARE_STAKE, '胡的人拿走彩池（含自己的押金）');
  eq(sk.potAfter, 0, '有人胡：彩池清空');
  const d = SC.settleStakes(t.m, t.h, { type: 'draw', winners: [] }, {});
  eq(d.potAfter, 2 * SC.DECLARE_STAKE, '流局：押金留在彩池');
}
console.log('═══ 電腦：初學不宣、普通一律宣、高手自己判斷 ═══');
{
  const { h } = table(TENPAI14);
  const cand = F.declareTiles(h, 0);
  eq(AI.declareFor(h, 0, 1, cand), null, '初學：不宣戰');
  ok(cand.includes(AI.declareFor(h, 0, 2, cand)), '普通：宣戰，打出的是可以宣戰的那張');
  const t4 = table(TENPAI14, { live: 4 }).h;
  ok(F.declareTiles(t4, 0).includes(AI.declareFor(t4, 0, 2, F.declareTiles(t4, 0))), '普通：牌山只剩 4 張也宣（一律宣戰）');
  eq(AI.declareFor(h, 0, 2, cand), AI.declareFor(h, 0, 2, cand), '同一份牌局算兩次結果一樣（可重放）');
  eq(AI.declareFor(h, 0, 3, cand), null, '高手：單吊（只剩 3 張可摸，< 4）→ 不宣');
  const RYANMEN = '1萬 2萬 3萬 4萬 5萬 6萬 7萬 8萬 東 東 東 南 南 西';   // 打西 → 聽 3萬、6萬、9萬（剩 10 張）
  const g = table(RYANMEN).h, gc = F.declareTiles(g, 0);
  eq(gc.map(i => g.seats[0].hand[i].display).join(','), '西', '（前提）兩面聽：打西宣戰');
  eq(AI.declareFor(g, 0, 3, gc), gc[0], '高手：兩面聽、剩張夠 → 宣戰');
  g.seats[2].declared = { at: 0, menzen: true };
  eq(AI.declareFor(g, 0, 3, gc), null, '高手：別家已經宣戰 → 不宣，轉防守');
  eq(AI.declareFor(g, 0, 2, gc), gc[0], '普通：別家宣戰了照樣宣');
  eq(AI.threatLevel(g, 2), 1, '有人宣戰：他的威脅拉滿（確定聽牌）');
  // 聽牌很差：要的牌場上都看得到了
  const bad = table(RYANMEN).h;
  bad.seats[1].discards = T('3萬 3萬 3萬 6萬 6萬 6萬 9萬 9萬 9萬');
  eq(AI.declareFor(bad, 0, 3, F.declareTiles(bad, 0)), null, '高手：要的牌幾乎被打光（剩 1 張）→ 不宣');
  eq(AI.declareFor(table(RYANMEN, { live: 5 }).h, 0, 3, gc), null, '高手：牌山剩 5 張（< 6）→ 不宣');
}
{
  // 留祥瑞：牌效一樣時不打祥瑞
  const { h } = table('1萬 2萬 3萬 4萬 5萬 6萬 7萬 8萬 9萬 東 東 東 北 西');
  h.doraShown = T('南');                                 // 祥瑞 西
  const i = AI.chooseDiscard(h, 0, { level: 2 });
  ok(h.seats[0].hand[i].display !== '西', '北、西一樣沒用：留下祥瑞西、打北', h.seats[0].hand[i].display);
}

console.log('═══ 代打的武將不宣戰 ═══');
{
  // 座位 0 是真人，被武將代打（普通難度＝聽牌就宣戰）：不能替本人宣戰
  const { m, h } = table(TENPAI14);
  F.startSub(m, 0, { general: '王翦', now: 1, idle: true });
  const hooks = AI.flowHooks();
  const c2 = Object.assign({}, ctx, hooks, { seatInfo: { 0: {}, 1: { isAI: true, aiLevel: 2 }, 2: { isAI: true, aiLevel: 2 }, 3: { isAI: true, aiLevel: 2 } },
                                             pauseAfter: ['discard'] });
  h.phase = 'discard'; h.turn = 0;
  F.run(m, c2);
  ok(!h.seats[0].declared, '代打中：聽牌也不替本人宣戰（押金、不能撤回留給本人）', JSON.stringify(h.seats[0].declared));
  ok(h.seats[0].discards.length === 1, '（前提）武將照常替他打了一張', String(h.seats[0].discards.length));
  // 對照：同一副牌，電腦守將（普通）會宣戰
  const t2 = table(TENPAI14);
  t2.m.seats[0].isAI = true;
  const c3 = Object.assign({}, c2, { seatInfo: Object.assign({}, c2.seatInfo, { 0: { isAI: true, aiLevel: 2 } }) });
  F.run(t2.m, c3);
  ok(!!t2.h.seats[0].declared, '對照：電腦守將（普通）同一副牌會宣戰', JSON.stringify(t2.h.seats[0].declared));
}

console.log('\n─────────────────────────');
console.log(`通過 ${pass}　失敗 ${fail}`);
if (fail) { fails.forEach(f => console.log('  ✗ ' + f)); process.exit(1); }
console.log('全部通過 ✓');
