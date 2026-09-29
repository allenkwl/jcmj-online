#!/bin/bash
# 對著本機的 Firebase 模擬器驗安全規則。
#
#   bash tools/run-rules-test.sh              ← 驗 database.rules.next.json（還沒部署的那份）
#   bash tools/run-rules-test.sh live         ← 驗 database.rules.json（線上現在跑的那份）
#
# ⚠️ 規則寫錯的後果是**線上玩家寫不進去、當場卡死**，所以規則改完一定要先在這裡跑過。
#    模擬器完全在本機，不會碰到線上資料庫。
#
# 需要：Java（brew install openjdk）、firebase CLI。第一次跑會自動下載模擬器的 jar。
set -e
cd "$(dirname "$0")/.."
ROOT=$(pwd)
SRC="database.rules.next.json"
[ "$1" = "live" ] && SRC="database.rules.json"
[ -f "$SRC" ] || { echo "找不到 $SRC"; exit 1; }

export PATH="/opt/homebrew/opt/openjdk/bin:$PATH"
command -v java >/dev/null || { echo "沒有 Java —— brew install openjdk"; exit 1; }

cd tools/rules-test
cp "$ROOT/$SRC" database.rules.json
[ -d node_modules ] || npm install --silent @firebase/rules-unit-testing firebase
echo "用的規則：$SRC"
firebase emulators:exec --only database --project jcmj-4p "node rules.test.mjs"
