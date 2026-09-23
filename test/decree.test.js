/* 出師奏章的驗證測試
   重點是「不要出現空白的替換記號」與「語氣要配得上處境」——
   手上五國的人連輸一場，收到「非將士不用命」那種奏章會很怪。
   執行： node test/decree.test.js                                */
const D = require('../src/decree.js');
const K = require('../src/kingdoms.js');
const C = require('../src/campaign.js');

let pass = 0, fail = 0;
const fails = [];
function ok(cond, name, detail) {
  if (cond) { pass++; }
  else { fail++; fails.push(name + (detail ? '　→ ' + detail : '')); }
}
function eq(a, b, name) { ok(a === b, name, `得到 ${JSON.stringify(a)}，預期 ${JSON.stringify(b)}`); }

const player = (kingdom, conquered, streak, matches) => Object.assign(
  C.createPlayer({ seat: 0, name: '我', kingdom }),
  { conquered: conquered || [], lastStreak: streak || 0, matches: matches || 0 });

console.log('═══ 選哪一篇（語氣要配得上處境）═══');

{
  eq(D.choose(player('qi')).id, 'first', '首戰 → 請伐三國疏');
  eq(D.choose(player('qi', ['chu'], 0)).id, 'first', '上一場有進帳 → 還是請伐三國疏');
  eq(D.choose(player('qi', ['chu'], 1)).id, 'again', '連敗一場 → 再請出師疏');
  eq(D.choose(player('qi', ['chu'], 2)).id, 'desperate', '連敗兩場 → 背水疏');
  eq(D.choose(player('qi', ['chu'], 5)).id, 'desperate', '連敗更多場 → 還是背水疏');
  eq(D.choose(player('qi', ['chu', 'yan', 'han', 'wei'], 0)).id, 'closing',
     '征服四國 → 掃平六合疏');
}

{
  /* ⚠️ 這一項是刻意的優先序。手上五國的人連輸一場，
     不該收到「前役失利，非將士不用命」那種奏章 —— 他明明快統一了。 */
  eq(D.choose(player('qi', ['chu', 'yan', 'han', 'wei', 'zhao'], 1)).id, 'closing',
     '快統一的人連敗也走掃平六合疏，不走再請出師疏');
  eq(D.choose(player('qi', ['chu', 'yan', 'han', 'wei', 'zhao'], 3)).id, 'closing',
     '快統一的人連敗三場也一樣');
}

console.log('═══ 替換記號一定要填滿 ═══');

{
  // 四篇 × 各種處境，全部不能留下 {…}
  const foes = ['chu', 'yan', 'han'];
  const cases = [
    player('qi'), player('qi', ['chu'], 1), player('qi', ['chu'], 3),
    player('qi', ['chu', 'yan', 'han', 'wei'], 0),
    player('qin', ['qi', 'chu', 'yan', 'han', 'wei'], 2),
  ];
  cases.forEach(p => {
    const d = D.forMatch(p, foes);
    ok(!/[{}]/.test(d.title), `${d.id} 標題沒有殘留的替換記號`, d.title);
    ok(!/[{}]/.test(d.body), `${d.id} 內文沒有殘留的替換記號`, d.body.slice(0, 40));
    ok(d.body.length > 60, `${d.id} 內文有寫東西`, String(d.body.length));
    ok(!!d.button, `${d.id} 有按鈕文字`);
  });
}

{
  const d = D.forMatch(player('qi'), ['chu', 'yan', 'han']);
  ok(d.body.indexOf('齊國') >= 0, '內文提到本國', d.body.slice(0, 30));
  ok(d.body.indexOf('楚國、燕國、韓國') >= 0, '三個對手以「、」相連填進去', d.body);
}

{
  // {甲}{乙}{丙} 分開用的那一篇
  const d = D.forMatch(player('qi', ['chu'], 1), ['wei', 'zhao', 'qin']);
  eq(d.id, 'again', '拿到的是再請出師疏');
  ['魏國', '趙國', '秦國'].forEach(n =>
    ok(d.body.indexOf(n) >= 0, `內文提到 ${n}`));
}

{
  const d = D.forMatch(player('qi', ['chu', 'yan', 'han', 'wei'], 0), ['zhao', 'qin', 'chu']);
  eq(d.id, 'closing', '掃平六合疏');
  ok(d.body.indexOf('4 國') >= 0 || d.body.indexOf('4國') >= 0,
     '征服數有填進去', d.body);
}

console.log('═══ 對手不足三家也不能壞掉 ═══');

{
  // 線上版可能湊不滿，或日後改成三人桌
  [[], ['chu'], ['chu', 'yan']].forEach(foes => {
    const d = D.forMatch(player('qi'), foes);
    ok(!/[{}]/.test(d.body), `對手 ${foes.length} 家：沒有殘留記號`, d.body.slice(0, 40));
    ok(d.body.indexOf('、、') < 0, `對手 ${foes.length} 家：沒有連續的頓號`, d.body);
  });
  const none = D.forMatch(player('qi'), []);
  ok(!/undefined|null/.test(none.body), '沒有對手時不會印出 undefined');
}

{
  // 完全不給 player 也不能爆（存檔壞掉／第一次進遊戲）
  const d = D.forMatch(null, null);
  ok(!!d.title && !!d.body, '沒有玩家資料也給得出一篇');
  ok(!/undefined|null/.test(d.body), '而且不含 undefined', d.body.slice(0, 40));
}

console.log('═══ 告天下書（統一天下）═══');

{
  const six = ['chu', 'yan', 'han', 'wei', 'zhao', 'qin'];
  const p = player('qi', six, 0, 11);
  const d = D.forVictory(p);
  eq(d.id, 'unified', '拿到的是告天下書');
  ok(!/[{}]/.test(d.body), '沒有殘留記號', d.body);
  ok(d.body.indexOf('11') >= 0, '場次有填進去', d.body);
  ['楚國', '燕國', '韓國', '魏國', '趙國', '秦國'].forEach(n =>
    ok(d.body.indexOf(n) >= 0, `六國都列到 ${n}`));
  ok(d.body.indexOf('齊國') >= 0, '也提到本國');
}

console.log('═══ 文案本身的體例 ═══');

{
  D.DECREES.forEach(d => {
    ok(/疏$/.test(d.title), `${d.id} 的標題是「…疏」`, d.title);
    ok(d.body.indexOf('臣等') >= 0, `${d.id} 是臣下上奏的口吻`, d.body.slice(0, 20));
    ok(!!d.when, `${d.id} 有註明什麼時候用`);
  });
  eq(D.DECREES.length, 4, '四篇（不是舊版那 28 篇）');
  ok(new Set(D.DECREES.map(d => d.id)).size === 4, 'id 不重複');
  ok(new Set(D.DECREES.map(d => d.title)).size === 4, '標題不重複');
}

console.log('\n─────────────────────────');
console.log(`通過 ${pass}　失敗 ${fail}`);
if (fail) { fails.forEach(f => console.log('  ✗ ' + f)); process.exit(1); }
console.log('全部通過 ✓');
