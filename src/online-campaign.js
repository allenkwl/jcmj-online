/* ═══════════════════════════════════════════════════════════════
   online-campaign.js — 連線戰役：存檔格、名冊、排座位、一場的結算
   ───────────────────────────────────────────────────────────────
   規格：docs/online-campaign.md（2026-09-24 與使用者定案）。

   ── 資料放在哪 ──
   ‧ 每個人的**進度只存在自己的手機**（localStorage，十格，仿小球貓電鐵）
   ‧ 一格＝一段連線戰役：{ id（唯一序號）, table（開局時的桌名）, uid, me（我的戰役記錄）, roster（名冊） }
   ‧ 名冊記每位成員：uid、名字、本國、加入時間，以及**上次看到的**征服地（大廳、地圖顯示用）。
     連線時以**在場本人**的記錄為準更新（成員資料的 camp 欄）
   ‧ 群組上也掛一份 campaign：{ id, roster }，讓開桌的人把名冊帶進來、新成員加進去

   ── 三種「人不在」（第三節）──
     缺席：名冊裡有、這一場沒來 → 座位由他那一國的武將代打，他的進度不動
     退出：只能在大廳按 → 從名冊移除，空位讓新人（從頭開始）
     斷線：牌局中，由 10 秒代打機制處理（不在這裡）

   這裡只有純函式，不碰畫面、不碰 Firebase。
   ═══════════════════════════════════════════════════════════════ */
(function (root, factory) {
  const api = factory(
    typeof require === 'function' ? require('./campaign.js') : root.MJCampaign,
    typeof require === 'function' ? require('./kingdoms.js') : root.MJKingdoms);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MJOnlineCampaign = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (CP, K) {
'use strict';

const KEY = 'jcmj_online_saves';
const MAX_SLOTS = 10;
const SEATS = 4;

/* ── 存檔格 ─────────────────────────────────────────────── */
function loadSlots(store) {
  try {
    const a = JSON.parse((store && store.getItem(KEY)) || '[]');
    return Array.isArray(a) ? a.filter(s => s && s.id) : [];
  } catch (_) { return []; }
}
/* ⚠️ 不裁切、不擠掉任何一格 —— 系統不主動刪記錄，只有玩家自己按刪除才刪（使用者 2026-09-25）。
   滿了就擋在「開新桌／加入新的戰役」那一步（isFull），不是事後偷偷丟掉最舊的。 */
function saveSlots(store, slots) {
  try { store && store.setItem(KEY, JSON.stringify(slots || [])); } catch (_) {}
}
function findSlot(slots, id) { return (slots || []).find(s => s.id === id) || null; }
/* 放到最前面（最近玩的排第一）。不會擠掉任何一格 */
function putSlot(slots, slot, now) {
  const s = Object.assign({}, slot, { updatedAt: now != null ? now : Date.now() });
  return [s].concat((slots || []).filter(x => x.id !== slot.id));
}
/* 這一段戰役還沒有存檔格、而且十格都滿了 → 要玩家先刪一格 */
function isFull(slots, id) {
  const list = slots || [];
  return !list.some(x => x.id === id) && list.length >= MAX_SLOTS;
}
function dropSlot(slots, id) { return (slots || []).filter(x => x.id !== id); }

function newId(rand) {
  const r = rand || Math.random;
  return Date.now().toString(36) + '-' + Math.floor(r() * 0x7fffffff).toString(36);
}

function makeSlot(o) {
  const now = o.now != null ? o.now : Date.now();
  return {
    id: o.id, table: o.table || '', uid: o.uid || null,
    createdAt: now, updatedAt: now,
    me: CP.createPlayer({ seat: 0, name: o.name || '', kingdom: o.kingdom || null }),
    roster: (o.roster || []).map(cleanMember),
  };
}

/* ── 名冊 ───────────────────────────────────────────────── */
function cleanMember(m) {
  return {
    uid: m.uid, name: m.name || '', kingdom: m.kingdom || null,
    joinedAt: m.joinedAt || 0,
    conquered: (m.conquered || []).slice(),
    matches: m.matches || 0,
    unified: !!m.unified,
  };
}

/* 我的戰役記錄 → 放進成員資料／名冊的那一份（只有別人需要知道的） */
function snapshot(player) {
  return {
    conquered: (player && player.conquered || []).slice(),
    matches: (player && player.matches) || 0,
    unified: !!(player && player.unified),
  };
}

/* 把在場成員併進名冊。
   members：大廳的成員清單 [{ uid, name, kingdom, joinedAt, camp }]
     camp.id 對得上這段戰役 → 用他本人的記錄（以在場本人為準）
     對不上（新人、或他手機裡沒有這一格）→ 從頭開始
   名冊滿四人就不收新人 —— 呼叫端要在加入時先擋（見 canJoin）。 */
function mergeRoster(roster, members, campaignId) {
  const out = (roster || []).map(cleanMember);
  (members || []).forEach(m => {
    if (!m || !m.uid) return;
    const mine = m.camp && m.camp.id === campaignId ? m.camp : null;
    const cur = out.find(r => r.uid === m.uid);
    if (cur) {
      cur.name = m.name || cur.name;
      if (mine) Object.assign(cur, { conquered: (mine.conquered || []).slice(), matches: mine.matches || 0, unified: !!mine.unified });
      return;
    }
    if (out.length >= SEATS) return;
    out.push(cleanMember({ uid: m.uid, name: m.name, kingdom: m.kingdom, joinedAt: m.joinedAt,
                           conquered: mine ? mine.conquered : [], matches: mine ? mine.matches : 0 }));
  });
  return out.sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0));
}

/* 能不能加入這一桌的戰役：名冊裡有我（回來），或名冊還有空位（新人） */
function canJoin(roster, uid) {
  const r = roster || [];
  return r.some(m => m.uid === uid) || r.length < SEATS;
}

function removeMember(roster, uid) { return (roster || []).filter(m => m.uid !== uid).map(cleanMember); }

/* 本國不能重複。照加入順序，先來的保有自己的國；沒國或撞國的從空國抽。 */
function assignKingdoms(roster, rng) {
  const used = new Set();
  const out = roster.map(cleanMember);
  const all = K.KINGDOMS.map(k => k.id);
  out.forEach(m => { if (m.kingdom && all.indexOf(m.kingdom) >= 0 && !used.has(m.kingdom)) used.add(m.kingdom); else m.kingdom = null; });
  out.forEach(m => {
    if (m.kingdom) return;
    const free = all.filter(id => !used.has(id));
    m.kingdom = free[Math.floor(rng() * free.length)];
    used.add(m.kingdom);
  });
  return out;
}

/* ── 排座位 ───────────────────────────────────────────────
   ‧ 在場的真人：開桌的人（群主）坐 0，其餘照加入順序
   ‧ 缺席的成員：保留座位，由他那一國的武將代打（absentOf 記是誰的位子）
   ‧ 名冊不滿四人：其餘由各國守將補上（沒人用的國隨機抽）
   回傳 4 個座位，欄位多於 createMatch 認得的（conquered、absentOf）由呼叫端另外掛上 match.seats。 */
function buildSeats(o) {
  const roster = o.roster || [];
  const present = new Set(o.present || []);
  const rng = o.rng;
  const aiLevel = o.aiLevel || 2;
  const humans = roster.filter(m => present.has(m.uid))
    .sort((a, b) => ((b.uid === o.hostUid) - (a.uid === o.hostUid)) || ((a.joinedAt || 0) - (b.joinedAt || 0)));
  const absent = roster.filter(m => !present.has(m.uid));
  const seats = humans.map(m => ({
    name: m.name || '玩家', kingdom: m.kingdom, clientId: m.uid, conquered: m.conquered.slice(),
  })).concat(absent.map(m => ({
    name: K.generalTitle(m.kingdom), isAI: true, aiLevel, kingdom: m.kingdom,
    absentOf: { uid: m.uid, name: m.name }, conquered: m.conquered.slice(),
  })));
  const used = new Set(seats.map(s => s.kingdom));
  const free = K.KINGDOMS.map(k => k.id).filter(id => !used.has(id));
  while (seats.length < SEATS && free.length) {
    const k = free.splice(Math.floor(rng() * free.length), 1)[0];
    seats.push({ name: K.generalTitle(k), isAI: true, aiLevel, kingdom: k, conquered: [] });
  }
  return seats;
}

/* ── 一場的結算 ───────────────────────────────────────────
   **每一台各自算**，所以輸入一定要四台一樣：
     seats      公開牌局的座位（conquered 快照在上面）
     standings  scoring.standings(match)
     seed       大家都知道的數（群主的 gameId＋第幾場）—— 牌局的種子是秘密，不能用
     credit(i)  這一家的戰果記不記（斷線被武將代打過就不記：campaign.creditable）
   電腦守將、缺席的座位也照樣排名（別人征服了誰取決於完整排名），只是結果不存。
   回傳 { report, players }：players[i] 是第 i 家算完之後的記錄（真人才有意義）。 */
function settle(o) {
  const players = o.seats.map((st, i) => {
    const p = CP.createPlayer({ seat: i, name: st.name, isAI: !!st.isAI, kingdom: st.kingdom });
    p.conquered = (st.conquered || []).slice();
    if (o.records && o.records[i]) Object.assign(p, JSON.parse(JSON.stringify(o.records[i])), { seat: i });
    return p;
  });
  const rng = makeRNG(o.seed);
  const report = CP.applyResult(players, o.standings, rng);
  return { report, players };
}

function makeRNG(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

return {
  KEY, MAX_SLOTS,
  loadSlots, saveSlots, findSlot, putSlot, dropSlot, isFull, newId, makeSlot,
  snapshot, mergeRoster, canJoin, removeMember, assignKingdoms, buildSeats, settle, makeRNG,
};
});
