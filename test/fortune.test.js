/* fortune 的驗證測試
   重點是「不要像舊版那樣亂喊」—— 提示是拿來下注的，喊錯會害玩家押錯。
   執行： node test/fortune.test.js                               */
const Fo = require('../src/fortune.js');
const R = require('../src/rules-core.js');
const S = require('../src/game-state.js');

let pass = 0, fail = 0;
const fails = [];
function ok(cond, name, detail) {
  if (cond) { pass++; }
  else { fail++; fails.push(name + (detail ? '　→ ' + detail : '')); }
}
function eq(a, b, name) { ok(a === b, name, `得到 ${JSON.stringify(a)}，預期 ${JSON.stringify(b)}`); }

let _uid = 0;
function T(str) {
  return str.trim().split(/\s+/).map(d => {
    const m = d.match(/^(\d+)(.+)$/);
    return m
      ? { suit: m[2], num: +m[1], display: d, isHonor: false, uid: _uid++ }
      : { suit: d, num: 0, display: d, isHonor: true, uid: _uid++ };
  });
}
const hintOf = s => (Fo.analyze(T(s), []).best || {}).name || null;
const awayOf = (s, id) => Fo.ESTIMATORS[id](T(s));

console.log('═══ 🐛 舊版九連寶燈的誤判不能重演 ═══');

{
  /* 舊版：主花色 >=11 且「有一張 1、有一張 9」就喊九連寶燈。
     實測 4,000 副清一色手牌喊了 2,908 次，2,846 次是錯的（97.9%）。
     詳見 docs/fortune-analysis.md。 */
  const oneOneOneNine = '1萬 3萬 3萬 4萬 5萬 6萬 6萬 6萬 7萬 7萬 8萬 9萬 9萬';
  ok(awayOf(oneOneOneNine, 'jiulian') >= 3,
     '只有一張 1、兩張 9 的清一色，離九連還很遠',
     '算出來差 ' + awayOf(oneOneOneNine, 'jiulian') + ' 張');
  ok(hintOf(oneOneOneNine) !== '九連寶燈',
     '這種手不會被喊成九連寶燈', '喊了：' + hintOf(oneOneOneNine));

  // 真的九連（差一張就成）要認得出來
  const real = '1萬 1萬 1萬 2萬 3萬 4萬 5萬 6萬 7萬 8萬 9萬 9萬 9萬';
  eq(awayOf(real, 'jiulian'), 0, '正牌的 1112345678999 差 0 張');
  eq(hintOf(real), '九連寶燈', '正牌的九連認得出來');

  // 少一張 1 → 差一張
  const near = '1萬 1萬 2萬 3萬 4萬 5萬 6萬 7萬 8萬 9萬 9萬 9萬 5萬';
  eq(awayOf(near, 'jiulian'), 1, '少一張 1 就是差一張');
}

console.log('═══ 各牌型的距離估計 ═══');

{
  eq(awayOf('東 東 東 南 南 南 西 西 西 北 北 北 白', 'dasixi'), 0, '四風齊全：大四喜差 0');
  ok(awayOf('東 東 南 南 西 西 北 北 1萬 2萬 3萬 4萬 5萬', 'dasixi') > 0, '四風各兩張還差一些');

  eq(awayOf('2條 3條 4條 6條 8條 發 2條 3條 4條 6條 8條 發 2條', 'lvyise'), 0, '全綠：綠一色差 0');
  eq(awayOf('2條 3條 4條 6條 8條 發 1萬 1萬 1萬 1萬 1萬 1萬 1萬', 'lvyise'), 7, '七張非綠就差七張');

  eq(awayOf('1萬 9萬 1筒 9筒 1條 9條 東 南 西 北 中 發 白', 'guoshi'), 0, '十三么齊全：國士差 0');
  eq(awayOf('1萬 9萬 1筒 9筒 1條 9條 東 南 2萬 3萬 4萬 5萬 6萬', 'guoshi'), 5, '缺五種么九就差五張');

  eq(awayOf('東 東 東 南 南 南 西 西 西 中 中 發 發', 'ziyise'), 0, '全字牌：字一色差 0');
  eq(awayOf('中 中 中 發 發 發 白 白 1萬 2萬 3萬 4萬 5萬', 'xiaosanxi'), 0, '兩刻一對：小三元差 0');
  eq(awayOf('1萬 2萬 3萬 4萬 5萬 6萬 7萬 8萬 9萬 1萬 2萬 3萬 4萬', 'qingyise'), 0, '全萬：清一色差 0');
  eq(awayOf('1萬 2萬 3萬 4萬 5萬 6萬 東 東 東 南 南 西 西', 'hunyise'), 0, '一色加字牌：混一色差 0');

  eq(awayOf('1萬 1萬 3萬 3萬 5筒 5筒 7筒 7筒 2條 2條 東 東 白', 'qidui'), 0, '六對加單騎：七對子已經聽牌，差 0 張');
  eq(awayOf('1萬 1萬 1萬 5筒 5筒 5筒 9條 9條 9條 東 東 東 白', 'duiduihu'), 1, '四刻缺雀頭：對對胡差一張');
}

console.log('═══ 不亂喊 ═══');

{
  const plain = [
    '1萬 4萬 7萬 2筒 5筒 8筒 3條 6條 9條 東 南 西 北',
    '2萬 3萬 5萬 6萬 8萬 2筒 4筒 7筒 1條 5條 9條 南 白',
  ];
  plain.forEach((s, i) => {
    ok(hintOf(s) === null, `雜牌 ${i + 1} 不會被標成「有機會」`, '喊了：' + hintOf(s));
    ok(Fo.analyze(T(s), []).hints.length > 0, `雜牌 ${i + 1} 仍然給得出參考清單`);
  });
}

{
  /* 一萬副真實發牌，量提示率。
     太高代表門檻太鬆（提示沒有資訊量），太低代表玩家永遠看不到提示。 */
  const N = 4000;
  const dist = {}; let withHint = 0, veryClose = 0;
  for (let seed = 1; seed <= N; seed++) {
    const m = S.createMatch({ seed });
    S.startHand(m);
    const a = Fo.analyze(m.hand.seats[0].hand, []);
    if (a.best) {
      withHint++;
      dist[a.best.name] = (dist[a.best.name] || 0) + 1;
      if (a.best.away <= 1) veryClose++;
    }
  }
  const pct = n => (n * 100 / N).toFixed(2) + '%';
  console.log(`  ${N} 副隨機起手：有提示 ${withHint}（${pct(withHint)}）、差一張以內 ${veryClose}（${pct(veryClose)}）`);
  Object.entries(dist).sort((a, b) => b[1] - a[1]).slice(0, 6)
    .forEach(([k, v]) => console.log(`    ${k.padEnd(10)} ${String(v).padStart(4)}　${pct(v)}`));

  ok(withHint / N < 0.05, '「真的有機會」是罕見的（best 只在夠近時才設）', pct(withHint));
  ok(veryClose / N < 0.02, '「差一張以內」更罕見', pct(veryClose));
  ok((dist['九連寶燈'] || 0) / N < 0.001, '起手不會亂喊九連寶燈', pct(dist['九連寶燈'] || 0));
  ok((dist['大四喜'] || 0) / N < 0.001, '起手不會亂喊大四喜', pct(dist['大四喜'] || 0));
}

console.log('═══ 🎯 拿得到嗎：牌被別人吃光的情況 ═══');

/* 用真實的牌局狀態建可見牌，不是自己捏 counts —— 要驗的正是
   「別人碰走 / 打掉的牌會讓我的牌型做不成」這條路徑。 */
function tableWith(mine, setup) {
  const m = S.createMatch({ seed: 99 });
  S.startHand(m);
  const h = m.hand;
  h.seats.forEach(st => { st.hand = []; st.melds = []; st.discards = []; });
  h.seats[0].hand = T(mine);
  (setup || []).forEach(([seat, kind, tiles]) => {
    if (kind === 'meld') h.seats[seat].melds.push({ type: 'pong', tiles: T(tiles), from: 1 });
    else h.seats[seat].discards.push(...T(tiles));
  });
  return h;
}

{
  // 大四喜要十二張風。全場只有十六張，別人碰走兩組就湊不齊了
  const mine = '東 東 東 南 南 南 西 西 北 北 1萬 2萬 3萬';
  const clean = tableWith(mine);
  const a1 = Fo.analyze(clean.seats[0].hand, [], { visible: Fo.visibleCounts(clean, 0) });
  const h1 = a1.hints.find(x => x.id === 'dasixi');
  ok(h1 && h1.feasible, '沒人搶的時候，大四喜做得成');

  // 別家碰走 西西西 和 北北北 → 我只湊得到各兩張，做不成了
  const blocked = tableWith(mine, [
    [1, 'meld', '西 西 西'],
    [2, 'meld', '北 北 北'],
  ]);
  const a2 = Fo.analyze(blocked.seats[0].hand, [], { visible: Fo.visibleCounts(blocked, 0) });
  const h2 = a2.hints.find(x => x.id === 'dasixi');
  ok(h2 && !h2.feasible, '西北被碰走之後，大四喜做不成了',
     h2 ? '差 ' + h2.dead + ' 張拿不到' : '（清單裡沒有大四喜）');
  ok(!a2.best || a2.best.id !== 'dasixi', '做不成的牌型不會被標成「有機會」');
}

{
  /* 小三元有三種湊法（哪一種三元牌當雀頭），要三種都堵死才算做不成。
     ⚠️ 造測資時要記得**一種牌全場只有四張** ——
     第一版讓我自己拿兩張發、又讓別家碰走三張發，那副牌根本不存在。 */
  const mine = '中 中 中 發 發 1萬 2萬 3萬 5筒 6筒 7筒 9條 9條';
  const clean = tableWith(mine);
  const a0 = Fo.analyze(clean.seats[0].hand, [], { visible: Fo.visibleCounts(clean, 0) });
  ok(a0.hints.find(x => x.id === 'xiaosanxi').feasible, '沒人搶時小三元做得成');

  // 白板四張全進牌河 → 三種湊法都要用到白，全死
  const blocked = tableWith(mine, [
    [1, 'discard', '白 白'], [2, 'discard', '白 白'],
  ]);
  const a = Fo.analyze(blocked.seats[0].hand, [], { visible: Fo.visibleCounts(blocked, 0) });
  const h = a.hints.find(x => x.id === 'xiaosanxi');
  ok(h && !h.feasible, '白板打光之後小三元做不成（三種湊法都要用到白）',
     h ? '差 ' + h.dead + ' 張' : '（沒列）');
}

{
  // 國士要十三種各一張。其中一種被打光四張就死了
  const mine = '1萬 9萬 1筒 9筒 1條 9條 東 南 西 北 中 發 2萬';
  const dead = tableWith(mine, [
    [1, 'discard', '白 白'], [2, 'discard', '白 白'],
  ]);
  const a = Fo.analyze(dead.seats[0].hand, [], { visible: Fo.visibleCounts(dead, 0) });
  const h = a.hints.find(x => x.id === 'guoshi');
  ok(h && !h.feasible, '白板四張全在牌河 → 國士無雙做不成', h ? '差 ' + h.dead + ' 張' : '（沒列）');

  // 只打掉三張還有救
  const alive = tableWith(mine, [[1, 'discard', '白 白'], [2, 'discard', '白']]);
  const a2 = Fo.analyze(alive.seats[0].hand, [], { visible: Fo.visibleCounts(alive, 0) });
  const h2 = a2.hints.find(x => x.id === 'guoshi');
  ok(h2 && h2.feasible, '白板還剩一張 → 國士還有救');
}

{
  // 形狀型的牌型（七對子／對對胡／清一色）沒有固定牌組，不會有「拿不到」
  const t = tableWith('1萬 1萬 3萬 3萬 5筒 5筒 7筒 7筒 2條 2條 東 東 白');
  const a = Fo.analyze(t.seats[0].hand, [], { visible: Fo.visibleCounts(t, 0) });
  const q = a.hints.find(x => x.id === 'qidui');
  ok(q && q.feasible, '七對子這種形狀型的牌型永遠做得成');
}

/* 「死聽提醒」被否決了 —— 見 fortune.js 的註解。
   這裡改成釘死「不會有那個功能」，免得日後有人好心加回去。 */
console.log('═══ 不代玩家數牌河 ═══');

{
  const a = Fo.analyze(T('1萬 2萬 3萬 4萬 5萬 6萬 7萬 8萬 9萬 1筒 2筒 3筒 東'), []);
  ok(!('deadWait' in a), 'analyze 不回死聽判定');
  ok(!('waitInfo' in a), 'analyze 不回每張聽牌剩幾張');
  ok(Fo.summary(a).every(l => l.indexOf('胡不了') < 0), '摘要不會說「胡不了」');
  ok(Array.isArray(a.waits) && a.waits.length > 0, '聽牌張本身照樣給（那是自己手牌算得出來的）');
}

console.log('═══ 下注 ═══');

{
  eq(Fo.BETS.length, 3, '三種注');
  eq(Fo.BETS.map(b => b.mult).join(','), '1,2,3', '倍率 1／2／3，與舊版相同');
  // rules-core 的 calcScore 本來就吃這些 id
  const base = R.calcScore(null, 'normal', null);
  eq(R.calcScore(null, 'special', null), base * 2, 'special 是兩倍');
  eq(R.calcScore(null, 'dragon', null), base * 3, 'dragon 是三倍');
}

{
  const near9 = Fo.analyze(T('1萬 1萬 1萬 2萬 3萬 4萬 5萬 6萬 7萬 8萬 9萬 9萬 9萬'), []);
  eq(Fo.suggestBet(near9), 'dragon', '差 0 張的高分牌型：建議孤注一擲');
  const plain = Fo.analyze(T('1萬 4萬 7萬 2筒 5筒 8筒 3條 6條 9條 東 南 西 北'), []);
  eq(Fo.suggestBet(plain), 'normal', '雜牌：建議普通');
}

console.log('═══ 分析輸出 ═══');

{
  const a = Fo.analyze(T('1萬 1萬 3萬 3萬 5筒 5筒 7筒 7筒 2條 2條 東 東 白'), []);
  eq(a.pairs, 6, '數得出六個對子');
  eq(a.suits.join(''), '萬筒條', '花色分布');
  eq(a.honors, 3, '字牌三張');
  ok(a.shanten >= 0, '算得出向聽數');
  ok(Array.isArray(a.waits), '聽牌張是陣列');
  ok(Fo.summary(a).length >= 3, '摘要至少三行');
  ok(a.hints.length <= Fo.MAX_HINTS, '提示不超過上限');
}

{
  // 提示要照「差得少優先、同樣近就分數高優先」排
  const a = Fo.analyze(T('中 中 中 發 發 發 白 白 1萬 1萬 1萬 5筒 5筒'), []);
  ok(a.hints.length > 1, '這手同時像好幾種牌型');
  for (let i = 1; i < a.hints.length; i++) {
    const p = a.hints[i - 1], q = a.hints[i];
    ok(p.away < q.away || (p.away === q.away && p.pts >= q.pts),
       `提示排序正確（${p.name} 在 ${q.name} 前面）`);
  }
  eq(a.hints[0].name, '小三元', '最近的是小三元');
  eq(a.best && a.best.name, '小三元', '夠近，所以標成「有機會」');
}

console.log('═══ 聽哪幾張（手上 14 張時也要算得出來）═══');

const eqArr = (a, b, name) => eq(JSON.stringify(a), JSON.stringify(b), name);

{
  const melds = [
    { type: 'pong', tiles: T('1條 1條 1條') },
    { type: 'chi',  tiles: T('6條 7條 8條') },
    { type: 'chi',  tiles: T('4筒 5筒 6筒') },
  ];
  eqArr(Fo.analyze(T('6條 8條 中 中'), melds).waits, ['7條'], '13 張：等 7條');
  // 輪到自己時手上是 14 張。這裡一度回空陣列 ——
  // 畫面就變成「🎯 聽牌」卻不說等什麼，偏偏那是玩家最想知道的時候。
  eqArr(Fo.analyze(T('7萬 6條 8條 中 中'), melds).waits, ['7條'], '14 張：一樣要算得出 7條');
}

{
  const t13 = T('1萬 2萬 3萬 4萬 5萬 6萬 7萬 8萬 1筒 1筒 1筒 9條 9條');
  const t14 = T('1萬 2萬 3萬 4萬 5萬 6萬 7萬 8萬 1筒 1筒 1筒 9條 9條 東');
  eqArr(Fo.analyze(t13, []).waits, ['3萬', '6萬', '9萬'], '門清 13 張：三面聽');
  eqArr(Fo.analyze(t14, []).waits, ['3萬', '6萬', '9萬'], '門清 14 張：摸切之後的聽張');
}

{
  // 沒聽牌就是沒聽牌 —— 不能因為多試了幾張，就湊出一個等牌清單
  eqArr(Fo.analyze(T('1萬 5萬 9萬 2筒 6筒 9筒 3條 7條 東 南 西 北 中'), []).waits, [],
        '沒聽牌：不給等牌清單');
}

console.log('\n─────────────────────────');
console.log(`通過 ${pass}　失敗 ${fail}`);
if (fail) { fails.forEach(f => console.log('  ✗ ' + f)); process.exit(1); }
console.log('全部通過 ✓');
