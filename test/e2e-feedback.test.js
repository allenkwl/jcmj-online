/* 端對端：問題反應與意見諮詢（v2.07，src/feedback.js、devtools/意見反應v0.1.html、docs/feedback.md）
   ───────────────────────────────────────────────────────────────
   本機 Firebase 模擬器（database.rules.next.json —— 有 /feedback、/admins）＋ 無頭 Chromium：
     玩家：單機開一場 → 說明面板最上面是「問題反應與意見諮詢」、方向鍵一打開就在那顆鈕上
           → 寫意見送出（匿名登入、附帶版本與裝置資訊）→ 「您的意見」列出來、狀態「已送出」→ 一分鐘內不能再送
     管理頁：還不是管理者 → 顯示 uid、讀不到 → 加進 /admins → 看到那一則 → 回覆
     玩家：重開遊戲 → 標題畫面出現「有新回覆」→ 點開看到回覆 → 看過之後提醒消失、再開也不會再出現
   執行： node test/e2e-feedback.test.js                                                      */
'use strict';
const E = require('./_e2e.js');
const { ok, finish } = E.counter();
const chromium = E.findChromium();

const HELPERS = `
  window.__until = async (cond, max) => { const t0 = Date.now(); while (Date.now() - t0 < (max || 10000)) { try { if (cond()) return true; } catch (_) {} await new Promise(r => setTimeout(r, 80)); } try { return !!cond(); } catch (_) { return false; } };
  window.__vis = el => { if (!el) return false; if (el.offsetParent) return true; const cs = getComputedStyle(el); return cs.position === 'fixed' && cs.display !== 'none' && cs.visibility !== 'hidden'; };
`;
const ADMIN_EMAIL = 'admin@example.com', ADMIN_PW = 'admin-pw-123';

(async () => {
  if (!chromium) {
    ok(false, '找得到 Playwright', '請在專案資料夾跑：npm i -D playwright && npx playwright install chromium');
    return finish();
  }
  const kill = setTimeout(() => { console.log('超過 4 分鐘，強制結束'); process.exit(1); }, 240000);
  let emu = null, srv = null, browser = null;
  try {
    emu = await E.startEmulators({ rules: 'database.rules.next.json' });
    srv = await E.serve();
    const base = `http://127.0.0.1:${srv.address().port}/`;
    const latest = process.env.E2E_FILE || JSON.parse(require('fs').readFileSync(require('path').join(E.ROOT, 'latest.json'), 'utf8')).file;
    console.log('═══ 端對端：意見反應（' + latest + '）═══');
    const GAME = base + encodeURI(latest) + '?emu=1#test&mute';
    browser = await chromium.launch({ headless: true });

    /* ── 玩家 ── */
    const pctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    await pctx.addInitScript(() => { try { localStorage.setItem('jcmj_intro_seen', '1'); } catch (_) {} });
    const player = await pctx.newPage();
    const perr = [];
    player.on('pageerror', e => perr.push(String(e)));
    // ⚠️ 第二次起要 reload：網址一模一樣（含 #）時 goto 只是同一頁的錨點跳轉，頁面根本沒重新載入
    let loaded = false;
    const loadGame = async () => {
      if (loaded) await player.reload(); else await player.goto(GAME);
      loaded = true;
      await player.waitForFunction(() => window.MJDev && window.MJFeedback, null, { timeout: 20000 });
      await player.evaluate(HELPERS);
    };
    await loadGame();
    const r1 = await player.evaluate(async () => {
      const out = {};
      out.sentBefore = MJFeedback.hasSent();
      MJDev.quickStart('qin', 2, 0);
      out.table = await __until(() => __vis(document.getElementById('hud-help')), 15000);
      document.getElementById('hud-help').click();
      await __until(() => document.getElementById('help-ov').classList.contains('show'), 3000);
      await new Promise(r => setTimeout(r, 200));
      const card = document.querySelector('#help-ov .panel-card');
      const firstSec = card.querySelector('.help-sec h3');
      out.firstTitle = firstSec && firstSec.textContent;
      const kb = document.querySelector('.kbfocus');
      out.focus = kb && kb.id;
      document.getElementById('fb-open').click();
      out.open = await __until(() => document.getElementById('fb-ov').classList.contains('show'), 3000);
      out.empty = document.getElementById('fb-list').textContent;
      out.myTitle = [...document.querySelectorAll('#fb-ov h3')].map(h => h.textContent).join('|');
      out.note = document.getElementById('fb-note').textContent;
      // 空白不能送
      document.getElementById('fb-send').click();
      out.emptyMsg = document.getElementById('fb-msg').textContent;
      document.querySelector('#fb-cat button[data-cat="idea"]').click();
      document.getElementById('fb-text').value = '希望可以調整牌的大小';
      document.getElementById('fb-text').dispatchEvent(new Event('input'));
      out.len = document.getElementById('fb-len').textContent;
      document.getElementById('fb-contact').value = 'line:tester';
      document.getElementById('fb-send').click();
      out.sent = await __until(() => /已送出/.test(document.getElementById('fb-msg').textContent), 15000);
      out.msg = document.getElementById('fb-msg').textContent;
      out.listed = await __until(() => document.querySelectorAll('#fb-list .fb-item').length === 1, 8000);
      out.item = (document.querySelector('#fb-list .fb-item') || {}).textContent;
      out.cleared = document.getElementById('fb-text').value === '';
      out.cool = document.getElementById('fb-send').disabled && /秒/.test(document.getElementById('fb-send').textContent);
      out.uid = Net.uid;
      out.sentAfter = MJFeedback.hasSent();
      // B 鍵：先關意見面板、說明還在
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', bubbles: true }));
      await new Promise(r => setTimeout(r, 150));
      out.bClosesFb = !document.getElementById('fb-ov').classList.contains('show') && document.getElementById('help-ov').classList.contains('show');
      return out;
    });
    ok(!r1.sentBefore, '一開始這台沒送過意見', JSON.stringify(r1));
    ok(r1.table, '單機開一場、說明鈕出現');
    ok(r1.firstTitle === '問題反應與意見諮詢', '說明面板最上面一段是「問題反應與意見諮詢」', r1.firstTitle);
    ok(r1.focus === 'fb-open', '打開說明時方向鍵的焦點在「反應問題」那顆鈕上', r1.focus);
    ok(r1.open, '點了打開意見面板');
    ok(/您還沒有送過意見/.test(r1.empty), '還沒送過：「您還沒有送過意見」', r1.empty);
    ok(/我的意見/.test(r1.myTitle), '清單標題是「我的意見」', r1.myTitle);
    ok(/登入後/.test(r1.note), '沒登入：提醒登入後換裝置也看得到', r1.note);
    ok(/請先寫下內容/.test(r1.emptyMsg), '空白不能送', r1.emptyMsg);
    ok(r1.len === '10', '字數跟著打的字更新', r1.len);
    ok(r1.sent, '送出成功（單機、匿名登入、寫進模擬器）', r1.msg);
    ok(r1.listed && /意見建議/.test(r1.item) && /已送出/.test(r1.item) && /調整牌的大小/.test(r1.item), '「我的意見」列出剛送的、狀態已送出', r1.item);
    ok(r1.cleared, '送出後清掉輸入框');
    ok(r1.cool, '一分鐘內不能再送（按鈕倒數）');
    ok(r1.sentAfter, '這台記下送過意見（之後開遊戲才去查回覆）');
    ok(r1.bClosesFb, 'B 鍵先關意見面板、說明面板還在');

    /* ── 管理頁 ── */
    const signUp = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PW, returnSecureToken: true }),
    }).then(r => r.json());
    const adminUid = signUp.localId;
    const actx = await browser.newContext({ viewport: { width: 1100, height: 800 } });
    const admin = await actx.newPage();
    const aerr = [];
    admin.on('pageerror', e => aerr.push(String(e)));
    const answers = [ADMIN_EMAIL, ADMIN_PW];
    admin.on('dialog', d => d.accept(d.type() === 'prompt' ? answers.shift() : undefined));
    await admin.goto(base + encodeURI('devtools/意見反應v0.1.html') + '?emu=1');
    await admin.evaluate(HELPERS);
    const a1 = await admin.evaluate(async () => {
      document.getElementById('b-email').click();
      await __until(() => /uid/.test(document.getElementById('who').textContent), 10000);
      await __until(() => /還不是管理者/.test(document.getElementById('msg').textContent), 10000);
      return { who: document.getElementById('who').textContent, msg: document.getElementById('msg').textContent, n: document.querySelectorAll('.item').length };
    });
    ok(a1.who.includes(adminUid), '管理頁顯示登入帳號的 uid', a1.who);
    ok(/還不是管理者/.test(a1.msg) && a1.n === 0, '還不是管理者：讀不到任何意見、告訴他怎麼加', a1.msg);
    // 加進 /admins（模擬器的管理者權限，等同線上用 firebase CLI 加）
    await fetch(`http://127.0.0.1:9123/admins/${adminUid}.json?ns=jcmj-4p-default-rtdb`, {
      method: 'PUT', headers: { Authorization: 'Bearer owner' }, body: 'true',
    });
    await admin.reload();
    await admin.evaluate(HELPERS);
    const a2 = await admin.evaluate(async (puid) => {
      const out = {};
      out.got = await __until(() => document.querySelectorAll('.item').length === 1, 10000);
      const it = document.querySelector('.item');
      out.text = it && it.textContent;
      const f = items[0] || {};
      let info = {};
      try { info = JSON.parse(f.info); } catch (_) {}
      out.rec = { uid: f.uid === puid, cat: f.cat, ver: f.ver, contact: f.contact, mode: info.mode, ua: !!info.ua, view: info.view, errors: Array.isArray(info.errors) };
      it.querySelector('textarea').value = '下一版會加上牌的大小設定，謝謝您的建議！';
      it.querySelector('button[data-act="reply"]').click();
      out.replied = await __until(() => items[0] && items[0].status === 'replied' && items[0].reply && items[0].replyAt, 8000);
      // 預設篩選是「未處理」：回覆過的就不在清單上
      out.hidden = await __until(() => document.querySelectorAll('.item').length === 0, 3000);
      document.getElementById('f-st').value = 'all';
      document.getElementById('f-st').dispatchEvent(new Event('input'));
      out.allN = document.querySelectorAll('.item').length;
      return out;
    }, r1.uid);
    ok(a2.got, '加進管理者之後看得到玩家的意見', JSON.stringify(a2));
    ok(a2.rec.uid && a2.rec.cat === 'idea' && /^v\d+\.\d+$/.test(a2.rec.ver) && a2.rec.contact === 'line:tester', '意見的分類、版本、聯絡方式都對', JSON.stringify(a2.rec));
    ok(a2.rec.mode === '單機' && a2.rec.ua && a2.rec.view === '1280x720' && a2.rec.errors, '附帶資訊：單機、瀏覽器、畫面大小、錯誤紀錄', JSON.stringify(a2.rec));
    ok(a2.replied, '管理頁送出回覆（status=replied、replyAt）');
    ok(a2.hidden && a2.allN === 1, '回覆過的不在「未處理」裡，切到「全部」看得到', JSON.stringify(a2));

    /* ── 玩家重開遊戲 ── */
    await loadGame();
    const r2 = await player.evaluate(async () => {
      const out = {};
      out.notice = await __until(() => document.getElementById('fb-notice').classList.contains('show'), 10000);
      out.noticeText = document.getElementById('fb-notice').textContent;
      out.dot = document.getElementById('hud-help').classList.contains('has-reply');
      out.inFocus = !!document.querySelector('#fb-notice');
      document.getElementById('fb-notice').click();
      out.open = await __until(() => document.getElementById('fb-ov').classList.contains('show'), 3000);
      out.reply = await __until(() => /牌的大小設定/.test(document.getElementById('fb-list').textContent), 8000);
      out.item = (document.querySelector('#fb-list .fb-item') || {}).textContent;
      out.newMark = !!document.querySelector('#fb-list .fb-item.new');
      out.goneNotice = await __until(() => !document.getElementById('fb-notice').classList.contains('show'), 3000);
      document.getElementById('fb-close').click();
      out.closed = !document.getElementById('fb-ov').classList.contains('show');
      return out;
    });
    ok(r2.notice && /您反應的意見有新回覆/.test(r2.noticeText), '重開遊戲：標題畫面出現「您反應的意見有新回覆」', JSON.stringify(r2));
    ok(r2.dot, '說明鈕也亮紅點');
    ok(r2.open && r2.reply && /已回覆/.test(r2.item), '點提醒打開意見面板、看到回覆與狀態「已回覆」', r2.item);
    ok(r2.newMark, '沒看過的回覆有標記');
    ok(r2.goneNotice, '看過之後提醒消失');
    await loadGame();
    const r3 = await player.evaluate(async () => {
      await new Promise(r => setTimeout(r, 4500));
      return { notice: document.getElementById('fb-notice').classList.contains('show'), dot: document.getElementById('hud-help').classList.contains('has-reply') };
    });
    ok(!r3.notice && !r3.dot, '再開一次：看過的回覆不會再提醒', JSON.stringify(r3));

    ok(perr.length === 0, '遊戲頁沒有 JavaScript 錯誤', perr.slice(0, 3).join(' | '));
    ok(aerr.length === 0, '管理頁沒有 JavaScript 錯誤', aerr.slice(0, 3).join(' | '));
  } catch (e) {
    ok(false, '端對端測試跑完', String(e && e.stack || e).slice(0, 600));
  } finally {
    clearTimeout(kill);
    try { if (browser) await browser.close(); } catch (_) {}
    try { if (srv) srv.close(); } catch (_) {}
    try { if (emu) await emu.stop(); } catch (_) {}
    finish();
  }
})();
