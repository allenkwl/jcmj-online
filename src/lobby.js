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

let cfg = { onEnterGame: null, onBack: null };
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

  // 之前玩過的
  const rc = recent();
  const wrap = byId('lobby-recent-wrap');
  const rbox = byId('lobby-recent');
  clear(rbox);
  show('lobby-recent-wrap', rc.length > 0);
  rc.forEach(name => rbox.appendChild(
    row('net-row', `<b>${esc(name)}</b><span>再開一次</span>`, () => doCreate(name))));

  // 現有群組（由 watchGroups 持續更新）
  byId('lobby-groups-empty').textContent = '搜尋中⋯';
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

function finishCreate(name) {
  const onBtn = byId('lobby-ailevel').querySelector('button.on');
  const lv = Number(onBtn && onBtn.dataset.v) || 2;
  return Net.createGroup(name, myName, { aiLevel: lv })
    .then(key => { rememberGroup(name); enterRoom(key, name, true); })
    .catch(e => {
      if (e && e.message === 'EXISTS') toast('這個名字已經有人用了，換一個');
      else toast('開群組失敗：' + (e && e.message));
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

function renderRoom(g) {
  if (!cur) return;
  // ⚠️ watchRoom 回的 members 是**陣列**（每筆已經是 {id,name,isHost,me}），
  //    不是以 id 為鍵的物件 —— 當成物件處理會矇對但很脆弱。
  const members = g.members || [];
  const n = members.length;
  cur.isHost = g.host === Net.clientId;

  byId('room-role').textContent = cur.isHost ? '你是群主' : '';
  byId('room-count').textContent = `${n}/${SEATS} 人` + (n < SEATS ? `　不足的 ${SEATS - n} 家由電腦補上` : '');
  byId('room-ai').textContent = '電腦強度：' + (LEVEL_NAME[g.aiLevel] || '普通');

  const box = byId('room-members');
  clear(box);
  members.forEach(m => box.appendChild(row('net-row',
    `<b>${esc(m.name || '?')}</b><span>${m.me ? '（你）' : ''}${m.isHost ? '　群主' : ''}</span>`)));

  show('room-start', cur.isHost);
  show('room-wait', !cur.isHost);
  if (window.MJInput) setTimeout(() => window.MJInput.refresh(), 0);
}

function startWatching() {
  if (watching) return;
  watching = true;
  Net.watchRoom(g => {
    if (!g) { leave(true); return; }          // 群組沒了
    // 開局只進一次 —— 房間資料之後每變一次（有人斷線、改名）都會再觸發，不擋就會重複開局
    if (g.status === 'started') { if (!cur.entered) enterGame(g); return; }
    renderRoom(g);
  });
}

function enterGame(g) {
  cur.entered = true;
  const ctx = {
    gameId: g.gameId || null,
    groupKey: cur.key,
    groupName: cur.displayName,
    isHost: g.host === Net.clientId,
    members: (g.members || []).slice(),
    aiLevel: g.aiLevel || 2,
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
    if (!cur || !cur.isHost) return;
    Net.startGame().catch(e => toast('開始失敗：' + (e && e.message)));
  });
  byId('room-leave').addEventListener('click', () => leave(false));
}

/* 進大廳。回傳 Promise —— 連線／登入可能失敗，呼叫端要能據此退回單機。 */
function open() {
  if (!Net.init()) return Promise.reject(new Error('NOFIREBASE'));
  return Net.signIn().then(() => {
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

return { init, open, close, hide, leave: quit, get myName() { return myName; }, get current() { return cur; } };
});
