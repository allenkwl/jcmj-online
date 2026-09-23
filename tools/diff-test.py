#!/usr/bin/env python3
"""把原始檔的 findNeeded13 及其相依函式抽進沙箱，與新模組的 winningTiles 對照"""
import os
SRC = os.path.expanduser('~/Documents/DILA/麻將戰國列傳/戰國麻將列傳.html')
lines = open(SRC, encoding='utf-8').read().split('\n')
g = lambda a, b: '\n'.join(lines[a-1:b])

harness = f'''
// ── 原始檔的相依函式（原封不動）──
const SUITS=['萬','筒','條'];
const HONORS=['東','南','西','北','中','發','白'];
let G = {{ pM: [] }};                       // 原版讀的全域

{g(3684,3697)}
{g(3699,3708)}
{g(3755,3785)}
{g(3802,3832)}                              // findNeeded13（原版）

module.exports = {{ findNeeded13, setMelds: m => {{ G.pM = m; }} }};
'''
open('/tmp/orig-harness.js','w',encoding='utf-8').write(harness)
print('沙箱已產生 /tmp/orig-harness.js')
