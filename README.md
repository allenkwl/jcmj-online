# 戰國麻將列傳 — 四人版

四人日式麻將（十三張），打的是戰國：選一國當本國，在牌桌上擊敗其他諸侯、逐一征服，集滿六國統一天下。

**線上試玩：** https://allenkwl.github.io/jcmj-online/

- 手機請**橫放**；支援滑鼠、鍵盤、手把
- 真人是「主公」，電腦是各國「守將」
- 「連線對戰」目前只做到大廳，牌局同步還在開發中

## 本機執行

直接用瀏覽器打開最新版的遊戲檔（例如 `戰國麻將線上v1.00.html`）即可，不需要伺服器。
最新版是哪一個檔記在 `latest.json`。

## 版號

遊戲檔名帶版號，**每次改版 +0.01 另存新檔**，舊版留著不刪：

```bash
python3 tools/bump-version.py
```

測試：

```bash
bash tools/run-tests.sh
```

## 文件

- `docs/character-design.md` — 主公／守將的人物設計、畫風、出征動畫的做法
- `docs/net-turn-model.md` — 線上版的回合模型（群主當裁判）
- `docs/campaign.md` — 征服與戰役規則
- `PLAN.md` — 開發計畫
