/* online-progress（連線的七國進度）的驗證測試
   執行： node test/online-progress.test.js                            */
const OP = require('../src/online-progress.js');
const CP = require('../src/campaign.js');

let pass = 0, fail = 0;
const fails = [];
function ok(cond, name, detail) {
  if (cond) { pass++; }
  else { fail++; fails.push(name + (detail ? '　→ ' + detail : '')); }
}
function eq(a, b, name) { ok(a === b, name, `得到 ${JSON.stringify(a)}，預期 ${JSON.stringify(b)}`); }

/* 假的 localStorage */
function store(init) {
  const m = Object.assign({}, init || {});
  return {
    getItem: k => (k in m ? m[k] : null),
    setItem: (k, v) => { m[k] = String(v); },
    removeItem: k => { delete m[k]; },
    _m: m,
  };
}

console.log('═══ 七國進度 ═══');
{
  const s = store();
  const d = OP.load(s);
  eq(Object.keys(d.kingdoms).length, 0, '沒存過：空的');
  eq(OP.summary(d, 'qin'), null, '沒出征過的國：沒有摘要');

  const fresh = OP.forTable(d, 'qin', '小球貓');
  eq(fresh.kingdom, 'qin', '沒有進度：從頭開始，本國是選的那一國');
  eq(fresh.gold, CP.START_GOLD, '沒有進度：國庫是本錢');
  eq(fresh.conquered.length, 0, '沒有進度：沒有征服地');

  fresh.conquered = ['han', 'wei']; fresh.matches = 5; fresh.gold = 2450;
  OP.put(d, fresh, 1000);
  ok(OP.save(s, d), '存得進去');

  const d2 = OP.load(s);
  const back = OP.forTable(d2, 'qin', '新名字');
  eq(back.conquered.join(','), 'han,wei', '再選秦：征服地帶進來');
  eq(back.gold, 2450, '再選秦：國庫帶進來');
  eq(back.matches, 5, '再選秦：場數帶進來');
  eq(back.name, '新名字', '名字用這一次的');
  const sm = OP.summary(d2, 'qin');
  ok(sm && sm.conquered === 2 && sm.gold === 2450 && sm.matches === 5, '擇國卡片的摘要', JSON.stringify(sm));
  eq(OP.summary(d2, 'zhao'), null, '別的國不受影響');

  // forTable 拿到的是副本：改了不會偷偷寫回
  back.gold = -999;
  eq(OP.get(OP.load(s), 'qin').gold, 2450, 'forTable 給的是副本，沒 put 就不會寫回');

  // 統一天下／亡國：刪掉那一國
  OP.drop(d2, 'qin'); OP.save(s, d2);
  eq(OP.summary(OP.load(s), 'qin'), null, '刪掉之後再選就從頭開始');
}
{
  // 舊存檔裡沒有 gold（v1.61 之前）：照「本錢＋征服國數×戰利品」補
  const d = { kingdoms: { chu: { kingdom: 'chu', conquered: ['qi'], matches: 3 } } };
  eq(OP.summary(d, 'chu').gold, CP.START_GOLD + CP.SPOILS, '沒有國庫欄位：補本錢＋戰利品');
  const sn = OP.snapshot(OP.forTable(d, 'chu', 'A'));
  ok(sn.kingdom === 'chu' && sn.conquered.length === 1 && sn.gold === CP.START_GOLD + CP.SPOILS, '給同桌看的快照', JSON.stringify(sn));
}
{
  // 壞掉的資料不會讓遊戲當掉
  eq(Object.keys(OP.load(store({ jcmj_online_kingdoms: '{壞掉' })).kingdoms).length, 0, '壞掉的 JSON：當成空的');
}

console.log('═══ 清掉舊的一桌一段存檔 ═══');
{
  const s = store({ jcmj_online_saves: '[{"id":"a"}]', jcmj_pending_quits: '[]', other: 'keep' });
  eq(OP.clearOld(s), true, '有舊存檔：回 true（要提示一次）');
  eq(s.getItem('jcmj_online_saves'), null, '舊存檔刪掉');
  eq(s.getItem('jcmj_pending_quits'), null, '退出待補送也刪掉');
  eq(s.getItem('other'), 'keep', '別的東西不動');
  eq(OP.clearOld(s), false, '第二次：沒東西可刪，回 false（不再提示）');
  eq(OP.clearOld(store({ jcmj_online_saves: '[]' })), false, '只有空的清單：不算有舊存檔');
}

console.log('═══ 一個瀏覽器一桌 ═══');
{
  const s = store();
  ok(OP.lock(s, 'tabA', { table: '小球貓的牌桌', kingdom: 'qin' }, 1000), 'A 分頁拿到鎖');
  const other = OP.lockedByOther(s, 'tabB', 2000);
  ok(other && other.table === '小球貓的牌桌', 'B 分頁看到 A 正在用', JSON.stringify(other));
  eq(OP.lock(s, 'tabB', { table: '別桌' }, 2000), false, 'B 分頁拿不到鎖');
  eq(OP.lockedByOther(s, 'tabA', 2000), null, '自己的鎖不算別人的');
  ok(OP.lock(s, 'tabA', { kingdom: 'zhao' }, 5000), 'A 更新鎖（換國）');
  eq(OP.readLock(s).table, '小球貓的牌桌', '更新時保留原本的桌名');
  eq(OP.readLock(s).kingdom, 'zhao', '更新時換成新的國');
  // A 分頁直接關掉，鎖沒放：過 30 秒自然失效
  eq(OP.lockedByOther(s, 'tabB', 5000 + OP.LOCK_TTL + 1), null, '鎖過期：B 可以上桌了');
  ok(OP.lock(s, 'tabB', { table: '別桌' }, 5000 + OP.LOCK_TTL + 1), 'B 拿到過期的鎖');
  OP.unlock(s, 'tabA');
  eq(OP.readLock(s).tab, 'tabB', 'A 放鎖不會放掉 B 的鎖');
  OP.unlock(s, 'tabB');
  eq(OP.readLock(s), null, 'B 離開時放掉');
}

console.log('\n─────────────────────────');
console.log(`通過 ${pass}　失敗 ${fail}`);
if (fail) { fails.forEach(f => console.log('  ✗ ' + f)); process.exit(1); }
console.log('全部通過 ✓');
