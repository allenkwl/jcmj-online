/* ═══════════════════════════════════════════════════════════════
   online-progress.js — 連線的七國進度（每個玩家一國一份）
   ───────────────────────────────────────────────────────────────
   規格：docs/online-kingdoms.md（2026-10-16 與使用者定案）。取代 online-campaign.js 的「一桌一段戰役」。

   使用者：「要加入牌桌（不論全新桌或是進行中的）一樣要選國家，若選到的國家是自己之前打過沒有統一天下的，
   就把進度帶進來，所以每個玩家就會有七組進度」。

   ── 資料 ──
     jcmj_online_kingdoms = { v: 1, kingdoms: { qin: {…player…}, … } }
     每一筆就是 campaign.js 的 player（征服地、國庫、場數、連敗、追趕機制），外加 updatedAt。
     沒出征過的國：沒有這一筆。統一天下、亡國：那一筆刪掉，再選就從頭開始。
     ⚠️ 格式照「之後要存進雲端」來寫（docs 第十一節的 /players/{uid}/kingdoms/{國}）：純 JSON、一國一個鍵。

   ── 同一個瀏覽器只能在一桌（docs 第六節）──
     jcmj_online_lock = { tab, table, kingdom, at }
     進牌桌時拿鎖、在牌桌上每 10 秒更新 at、離開時放掉。另一個分頁看到鎖還新鮮（30 秒內）就不能上桌；
     分頁直接關掉的話，鎖過 30 秒自然失效。

   ── 舊資料 ──
     一桌一段的連線存檔（jcmj_online_saves）與退出待補送清單（jcmj_pending_quits）：使用者「清掉重來」。
     clearOld() 刪掉，回傳有沒有刪到東西（有的話畫面提示一次）。

   這裡只有純函式（外加讀寫 store），不碰畫面、不碰 Firebase。
   ═══════════════════════════════════════════════════════════════ */
(function (root, factory) {
  const api = factory(
    typeof require === 'function' ? require('./campaign.js') : root.MJCampaign);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MJOnlineProgress = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (CP) {
'use strict';

const KEY = 'jcmj_online_kingdoms';
const LOCK_KEY = 'jcmj_online_lock';
const OLD_KEYS = ['jcmj_online_saves', 'jcmj_pending_quits'];
const LOCK_TTL = 30000;          // 鎖多久沒更新就當作失效（分頁直接關掉的情況）

/* ── 讀寫 ── */
function load(store) {
  try {
    const d = JSON.parse((store && store.getItem(KEY)) || 'null');
    if (d && d.kingdoms && typeof d.kingdoms === 'object') return { v: 1, kingdoms: d.kingdoms };
  } catch (_) {}
  return { v: 1, kingdoms: {} };
}
function save(store, data) {
  try { store && store.setItem(KEY, JSON.stringify({ v: 1, kingdoms: (data && data.kingdoms) || {} })); return true; }
  catch (_) { return false; }
}

/* 某一國的進度；沒有就 null */
function get(data, kingdom) {
  const r = data && data.kingdoms && data.kingdoms[kingdom];
  return r ? JSON.parse(JSON.stringify(r)) : null;
}

/* 上桌用的那一份：有進度就帶進來，沒有就從頭開始（本錢、只有本國）。不會寫回 —— 結算後才 put */
function forTable(data, kingdom, name) {
  const r = get(data, kingdom);
  if (r) return Object.assign(r, { kingdom, name: name || r.name || '' });
  return CP.createPlayer({ seat: 0, name: name || '', kingdom });
}

/* 一場打完寫回這一國。統一天下的不寫（呼叫端改呼叫 drop） */
function put(data, player, now) {
  if (!player || !player.kingdom) return data;
  const p = JSON.parse(JSON.stringify(player));
  p.seat = 0;
  p.updatedAt = now != null ? now : Date.now();
  data.kingdoms[p.kingdom] = p;
  return data;
}

/* 統一天下、亡國：那一國的進度刪掉 */
function drop(data, kingdom) {
  if (data && data.kingdoms) delete data.kingdoms[kingdom];
  return data;
}

/* 擇國卡片上的一行字（沒有進度回 null） */
function summary(data, kingdom) {
  const r = data && data.kingdoms && data.kingdoms[kingdom];
  if (!r) return null;
  return {
    conquered: (r.conquered || []).length,
    gold: CP.goldOf(r),
    matches: r.matches || 0,
  };
}

/* 放進成員資料給同桌看的那一份（房間名單、名牌、地圖）。只有別人需要知道的 */
function snapshot(player) {
  return {
    kingdom: (player && player.kingdom) || null,
    conquered: ((player && player.conquered) || []).slice(),
    matches: (player && player.matches) || 0,
    gold: CP.goldOf(player),
  };
}

/* ── 舊的一桌一段存檔：清掉 ── */
function clearOld(store) {
  let had = false;
  OLD_KEYS.forEach(k => {
    try {
      const v = store && store.getItem(k);
      if (v && v !== '[]') had = true;
      if (v != null) store.removeItem(k);
    } catch (_) {}
  });
  return had;
}

/* ── 一個瀏覽器一桌 ──
   tab：這個分頁的代號（呼叫端產生一次、整個分頁沿用） */
function readLock(store) {
  try { return JSON.parse((store && store.getItem(LOCK_KEY)) || 'null'); } catch (_) { return null; }
}
/* 別的分頁正在用（鎖是別人的、而且還新鮮）→ 回那把鎖；否則 null */
function lockedByOther(store, tab, now) {
  const l = readLock(store);
  const t = now != null ? now : Date.now();
  if (!l || l.tab === tab) return null;
  return (t - (l.at || 0)) < LOCK_TTL ? l : null;
}
/* 拿鎖／更新鎖。別的分頁還拿著就失敗（回 false） */
function lock(store, tab, info, now) {
  const t = now != null ? now : Date.now();
  if (lockedByOther(store, tab, t)) return false;
  const cur = readLock(store);
  const keep = cur && cur.tab === tab ? cur : {};
  const l = Object.assign({}, keep, info || {}, { tab, at: t });
  try { store.setItem(LOCK_KEY, JSON.stringify(l)); return true; } catch (_) { return false; }
}
function unlock(store, tab) {
  const l = readLock(store);
  if (l && l.tab === tab) { try { store.removeItem(LOCK_KEY); } catch (_) {} }
}

return {
  KEY, LOCK_KEY, OLD_KEYS, LOCK_TTL,
  load, save, get, forTable, put, drop, summary, snapshot,
  clearOld, readLock, lockedByOther, lock, unlock,
};
});
