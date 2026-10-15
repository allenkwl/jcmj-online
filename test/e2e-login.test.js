/* 端對端：選用的登入（docs/online-kingdoms.md 第十一節，第 1.5 階段）
   ───────────────────────────────────────────────────────────────
   本機 Firebase 模擬器（**還沒部署的那份規則** database.rules.next.json —— 有 /players）＋ 無頭 Chromium。
   兩台「裝置」＝兩個各自獨立的瀏覽器環境（各自的 localStorage、各自的匿名登入），用同一個 Email 登入：
     裝置一：瀏覽器裡有秦國的進度（第 5 場）→ 用 Email 登入（信箱連結）
       ‧ 換成 Email 帳號（信裡的連結只能用一次，所以不做匿名升級）；秦國進度上雲端
     裝置二：瀏覽器裡有趙國（第 2 場）、秦國（第 1 場）→ 用同一個 Email 登入
       ‧ 換成同一個帳號（uid 跟裝置一一樣）；秦國用雲端的（第 5 場）、趙國用這台的，兩邊合併、有提示
     裝置一上桌 → 裝置二要開桌被擋（同一個帳號一次只能在一桌）
     裝置二登出 → 這台的進度清掉、變回沒登入
     裝置三：用 Google 登入（模擬器的假 Google 帳號視窗）
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
/* 按「用 Email 登入」、輸入 email、等寄出 */
async function requestLink(p) {
  return p.evaluate(async (em) => {
    document.getElementById('acct-email').click();
    await __until(() => __vis(document.getElementById('ask-input')), 5000);
    document.getElementById('ask-input').value = em;
    document.getElementById('ask-ok').click();
    return __until(() => /登入信已寄到/.test(__toast()), 10000);
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
    ok(await requestLink(D1.page), '裝置一：寄出登入信');
    const oob1 = await latestOob();
    ok(!!oob1, '模擬器收到登入信');
    await load(D1.page, linkUrl(base, oob1));       // 在同一台點連結
    const s1 = await D1.page.evaluate(async () => {
      await __until(() => /已登入/.test(__status()), 15000);
      await new Promise(r => setTimeout(r, 1500));   // 合併、上雲端
      return { status: __status(), uid: Net.uid, url: location.href, cloud: await Net.loadCloudProgress() };
    });
    ok(/已登入：tester@example\.com/.test(s1.status), '裝置一：點連結後已登入', s1.status);
    ok(s1.uid && s1.uid !== s0.uid, '裝置一：換成 Email 帳號的身分', s0.uid + ' → ' + s1.uid);
    ok(!/oobCode/.test(s1.url), '網址上的登入參數拿掉了', s1.url);
    ok(s1.cloud && s1.cloud.qin && s1.cloud.qin.matches === 5, '裝置一的秦國進度上雲端了', JSON.stringify(s1.cloud));

    // ── 裝置二：趙國第 2 場、秦國第 1 場 → 用同一個 Email 登入 ──
    const D2 = await device(browser, { jcmj_online_kingdoms: JSON.stringify({ v: 1, kingdoms: { zhao: rec('zhao', 2), qin: rec('qin', 1) } }), jcmj_my_name: '甲' });
    await load(D2.page, base);
    await openLobby(D2.page);
    ok(await requestLink(D2.page), '裝置二：寄出登入信');
    const oob2 = await latestOob();
    await load(D2.page, linkUrl(base, oob2));
    const s2 = await D2.page.evaluate(async () => {
      await __until(() => /已登入/.test(__status()), 15000);
      await __until(() => /秦國用了雲端/.test(__toast()), 8000);
      const loc = MJOnlineProgress.load(localStorage).kingdoms;
      return { uid: Net.uid, toast: __toast(), local: { qin: loc.qin && loc.qin.matches, zhao: loc.zhao && loc.zhao.matches },
               cloud: await Net.loadCloudProgress(), listed: document.getElementById('lobby-recent').textContent };
    });
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

    [D1, D2, D3].forEach((d, i) => ok(d.errors.length === 0, '裝置' + '一二三'[i] + '沒有 JavaScript 錯誤', d.errors.slice(0, 3).join(' | ')));
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
