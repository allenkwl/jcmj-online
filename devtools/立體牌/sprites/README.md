# 立體麻將牌的牌身（實驗中，遊戲還沒用）

2026-10-24 使用者：「正面的牌也能畫成立體嗎？遊戲畫面全改成立體麻將牌」「直的牌畫得太誇張，看起來後面都分開了」
「牌可以畫厚一點嗎？麻將牌沒那麼薄」「中間三張明顯比較薄」。
用在 `devtools/立體牌/tiles-3d.js`（預覽頁 `devtools/立體牌v0.1.html`）。

**牌身用圖、牌面用程式**：這裡只有空白的牌身，34 種牌面照舊用 `tiles.js` 的 `drawFaceInner` 畫在頂面上。

| 檔案 | 內容 | 用在 |
|---|---|---|
| `stand.png` | 立著、牌面朝自己 | **沒有用**：自己的手牌維持平面（使用者：「玩家手牌改立體會變小，玩家的手牌不要改吧」） |
| `faceV.png` | 躺著、牌面朝上、長邊朝遠方 | 牌河、副露、祥瑞指示牌（自己與對家） |
| `faceH.png` | 同上、長邊左右 | 左右兩家的牌河、副露 |
| `backV.png` | 躺著、牌背朝上、長邊朝遠方 | 對家的手牌、暗槓 |
| `backH.png` | 同上、長邊左右 | 左右兩家的手牌 |
| `原圖/` | Codex 生的原圖（透明背景） | |

## 怎麼生的

Codex CLI（`/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex`），每張附上一版的圖當參考鎖住材質與顏色。重點描述：

- **正投影**：*ORTHOGRAPHIC projection (no perspective at all): left and right edges perfectly parallel and vertical, the tile does NOT get narrower toward the back*
  —— 第一版是透視（近寬遠窄），一排擺起來後面一張張分開（使用者：「直的牌畫得太誇張，看起來後面都分開了」）
- **真牌的厚度**：*REAL CHUNKY PROPORTIONS: 26 mm wide, 35 mm long, 20 mm THICK … two bonded layers: ivory (2/3) and chocolate-brown back (1/3)*
- 躺著的：*camera about 60 degrees above the table … the visible FRONT SIDE takes about one quarter of the image height*
- 立著的：*STANDS UPRIGHT … BLANK ivory face facing the camera; camera about 25 degrees above … TOP SIDE clearly visible*
- 一律：*ONE single tile, centered … No engravings, no symbols, no text … TRANSPARENT background*

## 現在這一版：Codex 照修好的參考圖重畫，不做後製

前幾版的問題與經過（都是使用者看出來的）：
1. 透視（近寬遠窄）→ 一排擺起來後面一張張分開 → 描述加「正投影」
2. 太薄 → 描述加真牌尺寸（26×35×20 mm）
3. 五張厚度不一、褐白比例不對（「中間三張明顯比較薄」「要 50% 比 50%」）→ 曾用程式上下拉色帶、逐行放寬去掉前大後小
4. 程式逐行放寬留下一階一階的高光紋，並排像有縫 → 使用者：「叫 codex 重畫」

最後：把程式修好的那五張（外形、厚度、比例都對了）當**參考圖**，請 Codex 照同樣的輪廓重新渲染一張乾淨的，描述再寫死三條：
正投影（遠端跟近端一樣寬、並排從頭到尾貼緊）、側面褐白各 50%、真牌厚度。
量過（`寬度` 每一列都一樣；側面沿中線量亮度）—— 全部合格，直接用、不做後製：

| | 寬×高 | 頂面 | 側面（褐：白） |
|---|---|---|---|
| backV | 240×292 | 0–191 | 47 : 52 |
| backH | 240×179 | 0–107 | 32 : 38 |
| faceV | 240×301 | 0–205 | 49 : 46（象牙白那條跟頂面同色，看頂面邊緣那條高光分界） |
| faceH | 240×172 | 0–103 | 35 : 33 |
| stand | 240×370 | 牌面從第 80 列 | 頂上 38 : 38 |

`tiles-3d.js` 的 `BODY.top`（頂面佔圖高）與 `face`（牌面範圍）照這張表寫，換圖要重量。

## 拉直（2026-10-24 之後一版）

使用者看上一版「前小後大、怪怪的」。量過外框與頂面邊線都沒有斜（正投影本身會讓人覺得後面比較大），
但前緣下方的圓角比頂面後端大很多，前端看起來縮進去。使用者：「叫 codex 拉直就好」。
描述加：*perfectly STRAIGHT rectangular block … near end and far end EXACTLY the same width … SAME SMALL corner radius on all four
corners … do NOT round the bottom corners of the side bands more than the top corners*。
四張躺著的重畫（立著那張不變）。四個角一樣圓、每一列一樣寬。
牌背兩張的側面又偏白（約 39:61）→ 側面褐、白兩條**整條**上下調成一半（等比縮放色帶，外形、角不動）：直的 45:48、橫的 32:34。
牌面兩張本來就對（直的 44:47、橫的 30:32）。`tiles-3d.js` 的 `BODY` 照新圖：top 直 0.70、橫 0.59～0.61。

