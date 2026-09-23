/* rules-core 的驗證測試
   重點是「抽出後行為與原始兩人版一致」，以及新增的振聽規則正確。
   執行： node test/rules-core.test.js                           */
const R = require('../src/rules-core.js');

let pass = 0, fail = 0;
const fails = [];
function ok(cond, name, detail) {
  if (cond) { pass++; }
  else { fail++; fails.push(name + (detail ? '　→ ' + detail : '')); }
}
function eq(a, b, name) { ok(a === b, name, `得到 ${a}，預期 ${b}`); }

/* 把 '1萬 2萬 3萬' 這種字串轉成牌物件陣列 */
let _uid = 0;
function T(s) {
  return s.trim().split(/\s+/).map(d => {
    const m = d.match(/^(\d+)(.+)$/);
    return m
      ? { suit: m[2], num: +m[1], display: d, isHonor: false, uid: _uid++ }
      : { suit: d, num: 0, display: d, isHonor: true, uid: _uid++ };
  });
}
const D = s => T(s).map(t => t.display);

console.log('═══ 和牌判定 ═══');

// 標準型：4 面子 + 1 雀頭
ok(R.canWin14(D('1萬 2萬 3萬 4筒 5筒 6筒 7條 8條 9條 東 東 東 白 白')),
   '標準型和牌（3順+1刻+雀頭）');
ok(!R.canWin14(D('1萬 2萬 3萬 4筒 5筒 6筒 7條 8條 9條 東 東 東 白 中')),
   '缺雀頭不算和牌');

// 七對子
ok(R.canWin14(D('1萬 1萬 3萬 3萬 5筒 5筒 7筒 7筒 2條 2條 東 東 白 白')),
   '七對子和牌');
ok(!R.canWin14(D('1萬 1萬 1萬 1萬 5筒 5筒 7筒 7筒 2條 2條 東 東 白 白')),
   '四張同牌不算七對子');

// 國士無雙
ok(R.isGuoshi(D('1萬 9萬 1筒 9筒 1條 9條 東 南 西 北 中 發 白 白')),
   '國士無雙十三面聽 + 對子');
ok(!R.isGuoshi(D('1萬 9萬 1筒 9筒 1條 9條 東 南 西 北 中 發 2萬 白')),
   '缺一種么九不算國士');

console.log('═══ 向聽數 ═══');
eq(R.shantenNum(D('1萬 2萬 3萬 4筒 5筒 6筒 7條 8條 9條 東 東 東 白'), 0), 0,
   '聽牌 = 向聽 0（單騎白板）');
eq(R.shantenNum(D('1萬 1萬 3萬 3萬 5筒 5筒 7筒 7筒 2條 2條 東 東 白'), 0), 0,
   '七對子聽牌 = 向聽 0');
ok(R.shantenNum(D('1萬 4萬 7萬 2筒 5筒 8筒 3條 6條 9條 東 南 西 北'), 0) > 0,
   '散牌不是聽牌');

console.log('═══ 副露相關 ═══');
// 一個副露後，手牌 10 張
const meld1 = [{ type: 'pong', tiles: T('東 東 東') }];
ok(R.canWinInHand(T('1萬 2萬 3萬 4筒 5筒 6筒 7條 8條 9條 白 白'), meld1),
   '1 副露 + 10 張手牌自摸和牌');
eq(R.meldStats(meld1).mS, 3, '碰佔 3 張');
eq(R.meldStats([{ type: 'kong_dark', tiles: T('東 東 東 東') }]).kongCount, 1,
   '暗槓計入 kongCount');

console.log('═══ 吃牌 ═══');
eq(R.findAllChi(T('2萬 3萬 5萬 6萬'), T('4萬')[0]).length, 3,
   '4萬 對 2356萬 有三種吃法（234／345／456）');
eq(R.findAllChi(T('2萬 3萬'), T('4萬')[0]).length, 1, '只有 23萬 時 4萬 一種吃法');
ok(R.findAllChi(T('2萬 3萬'), T('東')[0]).length === 0, '字牌不能吃');

console.log('═══ 吃牌座位限制（新增）═══');
ok(R.canChiSeat(0, 1), '座位 0 打牌，座位 1（下家）可以吃');
ok(!R.canChiSeat(0, 2), '座位 2（對家）不能吃');
ok(!R.canChiSeat(0, 3), '座位 3（上家）不能吃');
ok(R.canChiSeat(3, 0), '座位 3 打牌，座位 0 可以吃（繞回）');

console.log('═══ 振聽（新增）═══');
// 聽 3萬/6萬 的兩面聽
// 4萬5萬 兩面聽 3萬/6萬，其餘已完成 3 面子 + 1 雀頭
const waitHand = T('4萬 5萬 6筒 6筒 6筒 7條 8條 9條 東 東 東 白 白');
const waits = R.winningTiles(waitHand, []);
ok(waits.includes('3萬') && waits.includes('6萬'),
   '兩面聽算出 3萬/6萬', '實得 ' + waits.join(','));

ok(!R.isFuriten(waitHand, [], T('9筒 南 北')),
   '棄牌堆沒有和牌張 → 不振聽');
ok(R.isFuriten(waitHand, [], T('9筒 3萬 北')),
   '棄牌堆有 3萬 → 振聽');
ok(R.isFuriten(waitHand, [], [], { temporary: true }),
   '同巡振聽旗標生效');

ok(R.canRonWith(waitHand, [], T('3萬')[0], T('9筒 南')),
   '沒振聽時可以榮和');
ok(!R.canRonWith(waitHand, [], T('3萬')[0], T('9筒 6萬')),
   '打過 6萬 → 3萬 也不能榮和（振聽是整組聽牌都封）');
ok(R.canWinInHand([...waitHand, ...T('3萬')], []),
   '振聽不影響自摸');

console.log('═══ 計分（參數化）═══');
const qingyise = R.SPECIAL_HANDS.find(s => s.id === 'qingyise');
eq(R.calcScore(null, null, null), 8, '無牌型基本分 8');
eq(R.calcScore(null, 'special', null), 16, '押注 special ×2');
eq(R.calcScore(null, 'dragon', null), 24, '押注 dragon ×3');
eq(R.calcScore(null, null, 'chu'), Math.ceil(8 * 1.3), '楚國雄兵 ×1.3');
eq(R.calcScore(qingyise, null, 'qin'), Math.ceil(qingyise.pts * 1.5),
   '秦國虎狼：特殊牌型 ×1.5');
eq(R.calcScore(null, null, 'qin'), 8, '秦國虎狼對無牌型不加成');

console.log('═══ 特殊牌型 ═══');
const sp1 = R.checkSpecialHand(T('1萬 1萬 1萬 2萬 3萬 4萬 5萬 6萬 7萬 8萬 9萬 9萬 9萬 5萬'), []);
ok(sp1 && sp1.id === 'jiulian', '九連寶燈', sp1 ? sp1.name : '沒認出來');
const sp2 = R.checkSpecialHand(T('1萬 1萬 3萬 3萬 5萬 5萬 7筒 7筒 2條 2條 東 東 白 白'), []);
ok(sp2 && sp2.id === 'qidui', '七對子', sp2 ? sp2.name : '沒認出來');


console.log('═══ 回歸：原版 findNeeded13 的六對子 bug ═══');
// 1萬1萬 2萬2萬 3萬3萬 4萬4萬 5萬5萬 6萬 9萬9萬
// 剛好是六對子 + 一孤張，原版會 early-return 只回報七對子聽張（6萬），
// 漏掉標準型的 3萬（123+123+345+456+99）。新版取聯集。
const sixPairBug = T('1萬 1萬 2萬 2萬 3萬 3萬 4萬 4萬 5萬 5萬 6萬 9萬 9萬');
const bugWaits = R.winningTiles(sixPairBug, []).sort();
ok(bugWaits.includes('3萬'), '六對子手牌也要報標準型聽張 3萬',
   '實得 ' + bugWaits.join(','));
ok(bugWaits.includes('6萬'), '同時保留七對子聽張 6萬');
ok(R.canWin14(D('1萬 1萬 2萬 2萬 3萬 3萬 3萬 4萬 4萬 5萬 5萬 6萬 9萬 9萬')),
   '摸進 3萬 確實可以和（驗證上面不是誤報）');

console.log('\n─────────────────────────');
console.log(`通過 ${pass}　失敗 ${fail}`);
if (fail) { fails.forEach(f => console.log('  ✗ ' + f)); process.exit(1); }
console.log('全部通過 ✓');
