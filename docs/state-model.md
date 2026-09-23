# 狀態模型對照表（階段一第 2 步）

把單機兩人版散在全域 `G` 上的欄位，換成 `src/game-state.js` 的四人座位模型。

來源：`~/Documents/DILA/麻將戰國列傳/戰國麻將列傳.html`（2026-09-15，V1.26）

---

## 為什麼不是就地改 `G`

兩人版的 `G` 是一個 5,000 行共用的裸物件，`pH`／`oH` 這種命名本身就寫死了「只有兩家」。
就地改成 `G.seats[4]` 的話，改完那一刻 12 MB 的單檔還是同一個無法測試的整體，
而且線上版還得再把它序列化一次。

所以走的是另一條路：**先在 `src/` 蓋乾淨的模型，舊檔留著當規格書**，
到第 4 步（流程狀態機）才把畫面層接過來。這也是第 1 步抽 `rules-core.js` 的同一個作法。

代價是舊檔的 58 個函式要逐一重寫而不是逐一改欄位名 —— 但那 58 個裡面有一半
（`render*`、`upd*`、`_auto*`）本來就要為四方版面重寫（第 6 步），實際上沒有多花。

---

## 欄位對照

| 兩人版 `G` | 四人版 | 備註 |
|---|---|---|
| `G.pH` | `hand.seats[i].hand` | 玩家固定是座位 0 |
| `G.oH` | `hand.seats[i].hand` | 對手不再是單一個體 |
| `G.pM` / `G.oM` | `hand.seats[i].melds` | |
| `G.pD` / `G.oD` | `hand.seats[i].discards` | **含被鳴走的牌**，畫面用 `visibleDiscards()` |
| `G.pTurn`（布林） | `hand.turn`（座位索引 0–3） | 布林在四人局表達不了 |
| — | `hand.dealer` | 兩人版沒有莊家概念 |
| — | `seatWind(hand, seat)` | 兩人版字牌不參與計分，沒有風位 |
| `G.pile`（陣列，`shift()` 取牌） | `hand.wall` + `hand.drawIdx` | 見下「為什麼改成索引」 |
| — | `hand.deadWallStart` / `rinshanTaken` | 兩人版沒有王牌 |
| `G.phase` | `hand.phase` | 值域改了，見下 |
| `G.lastDisc` | `hand.lastDiscard`＝`{seat, tile, seq}` | 多了 `seat`（誰打的）與 `seq`（對齊宣告視窗） |
| — | `hand.lastKongAdded` | 搶槓用；兩人版加槓直接併成明槓，沒有這個窗口 |
| `G.drawCount` + `MAX_TOTAL_DRAWS=60` | `liveWallCount(hand) === 0` | 流局改用真實牌山，不是摸牌計數 |
| `G.pendInt` | → `claim-arbiter.js`（第 3 步） | 兩人版只有「玩家可不可以鳴」一個待決項 |
| `G.playerK` | `match.seats[i].kingdom` | 四家各有本國 |
| `G.totalScore` | `match.seats[i].matchScore` | 一場四局的累計 |
| `G.conquered` / `G.specialCount` | 留在個人存檔（`localStorage`），不進對局狀態 | 跨場的資料不該每幀同步 |
| `G.sel` / `G.autoPlay` / `G.winShown` | 留在畫面層 | 純 UI 狀態，不進 Firebase |

### `phase` 的值域

| 兩人版 | 四人版 | |
|---|---|---|
| `deal_analysis` | —— | 發牌占卜是畫面層的事 |
| `draw` | `draw` | 該摸牌 |
| `discard` | `discard` | 該打牌 |
| `wait` / `interrupt` | `claim` | 兩人版分「我在等」與「我可以鳴」兩個相：四人局三家同時決定，只剩一個相 |
| `result` | `over` | |

### 為什麼 `G.pile` 改成 `wall` + `drawIdx`

1. `shift()` 會毀掉牌山，事後無法驗證這副牌沒被動手腳。線上版是其中一台發牌，
   留著完整 `wall` 加上 `seed`，對局結束後任何人都能重跑 `makeRNG(seed)` 核對。
2. 王牌（嶺上牌）要從**尾端**拿，陣列 `shift()` 的模型表達不了兩端取牌。
3. 索引是一個數字，Firebase 同步成本遠低於每次都推一整個陣列。

發牌亂數同時從 `Math.random()` 換成可帶種子的 `makeRNG()`（mulberry32），
測試才能重現同一副牌。

---

## 舊檔碰到這些欄位的函式（58 個，311 處）

PLAN.md 原本估「約 45 個函式、250 處」，實測偏低約三成。
統計方式：`G.pH|oH|pM|oM|pD|oD|pTurn|pile|phase|lastDisc|drawCount|pendInt` 的出現處，
歸給前一個 `function` 宣告。

| 函式 | 行號 | 處數 | 第 4 步（流程）的處置 |
|---|---:|---:|---|
| `oppTurn` | 4616 | 32 | 重寫 —— 四家共用一個 `takeTurn(seat)` |
| `initRound`（含巢狀 `takeN`／`takeTiles`） | 2481 | 26 | 已由 `startHand()` 取代；偏置發牌之後接成另一個 strategy |
| `pDraw` | 3800 | 15 | 併進 `takeTurn` |
| `doKong` | 3892 | 14 | 併進 `applyMeld` + 流程 |
| `doDiscard` | 3858 | 13 | 已由 `discardTile()` 取代狀態部分 |
| `checkTenpaiState` | 3991 | 10 | 改吃 `seats[i]` |
| `enableAutoPlay` | 4318 | 10 | 畫面層，第 6 步 |
| `oppDecide` | 4562 | 10 | → `claim-arbiter.js`（第 3 步） |
| `doIKong` / `doIPong` / `doIChiWith` / `doIChi` / `doIWin` | 4936–4977 | 33 | → `claim-arbiter.js`，四家共用一條路徑 |
| `oppKong` / `oppChi` / `oppPong` | 4597–4609 | 23 | 同上，與玩家的路徑合併 |
| `calcWaitChoices` | 4184 | 8 | 改吃 `seats[i]` |
| `_startAutoWatchdog` | 4517 | 8 | 畫面層 |
| `chkInt` / `passInt` | 4857 / 4926 | 9 | → `claim-arbiter.js` |
| `render*`（`PH` `OH` `Melds` `Discs` `Pile`） | 3518–3597 | 21 | 第 6 步四方版面一併重寫 |
| `aiD` / `aiShouldPong` / `aiShouldChi` / `getPlayerWaitingTiles` | 4767–4840 | 11 | 第 5 步參數化並拿掉作弊 |
| `canRon` / `canOppWin` / `chkWinFull` / `chkOppWinFull` / `canWinOnDiscard` / `findNeeded13` | 3686–3749 | 11 | 已由 `rules-core.js` 取代（第 1 步） |
| 其餘 20 個雜項（`updTL` `updateBtns` `doHint` `doSort` `showIPop` …） | — | 47 | 多數是畫面層，隨第 6 步處理 |

完整清單可重跑產生：見本檔末的統計指令。

---

## 兩個硬性約束（寫在 `game-state.js` 開頭，這裡記原因）

### 1. 狀態必須是純 JSON

不可有 `function`／`Set`／`Map`／`undefined`。
Firebase 的 `set()` 碰到 `undefined` 會**整份拒絕**，而 `JSON.stringify` 是**安靜忽略** ——
兩邊行為不一致，症狀（欄位莫名其妙不見了）很難往回推到成因。
寫出去之前一律過 `stripUndefined()`。

`test/game-state.test.js` 有一項會走遍整份狀態，發現非 JSON 的東西就失敗。

### 2. 空陣列存進 Firebase 再讀回來會變成缺欄位

不是變成 `[]`，是**整個欄位不見**。收到的狀態一律先過 `normalize()`，
否則 `seats[i].melds.forEach` 會炸在剛開局、還沒有人副露的時候 ——
也就是每一局的前半段都會炸。

---

## 這一步順手修掉的兩個問題

### 嶺上牌：流局之後還槓得下去

原本的守門條件是 `pos < deadWallStart`。但每開一個槓，`pos`（王牌尾端）與
`deadWallStart`（王牌邊界）**會同步前移**，兩者永遠差 13 —— 那是一行死碼。

實測舊寫法可以連開 **136 個槓**，而且活牌山摸空（流局）之後照樣抽得到嶺上牌。

改成擋兩件事：活牌山空了不能槓（沒有牌可以補進王牌）、四槓為上限。
四槓散了的判定屬於流程層，這裡只保證不超抽。

### 被鳴走的牌不再算振聽

原本 `applyMeld` 會把被碰／吃走的那張從打牌者的 `discards` 裡 `splice` 掉。
畫面上是對的（那張牌現在在別人的副露裡，不該重複畫），但振聽認的是
「這張牌**從我手上打出去過**」—— 真的刪掉，等於送玩家一個漏洞：
打出一張自己的和牌張，只要被別人碰走，振聽就消失了。

改成標記 `claimedBy` 而不刪除。畫面層改用 `visibleDiscards(hand, seat)`，
振聽判定用完整的 `seats[i].discards`。

兩項都有迴歸測試。

---

## 驗證

```bash
cd ~/Documents/DILA/戰國麻將列傳-四人線上版
node test/rules-core.test.js    # 37 項
node test/game-state.test.js    # 92 項
```

`game-state.test.js` 裡最值得留著的是「牌數守恆」那項：
隨機打 200 步，每一步都檢查**場上的牌 + 剩餘牌山 = 136**，且沒有重複的 uid。
副露的實作只要哪裡多扣或少扣一張，它會直接指出是第幾步壞的。

### 重跑函式統計

```bash
cd ~/Documents/DILA/麻將戰國列傳
awk 'length($0)<500' 戰國麻將列傳.html > /tmp/mj_nob64.txt   # 濾掉 base64
python3 - <<'EOF'
import re, io
lines = io.open('/tmp/mj_nob64.txt', encoding='utf-8').read().split('\n')
fields = 'pH oH pM oM pD oD pTurn pile phase lastDisc drawCount pendInt'.split()
fnre = re.compile(r'^\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)')
cur, hits = None, {}
for i, l in enumerate(lines, 1):
    m = fnre.match(l)
    if m: cur = (m.group(1), i)
    for f in fields:
        if cur and re.search(r'G\.' + f + r'\b', l):
            hits.setdefault(cur, {}).setdefault(f, 0)
            hits[cur][f] += 1
for (n, ln), d in sorted(hits.items(), key=lambda kv: -sum(kv[1].values())):
    print(f'{n:<26} L{ln:<6} {sum(d.values()):>3}')
EOF
```

注意巢狀函式會被歸給外層 —— `takeN`／`takeTiles` 實際上在 `initRound`（L2481）裡面。
