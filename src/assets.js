/* ═══════════════════════════════════════════════════════════════
   assets.js — 載入從舊版抽出來的圖
   ───────────────────────────────────────────────────────────────
   圖由 `tools/extract-assets.py` 從舊版單檔抽成 `assets/` 底下的獨立檔。

   ── 為什麼要分兩批載 ──
   抽出來的 65 個資產裡，**牌面只有約 200 KB，背景佔了 8.3 MB**。
   四人線上版四個人都要載完才能開局，背景圖卡在前面等於四個人一起等。
   所以：

     牌面（34 張，約 200 KB）　開局前就要，立刻載，載好重畫一次
     背景（標題／選國／七國君主／勝利／敗亡）　用到才載

   ── 舊版的型別標錯了 ──
   舊版一律寫 `data:image/png;base64,`，但位元組開頭是 `/9j/` —— 是 JPEG。
   瀏覽器會自己嗅探所以看不出來。抽取工具依實際位元組決定副檔名，
   所以這裡吃的是 manifest 給的檔名，不要自己猜副檔名。
   ═══════════════════════════════════════════════════════════════ */
(function (root, factory) {
  const api = factory(root.MJTiles);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MJAssets = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (T) {
'use strict';

const BASE = 'assets/';
const HONORS = ['東', '南', '西', '北', '中', '發', '白'];

let manifest = null;
const faces = {};          // display → Image
const bgCache = {};        // name → Image

/* manifest 的 key → 牌面。抽取工具用舊版的變數名當 key（B64_TONG1 → tong1）。 */
function faceKeyFor(display) {
  const m = display.match(/^(\d)(.)$/);
  if (m) {
    const n = m[1], suit = m[2];
    if (suit === '筒') return 'tong' + n;
    if (suit === '條') return 'tiao' + n;
    if (suit === '萬') return 'wan' + n;
    return null;
  }
  return HONORS.indexOf(display) >= 0 ? 'honor_' + display : null;
}

function allFaceDisplays() {
  const out = [];
  ['萬', '筒', '條'].forEach(s => { for (let n = 1; n <= 9; n++) out.push(n + s); });
  return out.concat(HONORS);
}

function fileOf(key) {
  const rec = manifest && manifest[key];
  return rec ? BASE + rec.file : null;
}

/* ── 牌面 ──────────────────────────────────────────────────
   onReady 在**全部載完**之後呼叫一次（不是每張一次）——
   每載好一張就重畫的話，開局會閃 34 次。                        */
function loadFaces(onReady) {
  const displays = allFaceDisplays();
  let pending = 0, done = 0, reported = false;
  const report = () => { if (onReady) onReady(Object.keys(faces).length); };

  displays.forEach(d => {
    const key = faceKeyFor(d);
    const url = key && fileOf(key);
    if (!url) return;
    pending++;
    let tries = 0;
    const load = () => {
      const img = new Image();
      img.onload = () => {
        faces[d] = img;
        // 重試成功的那一張（全部早就回報過了）：再重畫一次，不然它要等下一個動作才換上
        if (reported && tries > 0) report();
        else tick();
      };
      /* 缺圖或網路一時沒抓到：隔 2 秒再抓一次（加個參數繞過失敗的快取）。
         再不行就讓 tiles.js 走程序繪製的 fallback。
         ⚠️ 2026-09-24 使用者看到整副牌都是 fallback 的畫法（「牌面不見了？」），重新整理又好了 ——
            原本失敗就算了，要等下一次重畫才有機會換上 */
      img.onerror = () => {
        if (tries++ < 1) { setTimeout(load, 2000); return; }
        tick();
      };
      img.src = tries ? url + '?retry=' + Date.now() : url;
    };
    load();
  });

  function tick() {
    done++;
    if (done === pending && !reported) { reported = true; report(); }
  }
  /* 手機網路慢：3 秒還沒全部載完，先拿已經到的重畫一次（全部到齊時還會再畫一次） */
  setTimeout(() => { if (!reported && Object.keys(faces).length) report(); }, 3000);

  T.setFaceImages(faces);
  if (!pending && onReady) onReady(0);
  return pending;
}

/* ── 背景（用到才載）────────────────────────────────────── */
function background(name) {
  if (bgCache[name]) return bgCache[name];
  const url = fileOf(name);
  if (!url) return null;
  const img = new Image();
  img.src = url;
  bgCache[name] = img;
  return img;
}
function backgroundUrl(name) { return fileOf(name); }

/* ── 進入點 ────────────────────────────────────────────────
   先拿 manifest，再載牌面。背景不碰。

   ⚠️ **不要改回 fetch()。**
   `fetch()` 在 file:// 底下會被 CORS 擋，那會變成整個專案唯一需要伺服器的理由。
   manifest 改由 `assets/manifest.js` 以 <script> 載進來（同一份資料，
   由 extract-assets.py 一起產生），所以雙擊 mj4.html 就能玩，不必起伺服器。 */
function init(onReady) {
  manifest = (typeof window !== 'undefined' && window.MJ_ASSET_MANIFEST) || null;
  // 沒有 assets/ 也要能跑 —— tiles.js 的程序繪製是完整的 fallback，不是佔位圖。
  const n = manifest ? loadFaces(onReady) : 0;
  if (!manifest && onReady) onReady(0);
  return Promise.resolve(n);
}

return {
  init, loadFaces, background, backgroundUrl,
  faceKeyFor, allFaceDisplays,
  get manifest() { return manifest; },
  get faces() { return faces; },
};
});
