/* 寫入權規則實測：對著本機的 Database 模擬器，把 net.js 每一條會寫入的路徑各跑一遍。
   A = 群主、B = 同桌的一般成員、C = 還沒加入的人、X = 完全不相干的外人（別桌的玩家）。 */
import fs from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';

const HOUR = 3600000;
const A = 'uidA', B = 'uidB', C = 'uidC', X = 'uidX';

const env = await initializeTestEnvironment({
  projectId: 'jcmj-4p',
  database: { host: '127.0.0.1', port: 9123, rules: fs.readFileSync('database.rules.json', 'utf8') },
});

const db = uid => env.authenticatedContext(uid).database();
let pass = 0, fail = 0; const fails = [];
async function ok(name, p)   { try { await assertSucceeds(p()); pass++; } catch (e) { fail++; fails.push('應該可以寫，卻被擋了：' + name); } }
async function no(name, p)   { try { await assertFails(p());    pass++; } catch (e) { fail++; fails.push('應該被擋，卻寫進去了：' + name); } }

async function seed() {
  await env.clearDatabase();
  await env.withSecurityRulesDisabled(async ctx => {
    const r = ctx.database();
    await r.ref('groups/tbl').set({
      host: A, status: 'started', displayName: '桌', createdAt: Date.now(),
      members: { [A]: { name: 'A', isHost: true, uid: A, joinedAt: 100 },
                 [B]: { name: 'B', isHost: false, uid: B, joinedAt: 200 } },
    });
    await r.ref('states/tbl').set({ x: 1 });
    await r.ref('hands/tbl/' + B).set({ t: 1 });
    await r.ref('secret/tbl').set({ wall: [1, 2] });
    await r.ref('groups/empty').set({ host: A, status: 'waiting', createdAt: Date.now() });
    await r.ref('groups/stale').set({ host: A, status: 'waiting', createdAt: Date.now() - 2 * HOUR,
                                      members: { [A]: { name: 'A' } } });
    await r.ref('groups/stale2').set({ host: A, status: 'started', createdAt: Date.now() - 2 * HOUR,
                                       members: { [A]: { name: 'A' } } });
    await r.ref('groups/stale13').set({ host: A, status: 'started', createdAt: Date.now() - 13 * HOUR,
                                        members: { [A]: { name: 'A' } } });
    // 桌已經收掉、附屬資料還留著（purgeGroupData／sweepOrphans 要清的就是這種）
    await r.ref('states/gone').set({ x: 1 });
    await r.ref('token/gone').set({ holder: A });
    await r.ref('hands/gone/' + B).set({ t: 1 });
    await r.ref('secret/gone').set({ wall: [1] });
    await r.ref('camps/c1/members/' + B).set({ at: 1, name: 'B' });
    // 空殼：桌還在、成員全走光了（reopenGroup 清掉重開走的就是這條）
    await r.ref('groups/shell').set({ host: A, status: 'started', createdAt: Date.now() });
    await r.ref('states/shell').set({ x: 1 });
    await r.ref('token/shell').set({ holder: A });
    await r.ref('live/shell').set({ s: 1 });
    await r.ref('hands/shell/' + B).set({ t: 1 });
    await r.ref('secret/shell').set({ wall: [1] });
    await r.ref('pongs/tbl/req1/' + X).set(true);
  });
}

await seed();

/* ══ 1. 外人（別桌的玩家）對這一桌亂寫 —— 全部要擋 ══ */
for (const [name, path, val] of [
  ['token',    'token/tbl',        { holder: X, turn: 99 }],
  ['live',     'live/tbl',         { seat: 0 }],
  ['claims',   'claims/tbl/0',     { pass: true }],
  ['ready',    'ready/tbl/' + X,   true],
  ['bots',     'bots/tbl/0',       X],
  ['beat',     'beat/tbl',         123],
  ['pause',    'pause/tbl',        { who: X }],
  ['nudges',   'nudges/tbl/n1',    { text: 'hi' }],
  ['claimwin', 'claimwin/tbl',     { open: true }],
  ['debug',    'debug/tbl',        { z: 1 }],
  ['states',   'states/tbl',       { x: 2 }],
  ['secret',   'secret/tbl',       { wall: [] }],
  ['hands',    'hands/tbl/' + B,   { t: 2 }],
  ['桌的設定 status', 'groups/tbl/status', 'waiting'],
  ['桌的設定 host',   'groups/tbl/host',   X],
  ['別人的成員節點',   'groups/tbl/members/' + B, { name: '假的' }],
]) await no('外人寫 ' + name, () => db(X).ref(path).set(val));

await no('外人 push cmds',  () => db(X).ref('cmds/tbl').push({ t: 'x' }));
await no('外人刪掉別人正在用的桌', () => db(X).ref('groups/tbl').remove());
await no('外人讀 hands',    () => db(X).ref('hands/tbl/' + B).once('value'));
await no('外人讀 secret',   () => db(X).ref('secret/tbl').once('value'));
await no('外人寫別人的 camps 名冊', () => db(X).ref('camps/c1/members/' + B).set({ at: 2 }));

/* ══ 2. 同桌的一般成員 B —— 遊戲跑得起來 ══ */
for (const [name, path, val] of [
  ['token（交棒、ack）', 'token/tbl',      { holder: B, turn: 5 }],
  ['live（輕量同步）',   'live/tbl',       { seat: 1 }],
  ['claims（宣告回覆）', 'claims/tbl/0',   { pass: true }],
  ['ready（按準備）',    'ready/tbl/' + B, true],
  ['bots（認領電腦座位）', 'bots/tbl/0',   B],
  ['beat（持有者心跳）', 'beat/tbl',       123],
  ['pause（斷線暫停）',  'pause/tbl',      { who: A }],
  ['nudges（打招呼）',   'nudges/tbl/n1',  { text: 'hi' }],
  ['claimwin',          'claimwin/tbl',   { open: true }],
  ['debug',             'debug/tbl',      { z: 1 }],
  ['status（resetToWaiting）', 'groups/tbl/status', 'waiting'],
  ['host（takeHost 接手群主）', 'groups/tbl/host', B],
  ['自己的 ready 旗標',  'groups/tbl/members/' + B + '/ready', true],
  ['換群主補寫別人的 isHost', 'groups/tbl/members/' + C + '/isHost', true],
  ['gameId',            'groups/tbl/gameId', 'g1'],
  ['next（下一場）',     'groups/tbl/next',   { stay: [B] }],
]) await ok('成員寫 ' + name, () => db(B).ref(path).set(val));

await ok('成員 push cmds', () => db(B).ref('cmds/tbl').push({ t: 'x' }));
await ok('成員讀自己的手牌', () => db(B).ref('hands/tbl/' + B).once('value'));
await ok('成員寫自己的 camps 名冊', () => db(B).ref('camps/c1/members/' + B).set({ at: 2, name: 'B' }));
/* ⚠️ 上面測過「B 接手群主」，這時候 B 真的已經是群主了 —— 不重新播種的話，
   底下這四項會理所當然地過，看起來通過其實什麼都沒驗到。 */
await seed();
await no('成員寫 states（只有群主）', () => db(B).ref('states/tbl').set({ x: 3 }));
await no('成員寫 secret（只有群主）', () => db(B).ref('secret/tbl').set({ wall: [] }));
await no('成員讀 secret（只有群主）', () => db(B).ref('secret/tbl').once('value'));
await no('成員讀別人的手牌',          () => db(B).ref('hands/tbl/' + A).once('value'));

await seed();
/* ══ 3. 群主 A ══ */
await ok('群主寫 states',  () => db(A).ref('states/tbl').set({ x: 3 }));
await ok('群主寫 secret',  () => db(A).ref('secret/tbl').set({ wall: [3] }));
await ok('群主讀 secret',  () => db(A).ref('secret/tbl').once('value'));
await ok('群主發手牌給 B', () => db(A).ref('hands/tbl/' + B).set({ t: 9 }));
await ok('群主一次原子寫入 states+hands+secret', () => db(A).ref().update({
  'states/tbl': { x: 4 }, ['hands/tbl/' + B]: { t: 10 }, 'secret/tbl': { wall: [4] },
}));

/* ══ 4. 加入一張桌（C 還不是成員）══ */
await ok('新人寫自己的成員節點＝加入', () => db(C).ref('groups/tbl/members/' + C).set({ name: 'C', uid: C, joinedAt: 300 }));
await seed();
await no('新人冒充別人的成員節點', () => db(C).ref('groups/tbl/members/' + B).set({ name: '假的' }));
await no('還沒加入就改桌的設定',   () => db(C).ref('groups/tbl/status').set('waiting'));
await ok('開一張新桌',             () => db(C).ref('groups/newtbl').set({ host: C, status: 'waiting', createdAt: Date.now() }));

/* ══ 5. 刪桌 ══ */
await seed();
await ok('刪掉一個人都沒有的空殼桌',        () => db(X).ref('groups/empty').remove());
await ok('刪掉過期的等人桌（>1 小時）',      () => db(X).ref('groups/stale').remove());
await no('進行中才過 2 小時：還不能刪',      () => db(X).ref('groups/stale2').remove());
await ok('進行中過了 13 小時：可以刪',       () => db(X).ref('groups/stale13').remove());

/* ══ 6. 桌已經收掉 → 誰都可以清垃圾（purgeGroupData／sweepOrphans）══ */
await ok('清 states/{已收掉的桌}', () => db(X).ref('states/gone').remove());
await ok('清 token/{已收掉的桌}',  () => db(X).ref('token/gone').remove());
await ok('清 hands/{已收掉的桌}',  () => db(X).ref('hands/gone').remove());
await ok('清 secret/{已收掉的桌}', () => db(X).ref('secret/gone').remove());

/* ══ 6b. 開桌的流程：transaction 建桌之後補寫 createdAt，那時候我還沒進 members ══ */
await seed();
await ok('開新桌', () => db(C).ref('groups/brandnew').set({ host: C, status: 'waiting', createdAt: 1 }));
await ok('建桌後補寫 createdAt（還沒加入 members）', () => db(C).ref('groups/brandnew/createdAt').set(Date.now()));
await ok('開桌的人接著寫自己的成員節點', () => db(C).ref('groups/brandnew/members/' + C).set({ name: 'C', uid: C, joinedAt: 1 }));

/* ══ 6c. 空殼桌（桌還在、一個人都沒有）：purgeGroup 是**並行**刪十幾棵的，
        附屬那幾棵被判定的當下 groups 往往還在 —— 這幾項就是在驗那個時序 ══ */
await seed();
for (const [name, path] of [['states', 'states/shell'], ['token', 'token/shell'], ['live', 'live/shell'],
                            ['hands', 'hands/shell'], ['secret', 'secret/shell']])
  await ok('清空殼桌的 ' + name + '（桌還在、但沒人）', () => db(X).ref(path).remove());
await ok('清空殼桌本身', () => db(X).ref('groups/shell').remove());

/* ══ 7. 存活探測：故意不限成員（探測的人本來就還沒加入）══ */
await seed();
await ok('外人發 ping',        () => db(X).ref('pings/tbl').push({ from: X, at: 1 }));
await ok('成員回 pong',        () => db(B).ref('pongs/tbl/req2/' + B).set(true));
await ok('探測者清掉自己的 pong', () => db(X).ref('pongs/tbl/req1').remove());

/* ══ 8. 最後一個人離開：先把自己拿掉，再刪掉空了的桌 ══ */
await seed();
await env.withSecurityRulesDisabled(c => c.database().ref('groups/tbl/members/' + A).remove());
await ok('最後一位成員移除自己',   () => db(B).ref('groups/tbl/members/' + B).remove());
await ok('走掉之後刪掉空了的桌',   () => db(B).ref('groups/tbl').remove());

await env.cleanup();
console.log(`\n通過 ${pass}　失敗 ${fail}`);
if (fail) { fails.forEach(f => console.log('  ✗ ' + f)); process.exit(1); }
console.log('全部通過 ✓');
