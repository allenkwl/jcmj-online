/* online-campaign 的驗證測試（規格：docs/online-campaign.md）
   執行： node test/online-campaign.test.js */
const OC = require('../src/online-campaign.js');
const S = require('../src/game-state.js');

let pass = 0, fail = 0;
const fails = [];
function ok(cond, name, detail) { if (cond) pass++; else { fail++; fails.push(name + (detail ? '　→ ' + detail : '')); } }
function eq(a, b, name) { ok(JSON.stringify(a) === JSON.stringify(b), name, `得到 ${JSON.stringify(a)}，預期 ${JSON.stringify(b)}`); }

/* 假的 localStorage */
function store() { const m = {}; return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, _m: m }; }

console.log('── 存檔格 ──');
{
  const st = store();
  eq(OC.loadSlots(st), [], '沒有存檔是空陣列');
  st.setItem(OC.KEY, '壞掉的 json');
  eq(OC.loadSlots(st), [], '存檔壞掉不會炸');
  let slots = [];
  for (let i = 0; i < 12; i++) slots = OC.putSlot(slots, OC.makeSlot({ id: 'c' + i, table: '桌' + i, uid: 'u', name: '我', kingdom: 'qi', now: i }), i);
  eq(slots.length, 10, '最多十格');
  eq(slots[0].id, 'c11', '最近的在最前面');
  ok(!OC.findSlot(slots, 'c0') && !OC.findSlot(slots, 'c1'), '最舊的被擠掉');
  slots = OC.putSlot(slots, Object.assign({}, OC.findSlot(slots, 'c5'), { table: '改名' }), 99);
  eq(slots[0].id, 'c5', '更新的那格移到最前面');
  eq(slots.filter(s => s.id === 'c5').length, 1, '不會重複');
  OC.saveSlots(st, slots);
  eq(OC.loadSlots(st).length, 10, '存得回來');
  eq(OC.dropSlot(slots, 'c5').length, 9, '刪掉一格');
}

console.log('── 名冊 ──');
{
  const id = 'camp1';
  let roster = OC.mergeRoster([], [
    { uid: 'a', name: '小球貓', kingdom: 'qi', joinedAt: 10, camp: null },
    { uid: 'b', name: '阿明', kingdom: 'chu', joinedAt: 20, camp: { id: 'OTHER', conquered: ['han'] } },
  ], id);
  eq(roster.map(m => m.uid), ['a', 'b'], '照加入順序');
  eq(roster[1].conquered, [], '別的戰役的進度不帶進來（新人從頭開始）');

  roster = OC.mergeRoster(roster, [{ uid: 'a', name: '小球貓2', camp: { id, conquered: ['han', 'qin'], matches: 3 } }], id);
  eq(roster[0].conquered, ['han', 'qin'], '在場本人的記錄為準');
  eq(roster[0].name, '小球貓2', '名字跟著更新');

  roster = OC.mergeRoster(roster, [{ uid: 'c', joinedAt: 30 }, { uid: 'd', joinedAt: 40 }, { uid: 'e', joinedAt: 50 }], id);
  eq(roster.length, 4, '名冊最多四人');
  ok(OC.canJoin(roster, 'a'), '名冊裡的人可以回來');
  ok(!OC.canJoin(roster, 'e'), '滿了新人進不來');
  roster = OC.removeMember(roster, 'c');
  ok(OC.canJoin(roster, 'e'), '有人退出就空出位子');

  const k = OC.assignKingdoms([{ uid: 'a', kingdom: 'qi' }, { uid: 'b', kingdom: 'qi' }, { uid: 'c', kingdom: null }], S.makeRNG(7));
  eq(k[0].kingdom, 'qi', '先來的保有本國');
  ok(k[1].kingdom && k[1].kingdom !== 'qi', '撞國的換一國');
  ok(k[2].kingdom && new Set(k.map(m => m.kingdom)).size === 3, '三國都不同');
}

console.log('── 排座位 ──');
{
  const roster = [
    { uid: 'a', name: 'A', kingdom: 'qi', joinedAt: 1, conquered: ['han'] },
    { uid: 'b', name: 'B', kingdom: 'chu', joinedAt: 2, conquered: [] },
    { uid: 'c', name: 'C', kingdom: 'yan', joinedAt: 3, conquered: ['qin'] },
  ].map(m => Object.assign({ matches: 0, unified: false }, m));
  const seats = OC.buildSeats({ roster, present: ['b', 'a'], hostUid: 'b', aiLevel: 3, rng: S.makeRNG(1) });
  eq(seats.length, 4, '四個座位');
  eq(seats[0].clientId, 'b', '開桌的人坐 0');
  eq(seats[1].clientId, 'a', '其餘照加入順序');
  ok(seats[2].isAI && seats[2].absentOf && seats[2].absentOf.uid === 'c', '缺席的人：座位保留、電腦代打');
  eq(seats[2].kingdom, 'yan', '缺席的座位還是他那一國');
  eq(seats[2].conquered, ['qin'], '缺席的人的征服地照舊顯示');
  ok(seats[3].isAI && !seats[3].absentOf, '不滿四人由守將補');
  eq(new Set(seats.map(s => s.kingdom)).size, 4, '四國都不同');
}

console.log('── 結算：每台各自算要算出同一個答案 ──');
{
  const seats = [
    { name: 'A', kingdom: 'qi', clientId: 'a', conquered: ['han'] },
    { name: 'B', kingdom: 'chu', clientId: 'b', conquered: [] },
    { name: '燕將樂毅', kingdom: 'yan', isAI: true, conquered: [] },
    { name: '秦將王翦', kingdom: 'qin', isAI: true, conquered: [] },
  ];
  const standings = [{ seat: 1 }, { seat: 0 }, { seat: 3 }, { seat: 2 }];
  const r1 = OC.settle({ seats, standings, seed: 12345 });
  const r2 = OC.settle({ seats: JSON.parse(JSON.stringify(seats)), standings, seed: 12345 });
  eq(r1.report.map(x => x.gained), r2.report.map(x => x.gained), '同樣的輸入，兩台算出同樣的分封');
  eq(r1.report[3].gained, null, '墊底拿不到地');
  ok(r1.players[0].conquered.indexOf('han') >= 0, '原本的征服地還在（只進不退）');
  ok(r1.players[0].conquered.length === 2, '第二名多拿一國');
  eq(seats[0].conquered, ['han'], '不會改到傳進來的座位');
  // 自己的完整記錄（連敗數等）也要帶得進去
  const rec = { conquered: ['han'], lastStreak: 2, matches: 5, boost: false, unified: false, kingdom: 'qi', name: 'A', isAI: false };
  const r3 = OC.settle({ seats, standings, seed: 12345, records: { 0: rec } });
  eq(r3.players[0].matches, 6, '帶進去的記錄會累加場數');
  eq(r3.report.map(x => x.gained), r1.report.map(x => x.gained), '帶不帶完整記錄，分封結果都一樣');
}

console.log('\n─────────────────────────');
console.log(`通過 ${pass}　失敗 ${fail}`);
if (fail) { fails.forEach(f => console.log('  ✗ ' + f)); process.exit(1); }
console.log('全部通過 ✓');
