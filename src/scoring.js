/* ═══════════════════════════════════════════════════════════════
   scoring.js — 四人麻將的計分與點數移轉
   ───────────────────────────────────────────────────────────────
   兩人版沒有這一層：`calcScore` 只算「玩家一個人得幾分」，
   對手贏就從玩家的總分扣同額（`G.totalScore -= …`，L5234）。
   兩個人的時候這樣夠用，四個人就必須講清楚**誰付給誰**。

   這個模組負責：
     ‧ 這一手值多少分（特殊牌型 + 役牌 + 莊家加成 + 國家技能 + 本場）
     ‧ 點數怎麼在四家之間移轉（榮和／自摸／流局罰符）
     ‧ 連莊判定與一場的結束條件

   刻意不做的事：
     ‧ 和牌判定與牌型辨識　→ rules-core.js
     ‧ 什麼時候結算　　　　→ flow.js

   ── 為什麼不改 rules-core.js 的 calcScore ──
   那支是 `tools/build-rules-core.py` 從舊版自動抽出來的，
   文件寫明「不要手改」。四人化的部分疊在這裡，`calcScore` 保持原樣
   當作「這一手的基礎分」，重跑產生器不會把四人邏輯洗掉。

   ── 尺度 ──
   舊版兩人局是基本和牌 8 分、特殊牌型 8～88 分。
   四人局一律 ×10（見 POINT_SCALE），因為點數要拆給三家，
   8 分的尺度粗到讓百分比技能取整之後失效。
   ═══════════════════════════════════════════════════════════════ */
(function (root, factory) {
  const api = factory(
    typeof require === 'function' ? require('./rules-core.js') : root.MJRules,
    typeof require === 'function' ? require('./game-state.js') : root.MJState);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MJScore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (R, S) {
'use strict';

const SEATS = 4;

/* 點數尺度。舊版兩人局的基本和牌是 8 分，那個尺度在四人局**太粗**：
   一次自摸要拆成 4/2/2，任何百分比的技能套在 2 上面取整之後就消失了
   —— 齊「善守」×0.7 作用在 2 點上等於沒有這個技能。

   所以四人局的點數一律 ×10：基本和牌 80，自摸拆成 40/20/20，
   善守打折後是 14 —— 看得出來、算得準、排名也分得開。
   特殊牌型跟著放大（8～88 → 80～880）。                            */
const POINT_SCALE  = 10;

const YAKUHAI_PTS  = 4 * POINT_SCALE;   // 每一組役牌刻子，半個基本和牌
const DEALER_MULT  = 1.5;               // 莊家胡牌的加成
const HONBA_PTS    = 2 * POINT_SCALE;   // 每一本場
const NOTEN_POT    = 8 * POINT_SCALE;   // 流局罰符的總額（一個基本和牌）
/* 祥瑞（寶牌，docs/dora-and-declare.md 第二節，v1.91）：手上（含副露、和的那張）每有一張祥瑞加 DORA_PTS。
   ⚠️ 加在**整條乘法鏈之後**：押注倍率、莊家加成、秦楚的技能倍率都不乘；齊「善守」付款時也不打折
   （祥瑞是「這張牌今天值錢」，跟你押什麼、是哪一國無關 —— 定案 2026-10-24） */
const DORA_PTS     = 2 * POINT_SCALE;   // 20（基本和牌 80 的四分之一）

/* 指示牌 → 祥瑞：下一張。數牌 9→1；風 東→南→西→北→東；三元 白→發→中→白 */
const WIND_NEXT = { 東: '南', 南: '西', 西: '北', 北: '東' };
const DRAGON_NEXT = { 白: '發', 發: '中', 中: '白' };
function doraOf(indicator) {
  const d = indicator && (indicator.display || indicator);
  if (!d) return null;
  if (WIND_NEXT[d]) return WIND_NEXT[d];
  if (DRAGON_NEXT[d]) return DRAGON_NEXT[d];
  const n = parseInt(d, 10), suit = d.slice(String(n).length);
  if (!(n >= 1 && n <= 9) || !suit) return null;
  return (n === 9 ? 1 : n + 1) + suit;
}
/* 這一家整手牌（手牌＋副露）裡的祥瑞張數。指示牌重複（翻到同一種）就各算一次 */
function countDora(hand, seat) {
  const st = hand && hand.seats && hand.seats[seat];
  const shown = (hand && hand.doraShown) || [];
  if (!st || !shown.length) return { count: 0, pts: 0, dora: [] };
  const tiles = (st.hand || []).map(t => t.display)
    .concat(...(st.melds || []).map(m => (m.tiles || []).map(t => t.display)));
  const dora = shown.map(doraOf).filter(Boolean);
  let count = 0;
  dora.forEach(d => { tiles.forEach(t => { if (t === d) count++; }); });
  return { count, pts: count * DORA_PTS, dora };
}

/* ── 押注的押金（v1.61）──────────────────────────────────
   原本押注沒有代價，倍率又乘在**任何**胡牌上 —— 永遠押孤注一擲最划算
   （模擬：每局平均比押普通多賺 80）。2026-10-14 改成：
     ‧ 先付押金；**做成特殊牌型胡牌**才乘倍率、押金退回
     ‧ 其他情況押金進彩池，這一局胡牌的人拿走（自己胡了就是拿回自己的）
     ‧ 流局彩池留到下一局；一場打完還有剩，給這一場第一名
   押金 = 半個／一個基本胡牌。tools/sim-bet.js 跑了 2000 多場：
   亂押每局 −35／−70，照占卜押每局約 +15 —— 押注變成真的要看占卜的決定。
   40／80 太便宜（楚、秦亂押反而小賺），120／240 太貴（照占卜押也賺不到）。 */
const STAKE = { normal: 0, special: 8 * POINT_SCALE, dragon: 16 * POINT_SCALE };
const DRAGONS      = ['中', '發', '白'];

/* ── 國家的被動技能係數 ──────────────────────────────────
   七國技能已於 2026-09-15 定案，見 docs/skill-conflicts.md 第六節。
   這裡只放**三個被動**（齊、楚、秦）—— 它們是計分的一部分。
   四個主動技能（燕韓魏趙）屬於階段二第 9 項，不在這裡。

   成長依征服數，門檻 0–1 / 2–3 / 4+。                            */
function growthTier(conquered) {
  const n = conquered || 0;
  return n >= 4 ? 2 : n >= 2 ? 1 : 0;
}

const QI_PAY   = [0.7, 0.6, 0.5];   // 齊 善守：本家應付的點數
const CHU_WIN  = [1.3, 1.4, 1.5];   // 楚 雄兵：胡牌得分
const QIN_SPEC = [1.5, 1.6, 1.7];   // 秦 虎狼：特殊牌型再乘

function kingdomMods(kingdom, conquered) {
  const t = growthTier(conquered);
  return {
    winMult:     kingdom === 'chu' ? CHU_WIN[t]  : 1,
    specialMult: kingdom === 'qin' ? QIN_SPEC[t] : 1,
    payMult:     kingdom === 'qi'  ? QI_PAY[t]   : 1,
  };
}

/* ── 役牌 ──────────────────────────────────────────────────
   讓風位真的參與計分 —— 舊版的字牌只是牌面，打出來跟 5萬 沒兩樣。

   算法刻意跟舊版 `小三元` 的判定同一個路數：看**手牌加副露裡有沒有三張**，
   不去拆面子。拆面子在一手牌有多種拆法時會有歧義（同一副牌可以拆成
   刻子也可以拆成順子），而那個歧義對這個尺度的計分不值得處理。

   連風（莊家的東同時是場風與自風）算兩次 —— 這是標準規則。       */
function yakuhaiBonus(hand, seat) {
  const me = hand.seats[seat];
  const all = me.hand.concat(...me.melds.map(m => m.tiles));
  const count = d => all.filter(t => t.display === d).length;

  const roundWind = hand.roundWind || '東';
  const seatWind = S.seatWind(hand, seat);

  const hits = [];
  if (count(roundWind) >= 3) hits.push({ kind: 'roundWind', tile: roundWind });
  if (count(seatWind) >= 3) hits.push({ kind: 'seatWind', tile: seatWind });
  DRAGONS.forEach(d => { if (count(d) >= 3) hits.push({ kind: 'dragon', tile: d }); });

  return { pts: hits.length * YAKUHAI_PTS, hits };
}

/* ── 這一手值多少分 ────────────────────────────────────────
   回傳每一段的明細，不只總分 —— 結算畫面要逐項顯示，
   而且拆開來之後每一項都能單獨測。                                */
function handValue(hand, seat, opts) {
  const o = opts || {};
  const me = hand.seats[seat];
  const special = R.checkSpecialHand(me.hand, me.melds);
  const mods = kingdomMods(o.kingdom, o.conquered);

  // 基礎分走 rules-core 的 calcScore，但秦的倍率改用成長後的值，
  // 所以這裡不把 kingdomId 傳進去，自己乘。
  // ⚠️ 押注倍率只在**做成特殊牌型**時生效（v1.61 起）。原本 calcScore 不看有沒有特殊牌型就乘
  let base = R.calcScore(special, special ? (o.bet || 'normal') : 'normal', null) * POINT_SCALE;
  const yaku = yakuhaiBonus(hand, seat);
  let total = base + yaku.pts;

  if (special) total = Math.ceil(total * mods.specialMult);
  total = Math.ceil(total * mods.winMult);

  const isDealer = hand.dealer === seat;
  if (isDealer) total = Math.ceil(total * DEALER_MULT);

  const honba = (hand.honba || 0) * HONBA_PTS;
  total += honba;

  const dora = countDora(hand, seat);           // 祥瑞：乘法鏈之後才加（見 DORA_PTS）
  total += dora.pts;

  return {
    seat, total,
    dora: dora.count, doraPts: dora.pts,
    base, special: special ? { name: special.name, pts: special.pts } : null,
    yakuhai: yaku.pts, yakuhaiHits: yaku.hits,
    isDealer, dealerMult: isDealer ? DEALER_MULT : 1,
    winMult: mods.winMult, specialMult: mods.specialMult,
    honba,
  };
}

/* ── 把總額分給收款的人，湊出整數且不多不少 ────────────────── */
function distribute(total, receivers) {
  const n = receivers.length;
  if (!n) return [];
  const each = Math.floor(total / n);
  let rest = total - each * n;
  return receivers.map(seat => {
    const extra = rest > 0 ? 1 : 0;
    if (rest > 0) rest--;
    return { seat, pts: each + extra };
  });
}

/* 某一家實際要付多少 —— 齊「善守」在這裡生效。
   注意減免的結果是**贏家少收**，不是別人補上 ——
   這樣整場才守得住零和，排名才不會憑空多出分數。                 */
function payerAmount(raw, seatInfo) {
  const info = seatInfo || {};
  const mods = kingdomMods(info.kingdom, info.conquered);
  return Math.max(0, Math.ceil(raw * mods.payMult));
}

/* ── 和牌的點數移轉 ────────────────────────────────────────
   榮和：放銃者付全額。
   自摸：三家分攤，莊家付雙份（標準的 2:1:1）。莊家自摸則三家均分。

   回傳 transfers：[{from, to, pts}]。淨額由 applyTransfers 算。    */
function settleWin(match, hand, result, opts) {
  const o = opts || {};
  const seatInfo = o.seatInfo || {};
  const transfers = [];
  const details = [];

  (result.winners || []).forEach(w => {
    const info = seatInfo[w.seat] || {};
    const v = handValue(hand, w.seat, {
      kingdom: info.kingdom, conquered: info.conquered, bet: info.bet,
    });
    details.push(v);

    // 祥瑞那一段不受齊「善守」打折（見 DORA_PTS）：善守只打在其餘的部分
    const dp = v.doraPts || 0;
    if (result.type === 'ron') {
      const pts = payerAmount(v.total - dp, seatInfo[result.from]) + dp;
      if (pts > 0) transfers.push({ from: result.from, to: w.seat, pts, reason: 'ron' });
      return;
    }

    // 自摸：先算每一家的「應付原始額」，再各自套用善守
    const others = [0, 1, 2, 3].filter(s => s !== w.seat);
    const dealerSeat = hand.dealer;
    const winnerIsDealer = w.seat === dealerSeat;

    others.forEach(s => {
      // 非莊自摸時莊家付一半、另兩家各四分之一；莊家自摸則三家均分
      const frac = winnerIsDealer ? 1 / 3 : (s === dealerSeat ? 1 / 2 : 1 / 4);
      const pts = payerAmount(Math.ceil((v.total - dp) * frac), seatInfo[s]) + Math.ceil(dp * frac);
      if (pts > 0) transfers.push({ from: s, to: w.seat, pts, reason: 'tsumo' });
    });
  });

  return { transfers, details };
}

/* ── 流局罰符 ──────────────────────────────────────────────
   聽牌者收、未聽牌者付。四家都聽或都沒聽就不動。
   舊版沒有這條 —— 兩人版流局是「雙方合計摸滿 60 次」，誰都不罰。 */
function settleDraw(match, hand, tenpaiSeats, opts) {
  const o = opts || {};
  const seatInfo = o.seatInfo || {};
  const tenpai = (tenpaiSeats || []).slice().sort((a, b) => a - b);
  const noten = [0, 1, 2, 3].filter(s => tenpai.indexOf(s) < 0);
  if (!tenpai.length || !noten.length) return { transfers: [], details: [] };

  const rawEach = Math.ceil(NOTEN_POT / noten.length);
  const paid = noten.map(s => ({ seat: s, pts: payerAmount(rawEach, seatInfo[s]) }));
  const pot = paid.reduce((n, p) => n + p.pts, 0);
  const got = distribute(pot, tenpai);

  // 罰符是「一群人付、一群人收」，總額相等但不是一對一，
  // 所以照付款順序把收款方串起來，串到誰就記在誰頭上。
  const transfers = [];
  let qi = 0, remain = got.length ? got[0].pts : 0;
  paid.forEach(p => {
    let left = p.pts;
    while (left > 0 && qi < got.length) {
      const take = Math.min(left, remain);
      if (take > 0) transfers.push({ from: p.seat, to: got[qi].seat, pts: take, reason: 'noten' });
      left -= take; remain -= take;
      if (remain === 0) { qi++; remain = qi < got.length ? got[qi].pts : 0; }
    }
  });

  return { transfers, details: [{ pot, tenpai, noten }] };
}

/* ── 押金與彩池（v1.61，規則見 STAKE）─────────────────────────
   一局結束時算：押了注、卻沒做成特殊牌型胡牌的人，押金進彩池；
   這一局有人胡就把彩池（含之前流局留下的）分給胡的人，流局就留著。
   彩池不是一個座位，transfers 裡用 POT 表示（applyTransfers 只動座位那一端）。
   回傳 { transfers, potAfter, stakes:[{seat,pts}], paid:[{seat,pts}] } —— 結算畫面要逐項顯示。 */
const POT = 'pot';
function settleStakes(match, hand, result, opts) {
  const seatInfo = (opts && opts.seatInfo) || {};
  const winners = (result.winners || []).map(w => w.seat);
  const madeIt = seat => (result.winners || []).some(w => w.seat === seat && w.special);
  const transfers = [], stakes = [];
  [0, 1, 2, 3].forEach(seat => {
    const pts = STAKE[(seatInfo[seat] || {}).bet] || 0;
    if (!pts || madeIt(seat)) return;           // 沒押、或做成了（押金退回 = 不動）
    stakes.push({ seat, pts });
    transfers.push({ from: seat, to: POT, pts, reason: 'stake' });
  });
  let pot = (match.pot || 0) + stakes.reduce((n, x) => n + x.pts, 0);
  let paid = [];
  if (result.type !== 'draw' && winners.length && pot > 0) {
    paid = distribute(pot, winners);
    paid.forEach(p => { if (p.pts > 0) transfers.push({ from: POT, to: p.seat, pts: p.pts, reason: 'pot' }); });
    pot = 0;
  }
  return { transfers, potAfter: pot, stakes, paid };
}

/* 一場打完，彩池還有剩（最後一局流局）→ 給這一場的第一名。回傳 {seat, pts} 或 null */
function potToLeader(match) {
  const pot = match.pot || 0;
  if (pot <= 0) return null;
  const top = standings(match)[0];
  match.seats[top.seat].matchScore += pot;
  match.pot = 0;
  return { seat: top.seat, pts: pot };
}

/* ── 落到 match 上 ─────────────────────────────────────────── */
function applyTransfers(match, transfers) {
  const net = [0, 0, 0, 0];
  (transfers || []).forEach(t => {
    // 彩池那一端（POT）不是座位，只動座位這一端
    if (typeof t.from === 'number') net[t.from] -= t.pts;
    if (typeof t.to === 'number') net[t.to] += t.pts;
  });
  net.forEach((n, i) => { match.seats[i].matchScore += n; });
  return net;
}

/* ── 連莊與一場的結束 ──────────────────────────────────────
   renchan：
     'none'   莊家每局輪一位，固定打滿 totalHands 局（**預設**）
     'repeat' 標準連莊 —— 莊家胡牌、或流局時莊家聽牌就續莊，
              一場打到莊家輪滿一圈為止

   為什麼預設不連莊：PLAN 把對戰單位定成「一場四局，約 15–20 分鐘」，
   連莊會讓一場的長度變成不確定的 —— 線上四個人約好的時間會被打亂。
   想要標準規則的話把 renchan 設成 'repeat'，maxHands 是保護時間預算的硬上限。

   本場（honba）：連莊與流局都 +1，每一本場讓和牌者多收 HONBA_PTS。  */
function nextDealer(match, hand, result, opts) {
  const o = opts || {};
  const policy = o.renchan || 'none';
  const dealer = hand.dealer;

  let dealerKeeps = false;
  if (policy === 'repeat') {
    if (result.type === 'draw') {
      dealerKeeps = (result.tenpai || []).indexOf(dealer) >= 0;
    } else {
      dealerKeeps = (result.winners || []).some(w => w.seat === dealer);
    }
  }

  const honbaUp = dealerKeeps || result.type === 'draw';
  const honba = honbaUp ? (match.honba || 0) + 1 : 0;
  const rotations = (match.dealerRotations || 0) + (dealerKeeps ? 0 : 1);

  const maxHands = o.maxHands || (match.totalHands * 2);
  const over = policy === 'repeat'
    ? (rotations >= match.totalHands || match.handNo >= maxHands)
    : match.handNo >= match.totalHands;

  return {
    dealer: dealerKeeps ? dealer : S.nextSeat(dealer),
    dealerKeeps, honba, rotations, matchOver: over,
  };
}

/* 一場結束後的名次。分高者前，同分時莊家順位（座位小）在前。 */
function standings(match) {
  return match.seats
    .map(s => ({ seat: s.seat, name: s.name, score: s.matchScore }))
    .sort((a, b) => b.score - a.score || a.seat - b.seat);
}

return {
  POINT_SCALE, YAKUHAI_PTS, DEALER_MULT, HONBA_PTS, NOTEN_POT, STAKE, POT,
  QI_PAY, CHU_WIN, QIN_SPEC,
  growthTier, kingdomMods,
  yakuhaiBonus, handValue,
  settleWin, settleDraw, settleStakes, potToLeader, applyTransfers, distribute, payerAmount,
  DORA_PTS, doraOf, countDora,
  nextDealer, standings,
};
});
