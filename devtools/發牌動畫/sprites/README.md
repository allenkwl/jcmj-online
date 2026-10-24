# 發牌動畫・立體版的圖（實驗中，遊戲還沒用）

2026-10-24 使用者：「發牌動畫的牌畫得有點醜，能畫成立體的嗎？可以讓 codex or Gemini 或是 Comfy 畫」
「參考一下小球貓電鐵的骰子，畫得好看得多」「先改發牌測試程式，不要接進遊戲」。

用在 `devtools/發牌動畫/deal-anim-3d.js`（實驗台 `devtools/發牌動畫v0.3.html` 選「立體版」）。

| 檔案 | 內容 |
|---|---|
| `tileV-1.png` | 躺著、牌背朝上的牌，長邊直放（上下兩道牌牆、飛向自己與對家的牌） |
| `tileH-1.png` | 同上，長邊橫放（左右兩道牌牆、飛向上家與下家的牌） |
| `tileV-2.png`／`tileH-2.png` | 兩張疊好的一墩（目前沒用，程式自己疊兩張單張） |
| `die1`～`die6.png` | 骰子，第 N 張＝N 點朝上；一點、四點紅（中國骰子） |
| `原圖/` | Codex 生的整張圖（透明背景），要重新切再用 |

## 怎麼生的

Codex CLI（ChatGPT.app 內建，`/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex`），
參考圖一律用小球貓電鐵的 `圖片/骰子/骰子六面圖v0.3.png`（鎖住寫實渲染的質感與光線）：

```
codex exec --skip-git-repo-check -C . -s read-only -i dice-ref.png -o out.txt "<描述>" < /dev/null
```

- 骰子：Make a sprite sheet of six Chinese mahjong dice, in EXACTLY the same photorealistic 3D render style, camera angle, lighting and ivory-white material as the reference image: a 3-column x 2-row grid, top row shows faces 1,2,3 on top, bottom row faces 4,5,6 on top … the ONE pip AND all FOUR pips are red … TRANSPARENT background.
- 牌（長邊直放）：Photorealistic 3D render … Japanese mahjong tiles lying FACE-DOWN on a table, seen from the front and above (camera about 35 degrees above the table …), long side going AWAY from the camera. Two layers like real tiles: the bottom (face) layer is ivory white bone, the top (back) layer is deep glossy chocolate brown … top row = 3 single tiles; bottom row = 3 stacks of two … TRANSPARENT background.
- 牌（長邊橫放）：同上，改成 lying SIDEWAYS: its long side runs LEFT-RIGHT。

配色照遊戲現有的牌：象牙白牌身、深褐色牌背。

## 怎麼切的

整張圖照 3×2 格切，每格取不透明（alpha > 40）的範圍、外圍低 alpha 的雜點清掉，縮到牌寬 120／150、骰子寬 160。
單張牌那一格的底下會帶到下一列那一墩的頂端 —— 只取最上面一段連續的不透明列。
`deal-anim-3d.js` 的 `ASPECT`（寬高比）與 `EDGE`（厚度佔圖高 36%）是照切出來的圖量的，換圖要跟著改。
