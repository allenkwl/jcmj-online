#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════
   sim-bet-report.js — 讀 sim-bet.js 的紀錄，比較各種押注規則與國庫設定
   ───────────────────────────────────────────────────────────────
     node tools/sim-bet-report.js 紀錄1.jsonl 紀錄2.jsonl …

   同一批牌局拿來套每一種規則 —— 規則之間的差異就只剩規則本身，不是運氣。
   單位：遊戲裡的點數（之後改叫「兩黃金」，數字一樣：基本胡牌 80）。
   ═══════════════════════════════════════════════════════════════ */
'use strict';
const fs = require('fs');
const files = process.argv.slice(2);
const matches = [];
files.forEach(f => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).forEach(l => matches.push(JSON.parse(l))));
const hands = [];
matches.forEach(m => m.hands.forEach(h => { if (h.start) hands.push(h); }));

const pct = (a, b) => b ? (100 * a / b).toFixed(1) + '%' : '—';
const fmt = n => (n >= 0 ? '+' : '') + n.toFixed(1);
const line = s => console.log(s);

line(`═══ 樣本：${matches.length} 場、${hands.length} 局（電腦強度 ${[...new Set(matches.map(m => m.level))].join('/')}）═══\n`);

/* ── 一、基本機率 ── */
const win = hands.filter(h => h.win0);
const winSp = win.filter(h => h.win0.special);
line('一、座位 0（代表「你」）每一局');
line(`  胡牌 ${pct(win.length, hands.length)}　其中做成特殊牌型 ${pct(winSp.length, hands.length)}（佔胡牌的 ${pct(winSp.length, win.length)}）`);
line(`  流局 ${pct(hands.filter(h => h.type === 'draw').length, hands.length)}　放銃 ${pct(hands.filter(h => h.dealInSeat === 0).length, hands.length)}`);
line(`  起手被偏置發牌配到牌型 ${pct(hands.filter(h => h.start.seeded).length, hands.length)}`);
const spCount = {};
winSp.forEach(h => { spCount[h.win0.special] = (spCount[h.win0.special] || 0) + 1; });
line('  做成的特殊牌型：' + Object.entries(spCount).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join('、'));

/* ── 二、占卜說「還差幾張」→ 真的做成特殊牌型胡牌的機率 ── */
line('\n二、占卜的第一個提示「還差 N 張」→ 這一局真的做成特殊牌型胡牌');
line('  還差　局數　　佔比　　胡牌　　做成特殊牌型胡牌');
const byAway = {};
hands.forEach(h => { const a = h.start.top ? h.start.top.away : 99; (byAway[a] = byAway[a] || []).push(h); });
Object.keys(byAway).map(Number).sort((a, b) => a - b).forEach(a => {
  const g = byAway[a];
  line(`  ${a === 99 ? '無' : String(a).padStart(2)}　　${String(g.length).padStart(5)}　${pct(g.length, hands.length).padStart(6)}　${pct(g.filter(h => h.win0).length, g.length).padStart(6)}　${pct(g.filter(h => h.win0 && h.win0.special).length, g.length).padStart(6)}`);
});
const sug = {};
hands.forEach(h => { (sug[h.start.suggest] = sug[h.start.suggest] || []).push(h); });
line('  占卜建議的注　→ 做成特殊牌型胡牌');
Object.entries(sug).forEach(([k, g]) => line(`    ${k.padEnd(8)} ${String(g.length).padStart(5)} 局　${pct(g.filter(h => h.win0 && h.win0.special).length, g.length)}`));

/* ── 三、押注規則 × 押注策略 → 每一局的期望值（相對於永遠押普通） ──
   規則：
     現行　　倍率乘在任何胡牌上，沒有押金
     新制　　先付押金；做成特殊牌型胡牌 → 得分 ×倍率、押金退回；
             其他情況押金進彩池，這一局胡牌的人拿走（自己胡了就是拿回自己的）。
             流局時彩池留到下一局 —— 這裡近似成「押金沒了」（下一局有 1/4 機會拿回，略偏保守）
*/
function delta(h, bet, rule, kingdom) {
  if (bet === 'normal') return 0;
  const w = h.win0;
  const gain = w ? (w.values[bet][kingdom] - w.values.normal[kingdom]) : 0;
  if (rule.kind === 'current') return gain;
  const stake = rule.stake[bet];
  if (w && w.special) return gain * (rule.mult ? rule.mult[bet] : 1);   // 做成了：倍率生效、押金退回
  if (w) return 0;                                                       // 胡了但不是特殊牌型：彩池（含自己的押金）自己拿回
  return -stake;
}
const POLICIES = {
  '永遠押普通':        h => 'normal',
  '永遠押特殊牌型':    h => 'special',
  '永遠孤注一擲':      h => 'dragon',
  '照占卜建議':        h => h.start.suggest,
  '差≤2 押特殊':       h => (h.start.top && h.start.top.feasible && h.start.top.away <= 2) ? 'special' : 'normal',
  '差≤1 孤注一擲':     h => (h.start.top && h.start.top.feasible && h.start.top.away <= 1) ? 'dragon' : 'normal',
};
function evOf(rule, policy, kingdom) {
  let s = 0, bets = 0;
  hands.forEach(h => { const b = policy(h); if (b !== 'normal') bets++; s += delta(h, b, rule, kingdom); });
  return { ev: s / hands.length, betRate: bets / hands.length };
}
function table(title, rules, kingdom) {
  line(`\n${title}`);
  line('  ' + '策略'.padEnd(14) + rules.map(r => r.name.padStart(16)).join(''));
  Object.entries(POLICIES).forEach(([name, p]) => {
    const cells = rules.map(r => { const e = evOf(r, p, kingdom); return (fmt(e.ev) + ` (${(e.betRate * 100).toFixed(0)}%押)`).padStart(16); });
    line('  ' + name.padEnd(14) + cells.join(''));
  });
}
const RULES = [{ name: '現行', kind: 'current' }];
[[40, 80], [80, 160], [120, 240], [160, 320]].forEach(([a, b]) =>
  RULES.push({ name: `新制 押金${a}/${b}`, kind: 'new', stake: { special: a, dragon: b } }));
line('\n三、每一局的期望值（兩，跟「永遠押普通」比）　括號＝有押注的局佔幾成');
table('  無國家加成', RULES, 'none');
table('  楚（胡牌 ×1.3）', RULES, 'chu');
table('  秦（特殊牌型 ×1.5）', RULES, 'qin');

/* ── 四、國庫：一場的輸贏有多大、一段征途下來會不會見底 ── */
const sc = matches.map(m => m.score0).sort((a, b) => a - b);
const q = p => sc[Math.min(sc.length - 1, Math.floor(p * sc.length))];
const mean = sc.reduce((a, b) => a + b, 0) / sc.length;
line(`\n四、一場（四局）座位 0 的輸贏：平均 ${fmt(mean)}　中位 ${q(.5)}　5% ${q(.05)}　25% ${q(.25)}　75% ${q(.75)}　95% ${q(.95)}　最差 ${sc[0]}　最好 ${sc[sc.length - 1]}`);
const ranks = [0, 0, 0, 0]; matches.forEach(m => ranks[m.rank0]++);
line(`  名次分布：${ranks.map((n, i) => `第${i + 1} ${pct(n, matches.length)}`).join('　')}`);

/* 一段征途：從模擬的場次裡隨機抽（有放回），前三名征服一國，征服 6 國統一。
   國庫 = 本錢 + 每場輸贏 + 每征服一國的戰利品。不押注（押注的影響看第三節，每局幾兩的量級）。 */
function campaign(start, spoils, trials) {
  let everNeg = 0, finalNeg = 0, lens = 0;
  const finals = [];
  for (let t = 0; t < trials; t++) {
    let g = start, land = 0, n = 0, neg = false;
    while (land < 6 && n < 200) {
      const m = matches[Math.floor(Math.random() * matches.length)];
      n++; g += m.score0;
      if (m.rank0 <= 2) { land++; g += spoils; }
      if (g < 0) neg = true;
    }
    lens += n; if (neg) everNeg++; if (g < 0) finalNeg++; finals.push(g);
  }
  finals.sort((a, b) => a - b);
  const f = p => finals[Math.floor(p * finals.length)];
  return { avgLen: lens / trials, everNeg: everNeg / trials, finalNeg: finalNeg / trials, p10: f(.1), p50: f(.5), p90: f(.9) };
}
line('\n  一段征途（征服 6 國，實力跟電腦相當）：國庫會不會跌破 0');
line('  本錢　戰利品　平均幾場　途中曾經 <0　統一時 <0　統一時國庫（10% / 中位 / 90%）');
[0, 500, 1000, 2000].forEach(st => [0, 300, 500].forEach(sp => {
  const r = campaign(st, sp, 20000);
  line(`  ${String(st).padStart(4)}　${String(sp).padStart(5)}　　${r.avgLen.toFixed(1).padStart(5)}　　${pct(r.everNeg, 1).padStart(6)}　　${pct(r.finalNeg, 1).padStart(6)}　　${r.p10} / ${r.p50} / ${r.p90}`);
}));
