/* ═══════════════════════════════════════════════════════════════
   feedback.js — 問題反應與意見諮詢（v2.07，docs/feedback.md）
   ───────────────────────────────────────────────────────────────
   2026-10-25 使用者：「在說明裡加入一欄讓玩家反應問題的功能……反應的問題填入 firebase，我們之後要來處理意見反應」
   「我們處理後是否也可以寫回 firebase 該玩家上線就可以看到？」

   資料：/feedback/{uid}/{推送 key} = { cat, text, contact?, at, ver, name?, info, [status, reply, replyAt] }
     ‧ 玩家只能新增、讀自己名下的（不能改、不能刪）；status／reply／replyAt 只有管理者能寫
     ‧ 管理者＝ /admins/{uid} === true（只能用 firebase CLI 寫，網頁寫不進去）。管理頁：devtools/意見反應v0.1.html
   單機也能送：送出的那一刻才連 Firebase（匿名登入），不送就完全不碰網路。
   有新回覆的紅點：送過意見的這台（localStorage 記著）開遊戲時讀一次自己的意見，回覆時間比「看過的」新就亮。
   ⚠️ 匿名身分只存在這個瀏覽器：換裝置、清網站資料就讀不到以前的意見。登入（Google／Email）後送的才跟著帳號走。
   ⚠️ src/*.js 各版共用，但只有 v2.07 之後的頁面會載這一支 —— 舊版頁面完全不受影響。
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const SENT_KEY = 'jcmj_fb_sent';      // 這台送過意見（開遊戲時才需要去查有沒有回覆）
  const SEEN_KEY = 'jcmj_fb_seen';      // 看過的回覆裡最新的 replyAt
  const LAST_KEY = 'jcmj_fb_last';      // 上一次送出的時間（一分鐘內不能再送）
  const COOLDOWN_MS = 60 * 1000;
  const MAX_TEXT = 1000;
  const CATS = { bug: '問題回報', idea: '意見建議', other: '其他' };
  const STATUS = { '': '已送出', seen: '已讀', replied: '已回覆', done: '已處理' };

  const ls = {
    get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
    set(k, v) { try { localStorage.setItem(k, String(v)); } catch (_) {} },
  };

  /* ── 最近的 JS 錯誤：送出時附上，查問題用（只留最後 5 筆、每筆截短）── */
  const errors = [];
  function note(msg) {
    msg = String(msg || '').slice(0, 300);
    if (!msg) return;
    errors.push(new Date().toTimeString().slice(0, 8) + ' ' + msg);
    if (errors.length > 5) errors.shift();
  }
  window.addEventListener('error', e => {
    note((e.message || 'error') + (e.filename ? ' @' + String(e.filename).split('/').pop() + ':' + e.lineno : ''));
  });
  window.addEventListener('unhandledrejection', e => {
    const r = e.reason;
    note('promise: ' + ((r && (r.message || r.code)) || r));
  });

  function ready() {
    if (typeof Net === 'undefined' || !Net.init()) return Promise.reject(new Error('NONET'));
    return Net.signIn().then(() => Net.uid);
  }

  /* 還要等幾毫秒才能再送（0＝現在就能送） */
  function cooldownLeft() {
    const last = Number(ls.get(LAST_KEY)) || 0;
    return Math.max(0, last + COOLDOWN_MS - Date.now());
  }

  /* 送出。o = { cat, text, contact, ver, name, info(物件) } → Promise<推送 key> */
  function send(o) {
    const text = String(o.text || '').trim().slice(0, MAX_TEXT);
    if (!text) return Promise.reject(new Error('EMPTY'));
    if (cooldownLeft() > 0) return Promise.reject(new Error('COOLDOWN'));
    return ready().then(uid => {
      const rec = {
        cat: CATS[o.cat] ? o.cat : 'other',
        text,
        at: firebase.database.ServerValue.TIMESTAMP,
        ver: String(o.ver || '').slice(0, 40),
        info: JSON.stringify(Object.assign({}, o.info || {}, { errors: errors.slice() })).slice(0, 4000),
      };
      const contact = String(o.contact || '').trim().slice(0, 200);
      if (contact) rec.contact = contact;
      const name = String(o.name || '').trim().slice(0, 40);
      if (name) rec.name = name;
      const ref = Net.db.ref('feedback/' + uid).push();
      return ref.set(rec).then(() => {
        ls.set(SENT_KEY, '1');
        ls.set(LAST_KEY, Date.now());
        return ref.key;
      });
    });
  }

  /* 自己名下的意見，新的在前。沒送過就不連線（回空陣列） */
  function mine(force) {
    if (!force && !ls.get(SENT_KEY)) return Promise.resolve([]);
    return ready().then(uid => Net.db.ref('feedback/' + uid).once('value')).then(s => {
      const v = s.val() || {};
      return Object.keys(v).map(id => Object.assign({ id }, v[id]))
        .sort((a, b) => (b.at || 0) - (a.at || 0));
    });
  }

  const seenAt = () => Number(ls.get(SEEN_KEY)) || 0;
  /* 幾則回覆還沒看過 */
  function unseen(list) {
    const t = seenAt();
    return (list || []).filter(f => f.reply && (f.replyAt || 0) > t).length;
  }
  /* 看過了：記下最新的回覆時間 */
  function markSeen(list) {
    const t = (list || []).reduce((m, f) => Math.max(m, f.reply ? (f.replyAt || 0) : 0), seenAt());
    ls.set(SEEN_KEY, t);
  }

  window.MJFeedback = {
    CATS, STATUS, MAX_TEXT, COOLDOWN_MS,
    send, mine, unseen, markSeen, cooldownLeft,
    seenAt,
    hasSent: () => !!ls.get(SENT_KEY),
    errors: () => errors.slice(),
  };
})();
