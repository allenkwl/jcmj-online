/* scoring 的驗證測試
   這一層最容易出的錯是「分數憑空多出來或消失」——
   所以每一項點數移轉都順便驗零和。
   執行： node test/scoring.test.js                               */
const SC = require('../src/scoring.js');
const S = require('../src/game-state.js');
const R = require('../src/rules-core.js');

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

/* 一局，莊家是 dealer，手牌由測試指定 */
function table(dealer, hands, honba) {
  const m = S.createMatch({ seed: 3, seats: [0, 1, 2, 3].map(i => ({ name: 'P' + i })) });
  m.honba = honba || 0;
  S.startHand(m, { dealer });
  const h = m.hand;
  (hands || []).forEach((str, i) => {
    if (str) h.seats[i].hand = T(str);
    h.seats[i].melds = [];
    h.seats[i].discards = [];
  });
  return { m, h };
}

const zeroSum = tr => tr.reduce((n, t) => n + t.pts, 0) * 0 ===
                      0 && tr.every(t => t.pts > 0);
function netOf(tr) {
  const net = [0, 0, 0, 0];
  tr.forEach(t => { net[t.from] -= t.pts; net[t.to] += t.pts; });
  return net;
}

console.log('═══ 役牌（風位終於參與計分）═══');

{
  // 莊家的東是連風 —— 場風與自風都是東，算兩次
  const { h } = table(0, ['東 東 東 1萬 2萬 3萬 4筒 5筒 6筒 7條 8條 9條 白 白']);
  const y = SC.yakuhaiBonus(h, 0);
  eq(y.hits.length, 2, '莊家的東刻子算兩次（連風）');
  eq(y.pts, SC.YAKUHAI_PTS * 2, '連風給兩份役牌分');
  ok(y.hits.some(x => x.kind === 'roundWind'), '其中一份是場風');
  ok(y.hits.some(x => x.kind === 'seatWind'), '另一份是自風');
}

{
  // 座位 1 在莊家 0 之下是南家：東只是場風，南才是自風
  const { h } = table(0, [null, '東 東 東 1萬 2萬 3萬 4筒 5筒 6筒 7條 8條 9條 白 白']);
  eq(S.seatWind(h, 1), '南', '座位 1 是南家');
  const y = SC.yakuhaiBonus(h, 1);
  eq(y.hits.length, 1, '東對南家只是場風，算一次');

  const { h: h2 } = table(0, [null, '南 南 南 1萬 2萬 3萬 4筒 5筒 6筒 7條 8條 9條 白 白']);
  eq(SC.yakuhaiBonus(h2, 1).hits.length, 1, '自風南也算一次');

  const { h: h3 } = table(0, [null, '西 西 西 1萬 2萬 3萬 4筒 5筒 6筒 7條 8條 9條 白 白']);
  eq(SC.yakuhaiBonus(h3, 1).pts, 0, '不是自風也不是場風的風牌不給分');
}

{
  // 三元牌
  const { h } = table(0, [null, '中 中 中 發 發 發 1萬 2萬 3萬 4筒 5筒 6筒 9條 9條']);
  eq(SC.yakuhaiBonus(h, 1).pts, SC.YAKUHAI_PTS * 2, '兩組三元牌給兩份');
}

{
  // 副露的刻子一樣算
  const { h } = table(0, [null, '1萬 2萬 3萬 4筒 5筒 6筒 7條 8條 9條 白 白']);
  h.seats[1].melds = [{ type: 'pong', tiles: T('中 中 中'), from: 0 }];
  eq(SC.yakuhaiBonus(h, 1).pts, SC.YAKUHAI_PTS, '碰出來的三元牌也算役牌');
}

{
  // 只有兩張不算刻子
  const { h } = table(0, [null, '中 中 1萬 2萬 3萬 4筒 5筒 6筒 7條 8條 9條 白 白']);
  eq(SC.yakuhaiBonus(h, 1).pts, 0, '對子不是刻子，不給役牌分');
}

console.log('═══ 莊家加成與本場 ═══');

{
  const { h } = table(0, ['1萬 2萬 3萬 4筒 5筒 6筒 7條 8條 9條 1條 2條 3條 白 白',
                          '1萬 2萬 3萬 4筒 5筒 6筒 7條 8條 9條 1條 2條 3條 白 白']);
  const dealer = SC.handValue(h, 0, {});
  const other = SC.handValue(h, 1, {});
  ok(dealer.isDealer, '座位 0 是莊家');
  ok(!other.isDealer, '座位 1 不是莊家');
  eq(dealer.total, Math.ceil(other.total * SC.DEALER_MULT), '莊家胡牌多 1.5 倍');
}

{
  const a = table(0, ['1萬 2萬 3萬 4筒 5筒 6筒 7條 8條 9條 1條 2條 3條 白 白'], 0);
  const b = table(0, ['1萬 2萬 3萬 4筒 5筒 6筒 7條 8條 9條 1條 2條 3條 白 白'], 3);
  const v0 = SC.handValue(a.h, 0, {});
  const v3 = SC.handValue(b.h, 0, {});
  eq(v3.honba, 3 * SC.HONBA_PTS, '三本場給三份本場分');
  eq(v3.total - v0.total, 3 * SC.HONBA_PTS, '本場分直接加在總分上，不受倍率影響');
}

console.log('═══ 榮和：放銃者付全額 ═══');

{
  const { m, h } = table(0, [null, '1萬 2萬 3萬 4筒 5筒 6筒 7條 8條 9條 1條 2條 3條 白 白']);
  const result = { type: 'ron', from: 2, winners: [{ seat: 1 }] };
  const { transfers } = SC.settleWin(m, h, result, {});
  eq(transfers.length, 1, '只有一筆移轉');
  eq(transfers[0].from, 2, '放銃的座位 2 付錢');
  eq(transfers[0].to, 1, '胡牌的座位 1 收錢');

  const net = netOf(transfers);
  eq(net.reduce((a, b) => a + b, 0), 0, '零和');
  eq(net[0], 0, '沒參與的座位 0 不動');
  eq(net[3], 0, '沒參與的座位 3 不動');
}

console.log('═══ 自摸：三家分攤 ═══');

{
  // 非莊自摸 —— 莊家付一半，另兩家各四分之一
  const { m, h } = table(0, [null, '1萬 2萬 3萬 4筒 5筒 6筒 7條 8條 9條 1條 2條 3條 白 白']);
  const result = { type: 'tsumo', from: null, winners: [{ seat: 1 }] };
  const { transfers, details } = SC.settleWin(m, h, result, {});
  eq(transfers.length, 3, '三家都付');

  const byFrom = {};
  transfers.forEach(t => { byFrom[t.from] = t.pts; });
  const total = details[0].total;
  eq(byFrom[0], Math.ceil(total / 2), '莊家付一半');
  eq(byFrom[2], Math.ceil(total / 4), '其他家付四分之一');
  eq(byFrom[3], Math.ceil(total / 4), '其他家付四分之一');

  const net = netOf(transfers);
  eq(net.reduce((a, b) => a + b, 0), 0, '零和');
  ok(net[1] > 0, '自摸者收錢');
}

{
  // 莊家自摸 —— 三家均分
  const { m, h } = table(0, ['1萬 2萬 3萬 4筒 5筒 6筒 7條 8條 9條 1條 2條 3條 白 白']);
  const result = { type: 'tsumo', from: null, winners: [{ seat: 0 }] };
  const { transfers, details } = SC.settleWin(m, h, result, {});
  const amounts = transfers.map(t => t.pts);
  eq(new Set(amounts).size, 1, '三家付一樣多');
  eq(amounts[0], Math.ceil(details[0].total / 3), '各付三分之一');
  eq(netOf(transfers).reduce((a, b) => a + b, 0), 0, '零和');
}

console.log('═══ 流局罰符 ═══');

{
  const { m, h } = table(0);
  const r1 = SC.settleDraw(m, h, [0], {});
  const net1 = netOf(r1.transfers);
  eq(net1.reduce((a, b) => a + b, 0), 0, '一家聽牌：零和');
  ok(net1[0] > 0, '聽牌的收錢');
  ok(net1[1] < 0 && net1[2] < 0 && net1[3] < 0, '沒聽的三家都付錢');

  const r2 = SC.settleDraw(m, h, [0, 1, 2], {});
  const net2 = netOf(r2.transfers);
  eq(net2.reduce((a, b) => a + b, 0), 0, '三家聽牌：零和');
  ok(net2[3] < 0, '唯一沒聽的那家付錢');

  eq(SC.settleDraw(m, h, [0, 1, 2, 3], {}).transfers.length, 0, '四家都聽就不移轉');
  eq(SC.settleDraw(m, h, [], {}).transfers.length, 0, '四家都沒聽也不移轉');
}

{
  // 罰符總額不會因為人數分配而漏掉或多出來
  [[0], [0, 1], [0, 1, 2]].forEach(tenpai => {
    const { m, h } = table(0);
    const tr = SC.settleDraw(m, h, tenpai, {}).transfers;
    const net = netOf(tr);
    eq(net.reduce((a, b) => a + b, 0), 0, `${tenpai.length} 家聽牌：零和`);
    const paid = -net.filter(n => n < 0).reduce((a, b) => a + b, 0);
    const got = net.filter(n => n > 0).reduce((a, b) => a + b, 0);
    eq(paid, got, `${tenpai.length} 家聽牌：付出與收到相等`);
  });
}

console.log('═══ 國家被動技能 ═══');

{
  eq(SC.growthTier(0), 0, '征服 0 國是第一級');
  eq(SC.growthTier(1), 0, '征服 1 國還是第一級');
  eq(SC.growthTier(2), 1, '征服 2 國升第二級');
  eq(SC.growthTier(4), 2, '征服 4 國升第三級');
  eq(SC.growthTier(6), 2, '征服 6 國仍是第三級（封頂）');
}

{
  // 楚 雄兵：胡牌得分 ×1.3 → 1.4 → 1.5
  const { h } = table(1, [null, null, '1萬 2萬 3萬 4筒 5筒 6筒 7條 8條 9條 1條 2條 3條 白 白']);
  const plain = SC.handValue(h, 2, {}).total;
  [0, 2, 4].forEach((conq, i) => {
    const v = SC.handValue(h, 2, { kingdom: 'chu', conquered: conq }).total;
    eq(v, Math.ceil(plain * SC.CHU_WIN[i]), `楚 征服 ${conq} 國：×${SC.CHU_WIN[i]}`);
  });
}

{
  // 秦 虎狼：只對特殊牌型生效
  const plainHand = '1萬 2萬 3萬 4筒 5筒 6筒 7條 8條 9條 1條 2條 3條 白 白';
  const { h } = table(1, [null, null, plainHand]);
  eq(SC.handValue(h, 2, { kingdom: 'qin', conquered: 0 }).total,
     SC.handValue(h, 2, {}).total, '秦對普通牌型沒有加成');

  const qing = '1萬 1萬 1萬 2萬 3萬 4萬 5萬 6萬 7萬 8萬 9萬 9萬 9萬 9萬';
  const { h: h2 } = table(1, [null, null, qing]);
  ok(SC.handValue(h2, 2, {}).special, '這手是特殊牌型');
  ok(SC.handValue(h2, 2, { kingdom: 'qin', conquered: 0 }).total >
     SC.handValue(h2, 2, {}).total, '秦對特殊牌型有加成');
}

{
  // 齊 善守：本家應付的點數打折，而且是**贏家少收**（維持零和）
  const { m, h } = table(0, [null, '1萬 2萬 3萬 4筒 5筒 6筒 7條 8條 9條 1條 2條 3條 白 白']);
  const result = { type: 'ron', from: 2, winners: [{ seat: 1 }] };

  const plain = SC.settleWin(m, h, result, {});
  const shan = SC.settleWin(m, h, result, {
    seatInfo: { 2: { kingdom: 'qi', conquered: 0 } },
  });
  ok(shan.transfers[0].pts < plain.transfers[0].pts, '善守讓放銃者少付');
  eq(shan.transfers[0].pts, Math.ceil(plain.transfers[0].pts * SC.QI_PAY[0]),
     '折扣是 0.7');

  const net = netOf(shan.transfers);
  eq(net.reduce((a, b) => a + b, 0), 0, '善守之後仍然零和（贏家少收，沒有人補差額）');
  eq(net[1], shan.transfers[0].pts, '贏家收到的就是放銃者付的');

  // 成長
  const lv3 = SC.settleWin(m, h, result, {
    seatInfo: { 2: { kingdom: 'qi', conquered: 4 } },
  });
  ok(lv3.transfers[0].pts < shan.transfers[0].pts, '征服越多，善守越強');
}

{
  // 善守對自摸的分攤與流局罰符一樣生效
  const { m, h } = table(0, [null, '1萬 2萬 3萬 4筒 5筒 6筒 7條 8條 9條 1條 2條 3條 白 白']);
  const si = { 2: { kingdom: 'qi', conquered: 0 } };
  const t = SC.settleWin(m, h, { type: 'tsumo', from: null, winners: [{ seat: 1 }] }, { seatInfo: si });
  const p = SC.settleWin(m, h, { type: 'tsumo', from: null, winners: [{ seat: 1 }] }, {});
  const get = (tr, seat) => tr.find(x => x.from === seat).pts;
  ok(get(t.transfers, 2) < get(p.transfers, 2), '善守讓自摸的分攤也變少');
  eq(get(t.transfers, 0), get(p.transfers, 0), '沒有善守的莊家照付');

  const d = SC.settleDraw(m, h, [1], { seatInfo: si });
  const dp = SC.settleDraw(m, h, [1], {});
  const paid = (tr, seat) => tr.filter(x => x.from === seat).reduce((n, x) => n + x.pts, 0);
  ok(paid(d.transfers, 2) < paid(dp.transfers, 2), '善守讓流局罰符也變少');
  eq(netOf(d.transfers).reduce((a, b) => a + b, 0), 0, '罰符打折後仍然零和');
}

console.log('═══ 連莊 ═══');

{
  // 預設不連莊：莊家每局輪一位，固定打滿四局
  const { m, h } = table(0);
  const win0 = { type: 'ron', from: 1, winners: [{ seat: 0 }] };
  const nd = SC.nextDealer(m, h, win0, {});
  eq(nd.dealer, 1, '不連莊：莊家照輪');
  eq(nd.dealerKeeps, false, '不續莊');
  eq(nd.honba, 0, '本場歸零');
}

{
  // 標準連莊：莊家胡牌就續莊
  const { m, h } = table(0);
  const nd = SC.nextDealer(m, h, { type: 'ron', from: 1, winners: [{ seat: 0 }] }, { renchan: 'repeat' });
  eq(nd.dealer, 0, '莊家胡牌 → 續莊');
  eq(nd.dealerKeeps, true, '續莊旗標');
  eq(nd.honba, 1, '本場 +1');
  eq(nd.rotations, 0, '莊沒換，輪轉數不動');

  const nd2 = SC.nextDealer(m, h, { type: 'ron', from: 0, winners: [{ seat: 2 }] }, { renchan: 'repeat' });
  eq(nd2.dealer, 1, '別人胡牌 → 莊家換人');
  eq(nd2.honba, 0, '本場歸零');
  eq(nd2.rotations, 1, '輪轉數 +1');
}

{
  // 流局：莊家聽牌才續莊，但本場一律 +1
  const { m, h } = table(0);
  const keep = SC.nextDealer(m, h, { type: 'draw', tenpai: [0, 2] }, { renchan: 'repeat' });
  eq(keep.dealer, 0, '流局時莊家聽牌 → 續莊');
  eq(keep.honba, 1, '本場 +1');

  const pass = SC.nextDealer(m, h, { type: 'draw', tenpai: [2, 3] }, { renchan: 'repeat' });
  eq(pass.dealer, 1, '流局時莊家沒聽 → 換莊');
  eq(pass.honba, 1, '流局本場照樣 +1');

  const none = SC.nextDealer(m, h, { type: 'draw', tenpai: [2, 3] }, {});
  eq(none.honba, 1, '不連莊模式下流局也累積本場');
}

{
  // 一場的結束條件
  const { m, h } = table(0);
  m.handNo = 3;
  eq(SC.nextDealer(m, h, { type: 'draw', tenpai: [] }, {}).matchOver, false, '第 3 局還沒結束');
  m.handNo = 4;
  eq(SC.nextDealer(m, h, { type: 'draw', tenpai: [] }, {}).matchOver, true, '打滿四局就結束');

  // 連莊模式看的是莊家輪滿一圈
  m.handNo = 6; m.dealerRotations = 2;
  eq(SC.nextDealer(m, h, { type: 'ron', from: 1, winners: [{ seat: 2 }] }, { renchan: 'repeat' }).matchOver,
     false, '連莊模式：莊家還沒輪滿一圈就繼續');
  m.dealerRotations = 3;
  eq(SC.nextDealer(m, h, { type: 'ron', from: 1, winners: [{ seat: 2 }] }, { renchan: 'repeat' }).matchOver,
     true, '連莊模式：莊家輪滿一圈才結束');

  // 硬上限保護時間預算
  m.dealerRotations = 0; m.handNo = 8;
  eq(SC.nextDealer(m, h, { type: 'ron', from: 1, winners: [{ seat: 0 }] }, { renchan: 'repeat' }).matchOver,
     true, '打到硬上限就強制結束（保護 15–20 分鐘的時間預算）');
}

console.log('═══ 名次 ═══');

{
  const m = S.createMatch({ seed: 1, seats: [0, 1, 2, 3].map(i => ({ name: 'P' + i })) });
  m.seats[0].matchScore = 10;
  m.seats[1].matchScore = 30;
  m.seats[2].matchScore = 30;
  m.seats[3].matchScore = -5;
  const st = SC.standings(m);
  eq(st.map(x => x.seat).join(','), '1,2,0,3', '分高者前，同分時座位小的前');
}

console.log('\n─────────────────────────');
console.log(`通過 ${pass}　失敗 ${fail}`);
if (fail) { fails.forEach(f => console.log('  ✗ ' + f)); process.exit(1); }
console.log('全部通過 ✓');
