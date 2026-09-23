/* 四個主動技能
   規格：docs/skill-conflicts.md 第六節。

   這裡最重要的一條是規格的第一句：**技能只作用在自己身上**。
   所以有兩項專門盯著「有沒有動到別人」——
   換牌不可以位移其他三家的摸牌序列，窺探不可以看到王牌。
   執行： node test/skills.test.js                                */
const K = require('../src/skills.js');
const S = require('../src/game-state.js');

let pass = 0, fail = 0;
const fails = [];
function ok(cond, name, detail) {
  if (cond) { pass++; }
  else { fail++; fails.push(name + (detail ? '　→ ' + detail : '')); }
}
function eq(a, b, name) { ok(a === b, name, `得到 ${JSON.stringify(a)}，預期 ${JSON.stringify(b)}`); }

function freshHand(seed) {
  const m = S.createMatch({ seed: seed || 1 });
  S.startHand(m);
  return m.hand;
}

console.log('═══ 次數依征服數成長 ═══');

{
  // 門檻 0–1 / 2–3 / 4+（scoring.growthTier）
  eq(K.maxUses('yan', 0), 1, '燕 奇謀　征服 0 國：1 次');
  eq(K.maxUses('yan', 1), 1, '燕　征服 1 國：還是 1 次');
  eq(K.maxUses('yan', 2), 2, '燕　征服 2 國：2 次');
  eq(K.maxUses('yan', 3), 2, '燕　征服 3 國：2 次');
  eq(K.maxUses('yan', 4), 3, '燕　征服 4 國：3 次');
  eq(K.maxUses('yan', 6), 3, '燕　征服 6 國：上限 3 次');
  eq(K.maxUses('zhao', 0), 2, '趙 騎射起步就比韓多（2/3/4）');
  eq(K.maxUses('zhao', 4), 4, '趙　滿級 4 次');
  eq(K.maxUses('han', 0), 1, '韓 精兵 1/2/3');
  eq(K.maxUses('wei', 4), 3, '魏 鐵騎 1/2/3');
}

{
  // 被動的三國沒有主動技能
  ['qi', 'chu', 'qin'].forEach(k => {
    eq(K.skillOf(k), null, k + ' 是被動的，沒有主動技能');
    eq(K.maxUses(k, 4), 0, k + ' 的主動次數是 0');
  });
  eq(K.skillOf('nope'), null, '不認得的國回 null');
}

console.log('═══ 每局重置 vs 整場額度 ═══');

{
  const yan = K.createState('yan', 4);
  yan.used = 3;
  K.resetForHand(yan);
  eq(yan.used, 0, '燕是每局重置');

  const wei = K.createState('wei', 4);
  wei.used = 2;
  K.resetForHand(wei);
  eq(wei.used, 2, '⚠️ 魏是**整場**額度，換局不重置（四人局沿用一局一次會變 4 倍強）');
}

{
  // armed 一定要跨局清掉
  const wei = K.createState('wei', 0);
  wei.armed = true;
  K.resetForHand(wei);
  eq(wei.armed, false, '沒用到的護送不會跨局帶過去');
}

console.log('═══ 什麼時候能用 ═══');

{
  const h = freshHand(3);
  h.turn = 0;
  const han = K.createState('han', 0);
  ok(K.canUse(han, h, 0).ok, '換牌：輪到自己時可以用');
  ok(!K.canUse(han, h, 1).ok, '換牌：不是自己的回合不能用');
  eq(K.canUse(han, h, 1).why, '輪到你的時候才能用', '而且說得出理由');

  const yan = K.createState('yan', 0);
  ok(K.canUse(yan, h, 1).ok, '窺探：別人的回合也能用（只看自己的未來）');
}

{
  const h = freshHand(4);
  h.phase = 'over';
  ok(!K.canUse(K.createState('yan', 4), h, 0).ok, '局結束就不能用');
}

{
  const h = freshHand(5);
  h.turn = 0;
  const st = K.createState('han', 0);      // 只有 1 次
  ok(K.use(st, h, 0, { tileIndex: 0 }).ok, '第一次用得了');
  eq(K.left(st), 0, '用完就沒了');
  const r = K.use(st, h, 0, { tileIndex: 0 });
  eq(r.ok, false, '超過次數就用不了');
  eq(r.why, '這一局的次數用完了', '理由是「這一局」');

  const w = K.createState('wei', 0);
  w.used = 1;
  eq(K.canUse(w, h, 0).why, '這一場的次數用完了', '魏的理由是「這一場」');
}

{
  const h = freshHand(6);
  h.turn = 0;
  h.drawIdx = h.deadWallStart;             // 牌山摸完了
  ok(!K.canUse(K.createState('zhao', 0), h, 0).ok, '牌山沒牌就不能換');
}

console.log('═══ 韓／趙 換牌：不可以動到別人 ═══');

{
  /* ⚠️ 這是規格裡最重要的一條。舊版是 splice 掉手牌 + 從牌山頂端補，
     那會讓總張數少一張、其他三家的摸牌序列整個往前移一格。
     新做法是跟**牌山最末張**交換，所以： */
  const h = freshHand(7);
  h.turn = 0;
  const before = {
    wall: h.wall.length,
    drawIdx: h.drawIdx,
    deadWallStart: h.deadWallStart,
    // 其他三家接下來會摸到的牌，一張都不能變
    upcoming: h.wall.slice(h.drawIdx, h.deadWallStart - 1).map(t => t.display).join(','),
    hands: [1, 2, 3].map(s => h.seats[s].hand.map(t => t.display).join(',')),
  };
  const st = K.createState('zhao', 4);
  const r = K.use(st, h, 0, { tileIndex: 0 });

  ok(r.ok, '換得成');
  eq(h.wall.length, before.wall, '牌山總張數不變（是交換不是抽取）');
  eq(h.drawIdx, before.drawIdx, 'drawIdx 沒動');
  eq(h.deadWallStart, before.deadWallStart, '王牌邊界沒動');
  eq(h.wall.slice(h.drawIdx, h.deadWallStart - 1).map(t => t.display).join(','),
     before.upcoming, '⚠️ 其他三家接下來要摸的牌一張都沒位移');
  eq(JSON.stringify([1, 2, 3].map(s => h.seats[s].hand.map(t => t.display).join(','))),
     JSON.stringify(before.hands), '別人的手牌沒被動到');
  eq(h.seats[0].hand.length, 13, '自己的手牌張數不變');
  eq(h.wall[h.deadWallStart - 1].display, r.out.display, '換掉的那張進了牌山最末格');
}

{
  /* 交換不能讓牌憑空多出來或消失。

     ⚠️ 不要去數「整個 wall 有沒有 136 張不重複」——
     `startHand` 是 `hands[s].push(wall[idx++])`，**沒有把發出去的牌從 wall 移除**，
     所以前 52 格跟四家的手牌共用同一批物件（deal-seed.js 正是靠這個定位）。
     交換之後，讓出的那張會同時出現在「已發區」與牌山末格 ——
     那是發牌設計的既有現象，不是這次交換造成的。
     play 上無害：drawIdx 從 52 起算，已發區不再被讀。

     真正該成立的是這一條：**「自己的手牌 ∪ 還沒摸的牌山」這個多重集合不變**。 */
  const h = freshHand(8);
  h.turn = 0;
  const pool = () => h.seats[0].hand.map(t => t.display)
    .concat(h.wall.slice(h.drawIdx, h.deadWallStart).map(t => t.display))
    .sort().join(',');
  const before = pool();
  const st = K.createState('zhao', 4);
  K.use(st, h, 0, { tileIndex: 2 });
  K.use(st, h, 0, { tileIndex: 5 });
  eq(pool(), before, '換兩次之後，「手牌 ∪ 未摸牌山」完全一樣（只是換了位置）');
  eq(h.seats[0].hand.length, 13, '手牌張數不變');
  eq(new Set(h.wall.slice(h.drawIdx, h.deadWallStart).map(t => t.uid)).size,
     h.deadWallStart - h.drawIdx, '未摸的牌山裡沒有重複的牌');
}

{
  const h = freshHand(9);
  h.turn = 0;
  const st = K.createState('han', 0);
  eq(K.use(st, h, 0, { tileIndex: 99 }).ok, false, '指到不存在的牌：換不了');
  eq(K.left(st), 1, '而且不扣次數');
}

console.log('═══ 燕 奇謀：只看自己的未來 ═══');

{
  const h = freshHand(10);
  h.turn = 0;
  const t = K.peek(h, 0, 3);
  eq(t.length, 3, '看三張');
  eq(t[0].display, h.wall[h.drawIdx].display, '輪到自己時，第一張就是下一張');
  eq(t[1].display, h.wall[h.drawIdx + 4].display, '第二張隔四家');
  eq(t[2].display, h.wall[h.drawIdx + 8].display, '第三張再隔四家');
}

{
  // 別家的回合：要先等他們摸完
  const h = freshHand(11);
  h.turn = 2;
  const t = K.peek(h, 0, 3);
  eq(t[0].display, h.wall[h.drawIdx + 2].display, '從 2 號到 0 號要等兩家');
  const t3 = K.peek(h, 3, 1);
  eq(t3[0].display, h.wall[h.drawIdx + 1].display, '3 號只要等一家');
}

{
  /* ⚠️ 不可以看到王牌。王牌是槓的補牌來源，
     看得到等於多知道一段不屬於「自己接下來會摸到」的資訊。 */
  const h = freshHand(12);
  h.turn = 0;
  h.drawIdx = h.deadWallStart - 5;
  const t = K.peek(h, 0, 3);
  ok(t.length < 3, '快摸完時看不滿三張', String(t.length));
  ok(t.every((_, i) => h.drawIdx + i * 4 < h.deadWallStart), '看到的都還在活牌山裡');
}

{
  const h = freshHand(13);
  h.turn = 0;
  const st = K.createState('yan', 4);
  const r = K.use(st, h, 0);
  eq(r.kind, 'peek', '回報的種類是 peek');
  eq(r.tiles.length, 3, '帶了三張');
  ok(/無人鳴牌/.test(r.note || ''), '⚠️ 要附註「若無人鳴牌」—— 有人吃碰就不準了', r.note);
  eq(h.seats[0].hand.length, 13, '窺探不動手牌');
  eq(h.wall.length, 136, '窺探不動牌山');
}

console.log('═══ 魏 鐵騎：掛上與用掉 ═══');

{
  const h = freshHand(14);
  h.turn = 0;
  const st = K.createState('wei', 0);
  eq(st.armed, false, '一開始沒掛');
  ok(K.use(st, h, 0).ok, '掛得上');
  eq(st.armed, true, '掛上了');
  eq(K.canUse(st, h, 0).why, '已經掛上護送了', '掛著的時候不能再掛');

  eq(K.consumeGuard(st), true, '棄牌時用掉');
  eq(st.armed, false, '用掉之後就放掉');
  eq(K.consumeGuard(st), false, '沒掛的時候回 false');
}

{
  // 護送不會消耗到下一張
  const st = K.createState('wei', 4);
  st.armed = true;
  K.consumeGuard(st);
  eq(st.armed, false, '只保護一張，不是一直開著');
}

console.log('═══ 純 JSON（要能存檔與上線）═══');

{
  const st = K.createState('zhao', 3);
  st.used = 2;
  const round = JSON.parse(JSON.stringify(st));
  eq(JSON.stringify(round), JSON.stringify(st), '技能狀態可以 JSON 來回不失真');
  eq(Object.keys(st).sort().join(','), 'armed,kingdom,max,used', '欄位就這四個');
}

console.log('\n─────────────────────────');
console.log(`通過 ${pass}　失敗 ${fail}`);
if (fail) { fails.forEach(f => console.log('  ✗ ' + f)); process.exit(1); }
console.log('全部通過 ✓');
