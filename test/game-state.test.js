/* game-state 的驗證測試
   狀態模組只做「資料結構 + 不含判斷的基本動作」，所以測的是：
   牌的總數守恆、四人座位不互相污染、Firebase 往返後還活著。
   執行： node test/game-state.test.js                           */
const S = require('../src/game-state.js');
const R = require('../src/rules-core.js');

let pass = 0, fail = 0;
const fails = [];
function ok(cond, name, detail) {
  if (cond) { pass++; }
  else { fail++; fails.push(name + (detail ? '　→ ' + detail : '')); }
}
function eq(a, b, name) { ok(a === b, name, `得到 ${a}，預期 ${b}`); }

/* 開一場標準的四人局 */
function fresh(seed) {
  const m = S.createMatch({
    seed: seed == null ? 42 : seed,
    seats: [
      { name: '甲' },
      { name: '乙', isAI: true, aiLevel: 1 },
      { name: '丙', isAI: true, aiLevel: 2 },
      { name: '丁', isAI: true, aiLevel: 3 },
    ],
  });
  S.startHand(m);
  return m;
}

/* 場上所有看得到的牌 —— 用來驗證守恆 */
function allTiles(hand) {
  const out = [];
  hand.seats.forEach(s => {
    out.push(...s.hand);
    s.melds.forEach(m => out.push(...m.tiles));
    // 被鳴走的牌已經算在副露裡，不能重複計
    out.push(...s.discards.filter(t => t.claimedBy == null));
  });
  return out;
}

console.log('═══ 牌山 ═══');

{
  const deck = S.makeDeck();
  eq(deck.length, 136, '一副牌 136 張');
  eq(new Set(deck.map(t => t.uid)).size, 136, 'uid 不重複');
  eq(deck.filter(t => t.display === '5萬').length, 4, '每種牌各 4 張');
  eq(deck.filter(t => t.isHonor).length, 28, '字牌 7 種共 28 張');
}

{
  // 同一個種子要發出同一副牌 —— 線上版靠這個事後驗證發牌沒被動手腳
  const a = fresh(12345), b = fresh(12345), c = fresh(999);
  const key = m => m.hand.wall.map(t => t.display).join(',');
  ok(key(a) === key(b), '同種子發出同一副牌');
  ok(key(a) !== key(c), '不同種子發出不同牌');
}

console.log('═══ 開局 ═══');

{
  const m = fresh();
  const h = m.hand;
  eq(h.seats.length, 4, '四個座位');
  ok(h.seats.every(s => s.hand.length === 13), '每家起手 13 張');
  eq(h.drawIdx, 52, '發完 13×4 後牌山指標在 52');
  eq(h.deadWallStart, 136 - S.DEAD_WALL, '王牌從 122 起算');
  eq(S.liveWallCount(h), 70, '可摸 70 張');
  eq(h.turn, h.dealer, '莊家先摸');
  eq(h.phase, 'draw', '開局是摸牌階段');

  // 起手 52 張不能有重複的 uid（四家互不污染的最低門檻）
  const dealt = h.seats.flatMap(s => s.hand.map(t => t.uid));
  eq(new Set(dealt).size, 52, '四家起手沒有拿到同一張牌');

  // 發出去的牌必須都在牌山的前 52 張裡
  const head = new Set(h.wall.slice(0, 52).map(t => t.uid));
  ok(dealt.every(u => head.has(u)), '起手牌來自牌山前 52 張');
}

{
  // 四局的莊家依序輪一圈
  const m = S.createMatch({ seed: 7 });
  const dealers = [];
  for (let i = 0; i < 4; i++) { S.startHand(m); dealers.push(m.hand.dealer); }
  eq(dealers.join(''), '0123', '四局莊家輪一圈');
  S.startHand(m);
  ok(m.finished, '打滿四局後整場結束');
}

console.log('═══ 風位與座次 ═══');

{
  const m = fresh();
  const h = m.hand;
  h.dealer = 2;
  eq(S.seatWind(h, 2), '東', '莊家是東');
  eq(S.seatWind(h, 3), '南', '莊家下家是南');
  eq(S.seatWind(h, 0), '西', '對家是西');
  eq(S.seatWind(h, 1), '北', '上家是北');

  eq(S.nextSeat(3), 0, '3 的下家是 0');
  eq(S.seatOffset(1, 2), 1, '2 是 1 的下家');
  eq(S.seatOffset(1, 0), 3, '0 是 1 的上家');
  eq(S.seatOffset(1, 1), 0, '自己對自己是 0');

  // 吃只有下家能吃 —— 跟 rules-core 的判定要一致
  ok(R.canChiSeat(1, 2, 4), '下家可以吃');
  ok(!R.canChiSeat(1, 0, 4), '上家不能吃');
  ok(!R.canChiSeat(1, 3, 4), '對家不能吃');
}

console.log('═══ 摸牌與棄牌 ═══');

{
  const m = fresh();
  const h = m.hand;
  const before = S.liveWallCount(h);
  const t = S.drawTile(h, 0);
  eq(h.seats[0].hand.length, 14, '摸完 14 張');
  eq(S.liveWallCount(h), before - 1, '可摸張數減一');
  ok(h.seats[1].hand.length === 13 && h.seats[2].hand.length === 13,
     '摸牌不影響別家');

  const d = S.discardTile(h, 0, h.seats[0].hand.findIndex(x => x.uid === t.uid));
  eq(d.uid, t.uid, '棄掉的是指定的那張');
  eq(h.seats[0].hand.length, 13, '棄完回到 13 張');
  eq(h.seats[0].discards.length, 1, '牌河多一張');
  eq(h.phase, 'claim', '棄牌後進入宣告視窗');
  eq(h.lastDiscard.seat, 0, '記得誰打的');
  eq(h.lastDiscard.seq, 1, '棄牌序號從 1 開始');

  S.drawTile(h, 1);
  S.discardTile(h, 1, 0);
  eq(h.lastDiscard.seq, 2, '棄牌序號遞增');
}

{
  // 摸到牌山見底
  const m = fresh();
  const h = m.hand;
  let n = 0;
  while (!S.isWallEmpty(h)) { ok(S.drawTile(h, n % 4) != null, ''); n++; }
  pass -= n;                                    // 上面那行只是防呆，不計分
  eq(n, 70, '總共摸得到 70 張');
  ok(S.drawTile(h, 0) === null, '牌山空了摸不到牌');
}

console.log('═══ 嶺上牌 ═══');

{
  const m = fresh();
  const h = m.hand;
  const live0 = S.liveWallCount(h);
  const t = S.drawRinshan(h, 0);
  ok(t != null, '槓完補得到嶺上牌');
  eq(h.seats[0].hand.length, 14, '嶺上牌進手牌');
  eq(S.liveWallCount(h), live0 - 1, '開一個槓，可摸張數少一張');
  eq(h.deadWallStart, 136 - S.DEAD_WALL - 1, '王牌邊界前移，維持 14 張');

  // 四槓為上限
  S.drawRinshan(h, 1); S.drawRinshan(h, 2); S.drawRinshan(h, 3);
  eq(h.rinshanTaken, 4, '抽了四張嶺上牌');
  ok(S.drawRinshan(h, 0) === null, '第五個槓抽不到嶺上牌');
}

{
  // 迴歸：活牌山空了就不能再槓
  // （舊寫法比對 pos 與 deadWallStart，兩者同步前移永遠差 13，
  //   那個條件是死碼，結果是流局之後還槓得下去）
  const m = fresh();
  const h = m.hand;
  while (!S.isWallEmpty(h)) S.drawTile(h, 0);
  ok(S.drawRinshan(h, 0) === null, '流局後不能開槓');
}

console.log('═══ 副露 ═══');

{
  // 碰：從 1 的牌河碰走一張
  const m = fresh();
  const h = m.hand;
  const mk = (disp, uid) => ({
    suit: disp.slice(-1), num: +disp[0] || 0,
    display: disp, isHonor: false, uid,
  });
  h.seats[1].hand = [mk('5萬', 901)];
  h.seats[2].hand = [mk('5萬', 902), mk('5萬', 903), mk('9筒', 904)];
  S.discardTile(h, 1, 0);
  const disc = h.lastDiscard.tile;

  const meld = S.applyMeld(h, 2, 'pong',
    [disc, h.seats[2].hand[0], h.seats[2].hand[1]], 1);
  eq(meld.type, 'pong', '碰成立');
  eq(meld.tiles.length, 3, '碰是三張');
  eq(meld.from, 1, '記得從誰那裡碰的');
  eq(h.seats[2].hand.length, 1, '碰家手牌少兩張（被鳴的那張不從手上扣）');
  eq(h.turn, 2, '輪到碰的人');
  eq(h.phase, 'discard', '碰完要打牌');
  ok(h.lastDiscard === null, '宣告視窗關閉');

  // 被碰走的那張不再畫在河裡，但振聽仍然認得
  eq(S.visibleDiscards(h, 1).length, 0, '被碰走的牌從畫面上的牌河消失');
  eq(h.seats[1].discards.length, 1, '完整牌河仍留著那張（振聽要用）');
  eq(h.seats[1].discards[0].claimedBy, 2, '記得被誰鳴走');
}

{
  // 吃
  const m = fresh();
  const h = m.hand;
  const mk = (disp, uid, num) => ({
    suit: '萬', num, display: disp, isHonor: false, uid,
  });
  h.seats[0].hand = [mk('3萬', 910, 3)];
  h.seats[1].hand = [mk('4萬', 911, 4), mk('5萬', 912, 5), mk('9萬', 913, 9)];
  S.discardTile(h, 0, 0);
  const disc = h.lastDiscard.tile;
  const meld = S.applyMeld(h, 1, 'chi',
    [disc, h.seats[1].hand[0], h.seats[1].hand[1]], 0);
  eq(meld.type, 'chi', '吃成立');
  eq(h.seats[1].hand.length, 1, '吃掉手上兩張');
  eq(h.phase, 'discard', '吃完要打牌');
}

{
  // 暗槓：四張都從手上來，不動別人的牌河
  const m = fresh();
  const h = m.hand;
  const mk = uid => ({ suit: '筒', num: 7, display: '7筒', isHonor: false, uid });
  const four = [mk(920), mk(921), mk(922), mk(923)];
  h.seats[3].hand = four.concat([mk(924)]);
  const meld = S.applyMeld(h, 3, 'kong_dark', four, null);
  eq(meld.type, 'kong_dark', '暗槓成立');
  eq(meld.from, null, '暗槓沒有來源座位');
  eq(h.seats[3].hand.length, 1, '四張都從手牌扣掉');
  eq(h.phase, 'draw', '槓完要補嶺上牌');
}

{
  // 加槓：併進原本的碰，不是多開一個副露
  const m = fresh();
  const h = m.hand;
  const mk = uid => ({ suit: '條', num: 2, display: '2條', isHonor: false, uid });
  h.seats[0].melds = [{ type: 'pong', tiles: [mk(930), mk(931), mk(932)], from: 1 }];
  h.seats[0].hand = [mk(933), { suit: '萬', num: 1, display: '1萬', isHonor: false, uid: 934 }];

  const meld = S.applyMeld(h, 0, 'kong_added', [mk(933)], null);
  eq(h.seats[0].melds.length, 1, '加槓沒有多開一個副露');
  eq(meld.type, 'kong_added', '原本的碰升級成加槓');
  eq(meld.tiles.length, 4, '加槓是四張');
  eq(h.seats[0].hand.length, 1, '手牌扣掉加上去的那張');
  eq(h.phase, 'draw', '加槓後補嶺上牌');
  eq(h.lastKongAdded.tile.uid, 933, '記下加槓的牌（搶槓要用）');
  eq(h.lastKongAdded.seat, 0, '記下是誰加槓');

  // 下一次棄牌要把搶槓視窗關掉
  S.discardTile(h, 0, 0);
  ok(h.lastKongAdded === null, '棄牌後搶槓視窗關閉');
}

console.log('═══ 手牌張數 ═══');

{
  const m = fresh();
  const h = m.hand;
  eq(S.baseHandSize(h.seats[0]), 13, '沒副露時棄牌後 13 張');
  h.seats[0].melds = [{ type: 'pong', tiles: [1, 2, 3], from: 1 }];
  eq(S.baseHandSize(h.seats[0]), 10, '一個碰後 10 張');
  h.seats[0].melds.push({ type: 'kong_light', tiles: [1, 2, 3, 4], from: 2 });
  eq(S.baseHandSize(h.seats[0]), 7, '再一個槓後 7 張（槓佔 4 張但補摸 1 張）');
}

console.log('═══ 牌數守恆 ═══');

{
  // 隨機打 200 步，場上的牌加上剩餘牌山永遠是 136 張
  const m = fresh(2024);
  const h = m.hand;
  let broke = null;
  for (let step = 0; step < 200 && !broke; step++) {
    const seat = step % 4;
    if (S.isWallEmpty(h)) break;
    S.drawTile(h, seat);
    S.discardTile(h, seat, Math.floor(h.seats[seat].hand.length / 2));
    const seen = allTiles(h).length;
    const remain = h.wall.length - h.drawIdx;   // 含王牌
    if (seen + remain !== 136) broke = `第 ${step} 步：場上 ${seen} + 牌山 ${remain}`;
    const uids = allTiles(h).map(t => t.uid);
    if (new Set(uids).size !== uids.length) broke = `第 ${step} 步出現重複的牌`;
  }
  ok(!broke, '隨機對局 200 步牌數守恆', broke);
}

console.log('═══ Firebase 往返 ═══');

{
  const m = fresh();
  const h = m.hand;
  S.drawTile(h, 0);
  S.discardTile(h, 0, 0);

  // Firebase 的行為：空陣列整個欄位消失、undefined 會被 set() 拒絕
  const wire = JSON.parse(JSON.stringify(S.stripUndefined(m)));
  wire.hand.seats.forEach(s => {
    if (s.melds.length === 0) delete s.melds;
    if (s.discards.length === 0) delete s.discards;
  });
  ok(wire.hand.seats[1].melds === undefined, '模擬：空陣列在傳輸中消失');

  const back = S.normalize(wire);
  ok(Array.isArray(back.hand.seats[1].melds), 'normalize 把消失的副露補回陣列');
  ok(Array.isArray(back.hand.seats[1].discards), 'normalize 把消失的牌河補回陣列');
  eq(back.hand.seats[0].discards.length, 1, '有內容的欄位原封不動');
  eq(back.hand.lastDiscard.seat, 0, 'lastDiscard 過得去');
  ok(back.hand.lastKongAdded === null, 'lastKongAdded 補成 null 而不是 undefined');
  ok(S.normalize(null) === null, 'normalize 吃得下 null');
}

{
  // 狀態必須是純 JSON —— 帶 function / undefined / Map 就進不了 Firebase
  const m = fresh();
  S.drawTile(m.hand, 0);
  let bad = null;
  (function walk(v, path) {
    if (bad) return;
    if (v === undefined) { bad = path + ' 是 undefined'; return; }
    if (typeof v === 'function') { bad = path + ' 是 function'; return; }
    if (v instanceof Set || v instanceof Map) { bad = path + ' 是 Set/Map'; return; }
    if (v && typeof v === 'object')
      Object.keys(v).forEach(k => walk(v[k], path + '.' + k));
  })(m, 'match');
  ok(!bad, '整份狀態是純 JSON', bad);
}

{
  const m = fresh();
  S.drawTile(m.hand, 0);
  const clean = S.stripUndefined({ a: 1, b: undefined, c: { d: undefined, e: 2 }, f: [1, undefined] });
  ok(!('b' in clean), 'stripUndefined 清掉頂層的 undefined');
  ok(!('d' in clean.c), 'stripUndefined 遞迴清到巢狀物件');
  eq(clean.c.e, 2, 'stripUndefined 不動有值的欄位');
}

console.log('═══ 手牌排序 ═══');

function order(seatState) { return seatState.hand.map(t => t.display).join(' '); }
function isSorted(tiles) {
  const SU = ['萬', '筒', '條'];
  const key = t => t.isHonor
    ? [1, R.HONORS.indexOf(t.suit), 0]
    : [0, SU.indexOf(t.suit), t.num];
  for (let i = 1; i < tiles.length; i++) {
    const a = key(tiles[i - 1]), b = key(tiles[i]);
    for (let k = 0; k < 3; k++) {
      if (a[k] < b[k]) break;
      if (a[k] > b[k]) return false;
    }
  }
  return true;
}

{
  const m = fresh();
  const h = m.hand;
  ok(h.seats.every(s => isSorted(s.hand)), '四家起手都排好了');
  eq(h.seats[0].hand.length, 13, '排序不會弄丟牌');
}

{
  // 剛摸的那張留在最右邊，不排進去
  const m = fresh();
  const h = m.hand;
  const t = S.drawTile(h, 0);
  const hand = h.seats[0].hand;
  eq(hand[hand.length - 1].uid, t.uid, '剛摸的那張在最右邊');
  ok(isSorted(hand.slice(0, -1)), '前 13 張仍然是排好的');

  // 打掉之後，剛摸的那張才併回牌組裡
  S.discardTile(h, 0, 0);
  ok(isSorted(h.seats[0].hand), '棄牌後整副手牌重新排好');
}

{
  // 副露之後也要重排
  const m = fresh();
  const h = m.hand;
  const mk = (disp, uid) => ({
    suit: disp.slice(-1), num: +disp[0] || 0,
    display: disp, isHonor: false, uid,
  });
  h.seats[1].hand = [mk('5萬', 940)];
  h.seats[2].hand = [mk('9條', 941), mk('5萬', 942), mk('1萬', 943), mk('5萬', 944)];
  S.discardTile(h, 1, 0);
  const disc = h.lastDiscard.tile;
  S.applyMeld(h, 2, 'pong', [disc, h.seats[2].hand[1], h.seats[2].hand[3]], 1);
  ok(isSorted(h.seats[2].hand), '碰完剩下的手牌是排好的');
}

{
  // 換牌（韓／趙）換進來的不是剛摸的，要排進去
  const m = fresh();
  const h = m.hand;
  S.swapWithWallTail(h, 0, 3);
  ok(isSorted(h.seats[0].hand), '換牌後手牌是排好的');
}

{
  // 排序不能改變牌的內容，只能改順序
  const m = fresh();
  const before = m.hand.seats[0].hand.map(t => t.uid).slice().sort().join(',');
  S.sortTiles(m.hand.seats[0].hand);
  const after = m.hand.seats[0].hand.map(t => t.uid).slice().sort().join(',');
  eq(after, before, '排序不會增刪任何一張牌');
}

{
  // 萬 → 筒 → 條 → 字 的順序（與舊版 sortH 一致）
  const mk = (disp) => {
    const mm = disp.match(/^(\d+)(.+)$/);
    return mm
      ? { suit: mm[2], num: +mm[1], display: disp, isHonor: false, uid: Math.random() }
      : { suit: disp, num: 0, display: disp, isHonor: true, uid: Math.random() };
  };
  const tiles = ['白', '3條', '5筒', '9萬', '東', '1萬', '2條', '中'].map(mk);
  S.sortTiles(tiles);
  eq(tiles.map(t => t.display).join(' '), '1萬 9萬 5筒 2條 3條 東 中 白',
     '萬→筒→條→字，字牌依 東南西北中發白');
}

console.log('═══ 換牌（韓 精兵／趙 騎射）═══');

{
  const m = fresh();
  const h = m.hand;
  const before = allTiles(h).length + (h.wall.length - h.drawIdx);
  const liveBefore = S.liveWallCount(h);

  // 交換前先記下其他三家未來會摸到的序列
  const futureBefore = h.wall.slice(h.drawIdx, h.deadWallStart - 1).map(t => t.uid);

  const mine = h.seats[0].hand[3];
  const tailPos = h.deadWallStart - 1;
  const tailWas = h.wall[tailPos];

  const r = S.swapWithWallTail(h, 0, 3);
  eq(r.out.uid, mine.uid, '換出去的是指定的那張');
  eq(r.got.uid, tailWas.uid, '換進來的是活牌山最末張');
  // 換完會重新排序，所以不能再用固定的索引驗 —— 驗牌在不在手上
  ok(h.seats[0].hand.some(t => t.uid === tailWas.uid), '換進來的牌在手上');
  ok(!h.seats[0].hand.some(t => t.uid === mine.uid), '換出去的牌不在手上了');
  eq(h.seats[0].hand.length, 13, '手牌張數不變');
  eq(h.wall[tailPos].uid, mine.uid, '自己的牌進了牌山最末格');

  eq(S.liveWallCount(h), liveBefore, '可摸張數不變');
  eq(allTiles(h).length + (h.wall.length - h.drawIdx), before, '總牌數守恆');
  eq(h.wall.slice(h.drawIdx, h.deadWallStart - 1).map(t => t.uid).join(','),
     futureBefore.join(','), '其他家的摸牌序列一張都沒位移');
  eq(h.deadWallStart, 136 - S.DEAD_WALL, '王牌邊界沒動，槓的次數不變');
}

{
  const m = fresh();
  const h = m.hand;
  while (!S.isWallEmpty(h)) S.drawTile(h, 0);
  ok(S.swapWithWallTail(h, 0, 0) === null, '牌山空了換不了牌');
}

console.log('═══ 振聽接線 ═══');

{
  const m = fresh();
  const h = m.hand;
  const T = str => str.trim().split(/\s+/).map((d, i) => {
    const mm = d.match(/^(\d+)(.+)$/);
    return mm
      ? { suit: mm[2], num: +mm[1], display: d, isHonor: false, uid: 800 + i }
      : { suit: d, num: 0, display: d, isHonor: true, uid: 800 + i };
  });

  // 聽 3萬 / 6萬，自己河裡有 6萬 → 振聽
  h.seats[0].hand = T('1萬 2萬 3萬 4萬 5萬 6萬 7萬 8萬 1筒 1筒 1筒 9條 9條');
  h.seats[0].discards = T('6萬');
  ok(S.isSeatFuriten(h, 0), '河裡有自己的和牌張 → 振聽');

  h.seats[0].discards = T('9筒');
  ok(!S.isSeatFuriten(h, 0), '河裡沒有和牌張 → 不振聽');

  // 同巡振聽
  S.setTemporaryFuriten(h, 0, true);
  ok(S.isSeatFuriten(h, 0), '放過一張後同巡振聽');
  S.drawTile(h, 0);
  ok(!h.seats[0].furitenTemp, '摸到下一張牌自動解除同巡振聽');

  // 被碰走的牌照樣算振聽 —— 這是刪牌河會漏掉的那個洞
  const m2 = fresh();
  const h2 = m2.hand;
  h2.seats[1].hand = T('6萬');
  h2.seats[2].hand = [
    { suit: '萬', num: 6, display: '6萬', isHonor: false, uid: 851 },
    { suit: '萬', num: 6, display: '6萬', isHonor: false, uid: 852 },
  ];
  S.discardTile(h2, 1, 0);
  const d6 = h2.lastDiscard.tile;
  S.applyMeld(h2, 2, 'pong', [d6, h2.seats[2].hand[0], h2.seats[2].hand[1]], 1);
  h2.seats[1].hand = T('1萬 2萬 3萬 4萬 5萬 6萬 7萬 8萬 1筒 1筒 1筒 9條 9條');
  ok(S.isSeatFuriten(h2, 1), '打出去又被碰走的牌仍然造成振聽');
}

console.log('\n─────────────────────────');
console.log(`通過 ${pass}　失敗 ${fail}`);
if (fail) { fails.forEach(f => console.log('  ✗ ' + f)); process.exit(1); }
console.log('全部通過 ✓');
