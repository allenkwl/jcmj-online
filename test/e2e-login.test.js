/* 端對端：選用的登入（docs/online-kingdoms.md 第十一節，第 1.5 階段）
   ───────────────────────────────────────────────────────────────
   本機 Firebase 模擬器（**還沒部署的那份規則** database.rules.next.json —— 有 /players）＋ 無頭 Chromium。
   兩台「裝置」＝兩個各自獨立的瀏覽器環境（各自的 localStorage、各自的匿名登入），用同一個 Email 登入：
     裝置一：瀏覽器裡有秦國的進度（第 5 場）→ 用 Email＋密碼**註冊**（v1.75）
       ‧ 密碼打一次 → 「還沒註冊或打錯」→ 再打一次同一組 → 註冊；匿名身分升級，uid 不變；秦國進度上雲端
     裝置二：瀏覽器裡有趙國（第 2 場）、秦國（第 1 場）→ 同一個 Email，**先打錯密碼、再打對**
       ‧ 換成同一個帳號（uid 跟裝置一一樣）；秦國用雲端的（第 5 場）、趙國用這台的，兩邊合併、有提示
     裝置一上桌 → 裝置二要開桌被擋（同一個帳號一次只能在一桌）
     裝置二登出 → 這台的進度清掉、變回沒登入
     裝置二再用錯的密碼「註冊」→ 告訴他已經註冊過 → 寄重設密碼信
     裝置三：用 Google 登入（模擬器的假 Google 帳號視窗）
     裝置四：舊版頁面（輸入框不認密碼模式）→ 退回寄登入信、點連結登入同一個帳號
   登入信：模擬器不會真的寄信，信裡的連結從模擬器的 /emulator/v1/projects/{id}/oobCodes 拿。
   執行： node test/e2e-login.test.js                                                          */
'use strict';
const fs = require('fs');
const path = require('path');
const E = require('./_e2e.js');
const { ok, finish } = E.counter();
const chromium = E.findChromium();

const EMAIL = 'tester@example.com';
const HELPERS = `
  window.__until = async (cond, max) => { const t0 = Date.now(); while (Date.now() - t0 < (max || 10000)) { try { if (cond()) return true; } catch (_) {} await new Promise(r => setTimeout(r, 80)); } try { return !!cond(); } catch (_) { return false; } };
  window.__vis = el => { if (!el) return false; if (el.offsetParent) return true; const cs = getComputedStyle(el); return cs.position === 'fixed' && cs.display !== 'none' && cs.visibility !== 'hidden'; };
  window.__toast = () => (document.getElementById('lobby-toast') || {}).textContent || '';
  window.__status = () => (document.getElementById('acct-status') || {}).textContent || '';
  /* 等對話框出現、訊息符合 re；val 是字串就填進去按確定，'ok'/'cancel' 就按那顆 */
  window.__dlg = async (re, val, btn) => {
    const ov = document.getElementById('ask-ov'), msg = () => document.getElementById('ask-msg').textContent;
    if (!await __until(() => ov.classList.contains('show') && re.test(msg()), 10000)) throw new Error('沒等到對話框 ' + re + '，畫面上是：' + (ov.classList.contains('show') ? msg() : '（沒有對話框）'));
    const inp = document.getElementById('ask-input');
    const seen = { msg: msg(), type: inp.type, input: inp.style.display !== 'none',
                   ok: document.getElementById('ask-ok').textContent, cancel: document.getElementById('ask-cancel').textContent };
    if (val != null) inp.value = val;
    document.getElementById(btn === 'cancel' ? 'ask-cancel' : 'ask-ok').click();
    await new Promise(r => setTimeout(r, 120));
    return seen;
  };
`;
const rec = (k, m, c) => ({ seat: 0, name: '', isAI: false, kingdom: k, conquered: c || [], lastStreak: 0, boost: false,
                            matches: m, unified: false, gold: 2000 + m * 10, updatedAt: m });

async function device(browser, seed) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await ctx.addInitScript(s => {
    try {
      localStorage.setItem('jcmj_intro_seen', '1');
      if (s && !localStorage.getItem('__seeded')) { Object.keys(s).forEach(k => localStorage.setItem(k, s[k])); localStorage.setItem('__seeded', '1'); }
    } catch (_) {}
  }, seed || null);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  if (process.env.E2E_DEBUG) page.on('console', m => console.log('  [console]', m.type(), m.text().slice(0, 200)));
  return { ctx, page, errors };
}
async function load(p, url) {
  await p.goto(url);
  await p.waitForFunction(() => window.MJDev && window.MJLobby && typeof Net !== 'undefined', null, { timeout: 20000 });
  await p.evaluate(HELPERS);
}
async function openLobby(p) {
  return p.evaluate(async () => {
    if (!__vis(document.getElementById('net-lobby'))) document.getElementById('btn-online').click();
    return __until(() => __vis(document.getElementById('net-lobby')) && Net.signedIn, 20000);
  });
}
const PW = 'secret-123';
/* 按「用 Email 登入」走密碼流程。steps：依序回答的對話框 [[訊息, 值或 null, 'ok'|'cancel'], …] */
async function pwLogin(p, steps) {
  return p.evaluate(async ({ em, steps }) => {
    document.getElementById('acct-email').click();
    const seen = [];
    seen.push(await __dlg(/輸入你的 Email/, em));
    for (const [re, val, btn] of steps) seen.push(await __dlg(new RegExp(re), val, btn));
    return seen;
  }, { em: EMAIL, steps });
}
/* 按「用 Email 登入」、輸入 email、等寄出（舊版頁面的流程） */
async function requestLink(p) {
  return p.evaluate(async (em) => {
    document.getElementById('acct-email').click();
    await __until(() => __vis(document.getElementById('ask-input')), 5000);
    document.getElementById('ask-input').value = em;
    document.getElementById('ask-ok').click();
    /* v1.73 起寄出的結果是要按「知道了」才關的提示框（不是幾秒就消失的 toast —— 使用者來不及看）：
       要出現、1.5 秒後還在、按了才關 */
    const msg = () => document.getElementById('ask-msg').textContent;
    const shown = () => document.getElementById('ask-ov').classList.contains('show');
    if (!await __until(() => shown() && /登入信已寄到/.test(msg()), 10000)) return false;
    await new Promise(r => setTimeout(r, 1500));
    if (!shown() || !/登入信已寄到/.test(msg())) return false;
    document.getElementById('ask-ok').click();
    return __until(() => !shown(), 3000);
  }, EMAIL);
}
/* 模擬器記下的最新一封登入信的 oobCode */
async function latestOob() {
  const r = await fetch('http://127.0.0.1:9099/emulator/v1/projects/jcmj-4p/oobCodes');
  const j = await r.json();
  const list = (j.oobCodes || []).filter(c => c.email === EMAIL && c.requestType === 'EMAIL_SIGNIN');
  return list.length ? list[list.length - 1].oobCode : null;
}
/* 「在這台點信裡的連結」：照 Firebase 的格式，在原本的網址上帶 mode=signIn&oobCode=… */
function linkUrl(base, oob) {
  const [noHash, hash] = base.split('#');
  return noHash + (noHash.includes('?') ? '&' : '?') + 'apiKey=fake-api-key&mode=signIn&oobCode=' + encodeURIComponent(oob) + (hash ? '#' + hash : '');
}

(async () => {
  if (!chromium) {
    ok(false, '找得到 Playwright', '請在專案資料夾跑：npm i -D playwright && npx playwright install chromium');
    return finish();
  }
  const kill = setTimeout(() => { console.log('超過 5 分鐘，強制結束'); process.exit(1); }, 300000);
  let emu = null, srv = null, browser = null;
  try {
    emu = await E.startEmulators({ rules: 'database.rules.next.json' });
    srv = await E.serve();
    const latest = process.env.E2E_FILE || JSON.parse(fs.readFileSync(path.join(E.ROOT, 'latest.json'), 'utf8')).file;
    const base = `http://127.0.0.1:${srv.address().port}/${encodeURI(latest)}?emu=1#test&mute`;
    console.log('═══ 端對端：選用的登入（' + latest + '，本機模擬器＋未部署的規則）═══');
    browser = await chromium.launch({ headless: true });

    // ── 裝置一：有秦國進度 → Email 登入 ──
    const D1 = await device(browser, { jcmj_online_kingdoms: JSON.stringify({ v: 1, kingdoms: { qin: rec('qin', 5, ['han']) } }), jcmj_my_name: '甲' });
    await load(D1.page, base);
    ok(await openLobby(D1.page), '裝置一進得了大廳');
    const s0 = await D1.page.evaluate(() => ({ status: __status(), uid: Net.uid, g: __vis(document.getElementById('acct-google')), e: __vis(document.getElementById('acct-email')) }));
    ok(/未登入/.test(s0.status) && s0.g && s0.e, '沒登入：顯示「未登入」、有 Google／Email 兩顆', JSON.stringify(s0));
    const r1 = await pwLogin(D1.page, [
      ['輸入密碼', PW, 'ok'],
      ['還沒註冊過', PW, 'ok'],             // 再打一次同一組 → 註冊
      ['註冊好了', null, 'ok'],
    ]);
    ok(r1[0].type === 'email' && r1[1].type === 'password' && r1[2].type === 'password', '問 Email 是 Email 鍵盤、問密碼是密碼模式（打出來是圓點）', JSON.stringify(r1.map(x => x.type)));
    ok(r1[2].cancel === '忘記密碼' && r1[1].cancel === '取消', '「再打一次」那一步的取消鈕叫「忘記密碼」', JSON.stringify(r1.map(x => x.cancel)));
    ok(!r1[3].input && r1[3].ok === '知道了', '註冊好了是要按「知道了」的提示', JSON.stringify(r1[3]));
    const s1 = await D1.page.evaluate(async () => {
      await __until(() => /已登入/.test(__status()), 15000);
      await new Promise(r => setTimeout(r, 1500));   // 合併、上雲端
      return { status: __status(), uid: Net.uid, cloud: await Net.loadCloudProgress(), inputType: document.getElementById('ask-input').type,
               cancel: document.getElementById('ask-cancel').textContent };
    });
    ok(/已登入：tester@example\.com/.test(s1.status), '裝置一：註冊後已登入', s1.status);
    ok(s1.uid && s1.uid === s0.uid, '裝置一：匿名身分升級，uid 不變（這台的進度直接跟著帳號）', s0.uid + ' → ' + s1.uid);
    ok(s1.cloud && s1.cloud.qin && s1.cloud.qin.matches === 5, '裝置一的秦國進度上雲端了', JSON.stringify(s1.cloud));
    ok(s1.cancel === '取消', '對話框的取消鈕字樣還原', s1.cancel);
    const nameAsk = await D1.page.evaluate(async () => {
      const p = MJAsk('名字', '');
      await new Promise(r => setTimeout(r, 60));
      const inp = document.getElementById('ask-input');
      const r = { type: inp.type, max: inp.maxLength };
      document.getElementById('ask-cancel').click(); await p;
      return r;
    });
    ok(nameAsk.type === 'text' && nameAsk.max === 16, '之後問名字，輸入框變回一般文字、16 字', JSON.stringify(nameAsk));

    // ── 裝置二：趙國第 2 場、秦國第 1 場 → 用同一個 Email 登入 ──
    const D2 = await device(browser, { jcmj_online_kingdoms: JSON.stringify({ v: 1, kingdoms: { zhao: rec('zhao', 2), qin: rec('qin', 1) } }), jcmj_my_name: '甲' });
    await load(D2.page, base);
    await openLobby(D2.page);
    const r2 = await pwLogin(D2.page, [
      ['輸入密碼', 'wrong-pass', 'ok'],
      ['還沒註冊過', PW, 'ok'],             // 不一樣 → 當作打錯重試
    ]);
    ok(r2[2].cancel === '忘記密碼', '打錯之後的對話框有「忘記密碼」', r2[2].cancel);
    const s2 = await D2.page.evaluate(async () => {
      await __until(() => /已登入/.test(__status()), 15000);
      await __until(() => /秦國用了雲端/.test(__toast()), 8000);
      const loc = MJOnlineProgress.load(localStorage).kingdoms;
      return { uid: Net.uid, toast: __toast(), local: { qin: loc.qin && loc.qin.matches, zhao: loc.zhao && loc.zhao.matches },
               cloud: await Net.loadCloudProgress(), listed: document.getElementById('lobby-recent').textContent,
               dialog: document.getElementById('ask-ov').classList.contains('show') };
    });
    ok(!s2.dialog, '裝置二：打對之後直接登入，沒有多餘的對話框');
    ok(s2.uid === s1.uid, '裝置二：登入同一個帳號（uid 跟裝置一一樣）', s1.uid + ' / ' + s2.uid);
    ok(s2.local.qin === 5 && s2.local.zhao === 2, '裝置二：秦國用雲端的（第 5 場）、趙國用這台的（第 2 場）', JSON.stringify(s2.local));
    ok(s2.cloud && s2.cloud.zhao && s2.cloud.zhao.matches === 2 && s2.cloud.qin.matches === 5, '合併後雲端也有兩國', JSON.stringify(s2.cloud && Object.keys(s2.cloud)));
    ok(/秦國用了雲端/.test(s2.toast), '有提示秦國用了哪一份', s2.toast);
    ok(/秦國/.test(s2.listed) && /趙國/.test(s2.listed), '大廳列出兩國的進度', s2.listed);

    // ── 同一個帳號一次只能在一桌：裝置一開桌 → 裝置二被擋 ──
    await D1.page.evaluate(async () => {
      document.getElementById('lobby-create').click();
      await __until(() => __vis(document.getElementById('ask-input')), 5000);
      document.getElementById('ask-input').value = '登入測試桌';
      document.getElementById('ask-ok').click();
      await __until(() => document.querySelector('#sel-screen.show.online'), 10000);
    });
    const blocked = await D2.page.evaluate(async () => {
      await new Promise(r => setTimeout(r, 1500));
      document.getElementById('lobby-create').click();
      await __until(() => /另一台裝置/.test(__toast()), 8000);
      return { toast: __toast(), asked: __vis(document.getElementById('ask-input')) };
    });
    ok(/另一台裝置/.test(blocked.toast) && !blocked.asked, '裝置一在桌上時，裝置二不能開桌', JSON.stringify(blocked));

    // ── 裝置二登出 ──
    const s3 = await D2.page.evaluate(async () => {
      const b = document.getElementById('acct-logout');
      b.click(); await new Promise(r => setTimeout(r, 300)); b.click();      // 按兩下
      await __until(() => /未登入/.test(__status()), 10000);
      return { status: __status(), uid: Net.uid, local: Object.keys(MJOnlineProgress.load(localStorage).kingdoms) };
    });
    ok(/未登入/.test(s3.status), '裝置二登出：變回未登入', s3.status);
    ok(s3.uid && s3.uid !== s2.uid, '登出後換成新的匿名身分', s3.uid);
    ok(s3.local.length === 0, '登出後這台的連線進度清掉（都在雲端）', JSON.stringify(s3.local));

    // ── 裝置二：同一個 Email 打錯的密碼、又再打一次一樣的（以為是註冊）→ 已經註冊過 → 寄重設信 ──
    await pwLogin(D2.page, [
      ['輸入密碼', 'bad-pass-1', 'ok'],
      ['還沒註冊過', 'bad-pass-1', 'ok'],
      ['已經註冊過了', null, 'ok'],         // 寄重設信
      ['重設密碼的信已寄到', null, 'ok'],
    ]);
    const reset = await (await fetch('http://127.0.0.1:9099/emulator/v1/projects/jcmj-4p/oobCodes')).json();
    ok((reset.oobCodes || []).some(c => c.email === EMAIL && c.requestType === 'PASSWORD_RESET'), '模擬器收到重設密碼信');
    const s3b = await D2.page.evaluate(() => ({ status: __status(), dlg: document.getElementById('ask-ov').classList.contains('show') }));
    ok(/未登入/.test(s3b.status) && !s3b.dlg, '寄完重設信：還是未登入、對話框關了', JSON.stringify(s3b));
    // 「忘記密碼」鈕：直接問要不要寄
    await pwLogin(D2.page, [
      ['輸入密碼', 'bad-pass-2', 'ok'],
      ['還沒註冊過', null, 'cancel'],        // 忘記密碼
      ['重設密碼.*的信到', null, 'cancel'],  // 取消
    ]);
    const s3c = await D2.page.evaluate(() => ({ status: __status(), dlg: document.getElementById('ask-ov').classList.contains('show') }));
    ok(/未登入/.test(s3c.status) && !s3c.dlg, '按「忘記密碼」再取消：回到大廳、沒登入', JSON.stringify(s3c));

    // ── 裝置三：Google（模擬器的假 Google 帳號視窗） ──
    const D3 = await device(browser, { jcmj_my_name: '丙' });
    await load(D3.page, base);
    await openLobby(D3.page);
    const [popup] = await Promise.all([
      D3.page.waitForEvent('popup', { timeout: 10000 }),
      D3.page.evaluate(() => document.getElementById('acct-google').click()),
    ]);
    await popup.waitForLoadState();
    // 模擬器的帳號選擇頁：新增帳號 → 自動產生 → 登入
    await popup.getByText(/Add new account/i).click();
    const auto = popup.getByText(/Auto-generate user information/i);
    if (await auto.count()) await auto.click();
    await popup.getByText(/Sign in with Google\.com/i).click();
    const s4 = await D3.page.evaluate(async () => {
      await __until(() => /已登入/.test(__status()), 15000);
      return { status: __status(), acct: Net.account() };
    });
    ok(/已登入/.test(s4.status) && /Google/.test(s4.status) && s4.acct.provider === 'google', '裝置三：Google 登入成功', JSON.stringify(s4));

    // ── 裝置四：舊版頁面（輸入框不認密碼模式）→ 退回寄登入信，點連結登入同一個帳號 ──
    const D4 = await device(browser, { jcmj_my_name: '丁' });
    await load(D4.page, base);
    await openLobby(D4.page);
    await D4.page.evaluate(() => { window.MJAsk.password = false; });
    ok(await requestLink(D4.page), '裝置四（舊版頁面）：寄出登入信');
    const oob4 = await latestOob();
    ok(!!oob4, '模擬器收到登入信');
    await load(D4.page, linkUrl(base, oob4));
    const s5 = await D4.page.evaluate(async () => {
      await __until(() => /已登入/.test(__status()), 15000);
      return { status: __status(), uid: Net.uid, url: location.href };
    });
    ok(/已登入：tester@example\.com/.test(s5.status) && s5.uid === s1.uid, '裝置四：點連結登入同一個帳號', s5.status + ' ' + s5.uid);
    ok(!/oobCode/.test(s5.url), '網址上的登入參數拿掉了', s5.url);

    [D1, D2, D3, D4].forEach((d, i) => ok(d.errors.length === 0, '裝置' + '一二三四'[i] + '沒有 JavaScript 錯誤', d.errors.slice(0, 3).join(' | ')));
  } catch (e) {
    ok(false, '端對端測試跑完', String(e && e.stack || e).slice(0, 700));
  } finally {
    clearTimeout(kill);
    if (browser) await browser.close().catch(() => {});
    if (srv) srv.close();
    if (emu) await emu.stop();
    finish();
  }
})();
