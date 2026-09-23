#!/bin/bash
# 跑完所有測試。任何一支失敗就以非零結束。
cd "$(dirname "$0")/.." || exit 1
fail=0
total=0
for f in test/*.test.js; do
  out=$(node "$f" 2>&1)
  line=$(echo "$out" | grep -E '^通過 ' | tail -1)
  n=$(echo "$line" | sed -E 's/通過 ([0-9]+).*/\1/')
  printf '%-28s %s\n' "$(basename "$f")" "$line"
  if ! echo "$out" | grep -q '全部通過'; then
    fail=1
    echo "$out" | grep '✗' | sed 's/^/    /'
  fi
  total=$((total + ${n:-0}))
done
echo "─────────────────────────"
[ $fail -eq 0 ] && echo "共 $total 項，全部通過 ✓" || echo "共 $total 項，有失敗 ✗"
exit $fail
