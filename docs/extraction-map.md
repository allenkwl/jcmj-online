# 規則核心抽取對照表

`src/rules-core.js` 由 `tools/build-rules-core.py` 從單機兩人版自動產生。
**不要手改 `src/rules-core.js`**，要改請改產生器。

來源：`~/Documents/DILA/麻將戰國列傳/戰國麻將列傳.html`（2026-09-15，V1.26）

## 原封不動抽出的區塊

| 內容 | 來源行號 | 說明 |
|---|---|---|
| `SPECIAL_HANDS` | 2223–2355 | 10 種特殊牌型，資料驅動、玩家無關 |
| `sortTileKeys` | 3684–3697 | 牌面排序（萬→筒→條→字） |
| `isGuoshi` | 3699–3708 | 國士無雙 |
| `_meldStats` | 3714–3721 | 副露佔用張數與槓補摸數 |
| `canWinInHand` / `canWinOnDiscard` | 3723–3746 | 自摸／榮和的核心判定 |
| `canFPair` / `canFNS` / `canWin14` | 3755–3785 | 面子拆解遞迴 |
| `findChi` / `findAllChi` | 3786–3801 | 吃牌組合 |
| `checkSpecialHand` | 3833–3838 | 依序比對 SPECIAL_HANDS |
| `_shantenBest` ~ `shantenNum` | 4744–4798 | 向聽數（標準／七對／國士） |

產生器會逐塊檢查花括號平衡，來源檔行號若變動會直接報錯而不是產出壞檔。

## 抽出時有修改的

| 函式 | 原始 | 改成 | 原因 |
|---|---|---|---|
| `isTenpaiHand` | 4006–4042 | 移除 `console.log` 除錯 | 語意不變，函式庫不該印東西 |
| `calcScore` | 3841–3849 | 多一個 `kingdomId` 參數 | 原版直接讀 `G.playerK?.id` |
| `winningTiles` | 原 `findNeeded13` 3802–3832 | 多一個 `melds` 參數；六對子改取聯集 | 原版直接讀 `G.pM`；且有 bug（見下） |

## 新增（原版沒有的）

| 函式 | 用途 |
|---|---|
| `winningTiles(hand, melds)` | 列舉所有和牌張，振聽判定的基礎 |
| `isFuriten(hand, melds, ownDiscards, opts)` | **振聽規則**，原版完全沒有 |
| `canRonWith(hand, melds, tile, ownDiscards, opts)` | 含振聽的榮和判定 |
| `canChiSeat(discarderSeat, mySeat, seatCount)` | 四人版限制只有下家能吃 |
| `ALL_TILES` | 34 種牌面常數 |

---

## 🐛 順手找到的原版 bug（線上版仍存在）

### 六對子手牌的聽牌提示會少報

`findNeeded13()` 在手牌剛好有**六個對子**時，會 early-return 只回報七對子的聽張，
跳過標準型的聽張：

```js
if(pairs===6){
  const qiduiWaits = all.filter(td => (C13[td]||0)===1);
  if(qiduiWaits.length>0) return qiduiWaits;   // ← 這裡就回去了
}
```

**重現**：手牌 `1萬1萬 2萬2萬 3萬3萬 4萬4萬 5萬5萬 6萬 9萬9萬`
- 原版報：`6萬`
- 正確答案：`3萬`、`6萬`
  （摸 3萬 → `123萬 + 123萬 + 345萬 + 456萬 + 99萬`，是完整和牌）

**影響範圍**（三處，全部是顯示用）：
- `analyzeHand()` 3451 —— 發牌占卜的分析文字
- `doHint()` 3993 —— 「提示：摸到 ○○ 可胡牌」
- 提示音效的 patch 6742

**嚴重度：低。** 實際的胡牌判定走 `canWinInHand` / `canWinOnDiscard` / `canWin14`，
那條路徑是正確的，所以玩家該胡的牌還是胡得到，只是提示功能少報。

**目前不修**：線上版有玩家在玩，本專案開發期間不部署。
新版的 `winningTiles()` 已取聯集修正，並在 `test/rules-core.test.js` 有回歸測試。

**驗證方法**：`python3 tools/diff-test.py && node /tmp/diff2.js`
（把原版函式抽進沙箱，對 7,463 組構造出來的聽牌手牌逐一比對，找到 5 組差異，全是這個 bug）
