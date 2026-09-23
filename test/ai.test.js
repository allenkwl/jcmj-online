/* ai 的驗證測試
   最重要的兩項是「不作弊」與「不龜縮」—— 那是 PLAN 點名要修的兩個病。
   執行： node test/ai.test.js                                    */
const AI = require('../src/ai.js');
const F = require('../src/flow.js');
const S = require('../src/game-state.js');
const R = require('../src/rules-core.js');
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
const fails = [];
function ok(cond, name, detail) {
  if (cond) { pass++; }
  else { fail++; fails.push(name + (detail ? '　→ ' + detail : '')); }
}
function eq(a, b, name) { ok(a === b, name, `得到 ${JSON.stringify(a)}，預期 ${JSON.stringify(b)}`); }

let _uid = 9000;
function T(str) {
  return str.trim().split(/\s+/).map(d => {
    const m = d.match(/^(\d+)(.+)$/);
    return m
      ? { suit: m[2], num: +m[1], display: d, isHonor: false, uid: _uid++ }
      : { suit: d, num: 0, display: d, isHonor: true, uid: _uid++ };
  });
}

function table(hands, dealer) {
  const m = S.createMatch({ seed: 11, seats: [0, 1, 2, 3].map(i => ({ name: 'P' + i })) });
  S.startHand(m, { dealer: dealer || 0 });
  const h = m.hand;
  (hands || []).forEach((str, i) => {
    if (str) h.seats[i].hand = T(str);
    h.seats[i].melds = [];
    h.seats[i].discards = [];
  });
  return h;
}

const aiCtx = () => AI.flowHooks();

console.log('═══ 不作弊（最重要的一項）═══');

{
  // 把別家的手牌整個換掉，AI 的決定必須一模一樣。
  // 只要有任何一行偷讀別家的 hand，這一項就會紅。
  //
  // ⚠️ 這種測試最危險的失敗模式是**假通過**：如果拿來對照的手牌都不是聽牌，
  // 偷看也偷不到東西，測試就會綠得毫無意義。所以這裡：
  //   ‧ 對照組一律換成**貨真價實的聽牌**（聽 東 —— 一張基礎危險度很低的字牌，
  //     偷看與不偷看的判斷差最大）
  //   ‧ 跑很多個隨機盤面，不是一兩個特例
  const TENPAI_ON_EAST = '東 東 1萬 2萬 3萬 4筒 5筒 6筒 7條 8條 9條 1條 1條';
  const JUNK = '9萬 9萬 9萬 9萬 5筒 5筒 5筒 5筒 3條 3條 3條 3條 北';

  let diff = 0, total = 0, firstBad = '';
  for (let seed = 1; seed <= 50; seed++) {
    for (const lv of [2, 3]) {
      const build = other => {
        const m = S.createMatch({ seed, seats: [0, 1, 2, 3].map(i => ({ name: 'P' + i })) });
        S.startHand(m, { dealer: 0 });
        const h = m.hand;
        S.drawTile(h, 0);                       // 座位 0 摸到第 14 張，該打牌了
        [1, 2, 3].forEach(x => { h.seats[x].hand = T(other); });
        // 牌河是公開資訊，兩邊必須一致，否則比的不是同一件事
        [0, 1, 2, 3].forEach(x => {
          h.seats[x].discards = T('9筒 1條 北 2萬 6條 5筒 3萬');
        });
        return h;
      };
      AI.clearCache();
      const a = AI.chooseDiscard(build(JUNK), 0, { level: lv });
      AI.clearCache();
      const b = AI.chooseDiscard(build(TENPAI_ON_EAST), 0, { level: lv });
      total++;
      if (a !== b) { diff++; if (!firstBad) firstBad = `seed ${seed} 難度 ${lv}：${a} vs ${b}`; }
    }
  }
  eq(diff, 0, `${total} 個盤面：換掉別家的手牌，AI 決定完全不變（＝沒有偷看）`, firstBad);
}

{
  // 驗證上面那項測得到東西：對照組真的是聽牌，而且聽的那張基礎危險度很低
  const t = table([null, '東 東 1萬 2萬 3萬 4筒 5筒 6筒 7條 8條 9條 1條 1條']);
  ok(R.isTenpaiHand(t.seats[1].hand, []), '對照組確實是聽牌');
  ok(R.winningTiles(t.seats[1].hand, []).indexOf('東') >= 0, '確實聽 東');
  ok(AI.baseDanger('東') < AI.baseDanger('5萬'),
     '聽的是字牌 —— 偷看與不偷看的判斷差距最大');
}

{
  // 宣告決策也一樣
  const h1 = table(['5萬 5萬 1筒 2筒 3筒 4筒 5筒 6筒 7筒 8筒 9筒 東 南',
                    '5萬 9萬 9萬 9萬 9萬 5筒 5筒 5筒 5筒 3條 3條 3條 3條']);
  const h2 = table(['5萬 5萬 1筒 2筒 3筒 4筒 5筒 6筒 7筒 8筒 9筒 東 南',
                    '5萬 東 東 1萬 2萬 3萬 4筒 5筒 6筒 7條 8條 9條 1條']);
  [h1, h2].forEach(h => {
    [0, 1, 2, 3].forEach(x => { h.seats[x].discards = T('9筒 1條 北 2萬 6條'); });
    S.discardTile(h, 1, 0);
  });
  const opt = { ron: false, pong: true, kong: false, chi: [] };
  eq(JSON.stringify(AI.decideClaim(h1, 0, opt, { level: 3 })),
     JSON.stringify(AI.decideClaim(h2, 0, opt, { level: 3 })),
     '宣告決策也不受別家手牌影響');
}

{
  // 原始碼層級：AI 不該出現任何讀「別家 hand」的寫法
  const src = fs.readFileSync(path.join(__dirname, '../src/ai.js'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  ok(!/canRon|canWinOnDiscard|canRonWith|winningTiles|isTenpaiHand/.test(code),
     'AI 沒有呼叫任何需要別家手牌的判定');
  ok(!/Math\.random/.test(code),
     'AI 沒有用 Math.random（線上版要能重放）');
}

console.log('═══ 三家各算各的 ═══');

{
  const h = table(['1萬 1萬 1萬 2筒 3筒 4筒 5條 6條 7條 東 東 白 白 9萬',
                   '2萬 5萬 8萬 2筒 5筒 8筒 2條 5條 8條 東 南 西 北 中',
                   null, null]);
  h.seats[0].melds = [{ type: 'pong', tiles: T('發 發 發'), from: 3 }];
  const a = AI.chooseDiscard(h, 0, { level: 2 });
  const b = AI.chooseDiscard(h, 1, { level: 2 });
  ok(h.seats[0].hand[a], '座位 0 選得出一張牌');
  ok(h.seats[1].hand[b], '座位 1 選得出一張牌');
  // 座位 0 有副露、座位 1 沒有 —— 兩家的向聽基準不同，不該共用
  eq(h.seats[0].melds.length, 1, '座位 0 有一組副露');
  eq(h.seats[1].melds.length, 0, '座位 1 沒有副露');
  ok(h.seats[0].hand[a].display !== undefined && h.seats[1].hand[b].display !== undefined,
     '兩家各自算出自己的棄牌，沒有互相污染');
}

console.log('═══ 現物 ═══');

{
  const h = table([null, null, null, null]);
  h.seats[1].discards = T('5萬 東');
  const gen = AI.genbutsu(h, 1);
  ok(gen['5萬'], '打過的牌進現物');
  ok(gen['東'], '字牌也算現物');
  ok(!gen['6萬'], '沒打過的不是現物');

  eq(AI.tileDangerAgainst(h, '5萬', 1, 0, 2), 0, '現物對這家危險度 0');
  ok(AI.tileDangerAgainst(h, '6萬', 1, 0, 2) > 0, '非現物有危險度');
}

{
  // 被鳴走的牌仍然算現物 —— game-state 用 claimedBy 標記而不刪除就是為了這個
  const h = table([null, '5萬', '5萬 5萬 9筒', null]);
  S.discardTile(h, 1, 0);
  const disc = h.lastDiscard.tile;
  S.applyMeld(h, 2, 'pong', [disc, h.seats[2].hand[0], h.seats[2].hand[1]], 1);
  ok(AI.genbutsu(h, 1)['5萬'], '被碰走的牌照樣是現物');
  eq(AI.tileDangerAgainst(h, '5萬', 1, 0, 2), 0, '對打牌者仍然安全');
}

console.log('═══ 筋 ═══');

{
  const gen = { '4萬': true };
  ok(AI.isSuji('1萬', gen), '打過 4萬 → 1萬 是筋');
  ok(AI.isSuji('7萬', gen), '打過 4萬 → 7萬 是筋');
  ok(!AI.isSuji('5萬', gen), '打過 4萬 不能讓 5萬 變筋');
  ok(!AI.isSuji('東', gen), '字牌沒有筋');

  ok(!AI.isSuji('5萬', { '2萬': true }), '中張只有單邊不算本筋');
  ok(AI.isSuji('5萬', { '2萬': true, '8萬': true }), '中張兩邊都有才是本筋');

  // 筋只在高手難度生效
  const h = table();
  h.seats[1].discards = T('4萬');
  const normal = AI.tileDangerAgainst(h, '7萬', 1, 0, 2);
  const expert = AI.tileDangerAgainst(h, '7萬', 1, 0, 3);
  ok(expert < normal, '高手看筋，普通不看');
}

console.log('═══ 牌面本身的危險度 ═══');

{
  const d = AI.baseDanger;
  ok(d('5萬') > d('3萬'), '中張比 3/7 危險');
  ok(d('3萬') > d('2萬'), '3/7 比 2/8 危險');
  ok(d('2萬') > d('1萬'), '2/8 比么九危險');
  ok(d('1萬') > d('東'), '么九比字牌危險');
  eq(d('4筒'), d('6條'), '同一類的牌危險度相同');
}

{
  // 場上看得到越多張，越安全（高手才看）
  const h = table(['5萬 5萬 5萬 1筒 2筒 3筒 4筒 5筒 6筒 7筒 8筒 9筒 東 南']);
  h.seats[1].discards = T('9筒');
  const few = AI.tileDangerAgainst(h, '9萬', 1, 0, 3);
  const many = AI.tileDangerAgainst(h, '5萬', 1, 0, 3);
  ok(many < AI.baseDanger('5萬'), '自己手上有三張 5萬 → 5萬 的危險度打折');
  ok(few > 0, '沒看到幾張的牌仍然危險');
}

console.log('═══ 威脅度推測 ═══');

{
  const h = table();
  const t0 = AI.threatLevel(h, 1);
  eq(t0, 0, '什麼都還沒做的人威脅度 0');

  h.seats[1].discards = T('1萬 2萬 3萬 4萬 5萬 6萬 7萬');
  const t7 = AI.threatLevel(h, 1);
  ok(t7 > t0, '打了七張之後威脅度上升');

  h.seats[1].melds = [{ type: 'pong', tiles: T('9筒 9筒 9筒'), from: 0 }];
  const tm = AI.threatLevel(h, 1);
  ok(tm > t7, '有副露之後威脅度再上升');

  h.seats[1].melds = [{ type: 'pong', tiles: T('中 中 中'), from: 0 }];
  ok(AI.threatLevel(h, 1) > tm, '役牌副露的威脅度更高');

  h.seats[2].discards = T('1萬 2萬 3萬 4萬 5萬 6萬 7萬 8萬 9萬 1筒 2筒 3筒 4筒 5筒 6筒 7筒 8筒');
  ok(AI.threatLevel(h, 2) <= 1, '威脅度封頂在 1');
}

console.log('═══ 難度分級 ═══');

{
  const h = table([null, null, null, null]);
  h.seats[1].discards = T('5萬');
  eq(AI.tileDanger(h, '5萬', 0, 1), 0, '初學：完全不看危險度');
  eq(AI.tileDanger(h, '9萬', 0, 1), 0, '初學：任何牌都是 0');
  ok(AI.tileDanger(h, '9萬', 0, 2) >= 0, '普通：開始看危險度');
}

{
  // 初學不鳴牌，但有得胡還是胡
  const h = table([null, '5萬 5萬 9筒 9條 3條 7筒 1萬 2萬 3萬 4筒 5筒 6筒 東']);
  S.discardTile(h, 0, 0);
  const opt = { ron: false, pong: true, kong: false, chi: [] };
  eq(AI.decideClaim(h, 1, opt, { level: 1 }).type, 'pass', '初學不碰');
  eq(AI.decideClaim(h, 1, { ron: true, pong: false, kong: false, chi: [] },
                    { level: 1 }).type, 'ron', '初學有得胡還是胡');
}

{
  // 高手：自己還遠、別家威脅高 → 不鳴
  const far = '1萬 4萬 7萬 2筒 5筒 8筒 3條 6條 9條 東 南 西 北';
  const h = table([null, far, null, null]);
  h.seats[2].discards = T('1萬 2萬 3萬 4萬 5萬 6萬 7萬 8萬 9萬 1筒 2筒 3筒 4筒 5筒');
  h.seats[2].melds = [{ type: 'pong', tiles: T('中 中 中'), from: 0 }];
  h.seats[1].hand = T(far);
  h.seats[1].hand.push(T('9筒')[0]);
  h.seats[0].hand = T('9筒');
  S.discardTile(h, 0, 0);
  ok(AI.threatLevel(h, 2) >= 0.7, '座位 2 的威脅度夠高');
  const opt = { ron: false, pong: true, kong: false, chi: [] };
  eq(AI.decideClaim(h, 1, opt, { level: 3 }).type, 'pass',
     '高手：自己還遠又有人快聽了，不鳴');
}

console.log('═══ 不龜縮（PLAN 點名的病）═══');

{
  // 舊版 expert 的 dangerWeight=80 × danger=100 = 8000，一個向聽只值 1000，
  // 所以玩家一聽牌 AI 就完全不做牌。這裡驗新的比例不會出現那種事。
  ok(AI.DANGER_MAX < AI.SHANTEN_W * 2,
     '危險度最多值兩個向聽以內', `DANGER_MAX=${AI.DANGER_MAX} SHANTEN_W=${AI.SHANTEN_W}`);
  ok(AI.pressureOf(0) < AI.pressureOf(2), '自己越接近聽牌，越傾向推而不是縮');
  eq(AI.pressureOf(0) <= 0.3, true, '聽牌時防守權重降到很低');
}

{
  // 關鍵局面：安全牌要付出一個向聽的時候，AI 該不該付？
  //
  // 手牌打 5筒 就聽牌，但 5筒 是生張；打 東 安全（三家都打過 → 現物），
  // 代價是停在一向聽。三家都有役牌副露、打了十四張，威脅度拉滿。
  //
  //   舊版權重（danger 800 對一向聽 100）→ 打 東，放棄聽牌，龜
  //   新版（danger 上限 150，聽牌時壓力係數再降）→ 打 5筒，進聽牌
  //
  // 這一項是整組測試裡唯一分得開新舊行為的單點局面 ——
  // 手牌只要換成「安全牌不用付代價」，兩版都會打同一張，測不出東西。
  const h = table(['東 東 1萬 2萬 3萬 4萬 5萬 6萬 7萬 8萬 9萬 1條 2條 5筒']);
  [1, 2, 3].forEach(x => {
    h.seats[x].discards = T('東 1萬 9萬 9筒 1條 9條 北 西 南 白 發 2萬 8萬 3條');
    h.seats[x].melds = [{ type: 'pong', tiles: T('中 中 中'), from: 0 }];
  });

  // 先確認這個局面真的有「安全但要付代價」的選項
  const shOf = i => R.shantenNum(
    h.seats[0].hand.filter((_, j) => j !== i).map(t => t.display), 0);
  const iEast = h.seats[0].hand.findIndex(t => t.display === '東');
  const iPin5 = h.seats[0].hand.findIndex(t => t.display === '5筒');
  eq(shOf(iPin5), 0, '打 5筒 進聽牌');
  eq(shOf(iEast), 1, '打 東 停在一向聽');
  eq(AI.tileDangerAgainst(h, '東', 1, 0, 3), 0, '東 是現物，完全安全');
  ok(AI.tileDangerAgainst(h, '5筒', 1, 0, 3) > 0.5, '5筒 是生張中張，很危險');
  ok(AI.threatLevel(h, 1) >= 0.9, '對手的威脅度拉滿');

  const idx = AI.chooseDiscard(h, 0, { level: 3 });
  eq(h.seats[0].hand[idx].display, '5筒',
     '高壓之下仍然打生張進聽牌，不為了安全放棄一個向聽');
}

{
  // 整場實測：高手 AI 仍然做得出牌，不是從頭流局到尾。
  // 只跑兩場（八局）—— 高手 AI 一局約兩秒，跑多了測試會拖到半分鐘以上。
  // 實測基準：新版 16 局胡 14 局；舊版權重 12 局只胡 4 局。門檻抓在中間。
  let wins = 0, draws = 0;
  for (let seed = 1; seed <= 2; seed++) {
    const m = S.createMatch({ seed, seats: [0, 1, 2, 3].map(i => ({ name: 'P' + i })) });
    const si = {}; [0, 1, 2, 3].forEach(i => { si[i] = { isAI: true, aiLevel: 3 }; });
    const r = F.startMatch(m, Object.assign({ seatInfo: si, now: 1, claimTimeoutMs: 0 }, aiCtx()));
    r.events.forEach(e => {
      if (e.t === 'win') wins++;
      if (e.t === 'drawGame') draws++;
    });
  }
  eq(wins + draws, 8, '兩場共八局');
  ok(wins >= 5, '四家全是高手時，過半的局仍然有人胡牌（不是全程龜縮）',
     `胡 ${wins} 局、流局 ${draws} 局`);
}

console.log('═══ 受入 ═══');

{
  const h = table(['1萬 2萬 3萬 4筒 5筒 6筒 7條 8條 9條 1條 2條 白 白']);
  const disp = h.seats[0].hand.map(t => t.display);
  const u = AI.ukeire(h, disp, 0, 0);
  ok(u > 0, '一向聽的手牌有受入');

  // 兩面聽（1條2條 等 3條）比單騎寬
  const ryanmen = table(['1萬 2萬 3萬 4筒 5筒 6筒 7條 8條 9條 3萬 4萬 白 白']);
  const tanki = table(['1萬 2萬 3萬 4筒 5筒 6筒 7條 8條 9條 1條 1條 1條 白']);
  const ur = AI.ukeire(ryanmen, ryanmen.seats[0].hand.map(t => t.display), 0, 0);
  const ut = AI.ukeire(tanki, tanki.seats[0].hand.map(t => t.display), 0, 0);
  ok(ur >= ut, '兩面的受入不小於單騎', `兩面 ${ur} / 單騎 ${ut}`);
}

{
  // 場上看得到的牌會從受入裡扣掉
  const a = table(['1萬 2萬 3萬 4筒 5筒 6筒 7條 8條 9條 3萬 4萬 白 白']);
  const b = table(['1萬 2萬 3萬 4筒 5筒 6筒 7條 8條 9條 3萬 4萬 白 白']);
  b.seats[1].discards = T('2萬 2萬 5萬 5萬');
  const ua = AI.ukeire(a, a.seats[0].hand.map(t => t.display), 0, 0);
  const ub = AI.ukeire(b, b.seats[0].hand.map(t => t.display), 0, 0);
  ok(ub <= ua, '進張已經被打掉的話，受入會變少', `${ua} → ${ub}`);
}

console.log('═══ 可重放（線上版的地基）═══');

{
  // 同一份狀態算兩次，答案必須一樣；清掉快取也要一樣
  const h = table(['1萬 2萬 4萬 5萬 7萬 9萬 2筒 3筒 5筒 7條 8條 東 東 白']);
  h.seats[1].discards = T('9筒 1條');
  const a = AI.chooseDiscard(h, 0, { level: 3 });
  const b = AI.chooseDiscard(h, 0, { level: 3 });
  AI.clearCache();
  const c = AI.chooseDiscard(h, 0, { level: 3 });
  eq(a, b, '同一份狀態算兩次，答案一樣');
  eq(a, c, '清掉快取之後答案還是一樣（快取沒有改變結果）');
}

{
  // 初學的「隨手打」也要可重放
  const mk = () => {
    const h = table(['1萬 2萬 4萬 5萬 7萬 9萬 2筒 3筒 5筒 7條 8條 東 東 白']);
    h.seats[0].discards = T('9筒 1條 北');
    return h;
  };
  eq(AI.chooseDiscard(mk(), 0, { level: 1 }),
     AI.chooseDiscard(mk(), 0, { level: 1 }), '初學的隨手打可重放');
}

{
  // 整場重放
  const run = () => {
    const m = S.createMatch({ seed: 4242, seats: [0, 1, 2, 3].map(i => ({ name: 'P' + i })) });
    const si = {}; [0, 1, 2, 3].forEach(i => { si[i] = { isAI: true, aiLevel: i === 0 ? 1 : 3 }; });
    const r = F.startMatch(m, Object.assign({ seatInfo: si, now: 1, claimTimeoutMs: 0 }, aiCtx()));
    return r.events.map(e => e.t + (e.seat != null ? e.seat : '')).join('|');
  };
  eq(run(), run(), '同一場打兩次，事件序列完全相同');
}

console.log('═══ 聽牌代打 ═══');

{
  // 聽 3萬／6萬／9萬；摸到一張沒用的 → 應該摸切（打最後一張）
  const h = table([null, null, null, null]);
  h.seats[0].hand = T('1萬 2萬 3萬 4萬 5萬 6萬 7萬 8萬 1筒 1筒 1筒 9條 9條 東');
  const i = AI.tenpaiAutoDiscard(h, 0);
  eq(i, 13, '摸到沒用的牌 → 摸切（打剛摸的那張）');
  const rest = h.seats[0].hand.filter((_, j) => j !== i).map(t => t.display);
  ok(R.isTenpaiHand(rest.map(d => ({ display: d })), []) ||
     R.shantenNum(rest, 0) <= 0, '打完之後還是聽牌');
}

{
  // 摸到的那張讓牌型更好，摸切反而會拆聽 → 要改打別張
  const h = table([null, null, null, null]);
  //  1筒1筒1筒 9條9條 + 12345678萬，摸到 9萬 → 789萬 成立，
  //  這時摸切（打 9萬）會退回原本的聽，打 9條 也仍然聽牌
  h.seats[0].hand = T('1萬 2萬 3萬 4萬 5萬 6萬 7萬 8萬 9萬 1筒 1筒 1筒 9條 9條');
  const i = AI.tenpaiAutoDiscard(h, 0);
  const rest = h.seats[0].hand.filter((_, j) => j !== i).map(t => t.display);
  eq(R.shantenNum(rest, 0) <= 0, true, '不管打哪張，打完都還是聽牌');
}

{
  // 有副露時也要算對（副露會改變手牌張數）
  const h = table([null, null, null, null]);
  h.seats[0].melds = [{ type: 'pong', tiles: T('東 東 東'), from: 1 }];
  h.seats[0].hand = T('1萬 2萬 3萬 4萬 5萬 6萬 7萬 8萬 9條 9條 5筒');
  const i = AI.tenpaiAutoDiscard(h, 0);
  ok(i >= 0 && i < h.seats[0].hand.length, '有副露時也給得出合法的索引');
}

{
  // 保證回傳的一定是合法索引，不會爆掉
  let bad = null;
  for (let seed = 1; seed <= 60 && !bad; seed++) {
    const m = S.createMatch({ seed });
    S.startHand(m);
    S.drawTile(m.hand, 0);
    const i = AI.tenpaiAutoDiscard(m.hand, 0);
    if (!(i >= 0 && i < m.hand.seats[0].hand.length)) bad = `seed ${seed} 回傳 ${i}`;
  }
  ok(!bad, '沒聽牌時也不會回傳非法索引（保底摸切）', bad);
}

console.log('═══ 接上 flow ═══');

{
  const m = S.createMatch({ seed: 99, seats: [0, 1, 2, 3].map(i => ({ name: 'P' + i })) });
  const si = { 0: { isAI: true, aiLevel: 1 }, 1: { isAI: true, aiLevel: 2 },
               2: { isAI: true, aiLevel: 3 }, 3: { isAI: true, aiLevel: 3 } };
  const r = F.startMatch(m, Object.assign({ seatInfo: si, now: 1, claimTimeoutMs: 0 }, aiCtx()));
  eq(r.waiting.kind, 'matchOver', '一桌混難度打得完一整場');
  eq(m.seats.reduce((n, s) => n + s.matchScore, 0), 0, '總分零和');
  ok(r.events.some(e => e.t === 'meld'), '過程中有人鳴牌');
}

console.log('\n─────────────────────────');
console.log(`通過 ${pass}　失敗 ${fail}`);
if (fail) { fails.forEach(f => console.log('  ✗ ' + f)); process.exit(1); }
console.log('全部通過 ✓');
