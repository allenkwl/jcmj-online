/* solo-slots（單機十格存檔＋功業簿）的驗證測試（規格：docs/solo-saves.md）
   執行： node test/solo-slots.test.js */
const SS = require('../src/solo-slots.js');
const CP = require('../src/campaign.js');

let pass = 0, fail = 0;
const fails = [];
function ok(cond, name, detail) { if (cond) pass++; else { fail++; fails.push(name + (detail ? '　→ ' + detail : '')); } }
function eq(a, b, name) { ok(JSON.stringify(a) === JSON.stringify(b), name, `得到 ${JSON.stringify(a)}，預期 ${JSON.stringify(b)}`); }
function store() { const m = {}; return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, _m: m }; }
const lord = k => ({ qi: '齊威王', chu: '楚懷王', qin: '秦王' }[k] || k);
const player = (k, o) => Object.assign(CP.createPlayer({ seat: 0, name: '我', kingdom: k }), o || {});

console.log('── 讀寫 ──');
{
  const st = store();
  eq(SS.load(st), { slots: [], fame: [], migrated: false }, '沒有存檔');
  st.setItem(SS.KEY, '壞掉的 json');
  eq(SS.load(st).slots, [], '存檔壞掉不會炸');
}

console.log('── 搬舊存檔（舊資料不刪） ──');
{
  const st = store();
  const v2 = { current: 'chu', byKingdom: {
    qi: player('qi', { conquered: ['han', 'wei'], matches: 5 }),
    chu: player('chu', { conquered: ['qi', 'yan', 'han', 'wei', 'zhao', 'qin'], matches: 14, unified: true }),
    qin: player('qin'),                                 // 開了還沒打完第一場
  }, history: [player('qi', { conquered: ['a', 'b', 'c', 'd', 'e', 'f'], matches: 11, unified: true, archivedAt: 123 })] };
  const raw = JSON.stringify(v2);
  st.setItem(SS.OLD_V2, raw);
  const d = SS.migrate(st, lord, 1000);
  eq(d.slots.map(s => s.kingdom).sort(), ['qi', 'qin'], '沒統一的每一國各一格（連還沒打完第一場的也搬）');
  eq(d.slots.find(s => s.kingdom === 'qi').camp.conquered, ['han', 'wei'], '征服地原封不動');
  eq(d.fame.length, 2, '統一過的（含 history）進功業簿');
  eq(d.fame.map(f => f.name).sort(), ['楚懷王', '齊威王'], '功業簿名字預設君主稱號');
  ok(d.fame.every(f => f.migrated), '標成舊紀錄');
  eq(st.getItem(SS.OLD_V2), raw, '舊的 key 一個字都沒動');
  const again = SS.migrate(st, lord, 2000);
  eq(again.slots.length, 2, '只搬一次（重跑不會多出格子）');
}
{
  const st = store();
  st.setItem(SS.OLD_V1, JSON.stringify(player('chu', { conquered: ['qi'], matches: 3 })));
  const d = SS.migrate(st, lord, 1);
  eq(d.slots.map(s => [s.kingdom, s.camp.conquered]), [['chu', ['qi']]], '更舊的 v1 單份存檔也搬');
}
{
  const st = store();
  const d = SS.migrate(st, lord, 1);
  eq([d.slots.length, d.fame.length, d.migrated], [0, 0, true], '沒有舊存檔：空的，但標記搬過了');
}

console.log('── 十格 ──');
{
  const st = store();
  const d = SS.migrate(st, lord, 1);
  for (let i = 0; i < 10; i++) ok(!!SS.create(d, 'qi', player('qi'), 2, 100 + i), '開第 ' + (i + 1) + ' 格');
  ok(SS.isFull(d), '十格滿了');
  eq(SS.create(d, 'chu', player('chu'), 2, 999), null, '滿了開不出新的一格（不會自動擠掉最舊的）');
  eq(d.slots.length, 10, '還是十格，一格都沒少');
  const ids = d.slots.map(s => s.id);
  eq(new Set(ids).size, 10, 'id 不重複（同一毫秒開好幾格也一樣）');
  SS.update(d, ids[3], { snap: { x: 1 } }, 5000);
  eq(SS.sorted(d.slots)[0].id, ids[3], '最近玩的排最前面');
  eq(SS.update(d, 'nope', { snap: 1 }), null, '找不到的 id 不會多開一格');
  eq(d.slots.length, 10, '仍是十格');
  SS.drop(d, ids[0]);
  eq(d.slots.length, 9, '玩家刪一格');
  ok(!!SS.create(d, 'chu', player('chu'), 3), '刪了才開得出新的');
  SS.save(st, d);
  eq(SS.load(st).slots.length, 10, '寫回再讀');
  eq(SS.load(st).slots.filter(s => s.kingdom === 'qi').length, 9, '同一國可以開好幾格');
}

console.log('── 功業簿 ──');
{
  const d = { slots: [], fame: [], migrated: true };
  const e = SS.addFame(d, player('qin', { conquered: ['qi', 'chu', 'yan', 'han', 'wei', 'zhao'], matches: 12 }), '秦王', 42);
  eq([e.name, e.lord, e.kingdom, e.matches, e.conquered.length, e.unifiedAt], ['秦王', '秦王', 'qin', 12, 6, 42], '一筆功業');
  SS.renameFame(d, e.id, '小球貓一統天下的那一天真是太開心了');
  eq(d.fame[0].name.length, 12, '名字最多 12 個字');
  SS.renameFame(d, e.id, '');
  eq(d.fame[0].name.length, 12, '空名字不會把原本的名字洗掉');
  SS.dropFame(d, e.id);
  eq(d.fame.length, 0, '玩家自己刪');
}

console.log(`\n${pass} 通過，${fail} 失敗`);
if (fail) { fails.forEach(f => console.log('  ✗ ' + f)); process.exit(1); }
