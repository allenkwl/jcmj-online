#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════
   sim-bet.js — 押注與國庫的模擬（2026-10-14）
   ───────────────────────────────────────────────────────────────
   使用者要把押注改成有賠率、加「國庫（兩黃金）」：「先跑模擬看結果再來討論」。

   做法：四家都用遊戲裡真的 AI（ai.js）打完整的一場（flow.js），
   偏置發牌照遊戲的設定（deal-seed.js，四家都沒有連敗加成），
   每一局開牌時對座位 0 跑一次發牌占卜（fortune.js 的 analyze），
   一局結束時記下真正的結果。押注規則**不在這裡算**——
   這裡只產生原始紀錄（JSON lines），規則各種版本由 sim-bet-report.js 拿同一批紀錄比較。

   ⚠️ 座位 0 是 AI 在打，不是人：AI 不會因為押了特殊牌型就刻意去做那個牌型，
      所以「做成特殊牌型」的機率是**下限**，真人追牌型會高一些。

   執行：bash tools/sim-bet-run.sh（平行開 9 支、結果在 tools/sim-out/）
   單支：node tools/sim-bet.js --from 1 --count 300 --level 2 --out tools/sim-out/a.jsonl

   ⚠️ 可以接續：--out 的檔案裡已經有的 seed 會跳過，每跑完一場就馬上寫進去。
      2026-10-14 第一次跑了 78% 碰上重開機 —— 結果放在 /private/tmp（暫存區），
      重開機整個被清掉，只能重跑。所以結果改放專案裡的 tools/sim-out/（不進 git）。
   ═══════════════════════════════════════════════════════════════ */
'use strict';
const path = require('path');
const src = f => path.join(__dirname, '..', 'src', f);
const S = require(src('game-state.js'));
const F = require(src('flow.js'));
const AI = require(src('ai.js'));
const FT = require(src('fortune.js'));
const SC = require(src('scoring.js'));

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const FROM = +arg('from', 1), COUNT = +arg('count', 50), LEVEL = +arg('level', 2);
const OUT = arg('out', null);
const fs = require('fs');
/* 已經跑過的 seed（接續用）。最後一行可能只寫了一半（跑到一半被中斷）→ 解析失敗就當沒跑過、截掉 */
const done = new Set();
if (OUT && fs.existsSync(OUT)) {
  const good = [];
  fs.readFileSync(OUT, 'utf8').split('\n').forEach(l => {
    if (!l.trim()) return;
    try { const o = JSON.parse(l); done.add(o.seed); good.push(l); } catch (_) {}
  });
  fs.writeFileSync(OUT, good.length ? good.join('\n') + '\n' : '');
}
const emit = line => OUT ? fs.appendFileSync(OUT, line + '\n') : process.stdout.write(line + '\n');

/* 開牌那一刻對座位 0 占卜：包住 game-state 的 startHand（flow 是透過 S.startHand 呼叫的） */
let handStartInfo = null;
const origStart = S.startHand;
S.startHand = function (match, o) {
  const r = origStart.apply(this, arguments);
  const me = match.hand.seats[0];
  const a = FT.analyze(me.hand, me.melds);
  const b = a.hints[0];
  handStartInfo = {
    dealer: match.hand.dealer,
    shanten: a.shanten,
    best: a.best ? { id: a.best.id, away: a.best.away, pts: a.best.pts } : null,
    top: b ? { id: b.id, away: b.away, pts: b.pts, feasible: b.feasible } : null,
    suggest: FT.suggestBet(a),
    seeded: !!(match.hand.seeded && match.hand.seeded[0]),
  };
  return r;
};

/* 座位 0 胡了的話，同一手牌在各種押注、各國之下值多少（只看 handValue 的 total） */
function valuesFor(hand) {
  const out = {};
  ['normal', 'special', 'dragon'].forEach(bet => {
    out[bet] = {};
    [null, 'chu', 'qin'].forEach(k => {
      out[bet][k || 'none'] = SC.handValue(hand, 0, { bet, kingdom: k, conquered: 0 }).total;
    });
  });
  return out;
}

const seatInfo = {};
[0, 1, 2, 3].forEach(i => { seatInfo[i] = { isAI: true, aiLevel: LEVEL, kingdom: null, conquered: 0 }; });
const ctx = Object.assign({
  seatInfo, claimTimeoutMs: 20000, now: 1,
  autoNextHand: true, pauseAfter: ['handEnd'],
  handOptions: { seeding: { boost: [false, false, false, false] } },
}, AI.flowHooks());

for (let seed = FROM; seed < FROM + COUNT; seed++) {
  if (done.has(seed)) continue;
  const m = S.createMatch({ seed, seats: [0, 1, 2, 3].map(i => ({ name: 'P' + i, isAI: true })) });
  const hands = [];
  let r = F.startMatch(m, ctx);
  let guard = 0;
  while (!m.finished && guard++ < 200) {
    const h = m.hand;
    if (h && h.phase === 'over' && h.result && !h._logged) {
      h._logged = true;
      const res = h.result;
      const w0 = (res.winners || []).find(w => w.seat === 0);
      hands.push({
        start: handStartInfo,
        type: res.type,                                   // tsumo / ron / draw
        winners: (res.winners || []).map(w => w.seat),
        dealInSeat: res.from != null ? res.from : null,   // 誰放銃
        net0: res.net ? res.net[0] : 0,
        win0: w0 ? { special: w0.special ? w0.special.name : null, specialPts: w0.special ? w0.special.pts : 0,
                     values: valuesFor(h) } : null,
        anySpecial: (res.winners || []).some(w => w.special),
      });
    }
    r = F.run(m, ctx);
  }
  const st = SC.standings(m);
  const rank0 = st.findIndex(s => s.seat === 0);
  emit(JSON.stringify({ seed, level: LEVEL, rank0, score0: m.seats[0].matchScore,
    scores: m.seats.map(s => s.matchScore), hands }));
}
