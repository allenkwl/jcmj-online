/* campaign 的驗證測試
   規格見 docs/campaign.md。這裡守的是那份規格裡**算過數字**的部分 ——
   「只進不退」「前三名各一國」「墊底拿不到」一旦被改掉，戰役長度會整個垮。
   執行： node test/campaign.test.js                              */
const C = require('../src/campaign.js');
const K = require('../src/kingdoms.js');
const S = require('../src/game-state.js');

let pass = 0, fail = 0;
const fails = [];
function ok(cond, name, detail) {
  if (cond) { pass++; }
  else { fail++; fails.push(name + (detail ? '　→ ' + detail : '')); }
}
function eq(a, b, name) { ok(a === b, name, `得到 ${JSON.stringify(a)}，預期 ${JSON.stringify(b)}`); }

/* 固定 rng，測試才可重放 */
const rng = S.makeRNG(1234);
const fixed = v => () => v;

function table(kingdoms) {
  return kingdoms.map((kid, i) => C.createPlayer({ seat: i, kingdom: kid, name: 'P' + i }));
}
/* scoring.standings() 的形狀：已排好序的 [{seat, name, score}] */
const ranksOf = seats => seats.map(s => ({ seat: s, name: 'P' + s, score: 0 }));

console.log('═══ 前三名各征服一國，墊底拿不到 ═══');

{
  const ps = table(['qi', 'chu', 'yan', 'han']);
  const r = C.awardConquests(ps, ranksOf([0, 1, 2, 3]), rng);
  eq(r.length, 4, '四個人都有一筆報告');
  ok(r[0].gained && r[1].gained && r[2].gained, '前三名都拿到一國');
  eq(r[3].gained, null, '墊底拿不到（後面沒有人）');
  eq(r[3].rank, 4, '名次有記錄');
}

{
  // 「排在你後面的人」—— 第三名只能拿第四名那一國
  const ps = table(['qi', 'chu', 'yan', 'han']);
  const r = C.awardConquests(ps, ranksOf([0, 1, 2, 3]), rng);
  eq(r[2].gained, 'han', '第三名拿的是第四名（韓）的國');
  eq(r[2].from, 3, '而且來源記的是第四名那個座位');
}

{
  // 第一名可以從二三四名裡任一個拿，但不會拿到自己的本國
  const ps = table(['qi', 'chu', 'yan', 'han']);
  for (let seed = 1; seed <= 50; seed++) {
    const r = C.awardConquests(ps, ranksOf([0, 1, 2, 3]), S.makeRNG(seed));
    ok(r[0].gained !== 'qi', '第一名不會征服自己的本國', r[0].gained);
    ok(['chu', 'yan', 'han'].indexOf(r[0].gained) >= 0, '第一名拿的是後面三家之一', r[0].gained);
  }
}

console.log('═══ 只進不退 ═══');

{
  const ps = table(['qi', 'chu', 'yan', 'han']);
  // 讓 0 號一直墊底 20 場
  for (let i = 0; i < 20; i++) C.applyResult(ps, ranksOf([1, 2, 3, 0]), rng);
  eq(ps[0].conquered.length, 0, '一直墊底：征服數停在 0，不會變成負的');
  ok(ps[1].conquered.length > 0, '沒墊底的人有前進');
}

{
  const ps = table(['qi', 'chu', 'yan', 'han']);
  const before = [];
  for (let i = 0; i < 10; i++) {
    C.applyResult(ps, ranksOf([i % 4, (i + 1) % 4, (i + 2) % 4, (i + 3) % 4]), rng);
    before.push(ps[0].conquered.length);
  }
  let monotone = true;
  for (let i = 1; i < before.length; i++) if (before[i] < before[i - 1]) monotone = false;
  ok(monotone, '征服數只增不減', before.join('→'));
}

console.log('═══ 不會重複征服同一國、不會超過六國 ═══');

{
  const ps = table(['qi', 'chu', 'yan', 'han']);
  for (let i = 0; i < 60; i++) C.applyResult(ps, ranksOf([0, 1, 2, 3]), rng);
  const c = ps[0].conquered;
  eq(new Set(c).size, c.length, '沒有重複的國');
  ok(c.indexOf('qi') < 0, '本國不會出現在征服清單裡');
  ok(c.length <= C.UNIFY, '不會超過六國', String(c.length));
  ok(ps[0].unified, '一直第一名最後會統一天下');
}

console.log('═══ 退路：後面的國都征服過了 ═══');

{
  const ps = table(['qi', 'chu', 'yan', 'han']);
  ps[0].conquered = ['chu', 'yan', 'han'];        // 桌上另外三國都拿過了
  const r = C.awardConquests(ps, ranksOf([0, 1, 2, 3]), rng);
  ok(r[0].gained, '還是拿得到一國（走退路）');
  ok(['wei', 'zhao', 'qin'].indexOf(r[0].gained) >= 0, '拿的是還沒征服的國', r[0].gained);
  eq(r[0].fallback, true, '有標記這是退路');
  eq(r[0].from, null, '退路沒有來源座位');
}

{
  // 已經六國了就不該再拿（理論上不會還在打，防呆）
  const ps = table(['qi', 'chu', 'yan', 'han']);
  ps[0].conquered = ['chu', 'yan', 'han', 'wei', 'zhao', 'qin'];
  const r = C.awardConquests(ps, ranksOf([0, 1, 2, 3]), rng);
  eq(r[0].gained, null, '征服滿六國之後不會再拿');
}

console.log('═══ 追趕機制與重整旗鼓 ═══');

{
  const ps = table(['qi', 'chu', 'yan', 'han']);
  // 新手（征服數 0）墊底一次就觸發
  const r = C.applyResult(ps, ranksOf([1, 2, 3, 0]), rng);
  const me = r[3];
  eq(me.seat, 0, '第四名是 0 號');
  eq(me.rally.need, 1, '征服數 0 → 門檻是一場');
  eq(me.rally.boost, true, '墊底一次就啟動追趕機制');
  eq(me.rally.canRepick, true, '而且可以重整旗鼓換國');
}

{
  const ps = table(['qi', 'chu', 'yan', 'han']);
  ps[0].conquered = ['chu'];                       // 已經有地
  let r = C.applyResult(ps, ranksOf([1, 2, 3, 0]), rng);
  eq(r[3].rally.need, 2, '有征服地 → 門檻是連續兩場');
  eq(r[3].rally.boost, false, '墊底一場還不觸發');
  r = C.applyResult(ps, ranksOf([1, 2, 3, 0]), rng);
  eq(r[3].rally.boost, true, '連續兩場才觸發');
  eq(r[3].rally.canRepick, false, '有地的人不提供換國');
}

{
  const ps = table(['qi', 'chu', 'yan', 'han']);
  ps[0].conquered = ['chu'];
  C.applyResult(ps, ranksOf([1, 2, 3, 0]), rng);   // 墊底
  eq(ps[0].lastStreak, 1, '連敗計數有累加');
  C.applyResult(ps, ranksOf([0, 1, 2, 3]), rng);   // 第一名
  eq(ps[0].lastStreak, 0, '不墊底就歸零');
}

console.log('═══ AI 不成長 ═══');

{
  const human = C.createPlayer({ seat: 0, kingdom: 'qi' });
  const ai = C.createPlayer({ seat: 1, kingdom: 'chu', isAI: true });
  human.conquered = ['chu', 'yan', 'han', 'wei'];
  ai.conquered = ['qi', 'yan', 'han', 'wei'];      // 就算硬塞給它
  eq(C.conqueredCount(human), 4, '玩家的征服數照算');
  eq(C.conqueredCount(ai), 0, 'AI 永遠回 0 —— 電腦對手是陪玩家打牌的，不用成長');
}

console.log('═══ 決定論（線上四台要算出同一個答案）═══');

{
  const mk = () => table(['qi', 'chu', 'yan', 'han']);
  const a = C.awardConquests(mk(), ranksOf([0, 1, 2, 3]), S.makeRNG(777));
  const b = C.awardConquests(mk(), ranksOf([0, 1, 2, 3]), S.makeRNG(777));
  eq(JSON.stringify(a), JSON.stringify(b), '同一顆種子算出同一個結果');

  let differs = false;
  for (let s = 1; s <= 40 && !differs; s++) {
    const x = C.awardConquests(mk(), ranksOf([0, 1, 2, 3]), S.makeRNG(s));
    if (JSON.stringify(x) !== JSON.stringify(a)) differs = true;
  }
  ok(differs, '不同種子會有不同結果（不是寫死的）');
}

{
  // 純 JSON —— 階段三要原樣丟進 Firebase
  const p = C.createPlayer({ seat: 0, kingdom: 'qi', name: '我' });
  C.applyResult([p], ranksOf([0]), rng);
  const round = JSON.parse(JSON.stringify(p));
  eq(JSON.stringify(round), JSON.stringify(p), '玩家進度可以 JSON 來回不失真');
}

console.log('═══ 單機抽對手：優先抽還沒征服的 ═══');

{
  const p = C.createPlayer({ seat: 0, kingdom: 'qi' });
  p.conquered = ['chu', 'yan'];
  for (let s = 1; s <= 30; s++) {
    const foes = C.drawOpponents(p, S.makeRNG(s));
    eq(foes.length, 3, '抽三家');
    eq(new Set(foes).size, 3, '不重複');
    ok(foes.indexOf('qi') < 0, '不會抽到自己的本國');
    ok(foes.every(f => ['han', 'wei', 'zhao', 'qin'].indexOf(f) >= 0),
       '四個未征服國還夠時，不會抽到已征服的', foes.join(','));
  }
}

{
  // 快統一了：只剩一國沒征服，另外兩家只能從已征服的補
  const p = C.createPlayer({ seat: 0, kingdom: 'qi' });
  p.conquered = ['chu', 'yan', 'han', 'wei', 'zhao'];
  const foes = C.drawOpponents(p, S.makeRNG(5));
  eq(foes.length, 3, '湊得滿三家');
  eq(foes[0], 'qin', '唯一還沒征服的排在最前面');
  eq(new Set(foes).size, 3, '仍然不重複');
}

console.log('═══ 重整旗鼓：換國要保留承諾 ═══');

{
  const p = C.createPlayer({ seat: 0, name: '我', kingdom: 'qi' });
  p.matches = 7;
  p.lastStreak = 1;
  p.boost = true;                                  // 上一場結算時許下的「下一場更好做牌」
  const q = C.repick(p, 'qin');

  eq(q.kingdom, 'qin', '換成新的本國');
  eq(q.conquered.length, 0, '征服清單歸零');
  eq(q.lastStreak, 0, '連敗計數歸零');
  eq(q.boost, true, '⚠️ boost 要留著 —— 按了換國就收回承諾，那按鈕就變成懲罰了');
  eq(q.matches, 7, '總場數留著（那是這個人打過幾場，不屬於某一國）');
  eq(q.seat, 0, '座位不變');
  eq(q.name, '我', '名字不變');
  ok(q !== p, '回傳新物件，不是就地改');
}

{
  // 換成同一國也可以（規格明講「當然可以選一樣的」）
  const p = C.createPlayer({ seat: 0, kingdom: 'qi' });
  p.boost = true;
  eq(C.repick(p, 'qi').kingdom, 'qi', '可以重選同一國');
  eq(C.repick(p, 'qi').boost, true, '同一國也保留 boost');
}

console.log('═══ boost 要存成欄位，不能只存在報告裡 ═══');

{
  const ps = table(['qi', 'chu', 'yan', 'han']);
  eq(ps[0].boost, false, '一開始沒有加持');
  C.applyResult(ps, ranksOf([1, 2, 3, 0]), rng);   // 我墊底，征服數 0 → 一場就觸發
  eq(ps[0].boost, true, '墊底之後寫進玩家物件 —— 下一場開局發牌那層要讀得到');
  // 報告不見了也還在
  const saved = JSON.parse(JSON.stringify(ps[0]));
  eq(saved.boost, true, '存檔來回之後仍然在');

  C.applyResult(ps, ranksOf([0, 1, 2, 3]), rng);   // 拿第一
  eq(ps[0].boost, false, '不再墊底就關掉');
}

{
  const ps = table(['qi', 'chu', 'yan', 'han']);
  ps[0].conquered = ['chu'];
  C.applyResult(ps, ranksOf([1, 2, 3, 0]), rng);
  eq(ps[0].boost, false, '有征服地的人墊底一場還不給加持');
  C.applyResult(ps, ranksOf([1, 2, 3, 0]), rng);
  eq(ps[0].boost, true, '連續兩場才給');
}

console.log('═══ 對手每一場重抽（征服過的要退場）═══');

{
  const p = C.createPlayer({ seat: 0, kingdom: 'qi' });
  // 連續征服三國，每次重抽對手都不該再出現已征服的
  ['chu', 'yan', 'han'].forEach(id => {
    p.conquered.push(id);
    for (let sd = 1; sd <= 20; sd++) {
      const foes = C.drawOpponents(p, S.makeRNG(sd));
      const stale = foes.filter(f => p.conquered.indexOf(f) >= 0);
      ok(stale.length === 0,
         `征服 ${p.conquered.join('、')} 之後，對手不該再有已征服的國`, stale.join(','));
    }
  });
}

console.log('\n─────────────────────────');
console.log(`通過 ${pass}　失敗 ${fail}`);
if (fail) { fails.forEach(f => console.log('  ✗ ' + f)); process.exit(1); }
console.log('全部通過 ✓');
