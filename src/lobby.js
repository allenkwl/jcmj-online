/* ═══════════════════════════════════════════════════════════════
   lobby.js — 連線大廳
   ───────────────────────────────────────────────────────────────
   移植自小球貓電鐵的 main-v1.81.js:1579-2523（約 950 行）。
   那邊的大廳跟電鐵的遊戲流程糾纏在同一個 IIFE 裡（Pick／Game／Seats／
   OnlineSave 全部直接以全域名稱互相呼叫），這裡重寫成只有一個出口：

       Lobby.init({ onEnterGame(ctx) { ... } })

   ctx = { groupKey, groupName, isHost, members, aiLevel, myClientId }
   大廳只負責「把人湊齊」，湊齊之後要做什麼由呼叫端決定。

   ── 畫面狀態機（跟電鐵一樣，靠 groups/{key}/status 驅動）──
       waiting  ──群主按「開始」──▶  started
          ▲                            │
          └──── 有人離開／解散 ────────┘

   電鐵多一個 playing（選角畫面）階段，麻將沒有選角
   （座位是自動分配、國家在選國畫面已經選好），所以直接 waiting → started。

   ⚠️ 房號：跟電鐵一樣**沒有房號**，用公開的群組名稱互相找。
      要加房號的話改 createGroup 的地方，但那會連帶影響「繼續之前的群組」
      （那份記錄是用名字存的）。
   ═══════════════════════════════════════════════════════════════ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MJLobby = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
'use strict';

const RECENT_KEY = 'jcmj_recent_groups';
const NAME_KEY = 'jcmj_my_name';
const SEATS = 4;

let cfg = { onEnterGame: null, onBack: null, onRoom: null, onPickKingdom: null, onPickTaken: null };
let myName = '';
let cur = null;          // { key, displayName, isHost }
let watching = false;

const byId = id => document.getElementById(id);
const show = (id, on) => { const e = byId(id); if (e) e.style.display = on ? '' : 'none'; };

/* ── 名字 ─────────────────────────────────────────────────
   跟電鐵不同：那邊的大廳名字只存在記憶體，重整就沒了。
   麻將的名字會出現在牌桌的名牌上，整場都看得到，存起來比較合理。 */
function loadName() {
  try { myName = localStorage.getItem(NAME_KEY) || ''; } catch (_) { myName = ''; }
  if (!myName) { myName = '玩家' + (10 + Math.floor(Math.random() * 90)); saveName(); }
  return myName;
}
function saveName() { try { localStorage.setItem(NAME_KEY, myName); } catch (_) {} }

/* ── 玩過的群組 ───────────────────────────────────────────
   續玩就是「開一次同名群組」，但要玩家把名字一字不差打回來太苛刻
   （尤其中文），直接列出來給他點。                               */
function recent() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch (_) { return []; }
}
function rememberGroup(name) {
  const list = recent().filter(n => n !== name);
  list.unshift(name);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 5))); } catch (_) {}
}

/* ── 連線戰役的存檔（src/online-campaign.js，docs/online-campaign.md）──
   「繼續之前的牌桌」列的是**十格連線存檔**，不再是單純的桌名清單：
   每一格記著唯一序號與整張名冊，點下去用同一個桌名、同一段戰役重開。 */
const OC = () => window.MJOnlineCampaign;
function slots() { try { return OC() ? OC().loadSlots(localStorage) : []; } catch (_) { return []; } }
function slotsSave(list) { try { OC() && OC().saveSlots(localStorage, list); } catch (_) {} }
// Firebase 會把陣列存成物件、或把空陣列吃掉 —— 名冊讀回來一律整理成陣列
function toArr(x) { return Array.isArray(x) ? x.filter(Boolean) : Object.keys(x || {}).map(k => x[k]).filter(Boolean); }
function rosterOf(g) { return toArr(g && g.campaign && g.campaign.roster); }

/* ── 退出＝刪掉這一段的存檔（2026-09-26 使用者：「刪除就是退出很合理」）──
   刪除（或房間裡的「退出此牌局」）時，在雲端的成員名單（/camps/{戰役 id}）標記「我退出了」，
   其他人之後重開這一桌就會把我從名冊拿掉（空位給新人或電腦守將）。
   **全部成員都退出了**，這一段連同退出紀錄整個收掉，同名的空桌也清掉（使用者：「不要亂」）。
   當下沒網路、或規則還沒部署寫不進去：先排進待補送清單，之後每次進大廳再送一次。 */
const PENDING_QUITS_KEY = 'jcmj_pending_quits';
function pendingQuits() {
  try {
    // v1.38 排的是戰役 id 字串，之後改成 { cid, uids, table }
    // uids: null＝不知道名冊（v1.38 排的）—— 補送時只標自己退出，不判斷「全部人都退出、收掉這一段」
    return (JSON.parse(localStorage.getItem(PENDING_QUITS_KEY) || '[]') || []).map(x => typeof x === 'string' ? { cid: x, uids: null, table: '' } : x);
  } catch (_) { return []; }
}
function savePendingQuits(list) { try { localStorage.setItem(PENDING_QUITS_KEY, JSON.stringify(list)); } catch (_) {} }
/* roster：自己手機上這一段的名冊（替還沒登記的成員補佔位用）；table：桌名（整段收掉時清同名空桌） */
function markQuit(cid, roster, table) {
  if (!cid) return;
  const uids = roster === null ? null : toArr(roster).map(m => m.uid).filter(Boolean);
  const item = { cid, uids, table: table || '' };
  Net.markQuit(cid, myName, uids).then(r => {
    if (r === 'closed') Net.closeCampTable(item.table, cid);
  }).catch(() => {
    const list = pendingQuits().filter(x => x.cid !== cid);
    list.push(item);
    savePendingQuits(list);
  });
}
function flushQuits() {
  const list = pendingQuits();
  if (!list.length) return;
  savePendingQuits([]);
  list.forEach(x => markQuit(x.cid, x.uids ? x.uids.map(uid => ({ uid })) : null, x.table));   // 還是失敗的會自己排回去
}

/* ── 小工具 ────────────────────────────────────────────── */
function row(cls, html, onClick) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = cls;
  el.innerHTML = html;
  if (onClick) el.addEventListener('click', onClick);
  else el.disabled = true;
  return el;
}
function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); }
/* 文字輸入。⚠️ 不要退回原生 prompt() —— 那會讓瀏覽器退出全螢幕，
   而本作的老闆模式正是監聽 fullscreenchange 觸發的（見 mj4.html 的 askText）。 */
function ask(message, def) {
  if (typeof window.MJAsk === 'function') return window.MJAsk(message, def);
  return Promise.reject(new Error('NOASK'));
}

function toast(msg) {
  if (typeof window.MJToast === 'function') window.MJToast(msg);
  else console.log('[lobby]', msg);
}

/* ── 畫面切換 ───────────────────────────────────────────── */
function screen(which) {
  ['net-lobby', 'net-room'].forEach(id => show(id, id === which));
  if (window.MJInput) setTimeout(() => window.MJInput.refresh(0), 0);
}

/* ═══════════ 大廳 ═══════════ */

function renderLobby() {
  byId('lobby-myname').textContent = myName;

  // 之前玩過的：十格連線存檔
  const list = slots();
  const rbox = byId('lobby-recent');
  clear(rbox);
  show('lobby-recent-wrap', list.length > 0);
  list.forEach(sl => {
    const names = toArr(sl.roster).map(m => esc(m.name || '?')).join('、');
    const n = (sl.me && sl.me.conquered || []).length;
    // 統一天下的那一段：記錄留著（系統不主動刪），但已經打完了，不能再開
    const done = sl.finished === 'unified';
    rbox.appendChild(row('net-row' + (done ? ' full' : ''),
      `<b>${esc(sl.table || '?')}${done ? '　🏆 已統一' : ''}</b><span>${names || '只有你'}　你已征服 ${n} 國</span>`,
      done ? null : () => doResume(sl)));
    // 刪除只有玩家自己按才刪，而且要按兩下
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'net-del';
    del.textContent = '刪除';
    del.title = '刪除這一格存檔＝退出這一段戰役（其他人之後開這一桌就沒有你）';
    del.addEventListener('click', () => {
      if (!del.dataset.armed) {
        del.dataset.armed = '1';
        del.textContent = '確定退出？';
        setTimeout(() => { delete del.dataset.armed; del.textContent = '刪除'; }, 3000);
        return;
      }
      slotsSave(OC().dropSlot(slots(), sl.id));
      markQuit(sl.id, sl.roster, sl.table);
      toast('已退出「' + (sl.table || '') + '」並刪除存檔 —— 其他人之後開這一桌就沒有你了');
      renderLobby();
    });
    rbox.appendChild(del);
  });
  syncSlotQuits(list);
  const full = list.length >= (OC() ? OC().MAX_SLOTS : 10);
  byId('lobby-recent-wrap').querySelector('.net-label').textContent =
    '繼續之前的牌桌（連線存檔 ' + list.length + ' / ' + (OC() ? OC().MAX_SLOTS : 10) + '）' + (full ? '　已滿，要開新桌請先刪一格' : '　刪除＝退出那一段');

  // 現有群組（由 watchGroups 持續更新）
  byId('lobby-groups-empty').textContent = '搜尋中⋯';
}

/* 大廳列表上的名冊跟雲端的退出名單對一次（2026-09-26 使用者：「手機已經退出，怎麼還在？」）。
   列表是拿自己手機存的名冊畫的；別人退出只記在雲端（/camps），以前要等按下那一桌重開才會套用。
   有人退出就更新自己的存檔再重畫；沒變就不重畫（避免重畫又觸發一次） */
let quitSyncing = false;
function syncSlotQuits(list) {
  if (quitSyncing || !OC() || !list.length) return;
  quitSyncing = true;
  Promise.all(list.map(sl => Net.readQuits(sl.id).then(q => ({ sl, q })))).then(res => {
    let all = slots(), changed = false;
    res.forEach(({ sl, q }) => {
      const before = toArr(sl.roster);
      const after = OC().applyQuits(before, q);
      if (after.length === before.length) return;
      const cur2 = OC().findSlot(all, sl.id);
      if (!cur2) return;
      all = all.map(x => (x.id === sl.id ? Object.assign({}, x, { roster: after }) : x));   // 不動順序、不改時間
      changed = true;
    });
    if (changed) { slotsSave(all); renderLobby(); }
  }).catch(() => {}).then(() => { setTimeout(() => { quitSyncing = false; }, 0); });
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

const LEVEL_NAME = { 1: '初學', 2: '普通', 3: '高手' };

function renderGroupList(list) {
  const box = byId('lobby-groups');
  clear(box);
  const open = list.filter(g => g.status === 'waiting');
  byId('lobby-groups-empty').style.display = open.length ? 'none' : '';
  byId('lobby-groups-empty').textContent = '目前沒有人開桌，按上面「開一桌」自己開一個';
  // ⚠️ 清單是 watchGroups 非同步推過來的，項目一變焦點清單就變了。
  //    不重抓的話，方向鍵會停在已經被移除的舊節點上（畫面看起來沒有焦點框）。
  setTimeout(() => { if (window.MJInput) window.MJInput.refresh(); }, 0);

  open.forEach(g => {
    const n = g.count || 0;
    const lv = LEVEL_NAME[g.aiLevel] || '普通';
    const full = n >= SEATS;
    box.appendChild(row('net-row' + (full ? ' full' : ''),
      `<b>${esc(g.name || g.key)}</b>` +
      `<span>${n}/${SEATS} 人　電腦：${lv}${full ? '　（滿了）' : ''}</span>`,
      full ? null : () => doJoin(g.key)));
  });
}

/* ── 建群組 ───────────────────────────────────────────────
   電腦難度在**建房時**就決定，並寫進 groups/{key}，讓大廳列表看得到。
   理由：這個遊戲輸一場會掉一個國家，玩家該在進房前就知道風險，
   而不是進去了才發現群主設了高手局。                             */
function doCreate(presetName) {
  const p = presetName ? Promise.resolve(presetName)
                       : ask('這一桌叫什麼名字？（告訴朋友就能加入）', myName + '的牌桌');
  p.then(name => name && finishCreate(name)).catch(() => {});
}

function aiLevelNow() {
  const onBtn = byId('lobby-ailevel').querySelector('button.on');
  return Number(onBtn && onBtn.dataset.v) || 2;
}

/* 用存檔格重開：同一個桌名、同一段戰役（序號與名冊一起帶上去） */
function doResume(sl) {
  // 先看這一段有誰退出了（刪了存檔的人），從名冊拿掉再開桌；自己的存檔也跟著更新
  return Net.readQuits(sl.id).then(q => {
    const roster = OC() ? OC().applyQuits(toArr(sl.roster), q) : toArr(sl.roster);
    if (OC() && roster.length !== toArr(sl.roster).length) {
      const s2 = OC().findSlot(slots(), sl.id);
      if (s2) slotsSave(OC().putSlot(slots(), Object.assign({}, s2, { roster }), s2.updatedAt || Date.now()));
    }
    return openTable(sl.table, { aiLevel: aiLevelNow(), campaign: { id: sl.id, roster } });
  });
}

function slotsFullMsg() { toast('連線存檔已滿 ' + (OC() ? OC().MAX_SLOTS : 10) + ' 格，要開新的一段請先在「繼續之前的牌桌」刪掉一格'); }

function finishCreate(name) {
  // 新開的桌＝新的一段戰役：給一個唯一序號，名冊開局時才填。
  // 存檔滿了就先擋下來（系統不會自己擠掉舊的存檔）
  const id = OC() ? OC().newId() : String(Date.now());
  if (OC() && OC().isFull(slots(), id)) { slotsFullMsg(); return Promise.resolve(); }
  return openTable(name, { aiLevel: aiLevelNow(), campaign: { id, roster: [] } });
}

function openTable(name, extra) {
  // ⚠️ 不要直接 createGroup：同名的空殼（上次大家關掉分頁留下的）會讓它永遠回 EXISTS
  return Net.reopenGroup(name, myName, extra)
    .then(r => {
      rememberGroup(r.displayName); enterRoom(r.key, r.displayName, r.isHost);
      if (r.isHost) Net.sweepOrphans();          // 開桌的人順手清別桌的殘留資料（一天一次）
    })
    .catch(e => {
      const m = e && e.message;
      if (m === 'STARTED') toast('這一桌還有人在打，換一個名字');
      else if (m === 'EXISTS') toast('這個名字已經有人用了，換一個');
      else toast('開群組失敗：' + m);
    });
}

function doJoin(key) {
  Net.joinGroup(key, myName)
    .then(g => { const dn = (g && g.displayName) || key; rememberGroup(dn); enterRoom(key, dn, false); })
    .catch(e => {
      const m = e && e.message;
      if (m === 'STARTED') toast('這一桌已經開打了');
      else if (m === 'GONE') toast('這個群組已經不在了');
      else toast('加入失敗：' + m);
    });
}

/* ═══════════ 房間 ═══════════ */

function enterRoom(key, displayName, isHost) {
  cur = { key, displayName, isHost };
  byId('room-name').textContent = displayName;
  screen('net-room');
  startWatching();
}

/* 進房後第一次拿到房間資料：把我在這段戰役的記錄放上成員資料，
   名冊滿了（四位主公都有人）而我不在裡面 → 進不來 */
function syncMyCamp(g) {
  if (!cur || cur.campSynced || !g) return true;
  cur.campSynced = true;
  const c = g.campaign;
  if (!c || !c.id) return true;
  const roster = rosterOf(g);
  // 加入別人的一段戰役、我這邊還沒有它的存檔格，而十格都滿了 → 先擋下來
  if (OC() && OC().isFull(slots(), c.id)) {
    slotsFullMsg();
    leave(false);
    return false;
  }
  if (OC() && !OC().canJoin(roster, Net.uid)) {
    toast('這一桌的名冊滿了（四位主公），要等有人退出才能加入');
    leave(false);
    return false;
  }
  const sl = OC() ? OC().findSlot(slots(), c.id) : null;
  Net.updateMyCamp(Object.assign({ id: c.id }, sl ? OC().snapshot(sl.me) : { conquered: [], matches: 0, unified: false }));
  // 名冊裡的老成員：本國就是名冊上那一國（他的戰役），順手校正成員資料
  const mine = roster.find(r => r.uid === Net.uid);
  if (mine && mine.kingdom && mine.kingdom !== Net.prefKingdom) Net.updateMyKingdom(mine.kingdom);
  // 新成員（包括剛開的新桌）：一進房間先擇國而立
  if (!mine && cfg.onPickKingdom) setTimeout(pickKingdom, 350);
  return true;
}

/* 別人已經用掉的國：名冊上其他人的、房間裡其他人**選好的**（還在選國畫面的人沒選定，不算） */
function takenKingdoms(g) {
  const roster = rosterOf(g);
  return roster.filter(r => r.uid !== Net.uid).map(r => r.kingdom)
    .concat((g.members || []).filter(m => !m.me && (m.picked || roster.some(r => r.uid === m.uid))).map(m => m.kingdom))
    .filter(Boolean);
}

/* 連線擇國而立 */
function pickKingdom() {
  const g = cur && cur.last;
  if (!g || !cfg.onPickKingdom) return;
  const roster = rosterOf(g);
  if (roster.some(r => r.uid === Net.uid)) return;       // 老成員本國固定
  screen(null);                                          // 選國畫面在大廳底下，先把房間收起來
  cur.picking = true;
  if (cur.ready) setReady(false);                        // 改選國就要重新確認
  cfg.onPickKingdom({
    taken: takenKingdoms(g), current: Net.prefKingdom,
    done: k => {
      cur.picking = false;
      if (!k) return;
      cur.picked = true;
      Net.updateMyKingdom(k);
      Net.updateMyPicked && Net.updateMyPicked(true);
    },
  });
}

/* 準備好了（每個人都確認，開桌的人才能按開始） */
function setReady(on) {
  if (!cur) return;
  cur.ready = !!on;
  Net.updateMyReady(!!on);
  if (cur.last) renderRoom(cur.last);
}
/* 我可以按「準備好了」嗎：老成員隨時可以；新成員要先擇國而立 */
function canReady(g) {
  return rosterOf(g).some(r => r.uid === Net.uid) || !!cur.picked;
}

/* 退出此牌局（只能在大廳）：從名冊拿掉、刪掉這一格存檔，空出來的位子讓新人加入 */
function quitCampaign() {
  const g = cur && cur.last;
  const c = g && g.campaign;
  if (!c || !c.id || !OC()) { leave(false); return; }
  // 刪進度是不能回頭的事，要按兩下：第一下改字提醒，3 秒內再按一次才真的退
  const btn = byId('room-quit');
  if (!btn.dataset.armed) {
    btn.dataset.armed = '1';
    btn.textContent = '再按一次確認退出（進度會刪掉）';
    setTimeout(() => { delete btn.dataset.armed; btn.textContent = '退出此牌局'; }, 3000);
    return;
  }
  delete btn.dataset.armed;
  btn.textContent = '退出此牌局';
  Net.updateCampaign({ id: c.id, roster: OC().removeMember(rosterOf(g), Net.uid) })
    .then(() => {
      slotsSave(OC().dropSlot(slots(), c.id));
      markQuit(c.id, rosterOf(g), cur && cur.displayName);
      toast('已退出「' + (cur ? cur.displayName : '') + '」，這一桌的進度已刪除');
      leave(false);
      renderLobby();
    });
}

function renderRoom(g) {
  if (!cur) return;
  cur.last = g;
  if (!syncMyCamp(g)) return;
  // ⚠️ watchRoom 回的 members 是**陣列**（每筆已經是 {id,name,isHost,me}），
  //    不是以 id 為鍵的物件 —— 當成物件處理會矇對但很脆弱。
  const members = g.members || [];
  const n = members.length;
  cur.isHost = g.host === Net.clientId;

  byId('room-role').textContent = cur.isHost ? '你開的桌' : '';   // 畫面上不說「群主」
  byId('room-count').textContent = `${n}/${SEATS} 人` + (n < SEATS ? `　不足的 ${SEATS - n} 家由電腦補上` : '');
  byId('room-ai').textContent = '電腦強度：' + (LEVEL_NAME[g.aiLevel] || '普通');

  const box = byId('room-members');
  clear(box);
  const conq = arr => { const a = toArr(arr); return a.length ? '　已征服 ' + a.length + ' 國' : ''; };
  const roster = rosterOf(g);
  const kname = id => { const k = window.MJKingdoms && window.MJKingdoms.get(id); return k ? k.name : ''; };
  members.forEach(m => {
    // 老成員的本國以名冊為準（他的戰役）；新成員用他剛選的
    const r = roster.find(x => x.uid === m.uid);
    const k = kname((r && r.kingdom) || m.kingdom);
    const rd = m.isHost ? '' : (m.ready ? '　✔ 已準備' : '　⋯ 準備中');
    box.appendChild(row('net-row',
      `<b>${esc(m.name || '?')}${k ? '　' + k : ''}</b><span>${m.me ? '（你）' : ''}${m.isHost ? '　開桌' : ''}${rd}${conq(m.camp && m.camp.conquered)}</span>`));
  });
  // 名冊裡有、現在不在的人：這一場由他那一國的武將代打，他的進度不動
  roster.filter(r => !members.some(m => m.uid === r.uid)).forEach(r => box.appendChild(row('net-row absent',
    `<b>${esc(r.name || '?')}</b><span>缺席　由武將代打${conq(r.conquered)}</span>`)));
  show('room-quit', roster.some(r => r.uid === Net.uid));
  show('room-pick', !roster.some(r => r.uid === Net.uid) && !!cfg.onPickKingdom);
  // 還在選國畫面：別人剛選走的國要馬上鎖起來
  if (cur.picking && cfg.onPickTaken) cfg.onPickTaken(takenKingdoms(g));

  /* 每個人都確認才開局（使用者 2026-09-24）：
     成員按「準備好了」；開桌的人要等其他人都準備好，而且自己也選好國，「開始牌局」才按得下去 */
  const others = members.filter(m => !m.me);
  const notReady = others.filter(m => !m.ready).length;
  const rb = byId('room-ready');
  if (rb) {
    const ok = canReady(g);
    rb.disabled = !ok;
    rb.textContent = !ok ? '先擇國而立，才能準備' : (cur.ready ? '✔ 已準備（再按取消）' : '準備好了');
  }
  const sb = byId('room-start');
  if (sb) {
    const mineOk = canReady(g);
    sb.disabled = !mineOk || notReady > 0;
    sb.textContent = !mineOk ? '先擇國而立' : (notReady ? `等 ${notReady} 位主公準備⋯` : '開始牌局');
  }

  show('room-start', cur.isHost);
  show('room-ready', !cur.isHost);
  show('room-wait', !cur.isHost && !!cur.ready);
  if (window.MJInput) setTimeout(() => window.MJInput.refresh(), 0);
}

function startWatching() {
  if (watching) return;
  watching = true;
  Net.watchRoom(g => {
    // 牌局中：成員進出（斷線、連回來、換群主）交給遊戲處理，大廳畫面不動
    if (cur && cur.entered) { if (cfg.onRoom) cfg.onRoom(g); return; }
    if (!g) { leave(true); return; }          // 群組沒了
    // 開局只進一次 —— 房間資料之後每變一次（有人斷線、改名）都會再觸發，不擋就會重複開局
    if (g.status === 'started') { if (!cur.entered) enterGame(g); return; }
    renderRoom(g);
  });
}

function enterGame(g) {
  cur.entered = true;
  cur.ready = false;
  Net.updateMyReady(false);
  const ctx = {
    gameId: g.gameId || null,
    groupKey: cur.key,
    groupName: cur.displayName,
    isHost: g.host === Net.clientId,
    members: (g.members || []).slice(),
    aiLevel: g.aiLevel || 2,
    campaign: g.campaign ? { id: g.campaign.id, roster: rosterOf(g) } : null,
    myClientId: Net.clientId,
  };
  if (cfg.onEnterGame) cfg.onEnterGame(ctx);
}

function leave(silent) {
  Net.unwatchRoom();
  watching = false;
  Net.leaveGroup().catch(() => {});
  cur = null;
  if (!silent) screen('net-lobby');
  else { toast('群組已經解散了'); screen('net-lobby'); }
}

/* ═══════════ 對外 ═══════════ */

function init(options) {
  cfg = Object.assign(cfg, options || {});
  loadName();

  byId('lobby-rename').addEventListener('click', () => {
    ask('你的名字（會顯示在牌桌的名牌上）', myName).then(n => {
      if (!n) return;
      myName = n.slice(0, 12);
      saveName();
      byId('lobby-myname').textContent = myName;
      if (cur) Net.rename(myName);
    }).catch(() => {});
  });
  byId('lobby-create').addEventListener('click', () => doCreate(null));
  byId('lobby-back').addEventListener('click', () => { Net.unwatchGroups(); if (cfg.onBack) cfg.onBack(); });
  byId('room-start').addEventListener('click', () => {
    if (!cur || !cur.isHost || byId('room-start').disabled) return;
    Net.startGame().catch(e => toast('開始失敗：' + (e && e.message)));
  });
  byId('room-leave').addEventListener('click', () => leave(false));
  const q = byId('room-quit');
  if (q) q.addEventListener('click', quitCampaign);
  const pk = byId('room-pick');
  if (pk) pk.addEventListener('click', pickKingdom);
  const rd = byId('room-ready');
  if (rd) rd.addEventListener('click', () => { if (cur && !rd.disabled) setReady(!cur.ready); });
}

/* 進大廳。回傳 Promise —— 連線／登入可能失敗，呼叫端要能據此退回單機。 */
function open() {
  if (!Net.init()) return Promise.reject(new Error('NOFIREBASE'));
  return Net.signIn().then(() => {
    flushQuits();
    renderLobby();
    screen('net-lobby');
    Net.watchConnection(ok => show('net-offline', !ok));
    Net.watchGroups(renderGroupList);
    return true;
  });
}

function close() {
  Net.unwatchGroups();
  if (cur) leave(false);
  screen(null);
}

/* 只收起大廳畫面、**不退桌**。進入連線牌局時用這個。
   ⚠️ 不要用 close() —— 它會 leave()，玩家一進牌局就從桌上消失了。 */
function hide() {
  Net.unwatchGroups();
  screen(null);
}

/* 從牌局裡退桌：跟房間裡按「離開」一樣退出群組，但不回大廳畫面（呼叫端自己決定去哪） */
function quit() {
  Net.unwatchRoom();
  watching = false;
  Net.leaveGroup().catch(() => {});
  cur = null;
  screen(null);
}

/* 一場打完有人統一天下：全員回到房間（不退桌）。之後可以等新人加入，或直接按開始接著打 */
function backToRoom() {
  if (!cur) return;
  cur.entered = false;
  cur.ready = false;
  Net.updateMyReady(false);           // 下一場要重新確認
  cur.campSynced = false;           // 記錄剛更新過，重新放上成員資料
  screen('net-room');
  if (cur.last) renderRoom(cur.last);
}

/* 連線擇國而立選完（或取消）：回到房間畫面 */
function showRoom() {
  if (!cur) return;
  screen('net-room');
  if (cur.last) renderRoom(cur.last);
}

return { init, open, close, hide, leave: quit, backToRoom, showRoom, slots, slotsSave, rosterOf,
         get myName() { return myName; }, get current() { return cur; } };
});
