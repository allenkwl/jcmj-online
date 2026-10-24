# 立體麻將牌的牌身（實驗中，遊戲還沒用）

2026-10-24 使用者：「正面的牌也能畫成立體嗎？遊戲畫面全改成立體麻將牌」「直的牌畫得太誇張，看起來後面都分開了」
「牌可以畫厚一點嗎？麻將牌沒那麼薄」「中間三張明顯比較薄」。
用在 `devtools/立體牌/tiles-3d.js`（預覽頁 `devtools/立體牌v0.1.html`）。

**牌身用圖、牌面用程式**：這裡只有空白的牌身，34 種牌面照舊用 `tiles.js` 的 `drawFaceInner` 畫在頂面上。

| 檔案 | 內容 | 用在 |
|---|---|---|
| `stand.png` | 立著、牌面朝自己 | 自己的手牌 |
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

## 後製：厚度與透視統一

Codex 每張估的厚度、透視壓縮都不一樣（使用者：「中間三張明顯比較薄」）。以 `backV` 為準，把另外三張躺著的牌**上下拉**成同一個比例：
- 頂面高＝畫面上下方向那一邊 × 0.594（直的是長邊、橫的是短邊）
- 前緣高（厚度）＝短邊 × 0.42
- 前緣是橫向的色帶（褐、象牙白），只拉上下不會變形

結果（寬一律 240）：直的 240×291（頂面 190＋前緣 101）、橫的 240×183（頂面 107＋前緣 76）。
`tiles-3d.js` 的 `BODY.top`（頂面佔圖高）與 `face`（牌面範圍）是照這組數字寫的，換圖要跟著改。
