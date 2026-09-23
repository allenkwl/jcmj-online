/* 偏置發牌的驗證測試
   規格見 docs/biased-deal.md 第五節。

   這裡最重要的兩件事：
     ‧ **牌山永遠合法** —— 配種子是用「交換」做的，寫錯會讓牌憑空多出來或消失
     ‧ **十種牌型都出得來** —— 驗收條件。第一版模擬就是踩到混一色 0%
   執行： node test/deal-seed.test.js                              */
const DS = require('../src/deal-seed.js');
const R = require('../src/rules-core.js');
const S = require('../src/game-state.js');

let pass = 0, fail = 0;
const fails = [];
function ok(cond, name, detail) {
  if (cond) { pass++; }
  else { fail++; fails.push(name + (detail ? '　→ ' + detail : '')); }
}
function eq(a, b, name) { ok(a === b, name, `得到 ${JSON.stringify(a)}，預期 ${JSON.stringify(b)}`); }

function T(displays) {
  return displays.map(d => {
    const m = d.match(/^(\d)(.)$/);
    return m ? { suit: m[2], num: +m[1], display: d, isHonor: false }
             : { suit: d, num: 0, display: d, isHonor: true };
  });
}
const countBy = list => list.reduce((c, d) => { c[d] = (c[d] || 0) + 1; return c; }, {});

console.log('═══ 十種牌型都組得出來，而且是合法的胡牌 ═══');

DS.TYPES.forEach(type => {
  let hit = 0, wrong = 0, illegal = 0, wrongLen = 0;
  for (let i = 1; i <= 300; i++) {
    const h = DS.buildFull(type, S.makeRNG(i));
    if (h.length !== 14) wrongLen++;
    // ⚠️ 一種牌最多四張。這裡抓過兩次真的 bug：
    //    對對胡的雀頭寫死 '5'+花色，刻子抽到 5 就變成五張；
    //    混一色的刻子與雀頭可能抽到同一張字牌，也是五張。
    if (Object.values(countBy(h)).some(v => v > 4)) illegal++;
    const sp = R.checkSpecialHand(T(h), []);
    if (sp) hit++;
    if (sp && sp.id !== type) wrong++;
  }
  eq(hit, 300, type + '：300 次都判得出特殊牌型');
  eq(wrong, 0, type + '：不會被判成別的牌型（SPECIAL_HANDS 有優先序）');
  eq(illegal, 0, type + '：沒有一種牌超過四張');
  eq(wrongLen, 0, type + '：剛好 14 張');
});

console.log('═══ 牌山永遠合法（配種子是用交換做的）═══');

{
  let bad = 0, wrongLen = 0;
  for (let i = 1; i <= 400; i++) {
    const m = S.createMatch({ seed: i });
    S.startHand(m, { seeding: { rates: [1, 1, 1, 1] } });   // 四家全開，壓力最大
    if (m.hand.wall.length !== 136) wrongLen++;
    const c = countBy(m.hand.wall.map(t => t.display));
    if (Object.keys(c).length !== 34 || Object.values(c).some(v => v !== 4)) bad++;
  }
  eq(wrongLen, 0, '牌山還是 136 張');
  eq(bad, 0, '34 種牌各剛好四張 —— 牌沒有憑空多出來或消失');
}

{
  // uid 也不能重複（交換時拿錯物件會出現同一張牌兩次）
  const m = S.createMatch({ seed: 99 });
  S.startHand(m, { seeding: { rates: [1, 1, 1, 1] } });
  const uids = m.hand.wall.map(t => t.uid);
  eq(new Set(uids).size, 136, '136 張牌的 uid 互不重複');
}

console.log('═══ 預設不開，既有行為不受影響 ═══');

{
  const a = S.createMatch({ seed: 7 }); S.startHand(a);
  const b = S.createMatch({ seed: 7 }); S.startHand(b);
  eq(a.hand.seeded, null, '不傳 seeding 就是公平發牌');
  eq(JSON.stringify(a.hand.seats[0].hand.map(t => t.display)),
     JSON.stringify(b.hand.seats[0].hand.map(t => t.display)),
     '同一顆種子發出同一副牌');
}

console.log('═══ 決定論（線上四台要發出同一副）═══');

{
  const deal = () => {
    const m = S.createMatch({ seed: 4242 });
    S.startHand(m, { seeding: { rates: [1, 1, 1, 1] } });
    return m.hand.wall.map(t => t.display).join(',');
  };
  eq(deal(), deal(), '同一顆種子、同一組設定 → 同一副牌山');
}

console.log('═══ 機率與退路 ═══');

{
  let n = 0, seeded = 0;
  for (let i = 1; i <= 1500; i++) {
    const m = S.createMatch({ seed: i });
    S.startHand(m, { seeding: { rates: [0, 0, 0, 0] } });
    m.hand.seeded.forEach(r => { n++; if (r) seeded++; });
  }
  eq(seeded, 0, '機率 0 就一家都不配');
  eq(n, 6000, '每一局四家都有一筆結果');
}

{
  // boost 那家要明顯比較常拿到種子
  let plain = 0, boosted = 0;
  for (let i = 1; i <= 2000; i++) {
    const m = S.createMatch({ seed: i });
    S.startHand(m, { seeding: { boost: [true, false, false, false] } });
    if (m.hand.seeded[0]) boosted++;
    if (m.hand.seeded[1]) plain++;
  }
  ok(boosted > plain * 1.4, '追趕機制那家拿到種子的次數明顯較多',
     `boost ${boosted} vs 一般 ${plain}`);
}

console.log('═══ 驗收：十種牌型的出現率都不能是 0 ═══');

{
  // 這是規格白紙黑字的驗收條件 —— 第一版模擬混一色 0%，就是漏了跨花色的型
  const seen = {};
  DS.TYPES.forEach(t => { seen[t] = 0; });
  for (let i = 1; i <= 3000; i++) {
    const m = S.createMatch({ seed: i });
    S.startHand(m, { seeding: { rates: [1, 1, 1, 1] } });
    m.hand.seeded.forEach(r => { if (r) seen[r.type]++; });
  }
  DS.TYPES.forEach(t => ok(seen[t] > 0, `${t} 出現過（不能是 0%）`, String(seen[t])));
}

console.log('═══ 拿到種子的那家確實比較接近胡牌 ═══');

{
  let seedSum = 0, seedN = 0, fairSum = 0, fairN = 0;
  for (let i = 1; i <= 800; i++) {
    const m = S.createMatch({ seed: i });
    S.startHand(m, { seeding: { rates: [1, 1, 1, 1] } });
    m.hand.seeded.forEach((r, s) => {
      if (!r) return;
      seedSum += R.shantenNum(m.hand.seats[s].hand.map(t => t.display), 0); seedN++;
    });
    const f = S.createMatch({ seed: i + 500000 });
    S.startHand(f);
    for (let s = 0; s < 4; s++) {
      fairSum += R.shantenNum(f.hand.seats[s].hand.map(t => t.display), 0); fairN++;
    }
  }
  const seedAvg = seedSum / seedN, fairAvg = fairSum / fairN;
  ok(seedAvg < fairAvg - 1.5,
     `配到種子的起手明顯比公平發牌近（${seedAvg.toFixed(2)} vs ${fairAvg.toFixed(2)} 向聽）`);
  ok(seedAvg > 0.5, '但也不是一發就聽牌 —— 打散 1～2 張是刻意的', seedAvg.toFixed(2));
}

console.log('═══ 打散張數混著用（小確幸要維持得住）═══');

{
  // 規格原本寫「固定 2 張」，實測對不上舊版基準（1.6% 一到手聽牌 vs 舊版 6%）。
  // 改成按 LIGHT_RATE 混合 1／2 張之後才拉得回來 —— 這裡釘住那個結果。
  const sh = {};
  let n = 0;
  for (let i = 1; i <= 1200; i++) {
    const m = S.createMatch({ seed: i });
    S.startHand(m, { seeding: { rates: [1, 1, 1, 1] } });
    m.hand.seeded.forEach((r, s) => {
      if (!r) return;
      n++;
      const k = R.shantenNum(m.hand.seats[s].hand.map(t => t.display), 0);
      sh[k] = (sh[k] || 0) + 1;
    });
  }
  const pct = k => (sh[k] || 0) / n * 100;
  let tot = 0;
  Object.keys(sh).forEach(k => { tot += +k * sh[k]; });
  const avg = tot / n;

  ok(pct(0) > 4.5 && pct(0) < 9,
     `一到手就聽牌落在合理區間（舊版 6%，玩家要求再高一點）`, pct(0).toFixed(1) + '%');
  ok(avg > 0.95 && avg < 1.45, '平均向聽落在合理區間', avg.toFixed(2));
  ok(pct(3) < 1, '幾乎不會發出 3 向聽以上的種子（那就不算種子了）', pct(3).toFixed(1) + '%');
}

{
  // 混合要真的在混 —— 兩種打散張數都要出現得到
  const seen = {};
  for (let i = 1; i <= 400; i++) {
    const m = S.createMatch({ seed: i });
    S.startHand(m, { seeding: { rates: [1, 1, 1, 1] } });
    m.hand.seeded.forEach(r => { if (r) seen[r.placed] = (seen[r.placed] || 0) + 1; });
  }
  const keys = Object.keys(seen).map(Number).sort();
  ok(keys.length >= 2, '兩種打散張數都出現（不是退化成固定一種）', keys.join('／'));
  ok(seen[12] > 0 && seen[11] > 0, '打散 1 張（塞 12）與 2 張（塞 11）都有',
     JSON.stringify(seen));
}

{
  // 明確指定 disrupt 時要蓋過混合
  let all11 = true;
  for (let i = 1; i <= 200; i++) {
    const m = S.createMatch({ seed: i });
    S.startHand(m, { seeding: { rates: [1, 1, 1, 1], disrupt: 2 } });
    m.hand.seeded.forEach(r => { if (r && r.placed !== 11) all11 = false; });
  }
  ok(all11, '傳 disrupt 就照傳的來，不再混合');
}

console.log('\n─────────────────────────');
console.log(`通過 ${pass}　失敗 ${fail}`);
if (fail) { fails.forEach(f => console.log('  ✗ ' + f)); process.exit(1); }
console.log('全部通過 ✓');
