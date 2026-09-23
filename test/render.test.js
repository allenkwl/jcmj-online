/* render 的攤牌邏輯
   ⚠️ 這裡守的是一條**安全性**規則，不只是畫面：
   別家的手牌只能從 `hand.result`（結算結果）攤，不能從 `hand.seats[].hand` 讀。
   兩者在單機一模一樣，接上線之後前者是用戶端本來就有的、後者是洩漏。
   執行： node test/render.test.js                                */
global.window = { devicePixelRatio: 1 };
const R = require('../src/render.js');

let pass = 0, fail = 0;
const fails = [];
function ok(cond, name, detail) {
  if (cond) { pass++; }
  else { fail++; fails.push(name + (detail ? '　→ ' + detail : '')); }
}
function eq(a, b, name) { ok(a === b, name, `得到 ${JSON.stringify(a)}，預期 ${JSON.stringify(b)}`); }

const hand = (phase, result) => ({
  phase,
  result,
  seats: [0, 1, 2, 3].map(i => ({ seat: i, hand: [{ display: '1萬' }], melds: [] })),
});
const win = seat => ({ winners: [{ seat, hand: ['3萬', '4萬', '東'] }] });

console.log('═══ 只有「局已結束 + 是贏家」才攤牌 ═══');

{
  eq(R.revealedOf(hand('discard', win(1)), 1), null, '局還沒結束：不攤');
  eq(R.revealedOf(hand('claim', win(1)), 1), null, '宣告中：不攤');
  eq(R.revealedOf(hand('over', null), 1), null, '沒有結果（例如流局前）：不攤');
  eq(R.revealedOf(hand('over', { winners: [] }), 1), null, '流局沒有贏家：不攤');
  eq(R.revealedOf(hand('over', win(2)), 1), null, '不是贏家的那一家：不攤');
  ok(!!R.revealedOf(hand('over', win(1)), 1), '是贏家而且局結束了：攤');
}

{
  const t = R.revealedOf(hand('over', win(3)), 3);
  eq(t.length, 3, '攤出來的張數對');
  eq(t[0].display, '3萬', 'display 對');
  eq(t[0].num, 3, '數牌的 num 有解出來');
  eq(t[0].isHonor, false, '數牌不是字牌');
  eq(t[2].display, '東', '字牌的 display 對');
  eq(t[2].isHonor, true, '字牌認得出來');
}

{
  // 空的手牌不算（避免畫出 0 張的空列）
  eq(R.revealedOf(hand('over', { winners: [{ seat: 1, hand: [] }] }), 1), null,
     '結果裡的手牌是空的：不攤');
  eq(R.revealedOf(hand('over', { winners: [{ seat: 1 }] }), 1), null,
     '結果裡沒有 hand 欄位：不攤');
}

{
  // 防呆：什麼都不給也不能爆
  eq(R.revealedOf(null, 0), null, 'hand 是 null 也不會爆');
  eq(R.revealedOf(undefined, 0), null, 'hand 是 undefined 也不會爆');
}

{
  /* ⚠️ 這一項是規則本身。攤牌的來源必須是 result，
     所以「座位上有手牌、但 result 沒有」時一定要拒絕攤 ——
     會通過這一項的實作，接線之後才不會把別人的手牌送出去。 */
  const h = hand('over', { winners: [{ seat: 1, hand: ['5筒'] }] });
  h.seats[2].hand = [{ display: '9條' }, { display: '9條' }];
  eq(R.revealedOf(h, 2), null, '座位上有牌但不是結果裡的贏家：仍然不攤');
  eq(R.revealedOf(h, 1)[0].display, '5筒', '攤的是 result 裡的那一份');
}

console.log('\n─────────────────────────');
console.log(`通過 ${pass}　失敗 ${fail}`);
if (fail) { fails.forEach(f => console.log('  ✗ ' + f)); process.exit(1); }
console.log('全部通過 ✓');
