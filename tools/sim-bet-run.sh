#!/bin/bash
# 押注模擬：平行開 9 支，每支 230 場（共 2070 場，電腦強度 2）。可以接續 —— 中斷了再跑一次就從斷掉的地方補。
# 跑完：node tools/sim-bet-report.js tools/sim-out/l2_*.jsonl
cd "$(dirname "$0")/.." || exit 1
mkdir -p tools/sim-out
for i in 0 1 2 3 4 5 6 7 8; do
  node tools/sim-bet.js --from $((1000 + i*230)) --count 230 --level 2 --out tools/sim-out/l2_$i.jsonl 2> tools/sim-out/l2_$i.err &
done
wait
echo "完成：$(cat tools/sim-out/l2_*.jsonl | wc -l) 場"
