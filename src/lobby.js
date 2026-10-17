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

/* ── 七國進度（src/online-progress.js，docs/online-kingdoms.md，2026-10-16）──
   進度跟著人走、一國一份：加入任何一桌都要擇國，選到有進度的國就帶進來。
   舊的「一桌一段戰役、十格連線存檔、退出此牌局」整套不用了（使用者：舊存檔「清掉重來」）。 */
const OP = () => window.MJOnlineProgress;
function progress() { try { return OP() ? OP().load(localStorage) : { kingdoms: {} }; } catch (_) { return { kingdoms: {} }; } }
/* 這個分頁的代號（一個瀏覽器只能在一桌：別的分頁拿著鎖就不能上桌） */
const TAB = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
let lockTimer = null;
function otherTab() { try { return OP() ? OP().lockedByOther(localStorage, TAB) : null; } catch (_) { return null; } }
function takeLock(info) {
  if (!OP()) return true;
  if (!OP().lock(localStorage, TAB, info)) return false;
  // 登入的人：雲端也記一筆「這個帳號正在哪一桌」，另一台裝置就擋得到（v1.69）
  Net.claimSession({ tab: TAB, table: (info && info.table) || '' });
  clearInterval(lockTimer);
  lockTimer = setInterval(() => {
    try { OP().lock(localStorage, TAB, {}); } catch (_) {}
    const l = OP().readLock(localStorage);
    Net.claimSession({ tab: TAB, table: (l && l.table) || '' });
  }, 10000);
  return true;
}
function dropLock() {
  clearInterval(lockTimer); lockTimer = null;
  try { OP() && OP().unlock(localStorage, TAB); } catch (_) {}
  Net.releaseSession(TAB);
}
if (typeof window !== 'undefined') window.addEventListener('pagehide', dropLock);
/* 擋第二個分頁：回 true＝擋下了 */
function blockedByOtherTab() {
  const l = otherTab();
  if (!l) return false;
  toast('你已經在「' + (l.table || '另一桌') + '」了（另一個分頁）—— 同一個瀏覽器一次只能在一桌');
  return true;
}
/* 登入的人：同一個帳號在別台裝置上桌了 → 擋（uid 一樣，兩台同時上桌會撞身分）。回 Promise<是否擋下> */
const SESSION_TTL = 30000;
function blockedElsewhere() {
  if (blockedByOtherTab()) return Promise.resolve(true);
  return Net.readSession().then(v => {
    if (!v || v.tab === TAB) return false;
    const now = Date.now() + (Net.timeOffset || 0);
    if (now - (v.at || 0) > SESSION_TTL) return false;           // 過期（那台關掉了、網路斷了）
    toast('你的帳號正在「' + (v.table || '另一桌') + '」（另一台裝置或分頁）—— 同一個玩家一次只能在一桌');
    return true;
  }).catch(() => false);
}

/* ── 選用的登入（v1.69，docs/online-kingdoms.md 第十一節）──
   不登入照樣能玩（進度存這個瀏覽器）；登入之後進度存雲端，換裝置也能接著打。只能在大廳登入／登出。 */
function renderAccount() {
  const a = Net.account ? Net.account() : { loggedIn: false };
  const st = byId('acct-status');
  if (!st) return;
  st.textContent = a.loggedIn
    ? '已登入：' + (a.email || '') + (a.provider === 'google' ? '（Google）' : '（Email）') + '　進度存在雲端，換裝置也能接著打'
    : '未登入：進度只存在這個瀏覽器。登入之後換裝置也能接著打';
  show('acct-google', !a.loggedIn);
  show('acct-email', !a.loggedIn);
  show('acct-logout', a.loggedIn);
}
/* 登入之後（或每次進大廳）：這台的進度跟雲端合併。同一國取打過比較多場的那一份，不一樣的告訴玩家 */
function syncProgress() {
  if (!OP() || !Net.account().loggedIn) return Promise.resolve();
  return Net.loadCloudProgress().then(cloud => {
    const r = OP().merge(progress(), cloud || {});
    if (r.localChanged) OP().save(localStorage, r.data);
    if (r.cloudChanged) Net.saveCloudKingdoms(r.data.kingdoms);
    const K = window.MJKingdoms;
    if (r.notes.length) {
      toast(r.notes.map(n => (K && K.get(n.kingdom) ? K.get(n.kingdom).name : n.kingdom)
        + '用了' + (n.from === 'cloud' ? '雲端（別台）' : '這台') + '的進度（打過 ' + n.matches + ' 場；另一份 ' + n.other + ' 場）').join('；'));
    }
    renderLobby();
  }).catch(() => {});
}
/* 一國的進度變了（一場打完、統一）：登入的話推上雲端。rec＝null 代表那一國刪掉 */
function pushProgress(kingdom) {
  if (!OP() || !Net.account || !Net.account().loggedIn) return;
  Net.saveCloudKingdom(kingdom, OP().get(progress(), kingdom));
}
function loginMsg(e) {
  const c = (e && e.code) || (e && e.message) || '';
  if (/popup-closed|cancelled-popup/.test(c)) return '登入視窗被關掉了';
  if (/popup-blocked/.test(c)) return '瀏覽器擋住了登入視窗：請允許這個網站開彈出視窗，再按一次';
  if (/invalid-email/.test(c)) return 'Email 格式不對';
  if (/operation-not-allowed/.test(c)) return '這種登入方式還沒開放（Firebase 後台要先打開）';
  if (/unauthorized-domain/.test(c)) return '這個網址還不能登入（Firebase 後台要把網址加進允許清單）';
  if (/network/.test(c)) return '網路不通，等一下再試';
  // Firebase 免費方案每天能寄的登入信有上限；同一個 Email 短時間按太多次也會被擋
  if (/quota-exceeded/.test(c)) return '今天寄登入信的次數已經用完了（Firebase 免費方案每天有上限）。\n明天再試，或先用 Google 登入。';
  if (/too-many-requests/.test(c)) return '按太多次了，Firebase 暫時擋住。\n等幾分鐘再試。';
  if (/unauthorized-continue-uri|invalid-continue-uri|missing-continue-uri/.test(c)) return '這個網址不能收登入信（Firebase 後台的允許網域要加上它）\n' + c;
  if (/invalid-action-code|expired-action-code/.test(c)) return '這封登入信的連結已經用過或過期了，請再寄一次';
  if (/NOEMAIL/.test(c)) return '沒有輸入 Email，沒登入';
  if (/weak-password|password-does-not-meet/.test(c)) return '密碼太短，至少要 6 個字';
  if (/missing-password/.test(c)) return '沒有輸入密碼';
  if (/user-disabled/.test(c)) return '這個帳號被停用了';
  return '登入失敗：' + c;
}
/* 要玩家看完才關的訊息（寄信、登入失敗）。舊版頁面沒有 MJNotice 就退回 toast */
function notice(msg) {
  if (typeof window.MJNotice === 'function') return window.MJNotice(msg);
  toast(msg);
  return Promise.resolve();
}
function afterLogin(a) {
  renderAccount();
  toast('已登入：' + (a.email || ''));
  return syncProgress();
}
function doLoginGoogle() {
  Net.loginGoogle().then(afterLogin).catch(e => notice(loginMsg(e)));
}
/* 「用 Email 登入」：v1.75 起是 Email＋密碼。舊版頁面的輸入框不認密碼模式（會用明碼、限 16 字）→ 照舊寄登入信 */
function doLoginEmail() {
  if (window.MJAsk && window.MJAsk.password && typeof window.MJConfirm === 'function' && Net.loginPassword) return doLoginPassword();
  doLoginLink();
}
const LAST_EMAIL_KEY = 'jcmj_last_email';
function isBadCred(e) { return /invalid-credential|invalid-login-credentials|wrong-password|user-not-found|invalid-password/.test((e && e.code) || ''); }
/* 帳號不存在跟密碼錯分不出來（防 Email 列舉，見 net.js）→ 請玩家再打一次：
   跟剛才一樣＝第一次用，幫他註冊；不一樣＝剛才打錯了，用新的再登入一次 */
function doLoginPassword() {
  let lastEm = '';
  try { lastEm = localStorage.getItem(LAST_EMAIL_KEY) || ''; } catch (_) {}
  let em = '';
  const done = a => { try { localStorage.setItem(LAST_EMAIL_KEY, em); } catch (_) {} return afterLogin(a); };
  const tryLogin = (pw, round) => Net.loginPassword(em, pw).then(done).catch(e => {
    if (!isBadCred(e)) throw e;
    if (round >= 4) return notice('密碼一直不對。\n忘了密碼的話，再按一次「用 Email 登入」，在問密碼時按「忘記密碼」。');
    return ask('登入不了：密碼不對，或這個 Email 還沒註冊過。\n\n‧ 打錯了：重打一次密碼\n‧ 第一次用：再打一次同一組密碼，就幫你註冊\n‧ 忘了密碼：按「忘記密碼」',
      '', { password: true, newPassword: true, cancelLabel: '忘記密碼' }).then(pw2 => {
      if (pw2 == null) return forgot();
      if (pw2 === pw) return register(pw);
      return tryLogin(pw2, round + 1);
    });
  });
  const register = pw => Net.registerPassword(em, pw).then(a => {
    done(a);
    return notice('註冊好了，已登入：\n' + em + '\n\n之後在任何一台（包括加到主畫面的 App）按「用 Email 登入」、打這組密碼就行，不用收信。');
  }).catch(e => {
    if (/email-already-in-use|credential-already-in-use/.test((e && e.code) || '')) {
      return MJConfirm('這個 Email 已經註冊過了，所以是密碼不對。\n（用 Google 登入過的 Email，請改按「用 Google 登入」）\n\n要寄一封「重設密碼」的信嗎？', '寄重設信', '不用')
        .then(y => { if (y) return sendReset(); });
    }
    throw e;
  });
  const forgot = () => MJConfirm('寄一封「重設密碼」的信到\n' + em + '？', '寄信', '取消').then(y => { if (y) return sendReset(); });
  const sendReset = () => Net.sendPasswordReset(em).then(() => notice(
    '重設密碼的信已寄到\n' + em + '\n\n點信裡的連結設新密碼（在哪台點都可以），\n設好之後回到這裡，用新密碼登入。\n' +
    '寄件人是 noreply@jcmj-4p.firebaseapp.com\n幾分鐘內沒收到，請看垃圾信件匣。\n（outlook.com／hotmail 信箱可能完全收不到，這時請改用 Google 登入）'));

  ask('輸入你的 Email', lastEm, { email: true }).then(v => {
    em = String(v || '').trim();
    if (!em) return;
    return ask('輸入密碼\n（第一次用：這就是你要設定的密碼，至少 6 個字）', '', { password: true }).then(pw => {
      if (!pw) return;
      return tryLogin(pw, 1);
    });
  }).catch(e => { if (e && e.message !== 'NOASK') notice(loginMsg(e)); });
}
function doLoginLink() {
  ask('輸入你的 Email（會寄一封登入信過去）', '', { email: true }).then(em => {
    em = String(em || '').trim();
    if (!em) return;
    return Net.sendEmailLink(em).then(() => notice(
      '登入信已寄到\n' + em + '\n\n請在這台裝置打開那封信、點裡面的連結，就會登入。\n' +
      '寄件人是 noreply@jcmj-4p.firebaseapp.com\n幾分鐘內沒收到，請看垃圾信件匣。'));
  }).catch(e => { if (e && e.message !== 'NOASK') notice(loginMsg(e)); });
}
/* 從登入信的連結打開這一頁：完成登入。這台沒記著 email（別台按寄信、這台點連結）就問一次 */
function finishEmailLogin() {
  return Net.finishEmailLink(() => ask('確認一下 Email（要跟收到信的那個一樣）', '', { email: true }))
    .then(afterLogin).catch(e => notice(loginMsg(e)));
}
function doLogout() {
  const b = byId('acct-logout');
  if (!b.dataset.armed) {
    b.dataset.armed = '1';
    b.textContent = '再按一次登出（這台不會留著你的進度，都在雲端）';
    setTimeout(() => { delete b.dataset.armed; b.textContent = '登出'; }, 4000);
    return;
  }
  delete b.dataset.armed; b.textContent = '登出';
  // 登出：這台的連線進度清掉（都在雲端，再登入就回來）—— 公用的電腦不會留給下一個人
  try { OP() && OP().save(localStorage, { kingdoms: {} }); } catch (_) {}
  Net.logout().then(() => { renderAccount(); renderLobby(); toast('已登出'); }).catch(e => toast('登出失敗：' + (e && e.code || e)));
}

/* ── 連線戰役的存檔（src/online-campaign.js，docs/online-campaign.md）── 【v1.68 起不用，保留給舊版頁面】
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
function ask(message, def, opts) {
  // opts 給 Email 用（{ email: true }）；舊版頁面的 MJAsk 只吃兩個參數，多傳的會被忽略（照舊 16 字）
  if (typeof window.MJAsk === 'function') return window.MJAsk(message, def, opts);
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
  /* 「繼續之前的牌桌（十格連線存檔）」拿掉了（v1.68）：進度跟著人走，選國時就帶進來。
     這一區改成列出自己的七國進度，讓玩家知道帶得進來的有哪些 */
  const d = progress();
  const ids = Object.keys(d.kingdoms || {});
  const rbox = byId('lobby-recent');
  clear(rbox);
  show('lobby-recent-wrap', ids.length > 0);
  const K = window.MJKingdoms;
  ids.forEach(id => {
    const sm = OP().summary(d, id);
    const k = K && K.get(id);
    rbox.appendChild(row('net-row', `<b>${esc(k ? k.name : id)}</b><span>征服 ${sm.conquered} 國　國庫 ${sm.gold.toLocaleString()} 兩　打過 ${sm.matches} 場</span>`));
  });
  const lb = byId('lobby-recent-wrap').querySelector('.net-label');
  if (lb) lb.textContent = '你的連線進度（加入牌桌時選同一國就能接著打）';
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
  /* v1.79（第 3 階段）：進行中的牌桌也列出來，可以中途加入、下一場入座。等待中的排前面 */
  const waiting = list.filter(g => g.status === 'waiting');
  const playing = list.filter(g => g.status === 'started');
  const open = waiting.concat(playing);
  byId('lobby-groups-empty').style.display = open.length ? 'none' : '';
  byId('lobby-groups-empty').textContent = '目前沒有人開桌，按上面「開一桌」自己開一個';
  // ⚠️ 清單是 watchGroups 非同步推過來的，項目一變焦點清單就變了。
  //    不重抓的話，方向鍵會停在已經被移除的舊節點上（畫面看起來沒有焦點框）。
  setTimeout(() => { if (window.MJInput) window.MJInput.refresh(); }, 0);

  open.forEach(g => {
    const n = g.count || 0;
    const lv = LEVEL_NAME[g.aiLevel] || '普通';
    const full = n >= SEATS;
    const mid = g.status === 'started';
    const info = mid
      ? `進行中${g.progress ? '（' + esc(g.progress) + '）' : ''}・${full ? '坐滿了' : '空 ' + (SEATS - n) + ' 位，下一場入座'}　電腦：${lv}`
      : `${n}/${SEATS} 人　電腦：${lv}${full ? '　（滿了）' : ''}`;
    box.appendChild(row('net-row' + (full ? ' full' : '') + (mid ? ' playing' : ''),
      `<b>${esc(g.name || g.key)}</b><span>${info}</span>`,
      full ? null : () => doJoin(g.key, mid)));
  });
}

/* ── 建群組 ───────────────────────────────────────────────
   電腦難度在**建房時**就決定，並寫進 groups/{key}，讓大廳列表看得到。
   理由：這個遊戲輸一場會掉一個國家，玩家該在進房前就知道風險，
   而不是進去了才發現群主設了高手局。                             */
function doCreate(presetName) {
  blockedElsewhere().then(b => { if (!b) doCreate2(presetName); });
}
function doCreate2(presetName) {
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
  // v1.68：牌桌只是房間，不再是一段戰役（沒有序號、沒有名冊）
  return openTable(name, { aiLevel: aiLevelNow() });
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

function doJoin(key, mid) {
  blockedElsewhere().then(b => { if (!b) doJoin2(key, mid); });
}
function doJoin2(key, mid) {
  Net.joinGroup(key, myName, { mid: !!mid })
    .then(g => {
      const dn = (g && g.displayName) || key;
      rememberGroup(dn);
      // 進行中的桌：先待入座（這一場打完由開桌的人排進下一場）。記下加入時是第幾場，換場了才算輪到我
      const pending = !!(g && g.status !== 'waiting');
      enterRoom(key, dn, false, pending ? { pending: true, joinGameId: g.gameId || null } : null);
    })
    .catch(e => {
      const m = e && e.message;
      if (m === 'STARTED') toast('這一桌已經開打了');
      else if (m === 'FULL') toast('這一桌已經坐滿四位主公了');
      else if (m === 'GONE') toast('這個群組已經不在了');
      else toast('加入失敗：' + m);
    });
}

/* ═══════════ 房間 ═══════════ */

function enterRoom(key, displayName, isHost, extra) {
  // 一個瀏覽器只能在一桌：開桌／加入前已經擋過一次，這裡拿鎖時再擋一次（兩個分頁同時按的情況）
  if (!takeLock({ table: displayName, kingdom: null })) {
    blockedByOtherTab();
    Net.leaveGroup().catch(() => {});
    return;
  }
  cur = Object.assign({ key, displayName, isHost }, extra || {});
  byId('room-name').textContent = displayName;
  screen('net-room');
  startWatching();
}

/* 進房後第一次拿到房間資料：一進來就擇國而立（v1.68：不論新桌、進行中，每一桌都要選）。
   選好了才把那一國的進度快照放上成員資料（syncMyProgress），給同桌看、開局排座位用 */
function syncMyCamp(g) {
  if (!cur || cur.campSynced || !g) return true;
  cur.campSynced = true;
  if (cur.picked) { syncMyProgress(); return true; }
  if (cfg.onPickKingdom) setTimeout(pickKingdom, 350);
  return true;
}
/* 把我選的那一國的進度快照放上成員資料（征服地、場數、國庫）。一場打完進度變了也要再放一次 */
/* 開局時：鎖上記下這一桌分到的國（遊戲那邊呼叫；撞國時群主可能換過） */
function lockKingdom(k) { try { OP() && OP().lock(localStorage, TAB, { kingdom: k || null }); } catch (_) {} }
function syncMyProgress() {
  const k = Net.prefKingdom;
  if (!k || !OP()) return;
  Net.updateMyCamp(OP().snapshot(OP().forTable(progress(), k, myName)));
  try { OP().lock(localStorage, TAB, { kingdom: k }); } catch (_) {}
}

/* 別人已經用掉的國：名冊上其他人的、房間裡其他人**選好的**（還在選國畫面的人沒選定，不算） */
function takenKingdoms(g) {
  // v1.68：沒有名冊了，只看房間裡其他人**選好的**（還在選國畫面的人沒選定，不算）
  return (g.members || []).filter(m => !m.me && m.picked).map(m => m.kingdom).filter(Boolean);
}

/* 連線擇國而立 */
function pickKingdom() {
  const g = cur && cur.last;
  if (!g || !cfg.onPickKingdom) return;
  screen(null);                                          // 選國畫面在大廳底下，先把房間收起來
  cur.picking = true;
  if (cur.ready) setReady(false);                        // 改選國就要重新確認
  // 每一國的卡片上顯示自己的進度（有進度的選了就帶進來）
  const d = progress();
  const prog = {};
  Object.keys(d.kingdoms || {}).forEach(id => { prog[id] = OP().summary(d, id); });
  cfg.onPickKingdom({
    taken: takenKingdoms(g), current: Net.prefKingdom, progress: prog,
    done: k => {
      cur.picking = false;
      if (!k) return;
      cur.picked = true;
      Net.updateMyKingdom(k);
      Net.updateMyPicked && Net.updateMyPicked(true);
      Net.prefKingdom = k;
      syncMyProgress();
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
  return !!cur.picked;          // v1.68：每個人都要先擇國
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
  byId('room-count').textContent = cur.pending
    ? `牌桌進行中${g.progress ? '（' + g.progress + '）' : ''}　` + (cur.picked ? '這一場打完你就入座' : '先擇國而立，這一場打完就入座')
    : `${n}/${SEATS} 人` + (n < SEATS ? `　不足的 ${SEATS - n} 家由電腦補上` : '');
  byId('room-ai').textContent = '電腦強度：' + (LEVEL_NAME[g.aiLevel] || '普通');

  const box = byId('room-members');
  clear(box);
  /* 「征服 N 國・國庫 X 兩」（v1.78，docs/online-kingdoms.md 第七節：大家看得到彼此的國庫）；低於 300 兩紅字。
     沒帶國庫的快照（舊版頁面放上來的）照舊只寫征服 */
  const conq = c => {
    if (!c) return '';
    const n = toArr(c.conquered).length;
    const parts = [];
    if (n) parts.push('征服 ' + n + ' 國');
    if (typeof c.gold === 'number') {
      const low = window.MJCampaign && c.gold < window.MJCampaign.LOW_GOLD;
      parts.push('<span' + (low ? ' style="color:#ff8a70;font-weight:700"' : '') + '>國庫 ' + c.gold.toLocaleString() + ' 兩</span>');
    }
    return parts.length ? '　' + parts.join('・') : '';
  };
  const kname = id => { const k = window.MJKingdoms && window.MJKingdoms.get(id); return k ? k.name : ''; };
  members.forEach(m => {
    // 還沒選定的人不顯示國名（選國畫面上的游標不算數）
    const k = m.picked ? kname(m.kingdom) : '';
    // 進行中的桌（我在等入座）：牌桌上的人標「牌桌上」，等入座的標「下一場入座」
    const rd = cur.pending ? (m.pending ? '　⋯ 下一場入座' : '　🀄 牌桌上')
             : m.isHost ? '' : (m.ready ? '　✔ 已準備' : '　⋯ 準備中');
    const camp = m.picked && m.camp && m.camp.kingdom === m.kingdom ? m.camp : null;
    box.appendChild(row('net-row',
      `<b>${esc(m.name || '?')}${k ? '　' + k : '　（選國中）'}</b><span>${m.me ? '（你）' : ''}${m.isHost ? '　開桌' : ''}${rd}${conq(camp)}</span>`));
  });
  // v1.68：沒有名冊、沒有缺席（不保留座位），也沒有「退出此牌局」（進度跟著人走）
  show('room-quit', false);
  show('room-pick', !!cfg.onPickKingdom);
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

  show('room-start', cur.isHost && !cur.pending);
  show('room-ready', !cur.isHost && !cur.pending);       // 等入座：選好國就是排隊了，不用按準備
  show('room-wait', !cur.isHost && !!cur.ready && !cur.pending);
  if (window.MJInput) setTimeout(() => window.MJInput.refresh(), 0);
}

function startWatching() {
  if (watching) return;
  watching = true;
  Net.watchRoom(g => {
    // 牌局中：成員進出（斷線、連回來、換群主）交給遊戲處理，大廳畫面不動
    if (cur && cur.entered) { cancelHostWatch(); if (cfg.onRoom) cfg.onRoom(g); return; }
    if (!g) { leave(true); return; }          // 群組沒了
    // 中途加入、還在等下一場（v1.79）：不進牌局，房間畫面顯示牌桌現況
    if (g.status === 'started' && cur.pending) { pendingRoom(g); return; }
    // 開局只進一次 —— 房間資料之後每變一次（有人斷線、改名）都會再觸發，不擋就會重複開局
    if (g.status === 'started') { if (!cur.entered) enterGame(g); return; }
    // 牌桌回到等待中（有人統一天下、或牌桌上的人全走了）：等入座的人變成一般成員，照常準備、開局
    if (cur.pending) { cur.pending = false; cancelOrphanWatch(); Net.updateMyPending(false); }
    watchHostGone(g);
    renderRoom(g);
  });
}

/* ── 開桌的人在等待室斷線 ──
   他按「離開」是 Net.leaveGroup 收拾的（那條路自己會交棒）；這裡管的是**沒按就不見了**
   （關分頁、斷網、當機）：onDisconnect 只刪他的成員節點，groups/host 還指著他，
   房間裡剩下的人一個都按不到「開始牌局」，只能各自退出重開一桌。
   等 10 秒再換，跟牌局中換群主同一個緩衝（NET_GRACE_MS）—— 網路瞬斷的人會自己補寫回
   成員名單（Net._watchRejoin），不給這段時間就會把人家踢下開桌位。
   每台都會跑這段，真正寫進去的只有一台（Net.maybeReassignHost 用 transaction）。 */
const HOST_GRACE_MS = 10000;
let hostGoneTimer = null;

function cancelHostWatch() {
  if (hostGoneTimer) { clearTimeout(hostGoneTimer); hostGoneTimer = null; }
}

function watchHostGone(g) {
  const gone = g.host && !(g.members || []).some(m => m.id === g.host);
  if (!gone) { cancelHostWatch(); return; }
  if (hostGoneTimer) return;      // 已經在等了；房間資料每變動一次就重新計時的話永遠等不到
  const oldHost = g.host;
  hostGoneTimer = setTimeout(() => {
    hostGoneTimer = null;
    const last = cur && cur.last;
    // 這 10 秒裡他連回來了、別台已經換過、或我自己已經離開這桌 → 不用動
    if (!last || last.host !== oldHost) return;
    if ((last.members || []).some(m => m.id === oldHost)) return;
    Net.maybeReassignHost(last.members || [], oldHost);
  }, HOST_GRACE_MS);
}

/* ── 中途加入、等下一場入座（v1.79，docs/online-kingdoms.md 第三節）──
   ‧ 一進來一樣擇國而立（選好就等於排隊入座，不用再按準備 —— 2026-10-17 使用者同意）
   ‧ 這一場打完，開桌的人把「選好國的待入座者」跟留下來的主公一起排進下一場（next.stay 有我）
     → 換了一場（gameId 不是我加入時那一場）就進牌局
   ‧ 牌桌上的人全斷線了、房間裡只剩待入座的人：等 15 秒，最早加入的那位把牌桌接下來變回等待中 */
const ORPHAN_MS = 15000;
let orphanTimer = null;
function cancelOrphanWatch() { if (orphanTimer) { clearTimeout(orphanTimer); orphanTimer = null; } }
function pendingRoom(g) {
  cur.last = g;
  syncMyCamp(g);
  const stay = toArr(g.next && g.next.stay);
  if (stay.indexOf(Net.clientId) >= 0 && g.gameId && g.gameId !== cur.joinGameId) {
    cancelOrphanWatch();
    cur.pending = false;
    Net.updateMyPending(false);
    toast('輪到你入座了');
    enterGame(g);
    return;
  }
  const members = g.members || [];
  if (members.length && members.every(m => m.pending)) {
    if (!orphanTimer) orphanTimer = setTimeout(() => {
      orphanTimer = null;
      const last = cur && cur.last;
      if (!cur || !cur.pending || !last || last.status !== 'started') return;
      const ms = (last.members || []).slice().sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0));
      if (!ms.length || !ms.every(m => m.pending) || ms[0].id !== Net.clientId) return;
      Net.handToWaiting(Net.clientId);
      toast('牌桌上的主公都離開了，這一桌交給你');
    }, ORPHAN_MS);
  } else cancelOrphanWatch();
  renderRoom(g);
}

function enterGame(g) {
  cur.entered = true;
  cancelHostWatch();
  cur.ready = false;
  Net.updateMyReady(false);
  const ctx = {
    gameId: g.gameId || null,
    groupKey: cur.key,
    groupName: cur.displayName,
    isHost: g.host === Net.clientId,
    members: (g.members || []).slice(),
    aiLevel: g.aiLevel || 2,
    campaign: null,                // v1.68：牌桌不再是一段戰役（進度跟著人走）
    myClientId: Net.clientId,
  };
  if (cfg.onEnterGame) cfg.onEnterGame(ctx);
}

function leave(silent) {
  cancelOrphanWatch();
  dropLock();
  Net.unwatchRoom();
  cancelHostWatch();
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
  const ag = byId('acct-google'), ae = byId('acct-email'), al = byId('acct-logout');
  if (ag) ag.addEventListener('click', doLoginGoogle);
  if (ae) ae.addEventListener('click', doLoginEmail);
  if (al) al.addEventListener('click', doLogout);
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
    // v1.68：舊的一桌一段存檔「清掉重來」（使用者 2026-10-16）。有刪到東西就提示一次
    try { if (OP() && OP().clearOld(localStorage)) toast('連線改成「七國進度」：每一國一份、換桌也帶著。舊的連線存檔已清除'); } catch (_) {}
    renderAccount();
    renderLobby();
    // 從登入信的連結打開的：完成登入；已經登入的：跟雲端對一次（別台打過的拿回來）
    if (Net.isEmailLink && Net.isEmailLink()) finishEmailLogin();
    else syncProgress();
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
  dropLock();
  Net.unwatchRoom();
  watching = false;
  Net.leaveGroup().catch(() => {});
  cur = null;
  screen(null);
}

/* 一場打完有人統一天下：全員回到房間（不退桌）。之後可以等新人加入，或直接按開始接著打 */
function backToRoom() {
  if (!cur) return;
  cur.pending = false;
  cur.entered = false;
  cur.ready = false;
  Net.updateMyReady(false);           // 下一場要重新確認
  cur.campSynced = false;           // 進度剛更新過，重新放上成員資料
  screen('net-room');
  if (cur.last) renderRoom(cur.last);
}

/* 連線擇國而立選完（或取消）：回到房間畫面 */
function showRoom() {
  if (!cur) return;
  screen('net-room');
  if (cur.last) renderRoom(cur.last);
}

return { init, open, close, hide, leave: quit, backToRoom, showRoom, slots, slotsSave, rosterOf, syncMyProgress, lockKingdom, pushProgress,
         get myName() { return myName; }, get current() { return cur; } };
});
