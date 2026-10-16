/* bgm-scene（牌桌上該播哪一首）的測試
   2026-10-16 使用者定：誰是東就播那一國的曲；有人聽牌（名牌亮「🎯 聽」）切聽牌曲。
   執行： node test/bgm-scene.test.js                               */
global.window = { devicePixelRatio: 1 };
const B = require('../src/bgm-scene.js');
const Rd = require('../src/render.js');

let pass = 0, fail = 0;
const fails = [];
function ok(cond, name, detail) {
  if (cond) { pass++; }
  else { fail++; fails.push(name + (detail ? '　→ ' + detail : '')); }
}
function eq(a, b, name) { ok(a === b, name, `得到 ${JSON.stringify(a)}，預期 ${JSON.stringify(b)}`); }

const T = s => s.split(' ').map(d => ({ display: d }));
const TENPAI = T('1萬 2萬 3萬 4萬 5萬 6萬 7萬 8萬 9萬 東 東 東 南');      // 單騎南
const NOT = T('1萬 3萬 5萬 7萬 9萬 1條 3條 5條 7條 東 南 西 北');           // 差很遠
const HIDDEN = Array.from({ length: 13 }, () => ({ suit: '?', hidden: true }));   // 線上：別家的佔位牌

function table(kingdoms, dealer, hands, phase) {
  return {
    seats: kingdoms.map(k => ({ kingdom: k })),
    hand: { dealer, phase: phase || 'discard', seats: hands.map(h => ({ hand: h, melds: [] })) },
  };
}
const K4 = ['qin', 'zhao', 'chu', 'qi'];

console.log('═══ 誰是東就播那一國 ═══');
{
  eq(B.tableScene(table(K4, 0, [NOT, NOT, NOT, NOT])), 'qin', '莊家（座位 0）是秦 → 秦');
  eq(B.tableScene(table(K4, 2, [NOT, NOT, NOT, NOT])), 'chu', '莊家換到座位 2（楚）→ 楚');
  eq(B.tableScene(table(K4, 3, [NOT, NOT, NOT, NOT])), 'qi', '莊家是齊 → 齊');
  eq(B.tableScene(table([null, 'zhao', 'chu', 'qi'], 0, [NOT, NOT, NOT, NOT])), 'game', '莊家沒有國（資料缺）→ 通用對局曲');
  eq(B.tableScene(table(['xx', 'zhao', 'chu', 'qi'], 0, [NOT, NOT, NOT, NOT])), 'game', '莊家的國不認得 → 通用對局曲');
  eq(B.tableScene(null), 'game', '沒有牌局 → 通用對局曲');
  eq(B.tableScene({ seats: [] }), 'game', '還沒開局 → 通用對局曲');
  eq(B.KINGDOM_SCENES.length, 7, '七國都有曲');
}

console.log('═══ 有人聽牌 → 聽牌曲 ═══');
{
  eq(B.tableScene(table(K4, 0, [NOT, NOT, TENPAI, NOT])), 'tenpai', '單機：別家（座位 2）聽牌 → 聽牌曲');
  eq(B.tableScene(table(K4, 0, [TENPAI, NOT, NOT, NOT])), 'tenpai', '自己聽牌 → 聽牌曲');
  eq(B.tenpaiSeats(table(K4, 0, [TENPAI, NOT, TENPAI, NOT]).hand).join(','), '0,2', '兩家聽牌：兩家都算');
  eq(B.tableScene(table(K4, 1, [NOT, NOT, NOT, NOT])), 'zhao', '沒人聽 → 回到莊家那一國');
  eq(B.tableScene(table(K4, 0, [NOT, TENPAI, NOT, NOT], 'over')), 'qin', '這一局結束了：不算聽牌，回到國曲');
}

console.log('═══ 連線：別家的牌看不到，不能拿佔位牌算 ═══');
{
  eq(B.tableScene(table(K4, 0, [NOT, HIDDEN, HIDDEN, HIDDEN])), 'qin', '別家是佔位牌 → 不會被當成聽牌');
  eq(B.tableScene(table(K4, 0, [TENPAI, HIDDEN, HIDDEN, HIDDEN])), 'tenpai', '自己聽牌照樣切');
}

console.log('═══ 連線：群主算好有／沒有，各台照它切（不知道是誰）═══');
{
  const R = require('../src/rules-core.js');
  const isT = st => R.isTenpaiHand(st.hand, st.melds);
  const full = table(K4, 0, [NOT, NOT, TENPAI, NOT]);
  eq(B.anyTenpaiFull(full.hand, isT), true, '群主：完整牌局裡座位 2 聽牌 → 有');
  eq(B.anyTenpaiFull(table(K4, 0, [NOT, NOT, NOT, NOT]).hand, isT), false, '群主：沒人聽 → 沒有');
  eq(B.anyTenpaiFull(table(K4, 0, [TENPAI, NOT, NOT, NOT], 'over').hand, isT), false, '群主：局結束了 → 沒有');
  const client = table(K4, 1, [NOT, HIDDEN, HIDDEN, HIDDEN]);
  eq(B.tableScene(client, { anyTenpai: true }), 'tenpai', '用戶端：群主說有 → 聽牌曲（自己沒聽、別家看不到也照切）');
  eq(B.tableScene(client, { anyTenpai: false }), 'zhao', '用戶端：群主說沒有 → 莊家（趙）的曲');
  eq(B.tableScene(table(K4, 0, [TENPAI, HIDDEN, HIDDEN, HIDDEN]), { anyTenpai: false }), 'qin',
     '帶了 anyTenpai 就只照它（群主的判斷為準，不自己另算）');
  eq(B.tableScene(table(K4, 0, [NOT, NOT, NOT, NOT], 'over'), { anyTenpai: true }), 'qin', '局結束了：就算說有也回國曲');
}

console.log('═══ 跟名牌的「🎯 聽」是同一個判斷 ═══');
{
  const m = table(K4, 0, [NOT, TENPAI, HIDDEN, NOT]);
  const plate = [0, 1, 2, 3].filter(i => Rd.showsTenpai(m.hand, i));
  eq(B.tenpaiSeats(m.hand).join(','), plate.join(','), '音樂認定的聽牌家 ＝ 名牌亮的那幾家');
  const src = require('fs').readFileSync(require('path').join(__dirname, '../src/render.js'), 'utf8');
  ok(/if \(showsTenpai\(hand, seat\) &&/.test(src), '名牌真的是用 showsTenpai 決定亮不亮（沒有另寫一套）');
}

console.log('\n─────────────────────────');
console.log(`通過 ${pass}　失敗 ${fail}`);
if (fail) { fails.forEach(f => console.log('  ✗ ' + f)); process.exit(1); }
console.log('全部通過 ✓');
