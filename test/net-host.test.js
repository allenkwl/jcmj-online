/* 換群主：遞補順序＝加入順序（joinedAt）

   為什麼要有這一支：`maybeReassignHost` 以前是**隨機**挑一個成員，而且沒把斷線的那個
   人排除；更麻煩的是它從頭到尾沒有任何地方呼叫（寫了但沒接上），所以「開桌的人在
   等待室斷線」這件事實際上沒有人處理。既然接上了，就要有測試守住遞補規則，不然
   下次再被改回隨機也沒人會發現 —— 隨機的東西人眼看不出壞掉。

   net.js 是給瀏覽器用的純腳本（沒有 module.exports，直接宣告全域 const Net），
   所以這裡用 vm 把它跑在一個假的 firebase 環境裡，再把 Net 拿出來。

   執行： node test/net-host.test.js                                        */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let pass = 0, fail = 0;
const fails = [];
function ok(cond, name, detail) {
  if (cond) { pass++; }
  else { fail++; fails.push(name + (detail ? '　→ ' + detail : '')); }
}
function eq(a, b, name) { ok(a === b, name, `得到 ${JSON.stringify(a)}，預期 ${JSON.stringify(b)}`); }

/* ── 把 net.js 載進來 ──
   它在載入時只會碰到 firebase.database.ServerValue，其餘都是呼叫時才用到。 */
function loadNet() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'net.js'), 'utf8');
  const sandbox = {
    firebase: { database: { ServerValue: { TIMESTAMP: '#ts' } } },
    window: {}, console, setTimeout, clearTimeout, Promise, Date, JSON, Math, Object,
  };
  sandbox.window.firebase = sandbox.firebase;
  return vm.runInNewContext(src + '\n;Net;', sandbox, { filename: 'net.js' });
}

/* 假的 /groups/{群} 節點：記下每一次 transaction 與 set。
   hostNow 代表 Firebase 上現在的 host 值（transaction 的 cur）。 */
function fakeGroupRef(hostNow) {
  const log = { sets: [], tx: 0, committed: null };
  const mk = p => ({
    path: p,
    transaction(fn) {
      log.tx++;
      const r = fn(p === 'host' ? log.host : undefined);
      const committed = r !== undefined;
      if (committed && p === 'host') log.host = r;
      log.committed = committed;
      return Promise.resolve({ committed, snapshot: { val: () => log.host } });
    },
    set(v) { log.sets.push([p, v]); return Promise.resolve(); },
    on() {}, off() {},
  });
  log.host = hostNow;
  return { log, child: p => mk(p), key: 'G' };
}

const M = (id, joinedAt) => ({ id, joinedAt });

/* 寫 isHost 是接在 transaction 的 .then() 後面的（微任務），同步斷言會抓不到，
   所以每次呼叫之後都讓出幾輪事件迴圈再看結果。 */
const settle = () => Promise.resolve().then(() => {}).then(() => {}).then(() => {});

/* ══════ 遞補順序 ══════ */
function run(members, oldHost, hostNow) {
  const Net = loadNet();
  const ref = fakeGroupRef(hostNow === undefined ? oldHost : hostNow);
  Net._groupRef = ref;
  Net.clientId = 'me';
  Net.maybeReassignHost(members, oldHost);
  return settle().then(() => ref.log);
}

(async function main() {
{
  // 陣列順序故意跟 joinedAt 相反，挑出來的必須是最早加入的那位
  const log = await run([M('c', 300), M('b', 200), M('a', 100)], 'H');
  eq(log.host, 'a', '挑最早加入的那位');
  eq(log.tx, 1, '只下一次 transaction');
}
{
  // 名單裡還留著斷線的舊群主（他的 joinedAt 最早）—— 不能挑回他自己
  const log = await run([M('H', 1), M('b', 200), M('a', 100)], 'H');
  eq(log.host, 'a', '排除斷線的舊群主，就算他加入得最早');
}
{
  // joinedAt 缺欄位（舊資料、或伺服器時間還沒寫回來）當 0 —— 不能炸，也不能挑到
  // 後面的人前面去
  const log = await run([M('b', 200), M('a', undefined)], 'H');
  eq(log.host, 'a', '沒有 joinedAt 的當最早，不炸');
}
{
  const log = await run([], 'H');
  eq(log.tx, 0, '沒有人可以接 → 不動');
  eq(log.host, 'H', '沒有人可以接 → host 不變');
}
{
  const Net = loadNet();
  const ref = fakeGroupRef('H');
  Net._groupRef = ref;
  Net.maybeReassignHost([M('a', 1)], null);
  eq(ref.log.tx, 0, 'oldHostId 是空的 → 不動');
}
{
  const Net = loadNet();
  Net._groupRef = null;
  let threw = false;
  try { Net.maybeReassignHost([M('a', 1)], 'H'); } catch (e) { threw = true; }
  ok(!threw, '還沒進群組就呼叫 → 不炸');
}

/* ══════ 別台先換過了 → transaction 要中止 ══════ */
{
  // Firebase 上的 host 已經是 'b'（別台搶先），我這台算出來是 'a' 也不能覆寫
  const log = await run([M('a', 100), M('b', 200)], 'H', 'b');
  eq(log.host, 'b', '別台先換過了 → 不覆寫');
  eq(log.committed, false, '別台先換過了 → transaction 中止');
  eq(log.sets.length, 0, '中止時不去寫別人的 isHost');
}

/* ══════ 名單上的「開桌」標記要跟著走 ══════ */
{
  const log = await run([M('a', 100), M('b', 200)], 'H');
  eq(log.sets.length, 1, '成功接手時寫一次 isHost');
  eq(log.sets[0][0], 'members/a/isHost', '寫到新群主的成員節點');
  eq(log.sets[0][1], true, 'isHost 設成 true');
}

/* ══════ watchRoom 要把本機的 isHost 跟 Firebase 對齊 ══════
   換過群主之後，新群主那台原本還是 false（斷線補寫會把自己寫回非群主），
   被換掉的那台原本還是 true（一直以為自己在當裁判）。 */
function watchWith(hostOnServer, myId, myIsHostBefore) {
  const Net = loadNet();
  let cb = null;
  Net._groupRef = { on: (_e, f) => { cb = f; }, off() {} };
  Net.clientId = myId;
  Net.isHost = myIsHostBefore;
  Net._meData = { isHost: myIsHostBefore };
  Net.watchRoom(() => {});
  cb({ val: () => ({ host: hostOnServer, members: { a: { name: 'A' } }, status: 'waiting' }) });
  return Net;
}
{
  const n = watchWith('me', 'me', false);
  eq(n.isHost, true, '被換成群主 → 本機 isHost 跟著變 true');
  eq(n._meData.isHost, true, '斷線補寫用的那份也一起更新');
}
{
  const n = watchWith('other', 'me', true);
  eq(n.isHost, false, '群主換成別人 → 本機 isHost 跟著變 false');
  eq(n._meData.isHost, false, '斷線補寫用的那份也一起更新');
}
{
  // host 還沒寫上去（null）時不要亂動本機的旗標 —— 建群的那一瞬間就是這樣
  const n = watchWith(null, 'me', true);
  eq(n.isHost, true, 'host 還是空的 → 不動本機旗標');
}

console.log(`\n通過 ${pass}　失敗 ${fail}`);
if (fail) { fails.forEach(f => console.log('  ✗ ' + f)); process.exit(1); }
console.log('全部通過 ✓');
})();
