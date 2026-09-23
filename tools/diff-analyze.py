#!/usr/bin/env python3
"""把舊版的 `analyzeHand`（發牌占卜的潛力提示）抽進沙箱，測它有沒有錯。

    python3 tools/diff-analyze.py && node /tmp/mj-analyze-test.js

── 為什麼不能直接跟 checkSpecialHand 比 ──
兩者判的不是同一件事：
  ‧ `checkSpecialHand(hand, melds)` —— 這手**已經成型**的 14 張是不是特殊牌型
  ‧ `analyzeHand(hand)`           —— 這手 **13 張**看起來可能做成什麼
後者是啟發式提示，沒有標準答案可以對等比較。

── 那要測什麼 ──
1. **漏報**：把真正的特殊牌型拆掉一張變成 13 張（也就是差一張就成），
   提示應該要講中那個牌型。講不出來就是漏報。
2. **誤報**：提示了一個從這 13 張**不可能**做成的牌型。
3. **優先序**：提示的優先序與 `SPECIAL_HANDS` 的分數順序是否一致
   （SPECIAL_HANDS 的順序攸關計分 —— 高分的要排前面，排錯玩家會少拿分）。
"""
import io, os, re, sys

SRC = os.path.expanduser('~/Documents/DILA/麻將戰國列傳/戰國麻將列傳.html')
OUT = '/tmp/mj-analyze-test.js'
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def grab(lines, start_1based):
    s = start_1based - 1
    depth = 0; started = False
    for i in range(s, len(lines)):
        for ch in lines[i]:
            if ch == '{': depth += 1; started = True
            elif ch == '}': depth -= 1
        if started and depth == 0:
            return '\n'.join(lines[s:i + 1])
    return None


def main():
    if not os.path.exists(SRC):
        print(f'找不到來源：{SRC}', file=sys.stderr); return 1
    lines = []
    with io.open(SRC, encoding='utf-8') as f:
        for line in f:
            lines.append('' if len(line) > 4000 else line.rstrip('\n'))

    start = next((i + 1 for i, l in enumerate(lines)
                  if re.match(r'^\s*function\s+analyzeHand\s*\(', l)), None)
    if start is None:
        print('找不到 analyzeHand', file=sys.stderr); return 1
    body = grab(lines, start)
    if body is None or 'base64' in body:
        print('抽取範圍不對', file=sys.stderr); return 1

    js = f'''/* 由 tools/diff-analyze.py 產生的沙箱，不要手改。
   舊版 analyzeHand 原封不動搬進來（來源 L{start}），
   只把它唯一的外部依賴 findNeeded13 換成 rules-core 的 winningTiles
   —— 那支舊的有六對子 bug（見 docs/extraction-map.md），
   用它會讓測試結果混進另一個已知問題。 */
const R = require('{ROOT}/src/rules-core.js');
function findNeeded13(hand) {{ return R.winningTiles(hand, []); }}

{body}

/* ── 測試工具 ───────────────────────────────────────────── */
let _uid = 0;
function T(str) {{
  return str.trim().split(/\\s+/).map(d => {{
    const m = d.match(/^(\\d+)(.+)$/);
    return m ? {{ suit: m[2], num: +m[1], display: d, isHonor: false, uid: _uid++ }}
             : {{ suit: d, num: 0, display: d, isHonor: true, uid: _uid++ }};
  }});
}}
/* analyzeHand 回傳 {{text, specialHint, ...}}；我們只看 specialHint */
function hintOf(tiles) {{
  try {{ return (analyzeHand(tiles) || {{}}).specialHint || null; }}
  catch (e) {{ return '(爆炸: ' + e.message + ')'; }}
}}

let pass = 0, fail = 0; const fails = [];
function ok(c, name, detail) {{ if (c) pass++; else {{ fail++; fails.push(name + (detail ? '　→ ' + detail : '')); }} }}

/* 每個特殊牌型：一副**真的**成立的 14 張 */
const SAMPLES = {{
  '大四喜':   '東 東 東 南 南 南 西 西 西 北 北 北 白 白',
  '字一色':   '東 東 東 南 南 南 西 西 西 中 中 發 發',
  '綠一色':   '2條 2條 2條 3條 3條 3條 4條 4條 4條 6條 6條 發 發',
  '國士無雙': '1萬 9萬 1筒 9筒 1條 9條 東 南 西 北 中 發 白 白',
  '小三元':   '中 中 中 發 發 發 白 白 1萬 2萬 3萬 5筒 6筒 7筒',
  // ⚠️ 不能用 1112345678999+X —— 那是九連寶燈不是清一色（第一版樣本就寫錯）
  '清一色':   '1萬 2萬 3萬 4萬 5萬 6萬 7萬 8萬 9萬 2萬 3萬 4萬 5萬 5萬',
  '七對子':   '1萬 1萬 3萬 3萬 5筒 5筒 7筒 7筒 2條 2條 東 東 白 白',
  '對對胡':   '1萬 1萬 1萬 5筒 5筒 5筒 9條 9條 9條 東 東 東 白 白',
  '混一色':   '1萬 1萬 1萬 2萬 3萬 4萬 5萬 6萬 7萬 東 東 東 白 白',
}};

console.log('═══ 這些樣本本身是不是真的成立 ═══');
for (const [name, s] of Object.entries(SAMPLES)) {{
  const t = T(s);
  const got = R.checkSpecialHand(t, []);
  ok(got && got.name === name, `樣本【${{name}}】確實成立`,
     got ? '被判成 ' + got.name : 'checkSpecialHand 判定不成立');
}}

console.log('\\n═══ 漏報：差一張就成，提示講不講得出來 ═══');
for (const [name, s] of Object.entries(SAMPLES)) {{
  const full = T(s);
  // 拆掉最後一張 → 13 張，差一張就成
  const thirteen = full.slice(0, 13);
  const hint = hintOf(thirteen);
  ok(hint === name, `差一張的【${{name}}】提示得出來`, '提示：' + (hint || '（沒有提示）'));
}}

console.log('\\n═══ 誤報：普通的手牌會不會亂喊 ═══');
const PLAIN = [
  '1萬 4萬 7萬 2筒 5筒 8筒 3條 6條 9條 東 南 西 北',
  '2萬 3萬 5萬 6萬 8萬 2筒 4筒 7筒 1條 5條 9條 南 白',
];
PLAIN.forEach((s, i) => {{
  const h = hintOf(T(s));
  ok(h === null, `雜牌 ${{i + 1}} 不亂喊牌型`, '提示：' + h);
}});

console.log('\\n═══ 優先序：與 SPECIAL_HANDS 的分數順序一致嗎 ═══');
const ORDER = R.SPECIAL_HANDS.map(h => h.name);
console.log('  SPECIAL_HANDS 的順序：' + ORDER.join(' > '));
/* 構一手同時像「字一色」與「大四喜」的 13 張 —— 大四喜分數高，該先講大四喜 */
{{
  const h = T('東 東 東 南 南 南 西 西 西 北 北 中 中');
  const hint = hintOf(h);
  ok(hint === '大四喜', '同時像字一色與大四喜時，先講分數高的大四喜', '提示：' + hint);
}}
/* 同時像小三元與對對胡 —— 小三元 32 分 > 對對胡 22 分 */
{{
  const h = T('中 中 中 發 發 發 白 白 1萬 1萬 1萬 5筒 5筒');
  const hint = hintOf(h);
  ok(hint === '小三元', '同時像小三元與對對胡時，先講小三元', '提示：' + hint);
}}
/* 同時像七對子與對對胡 —— 七對子 24 > 對對胡 22 */
{{
  const h = T('1萬 1萬 3萬 3萬 5筒 5筒 7筒 7筒 2條 2條 東 東 白');
  const hint = hintOf(h);
  ok(hint === '七對子', '四對以上時先講七對子（24 分）而不是對對胡（22 分）', '提示：' + hint);
}}

console.log('\\n═══ 誤報率：一萬副隨機起手的提示分布 ═══');
{{
  /* 提示太鬆的話，幾乎每副牌都會喊某個牌型，那個提示就沒有資訊量了。
     用真正的牌山發牌（每種四張），不是隨便抽字串。 */
  const S = require('{ROOT}/src/game-state.js');
  const dist = {{}}; let withHint = 0;
  const N = 10000;
  for (let i = 0; i < N; i++) {{
    const m = S.createMatch({{ seed: i + 1 }});
    S.startHand(m);
    const h = hintOf(m.hand.seats[0].hand);
    if (h) {{ withHint++; dist[h] = (dist[h] || 0) + 1; }}
  }}
  const pct = n => (n * 100 / N).toFixed(2) + '%';
  console.log(`  ${{N}} 副隨機起手，有提示的 ${{withHint}} 副（${{pct(withHint)}}）`);
  Object.entries(dist).sort((a, b) => b[1] - a[1])
    .forEach(([k, v]) => console.log(`    ${{k.padEnd(10)}} ${{String(v).padStart(5)}}　${{pct(v)}}`));

  // 起手就喊高分牌型應該非常罕見 —— 喊太多代表門檻太鬆
  const rare = ['大四喜', '字一色', '綠一色', '九連寶燈'];
  rare.forEach(k => ok((dist[k] || 0) / N < 0.005,
    `【${{k}}】不會在起手就亂喊（<0.5%）`, pct(dist[k] || 0)));
  ok(withHint / N < 0.9, '不是每副牌都有提示', pct(withHint));
}}

console.log('\\n═══ 🐛 九連寶燈的誤判 ═══');
{{
  /* 舊版的判定是：主花色 >=11 張、且「至少一張 1 和一張 9」就喊九連寶燈。
     但九連寶燈是 1112345678999 —— **三張 1、三張 9**。
     只有一張 1、一張 9 的清一色離九連還很遠，卻會被喊成九連。 */
  const S = require('{ROOT}/src/game-state.js');
  let fired = 0, reallyClose = 0, over = 0;
  const examples = [];
  for (let seed = 1; seed <= 4000; seed++) {{
    // 手工湊清一色的 13 張（同花色隨機 13 張，每種最多 4 張）
    const rng = S.makeRNG(seed);
    const pool = [];
    for (let n = 1; n <= 9; n++) for (let c = 0; c < 4; c++) pool.push(n);
    S.shuffleWith(rng, pool);
    const nums = pool.slice(0, 13).sort((a, b) => a - b);
    const tiles = T(nums.map(n => n + '萬').join(' '));
    const hint = hintOf(tiles);
    if (hint !== '九連寶燈') continue;
    fired++;
    const c1 = nums.filter(n => n === 1).length;
    const c9 = nums.filter(n => n === 9).length;
    const covers = [1,2,3,4,5,6,7,8,9].every(n => nums.includes(n));
    // 真的接近九連：至少兩張 1、兩張 9，而且 1~9 都有
    if (c1 >= 2 && c9 >= 2 && covers) reallyClose++;
    else {{ over++; if (examples.length < 3) examples.push(`${{nums.join('')}}（1×${{c1}} 9×${{c9}}）`); }}
  }}
  console.log(`  喊九連寶燈 ${{fired}} 次，其中真的接近的只有 ${{reallyClose}} 次`);
  console.log(`  誤判 ${{over}} 次（${{(over * 100 / Math.max(1, fired)).toFixed(1)}}%）`);
  examples.forEach(e => console.log('    例：' + e));
  ok(over === 0, '九連寶燈的提示沒有誤判',
     `${{over}}/${{fired}} 次誤判 —— 判定只看「有沒有 1 和 9」，但九連需要三張 1 三張 9`);
}}

console.log('\\n─────────────────────────');
console.log(`通過 ${{pass}}　失敗 ${{fail}}`);
if (fail) {{ fails.forEach(f => console.log('  ✗ ' + f)); }}
'''
    io.open(OUT, 'w', encoding='utf-8').write(js)
    print(f'產生沙箱 {OUT}（analyzeHand 來源 L{start}）')
    print('接著跑： node ' + OUT)
    return 0


if __name__ == '__main__':
    sys.exit(main())
