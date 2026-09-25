/* ═══════════════════════════════════════════════════════════════
   solo-slots.js — 單機的十格存檔＋功業簿
   ───────────────────────────────────────────────────────────────
   2026-09-25 與使用者定案（docs/solo-saves.md）：

   ‧ 十格存檔，一格＝一段征途（一位主公從選國到統一天下）。同一國可以開好幾格
   ‧ 每打一張牌就存（存整個牌局），回來停在離開的那一手 —— 不是退回局首，
     否則抓到爛牌重新整理就能重發
   ‧ 十格滿了要玩家自己刪一格，**系統不會自動擠掉任何一格**
   ‧ 統一天下的那一段移進「功業簿」（一定記錄，名字可以不寫，預設君主稱號），空出那一格
   ‧ 舊的存檔（mj4.campaigns.v2／mj4.campaign.v1）搬進來，**舊資料留著不刪**

   資料：localStorage['mj4.solo.v1'] = {
     slots: [{ id, kingdom, level, camp, snap, createdAt, updatedAt }],
     fame:  [{ id, name, lord, kingdom, matches, conquered, unifiedAt, migrated? }],
     migrated: true
   }
     camp  campaign.js 的 player（征服地、場數、boost…）
     snap  打到一半的牌局（null＝兩場之間，繼續時開下一場）：
           { match, waiting, foes, seatInfo, seeding, skill, betHandNo }

   這裡只有純函式，不碰畫面。storage 由呼叫端傳進來（測試用假的）。
   ═══════════════════════════════════════════════════════════════ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MJSoloSlots = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
'use strict';

const KEY = 'mj4.solo.v1';
const OLD_V2 = 'mj4.campaigns.v2';
const OLD_V1 = 'mj4.campaign.v1';
const MAX_SLOTS = 10;

const empty = () => ({ slots: [], fame: [], migrated: false });

function load(storage) {
  try {
    const raw = storage.getItem(KEY);
    if (!raw) return empty();
    const d = JSON.parse(raw) || {};
    return { slots: Array.isArray(d.slots) ? d.slots : [], fame: Array.isArray(d.fame) ? d.fame : [], migrated: !!d.migrated };
  } catch (_) { return empty(); }
}

/* 寫回。⚠️ 空間不夠時（瀏覽器的上限約 5MB）丟出錯誤給呼叫端決定怎麼辦，**不會**自己刪東西騰空間 */
function save(storage, data) {
  storage.setItem(KEY, JSON.stringify({ slots: data.slots, fame: data.fame, migrated: !!data.migrated }));
}

let seq = 0;
function newId(now) { return 's' + (now || Date.now()).toString(36) + (++seq).toString(36) + Math.floor(Math.random() * 1296).toString(36); }

/* 舊存檔搬進來（只搬一次）。舊的 key 一個字都不動。
   ‧ 每一國的戰役 → 一格（連還沒打完第一場的也搬 —— 那也是玩家開過的征途）
   ‧ 已統一的、收進 history 的 → 功業簿，名字用君主稱號
   lordName(kingdomId) 由呼叫端給（kingdoms.js 的稱號算法在主程式） */
function migrate(storage, lordName, now) {
  const d = load(storage);
  if (d.migrated) return d;
  const t = now || Date.now();
  const name = k => (lordName && lordName(k)) || k || '主公';
  let old = null;
  try {
    const v2 = storage.getItem(OLD_V2);
    if (v2) old = JSON.parse(v2);
    else {
      const v1 = storage.getItem(OLD_V1);
      const p = v1 ? JSON.parse(v1) : null;
      if (p && p.kingdom) old = { byKingdom: { [p.kingdom]: p }, history: [] };
    }
  } catch (_) { old = null; }
  if (old) {
    const by = old.byKingdom || {};
    Object.keys(by).forEach(k => {
      const p = by[k];
      if (!p) return;
      if (p.unified) d.fame.push(fameFrom(p, name(p.kingdom || k), t, true));
      else d.slots.push({ id: newId(t), kingdom: p.kingdom || k, level: 2, camp: p, snap: null, createdAt: t, updatedAt: t });
    });
    (old.history || []).forEach(p => { if (p) d.fame.push(fameFrom(p, name(p.kingdom), p.archivedAt || t, true)); });
  }
  d.migrated = true;
  save(storage, d);
  return d;
}

function fameFrom(camp, lord, at, migrated) {
  const e = {
    id: newId(at), name: lord, lord, kingdom: camp.kingdom,
    matches: camp.matches || 0, conquered: (camp.conquered || []).slice(), unifiedAt: at || Date.now(),
  };
  if (migrated) e.migrated = true;
  return e;
}

/* 最近玩的排最前面 */
function sorted(slots) { return slots.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)); }
function isFull(d) { return d.slots.length >= MAX_SLOTS; }
function find(d, id) { return d.slots.find(s => s.id === id) || null; }

/* 開一格新的征途。滿了回 null（要玩家先刪一格） */
function create(d, kingdom, camp, level, now) {
  if (isFull(d)) return null;
  const t = now || Date.now();
  const sl = { id: newId(t), kingdom, level: level || 2, camp, snap: null, createdAt: t, updatedAt: t };
  d.slots.push(sl);
  return sl;
}

/* 更新一格（找不到就不動 —— 不會因為 id 對不上而多開一格） */
function update(d, id, patch, now) {
  const sl = find(d, id);
  if (!sl) return null;
  Object.assign(sl, patch, { updatedAt: now || Date.now() });
  return sl;
}

/* 只有玩家按刪除才會呼叫；統一天下移進功業簿時也用（那一段已經記進功業簿了） */
function drop(d, id) { d.slots = d.slots.filter(s => s.id !== id); return d; }

function addFame(d, camp, lord, now) {
  const e = fameFrom(camp, lord, now || Date.now(), false);
  d.fame.push(e);
  return e;
}
function renameFame(d, id, name) {
  const e = d.fame.find(x => x.id === id);
  if (e && name) e.name = String(name).slice(0, 12);
  return e || null;
}
function dropFame(d, id) { d.fame = d.fame.filter(x => x.id !== id); return d; }

return { KEY, OLD_V2, OLD_V1, MAX_SLOTS, load, save, migrate, sorted, isFull, find, create, update, drop,
         addFame, renameFame, dropFame };
});
