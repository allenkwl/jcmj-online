/* claim-arbiter 的驗證測試
   重點在裁決順序與「不跳窗」那道閘 —— 這兩件事錯了，一局會多出五分鐘空轉，
   或是下家握有一票否決權讓別家永遠碰不到牌。
   執行： node test/claim-arbiter.test.js                        */
const C = require('../src/claim-arbiter.js');
const S = require('../src/game-state.js');
const R = require('../src/rules-core.js');

let pass = 0, fail = 0;
const fails = [];
function ok(cond, name, detail) {
  if (cond) { pass++; }
  else { fail++; fails.push(name + (detail ? '　→ ' + detail : '')); }
}
function eq(a, b, name) { ok(a === b, name, `得到 ${JSON.stringify(a)}，預期 ${JSON.stringify(b)}`); }

let _uid = 1000;
function T(str) {
  return str.trim().split(/\s+/).map(d => {
    const m = d.match(/^(\d+)(.+)$/);
    return m
      ? { suit: m[2], num: +m[1], display: d, isHonor: false, uid: _uid++ }
      : { suit: d, num: 0, display: d, isHonor: true, uid: _uid++ };
  });
}
const one = d => T(d)[0];

/* 開一局，手牌由測試自己塞 */
function table(hands) {
  const m = S.createMatch({ seed: 5 });
  S.startHand(m);
  const h = m.hand;
  h.dealer = 0;
  hands.forEach((str, i) => {
    h.seats[i].hand = str ? T(str) : [];
    h.seats[i].melds = [];
    h.seats[i].discards = [];
    h.seats[i].furitenTemp = false;
  });
  return h;
}

/* 讓 seat 打出 tile（tile 會先塞進他手裡再打掉） */
function discardFrom(h, seat, disp, opts) {
  h.seats[seat].hand.push(one(disp));
  return S.discardTile(h, seat, h.seats[seat].hand.length - 1, opts);
}

/* 一手聽 3萬/6萬 的十三張 */
const WAIT36 = '1萬 2萬 3萬 4萬 5萬 6萬 7萬 8萬 1筒 1筒 1筒 9條 9條';

console.log('═══ 能宣告什麼 ═══');

{
  const h = table([null, '5萬 5萬 5萬 9筒', null, null]);
  discardFrom(h, 3, '5萬');
  const o = C.buildOptions(h, 1);
  ok(o.pong, '手上兩張以上可以碰');
  ok(o.kong, '手上三張可以槓');
  ok(o.any, '有得宣告');

  eq(C.buildOptions(h, 3).any, false, '自己打的牌自己不能鳴');
}

{
  // 吃只有下家能吃
  const h = table([null, '4萬 5萬 9筒', '4萬 5萬 9筒', '4萬 5萬 9筒']);
  discardFrom(h, 0, '3萬');
  eq(C.buildOptions(h, 1).chi.length, 1, '下家吃得到');
  eq(C.buildOptions(h, 2).chi.length, 0, '對家吃不到');
  eq(C.buildOptions(h, 3).chi.length, 0, '上家吃不到');
  ok(R.canChiSeat(0, 1, 4) && !R.canChiSeat(0, 2, 4), '與 rules-core 的座位限制一致');
}

{
  // 多種吃法都要列出來
  const h = table([null, '2萬 3萬 4萬 5萬 9筒', null, null]);
  discardFrom(h, 0, '3萬');
  const chi = C.buildOptions(h, 1).chi;
  eq(chi.length, 2, '3萬 有兩種吃法');
  eq(JSON.stringify(chi), JSON.stringify([[2, 3, 4], [3, 4, 5]]), '列出 234 與 345');
}

{
  // 字牌不能吃
  const h = table([null, '東 東 南 西', null, null]);
  discardFrom(h, 0, '東');
  const o = C.buildOptions(h, 1);
  eq(o.chi.length, 0, '字牌沒有吃');
  ok(o.pong, '字牌還是可以碰');
}

console.log('═══ 振聽 ═══');

{
  const h = table([null, WAIT36, null, null]);
  discardFrom(h, 0, '6萬');
  ok(C.buildOptions(h, 1).ron, '聽的牌打出來可以榮和');
}

{
  const h = table([null, WAIT36, null, null]);
  h.seats[1].discards = T('3萬');                 // 自己河裡有和牌張
  discardFrom(h, 0, '6萬');
  eq(C.buildOptions(h, 1).ron, false, '振聽不能榮和');
}

{
  const h = table([null, WAIT36, null, null]);
  S.setTemporaryFuriten(h, 1, true);
  discardFrom(h, 0, '6萬');
  eq(C.buildOptions(h, 1).ron, false, '同巡振聽不能榮和');
}

console.log('═══ 鐵騎護送 ═══');

{
  const h = table([null, '5萬 5萬 5萬 9筒', null, null]);
  discardFrom(h, 0, '5萬', { guarded: true });
  const o = C.buildOptions(h, 1);
  eq(o.pong, false, '鐵騎擋住碰');
  eq(o.kong, false, '鐵騎擋住槓');
  eq(o.chi.length, 0, '鐵騎擋住吃');
  eq(o.any, false, '無牌可宣告');
}

{
  // 鐵騎不擋榮和 —— 技能寫的是「對手無法吃碰」
  const h = table([null, WAIT36, null, null]);
  discardFrom(h, 0, '6萬', { guarded: true });
  ok(C.buildOptions(h, 1).ron, '鐵騎不擋榮和');
  const win = C.openWindow(h);
  ok(win && win.guarded, '視窗記得這張被護送');
}

console.log('═══ 不跳窗 ═══');

{
  // 三家都沒東西可宣告 → 根本不開窗
  const h = table([null, '9筒 9筒', '9條', '東'], 0);
  discardFrom(h, 0, '5萬');
  eq(C.openWindow(h), null, '沒有人能宣告就不開窗');
}

{
  // 只有能宣告的人進 eligible
  const h = table([null, '5萬 5萬 9筒', '9條 9條 9條', '東 南 西']);
  discardFrom(h, 0, '5萬');
  const win = C.openWindow(h);
  eq(Object.keys(win.eligible).join(','), '1', '只有座位 1 被問到');
  eq(C.pendingSeats(win).join(','), '1', '只等座位 1');
}

console.log('═══ 收意向 ═══');

{
  const h = table([null, '5萬 5萬 9筒', null, null]);
  discardFrom(h, 0, '5萬');
  const win = C.openWindow(h);

  eq(C.respond(win, 2, { type: 'pong' }), false, '沒被問到的人不能插嘴');
  eq(C.respond(win, 1, { type: 'ron' }), false, '宣告做不到的事會被擋掉');
  eq(C.respond(win, 1, { type: 'kong' }), false, '只有兩張不能槓');
  eq(C.respond(win, 1, { type: 'pong' }), true, '合法的碰收得下');
  eq(C.respond(win, 1, { type: 'pass' }), false, '一家只能回一次');
  ok(C.isSettled(win), '全員到齊就算結束');
}

{
  // 吃的組合要對得上
  const h = table([null, '4萬 5萬 9筒', null, null]);
  discardFrom(h, 0, '3萬');
  const win = C.openWindow(h);
  eq(C.respond(win, 1, { type: 'chi', nums: [1, 2, 3] }), false, '手上沒有的吃法會被擋掉');
  eq(C.respond(win, 1, { type: 'chi', nums: [3, 4, 5] }), true, '手上有的吃法收得下');
}

console.log('═══ 逾時 ═══');

{
  const h = table([null, '5萬 5萬 9筒', null, null]);
  discardFrom(h, 0, '5萬');
  const win = C.openWindow(h, { now: 1000, timeoutMs: 8000 });
  eq(C.isSettled(win, 5000), false, '還沒到時間也還沒回應 → 未結束');
  ok(C.isTimedOut(win, 9000), '過了逾時');
  ok(C.isSettled(win, 9000), '逾時就算結束');

  const out = C.resolve(win);
  eq(out.type, 'pass', '逾時視同 pass');
  ok(win.responses['1'].timedOut, '記下這家是逾時而不是主動 pass');
}

console.log('═══ 優先權裁決 ═══');

{
  // 胡 > 碰
  const h = table([null, WAIT36, '6萬 6萬 9筒', null]);
  discardFrom(h, 0, '6萬');
  const win = C.openWindow(h);
  C.respond(win, 1, { type: 'ron' });
  C.respond(win, 2, { type: 'pong' });
  const out = C.resolve(win);
  eq(out.type, 'ron', '胡贏碰');
  eq(out.seats.join(','), '1', '胡的是座位 1');
}

{
  // 碰 > 吃　（吃的是下家，碰的是對家 —— 碰仍然贏）
  const h = table([null, '4萬 5萬 9筒', '3萬 3萬 9筒', null]);
  discardFrom(h, 0, '3萬');
  const win = C.openWindow(h);
  C.respond(win, 1, { type: 'chi', nums: [3, 4, 5] });
  C.respond(win, 2, { type: 'pong' });
  const out = C.resolve(win);
  eq(out.type, 'meld', '有人鳴牌');
  eq(out.seat, 2, '碰贏吃（否則下家等於握有一票否決權）');
  eq(out.claim.type, 'pong', '成立的是碰');
}

{
  // 沒人跟他搶的時候，吃成立
  const h = table([null, '4萬 5萬 9筒', '9條 9條 9條', null]);
  discardFrom(h, 0, '3萬');
  const win = C.openWindow(h);
  C.respond(win, 1, { type: 'chi', nums: [3, 4, 5] });
  const out = C.resolve(win);
  eq(out.type, 'meld', '吃成立');
  eq(out.claim.nums.join(''), '345', '吃的是 345');
}

{
  // 全部 pass
  const h = table([null, '5萬 5萬 9筒', null, null]);
  discardFrom(h, 0, '5萬');
  const win = C.openWindow(h);
  C.respond(win, 1, { type: 'pass' });
  eq(C.resolve(win).type, 'pass', '沒有人要就過');
}

console.log('═══ 多家同時胡 ═══');

{
  // 座位 1（下家）與座位 3（上家）同時胡座位 0 打的 6萬
  function twoRon() {
    const h = table([null, WAIT36, null, WAIT36]);
    discardFrom(h, 0, '6萬');
    const win = C.openWindow(h);
    C.respond(win, 3, { type: 'ron' });            // 故意讓遠的先回應
    C.respond(win, 1, { type: 'ron' });
    return win;
  }

  const head = C.resolve(twoRon(), { multiRon: 'head' });
  eq(head.seats.join(','), '1', '頭跳：離打牌者最近的那家成立');

  const multi = C.resolve(twoRon(), { multiRon: 'multi' });
  eq(multi.seats.join(','), '1,3', '多家和：兩家都成立，依距離排序');

  eq(C.DEFAULT_MULTI_RON, 'head', '預設是頭跳');
}

{
  // 三家和
  const h = table([null, WAIT36, WAIT36, WAIT36]);
  discardFrom(h, 0, '6萬');
  const win = C.openWindow(h);
  [1, 2, 3].forEach(s => C.respond(win, s, { type: 'ron' }));
  eq(C.resolve(win, { multiRon: 'abort3' }).type, 'abort', '三家和流局');
  eq(C.resolve(win, { multiRon: 'abort3' }).reason, 'sankaho', '流局原因是三家和');
}

console.log('═══ 碰代替胡 → 一樣過水 ═══');

{
  /* ⚠️ 上一節測的是「放過（pass）」。這一節測的是**用碰代替胡**。
     兩者在規則上同樣是「可以胡卻沒胡」，但在程式裡走的是不同分支：
     pass 的 res.type === 'pass'，碰的是 'pong' —— resolve() 的
     declinedRon 條件寫的是 `opt.ron && res.type !== 'ron'`，
     所以碰也算得進去。這一條就是在釘住那個 `!== 'ron'`。

     ⚠️ 還有一個容易漏的點：碰**不摸牌**，而 furitenTemp 只有
     drawTile／drawRinshan 會清掉。所以過水會一直撐到自己下一次摸牌，
     這是對的 —— 要是哪天有人在 applyMeld 裡順手清掉，這一條會抓到。 */

  // 1-6萬 + 66萬 + 111筒 + 99條：雙碰聽 6萬／9條，而且手上有兩張 6萬 可以碰
  const BOTH = '1萬 2萬 3萬 4萬 5萬 6萬 6萬 6萬 1筒 1筒 1筒 9條 9條';
  const h = table([null, BOTH, null, null]);
  discardFrom(h, 0, '6萬');

  const opt = C.buildOptions(h, 1);
  ok(opt.ron && opt.pong, '這張 6萬 既胡得了也碰得了（前提成立才測得下去）');

  const win = C.openWindow(h);
  C.respond(win, 1, { type: 'pong' });             // 選擇碰，不胡
  const out = C.resolve(win);

  eq(out.declinedRon.join(','), '1', '⚠️ 用碰代替胡，一樣記進 declinedRon');
  eq(out.type, 'meld', '碰仍然成立');
  eq(out.seat, 1, '碰的是 1 家');

  C.applyDeclinedRonFuriten(h, out);
  ok(h.seats[1].furitenTemp, '碰完就過水');

  // 過水是全面的：連另一張聽牌（9條）這一巡也不能胡
  S.applyMeld(h, 1, C.meldTypeFor(out.claim.type), C.meldTilesFor(h, out), out.claim.from != null ? out.claim.from : h.lastDiscard.seat);
  discardFrom(h, 2, '9條');
  eq(C.buildOptions(h, 1).ron, false,
     '⚠️ 過水擋的是「所有和牌張」，不是只擋剛剛那一張');

  // 碰沒有摸牌，所以過水撐到下一次真的摸到牌
  ok(h.seats[1].furitenTemp, '碰不摸牌，過水還在');
  S.drawTile(h, 1);
  ok(!h.seats[1].furitenTemp, '摸到牌才解除');
}

console.log('═══ 放過榮和 → 同巡振聽 ═══');

{
  const h = table([null, WAIT36, '6萬 6萬 9筒', null]);
  discardFrom(h, 0, '6萬');
  const win = C.openWindow(h);
  C.respond(win, 1, { type: 'pass' });             // 可以胡卻放過
  C.respond(win, 2, { type: 'pong' });
  const out = C.resolve(win);
  eq(out.declinedRon.join(','), '1', '記下誰放過了榮和');

  C.applyDeclinedRonFuriten(h, out);
  ok(h.seats[1].furitenTemp, '放過的人吃同巡振聽');

  // 下一家再打一張同樣的牌，這一巡不能胡
  discardFrom(h, 2, '6萬');
  eq(C.buildOptions(h, 1).ron, false, '同巡內不能再胡同一張');

  // 摸到牌就解除
  S.drawTile(h, 1);
  h.seats[1].hand.pop();
  discardFrom(h, 2, '6萬');
  ok(C.buildOptions(h, 1).ron, '摸過牌之後恢復');
}

console.log('═══ 搶槓 ═══');

{
  const h = table([null, WAIT36, null, null]);
  const t = one('6萬');
  h.seats[0].melds = [{ type: 'pong', tiles: T('6萬 6萬 6萬'), from: 2 }];
  h.seats[0].hand.push(t);
  S.applyMeld(h, 0, 'kong_added', [t], null);

  ok(h.lastKongAdded, '加槓有留下記錄');
  const win = C.openWindow(h, { kongAdded: true });
  ok(win, '開了搶槓視窗');
  eq(win.kind, 'kong_added', '視窗種類是加槓');
  const o = win.eligible['1'];
  ok(o.ron, '可以搶槓');
  eq(o.pong, false, '搶槓視窗沒有碰');
  eq(o.chi.length, 0, '搶槓視窗沒有吃');

  C.respond(win, 1, { type: 'ron' });
  eq(C.resolve(win).type, 'ron', '搶槓成立');
}

{
  // 沒人能搶就不開窗
  const h = table([null, '9筒 9筒', null, null]);
  const t = one('6萬');
  h.seats[0].melds = [{ type: 'pong', tiles: T('6萬 6萬 6萬'), from: 2 }];
  h.seats[0].hand.push(t);
  S.applyMeld(h, 0, 'kong_added', [t], null);
  eq(C.openWindow(h, { kongAdded: true }), null, '沒人能搶槓就不開窗');
}

console.log('═══ 接回 game-state ═══');

{
  // 碰：裁決 → 換算牌 → applyMeld，手牌與牌河都要對
  const h = table([null, '5萬 5萬 9筒', null, null]);
  discardFrom(h, 0, '5萬');
  const win = C.openWindow(h);
  C.respond(win, 1, { type: 'pong' });
  const out = C.resolve(win);

  const tiles = C.meldTilesFor(h, out);
  eq(tiles.length, 3, '碰湊出三張');
  eq(tiles.filter(x => x.display === '5萬').length, 3, '三張都是 5萬');

  S.applyMeld(h, out.seat, C.meldTypeFor(out.claim.type), tiles, win.from);
  eq(h.seats[1].hand.length, 1, '手上兩張被拿走');
  eq(h.seats[1].melds[0].type, 'pong', '副露是碰');
  eq(h.phase, 'discard', '碰完要打牌');
  eq(S.visibleDiscards(h, 0).length, 0, '被碰走的牌從畫面牌河消失');
}

{
  // 吃：換算出來的實牌要是手上那兩張，不能拿錯
  const h = table([null, '4萬 5萬 4萬 9筒', null, null]);
  discardFrom(h, 0, '3萬');
  const win = C.openWindow(h);
  C.respond(win, 1, { type: 'chi', nums: [3, 4, 5] });
  const out = C.resolve(win);
  const tiles = C.meldTilesFor(h, out);
  eq(tiles.map(x => x.display).join(''), '3萬4萬5萬', '吃湊出 345 且已排序');
  eq(new Set(tiles.map(x => x.uid)).size, 3, '三張是不同的實牌');

  S.applyMeld(h, out.seat, C.meldTypeFor(out.claim.type), tiles, win.from);
  eq(h.seats[1].hand.length, 2, '手上只被拿走兩張（4萬 5萬），多的那張 4萬 還在');
  ok(h.seats[1].hand.some(x => x.display === '4萬'), '重複的 4萬 只拿走一張');
}

{
  // 明槓
  const h = table([null, '5萬 5萬 5萬 9筒', null, null]);
  discardFrom(h, 0, '5萬');
  const win = C.openWindow(h);
  C.respond(win, 1, { type: 'kong' });
  const out = C.resolve(win);
  const tiles = C.meldTilesFor(h, out);
  eq(tiles.length, 4, '槓湊出四張');
  eq(C.meldTypeFor(out.claim.type), 'kong_light', '從棄牌槓是明槓');

  S.applyMeld(h, out.seat, 'kong_light', tiles, win.from);
  eq(h.seats[1].hand.length, 1, '手上三張被拿走');
  eq(h.phase, 'draw', '槓完要補嶺上牌');
}

console.log('═══ AI 宣告 ═══');

{
  // 有得胡一定胡，三級都一樣
  [1, 2, 3].forEach(lv => {
    const h = table([null, WAIT36, null, null]);
    discardFrom(h, 0, '6萬');
    eq(C.decideClaim(h, 1, null, lv).type, 'ron', `難度 ${lv}：有得胡就胡`);
  });
}

{
  // 初學不吃不碰
  const h = table([null, '5萬 5萬 9筒', null, null]);
  discardFrom(h, 0, '5萬');
  eq(C.decideClaim(h, 1, null, 1).type, 'pass', '初學不碰');
}

{
  // 高手積極碰
  const h = table([null, '5萬 5萬 9筒 9條 3條 7筒', null, null]);
  discardFrom(h, 0, '5萬');
  eq(C.decideClaim(h, 1, null, 3).type, 'pong', '高手積極碰');
}

{
  // 普通只在向聽真的改善時才碰
  const h = table([null, '5萬 5萬 1筒 1筒 1筒 9條 9條 2條 5條 8條 東 南 西', null, null]);
  discardFrom(h, 0, '5萬');
  const d = C.decideClaim(h, 1, null, 2);
  const me = h.seats[1];
  const cur = R.shantenNum(me.hand.map(t => t.display), 0);
  let removed = 0;
  const after = me.hand.filter(t => {
    if (t.display === '5萬' && removed < 2) { removed++; return false; }
    return true;
  }).map(t => t.display);
  const improved = R.shantenNum(after, 1) < cur;
  eq(d.type === 'pong', improved, '普通：碰不碰與向聽是否改善一致');
}

{
  // 一桌三家 AI 一次填完，而且各算各的手牌（不共用狀態）
  // 牌數要合法：5萬 全場只有 4 張，座位 3 拿 3 張 + 打出去那 1 張剛好用完
  const h = table([null, '3萬 4萬 9筒', '9條 9條 東', '5萬 5萬 5萬 東']);
  discardFrom(h, 0, '5萬');
  const win = C.openWindow(h);
  C.autoRespondAI(h, win, {
    1: { isAI: true, aiLevel: 3 },
    2: { isAI: true, aiLevel: 3 },
    3: { isAI: true, aiLevel: 3 },
  });
  eq(C.pendingSeats(win).length, 0, '被問到的 AI 都回應了');
  eq(win.responses['1'].type, 'chi', '座位 1 是下家 → 吃');
  eq(win.responses['3'].type, 'kong', '座位 3 三張 → 槓');
  ok(!win.eligible['2'], '座位 2 不是下家，吃不到也碰不到，沒被問');

  const out = C.resolve(win);
  eq(out.seat, 3, '槓贏吃');
  eq(out.claim.type, 'kong', '成立的是槓');
}

{
  // 兩家不可能同時碰同一張 —— 一種牌只有 4 張，
  // 要兩家都能碰就得 2+2+場上 1 = 5 張。這裡直接把不變量測出來，
  // 免得日後有人以為 resolve 裡的碰／槓排序是活的邏輯。
  const counts = {};
  const h = table([null, '5萬 5萬 9筒', '5萬 5萬 9條', null]);
  discardFrom(h, 0, '5萬');
  [1, 2].forEach(s => { counts[s] = C.buildOptions(h, s).pong; });
  ok(counts[1] && counts[2], '（構造出來的非法牌況：兩家都能碰）');
  const total = h.seats.reduce((n, st) =>
    n + st.hand.filter(t => t.display === '5萬').length +
        st.discards.filter(t => t.display === '5萬').length, 0);
  ok(total > 4, '證明這種牌況需要 5 張以上的 5萬，實際牌山只有 4 張', `算出 ${total} 張`);
}

{
  // 玩家沒回應時 AI 不會幫他回答
  const h = table([null, '5萬 5萬 9筒', null, '5萬 5萬 9筒']);
  discardFrom(h, 0, '5萬');
  const win = C.openWindow(h);
  C.autoRespondAI(h, win, {
    1: { isAI: false },
    3: { isAI: true, aiLevel: 3 },
  });
  eq(C.pendingSeats(win).join(','), '1', '只剩玩家那家還沒回應');
}

console.log('═══ Firebase 往返 ═══');

{
  const h = table([null, '4萬 5萬 9筒', null, null]);
  discardFrom(h, 0, '3萬');
  const win = C.openWindow(h);

  let bad = null;
  (function walk(v, path) {
    if (bad) return;
    if (v === undefined) { bad = path + ' 是 undefined'; return; }
    if (typeof v === 'function') { bad = path + ' 是 function'; return; }
    if (v instanceof Set || v instanceof Map) { bad = path + ' 是 Set/Map'; return; }
    if (v && typeof v === 'object') Object.keys(v).forEach(k => walk(v[k], path + '.' + k));
  })(win, 'win');
  ok(!bad, '視窗是純 JSON', bad);

  ok(!Array.isArray(win.eligible), 'eligible 用字串鍵的物件而不是陣列');
  ok(Object.keys(win.eligible).every(k => typeof k === 'string'), '座位鍵是字串');

  // 模擬 Firebase：空的 responses 與空的 chi 陣列整個消失
  const wire = JSON.parse(JSON.stringify(win));
  delete wire.responses;
  const h2 = table([null, '5萬 5萬 9筒', null, null]);
  discardFrom(h2, 0, '5萬');
  const w2 = JSON.parse(JSON.stringify(C.openWindow(h2)));
  delete w2.responses;
  delete w2.eligible['1'].chi;

  C.normalizeWindow(wire);
  C.normalizeWindow(w2);
  ok(wire.responses && typeof wire.responses === 'object', 'normalize 補回 responses');
  ok(Array.isArray(w2.eligible['1'].chi), 'normalize 補回消失的 chi 陣列');

  // 補回來之後還能正常裁決
  eq(C.respond(w2, 1, { type: 'pong' }), true, '往返後還收得下宣告');
  eq(C.resolve(w2).type, 'meld', '往返後還裁決得出來');
}

console.log('\n─────────────────────────');
console.log(`通過 ${pass}　失敗 ${fail}`);
if (fail) { fails.forEach(f => console.log('  ✗ ' + f)); process.exit(1); }
console.log('全部通過 ✓');
