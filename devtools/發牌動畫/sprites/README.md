# 發牌動畫・立體版的圖（實驗中，遊戲還沒用）

2026-10-24 使用者：「發牌動畫的牌畫得有點醜，能畫成立體的嗎？可以讓 codex or Gemini 或是 Comfy 畫」
「參考一下小球貓電鐵的骰子，畫得好看得多」「先改發牌測試程式，不要接進遊戲」。

用在 `devtools/發牌動畫/deal-anim-3d.js`（實驗台 `devtools/發牌動畫v0.3.html` 選「立體版」）。

**只有兩種牌**（2026-10-24 使用者：「全部應該只畫兩種麻將牌，直的和橫的，牌和牌相連自然只看到背面，兩層疊在一起也一樣」）。
疊兩層、一整排都是同一張圖，由程式排：一排緊貼、下面那張蓋住上面那張的前緣、上層墊一個牌的厚度。

| 檔案 | 內容 |
|---|---|
| `tileV.png` | 直的：躺著、牌背朝上，長邊朝遠方（上下兩道牌牆、飛向自己與對家的牌） |
| `tileH.png` | 橫的：同上，長邊左右（左右兩道牌牆、飛向上家與下家的牌） |
| `die1`～`die6.png` | 骰子，第 N 張＝N 點朝上；一點、四點紅（中國骰子） |
| `原圖/` | Codex 生的整張圖（透明背景，3×2；只用左上那一張） |

量到的比例（`deal-anim-3d.js` 的 `ASPECT`、`TOP`，換圖要跟著改）：

| | 寬×高 | 頂面佔圖高 | 前緣（一個牌的厚度） |
|---|---|---|---|
| tileV | 120×126 | 96（76%） | 30（24%） |
| tileH | 150×109 | 78（72%） | 31（28%） |

量法：沿牌的中線往下看亮度 —— 頂面是均勻的深褐，到前緣那一條高光（最亮的一列）就是頂面的盡頭，再往下是褐色帶、象牙白。

> 第一版（鏡頭約 35°）側面太厚、佔了半張圖：一排牌就算貼緊，比例也跟遊戲接近正上方往下看的牌桌對不起來。
> 改成鏡頭約 65°（描述裡寫 *seen from a HIGH camera: about 65 degrees above the table … only a THIN strip of the front edge is visible*），
> 附上一版的圖當參考鎖住材質與顏色。

## 怎麼生的

Codex CLI（ChatGPT.app 內建，`/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex`），
參考圖一律用小球貓電鐵的 `圖片/骰子/骰子六面圖v0.3.png`（鎖住寫實渲染的質感與光線）：

```
codex exec --skip-git-repo-check -C . -s read-only -i dice-ref.png -o out.txt "<描述>" < /dev/null
```

- 骰子：Make a sprite sheet of six Chinese mahjong dice, in EXACTLY the same photorealistic 3D render style, camera angle, lighting and ivory-white material as the reference image: a 3-column x 2-row grid, top row shows faces 1,2,3 on top, bottom row faces 4,5,6 on top … the ONE pip AND all FOUR pips are red … TRANSPARENT background.
- 牌（直的）：Photorealistic 3D render … Japanese mahjong tiles lying FACE-DOWN on a table, seen from a HIGH camera: about 65 degrees above the table, looking down steeply … only a THIN strip of the front edge is visible … long side goes AWAY from the camera. Two layers like real tiles: the bottom (face) layer is ivory white bone, the top (back) layer is deep glossy chocolate brown … top row = 3 single tiles; bottom row = 3 stacks of two … TRANSPARENT background.
- 牌（橫的）：同上，改成 lies SIDEWAYS: its long side runs LEFT-RIGHT。

配色照遊戲現有的牌：象牙白牌身、深褐色牌背。

## 怎麼切的

整張圖照 3×2 格切，取左上那一格不透明（alpha > 40）的範圍、外圍低 alpha 的雜點清掉，縮到牌寬 120／150、骰子寬 160。
那一格的底下會帶到下一列的頂端 —— 只取最上面一段連續的不透明列。
