/* 端對端：觀戰（v1.80，docs/online-kingdoms.md 第十三節）
   ───────────────────────────────────────────────────────────────
   本機 Firebase 模擬器（**還沒部署的那份規則** database.rules.next.json —— 有 /spect、/watch）＋ 無頭 Chromium：
     甲：登入（Email＋密碼）→ 開桌、一個人帶三家電腦開打
     丙：登入、不在牌桌上 → 大廳看到「👀 觀戰」→ 四家的牌攤開、坐在電腦的位置、即時跟著牌局、◀ ▶ 換座位、離開回大廳
     丁：沒登入（匿名）→ 按觀戰被擋（要先登入）
     丙再看一次、改按左上 ↩ → 跟「離開觀戰」一樣回大廳、配樂換回來（v1.82）
   規則：牌桌上的甲（有登入）讀不到 /spect、匿名的丁讀不到；沒人觀戰時開桌的人不發觀戰資料。
   執行： node test/e2e-spectate.test.js                                                        */
'use strict';
const fs = require('fs');
const path = require('path');
const E = require('./_e2e.js');
const { ok, finish } = E.counter();
const chromium = E.findChromium();

const HELPERS = `
  window.__until = async (cond, max) => { const t0 = Date.now(); while (Date.now() - t0 < (max || 10000)) { try { if (cond()) return true; } catch (_) {} await new Promise(r => setTimeout(r, 80)); } try { return !!cond(); } catch (_) { return false; } };
  window.__vis = el => { if (!el) return false; if (el.offsetParent) return true; const cs = getComputedStyle(el); return cs.position === 'fixed' && cs.display !== 'none' && cs.visibility !== 'hidden'; };
  window.__toast = () => (document.getElementById('lobby-toast') || {}).textContent || '';
  /* 讀一個路徑：回 { ok, val } 或 { ok:false, err }（被規則擋） */
  window.__read = async p => { try { const s = await Net.db.ref(p).once('value'); return { ok: true, val: s.val() }; } catch (e) { return { ok: false, err: String(e && (e.code || e.message)) }; } };
`;

async function player(browser, base, name) {
  // E2E_VIEW=844x390：用手機橫放的大小跑（看觀戰列的位置用）
  const vw = (process.env.E2E_VIEW || '1280x720').split('x').map(Number);
  const ctx = await browser.newContext({ viewport: { width: vw[0], height: vw[1] } });
  await ctx.addInitScript(n => { try { localStorage.setItem('jcmj_intro_seen', '1'); localStorage.setItem('jcmj_my_name', n); } catch (_) {} }, name);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  if (process.env.E2E_DEBUG) page.on('console', m => console.log('  [console]', name, m.type(), m.text().slice(0, 200)));
  await page.goto(base);
  await page.waitForFunction(() => window.MJDev && window.MJLobby && typeof Net !== 'undefined', null, { timeout: 20000 });
  await page.evaluate(HELPERS);
  return { ctx, page, errors };
}
async function openLobby(p) {
  return p.evaluate(async () => {
    document.getElementById('btn-online').click();
    return __until(() => __vis(document.getElementById('net-lobby')) && Net.signedIn, 20000);
  });
}
/* 直接用密碼註冊（登入流程本身由 e2e-login 測）：匿名升級，帳號變成非匿名 */
async function register(p, email) {
  return p.evaluate(async em => {
    await Net.registerPassword(em, 'secret-123');
    await firebase.auth().currentUser.getIdToken(true);          // 拿新的 token（規則看的是 token 裡的登入方式）
    return Net.account();
  }, email);
}

(async () => {
  if (!chromium) { ok(false, '找得到 Playwright'); return finish(); }
  const kill = setTimeout(() => { console.log('超過 5 分鐘，強制結束'); process.exit(1); }, 300000);
  let emu = null, srv = null, browser = null;
  try {
    emu = await E.startEmulators({ rules: 'database.rules.next.json' });
    srv = await E.serve();
    const latest = process.env.E2E_FILE || JSON.parse(fs.readFileSync(path.join(E.ROOT, 'latest.json'), 'utf8')).file;
    const base = `http://127.0.0.1:${srv.address().port}/${encodeURI(latest)}?emu=1#test&mute`;
    console.log('═══ 端對端：觀戰（' + latest + '，本機模擬器＋未部署的規則）═══');
    browser = await chromium.launch({ headless: true });

    // ── 甲：登入、開桌、一個人開打 ──
    const A = await player(browser, base, '甲');
    await openLobby(A.page);
    const accA = await register(A.page, 'jia@example.com');
    ok(accA.loggedIn, '甲登入了（Email＋密碼）');
    await A.page.evaluate(async () => {
      document.getElementById('lobby-create').click();
      await __until(() => __vis(document.getElementById('ask-input')), 5000);
      document.getElementById('ask-input').value = '觀戰測試桌';
      document.getElementById('ask-ok').click();
      await __until(() => document.querySelector('#sel-screen.show.online') && document.querySelectorAll('#kg-home .kcard').length === 7, 15000);
      document.querySelector('#kg-home .kcard[data-id="qin"]').click();
      await __until(() => !document.getElementById('btn-start').disabled, 5000);
      document.getElementById('btn-start').click();
      await __until(() => !document.getElementById('room-start').disabled, 15000);
      document.getElementById('room-start').click();
      await __until(() => window.__test.match && window.__test.match.seats, 20000);
      for (let i = 0; i < 300; i++) {
        const m = document.getElementById('map-ok'); if (__vis(m) && !m.disabled) m.click();
        const fb = document.querySelector('#fortune-ov.show #f-bets button[data-bet="normal"]'); if (fb) { fb.click(); break; }
        await new Promise(r => setTimeout(r, 100));
      }
    });
    const key = await A.page.evaluate(() => Net.groupKey);
    ok(!!key, '甲開打了', key);

    // ── 丙：登入、從大廳觀戰 ──
    const C = await player(browser, base, '丙');
    await openLobby(C.page);
    const accC = await register(C.page, 'bing@example.com');
    ok(accC.loggedIn, '丙登入了');
    const before = await C.page.evaluate(k => __read('spect/' + k), key);
    ok(before.ok && before.val === null, '沒人觀戰時，開桌的人不發觀戰資料', JSON.stringify(before));
    const lobbyRow = await C.page.evaluate(async () => {
      await __until(() => [...document.querySelectorAll('#lobby-groups .net-watch')].some(b => /觀戰測試桌/.test(b.textContent)), 15000);
      return [...document.querySelectorAll('#lobby-groups .net-watch')].map(b => b.textContent);
    });
    ok(lobbyRow.some(t => /👀 觀戰「觀戰測試桌」/.test(t)), '大廳：進行中的牌桌底下有「👀 觀戰」', JSON.stringify(lobbyRow));
    const sv = await C.page.evaluate(async () => {
      [...document.querySelectorAll('#lobby-groups .net-watch')].find(b => /觀戰測試桌/.test(b.textContent)).click();
      const got = await __until(() => __test.spect && __test.spect.match && __test.spect.match.hand, 15000);
      if (!got) return { got, diag: { data: __test.spect && __test.spect.data, toast: __toast() } };
      const zone = id => { const t = [...document.querySelectorAll('#hand-' + id + ' .tile')]; return { n: t.length, back: t.filter(x => x.classList.contains('back')).length }; };
      const spect = __test.spect, m = spect.match, me = m.seats[spect.seat];
      return { got, spectating: document.body.classList.contains('spectating'), bar: __vis(document.getElementById('spect-bar')),
               label: document.getElementById('spect-label').title, seat: spect.seat, seatIsAI: !me.clientId,
               zones: { top: zone('top'), left: zone('left'), right: zone('right'), bottom: zone('bottom') },
               lobby: __vis(document.getElementById('net-lobby')) };
    });
    ok(sv.got && sv.spectating && sv.bar && !sv.lobby, '丙進了觀戰畫面（觀戰列出現、大廳收起來）', JSON.stringify(sv));
    if (process.env.E2E_SHOT) await C.page.screenshot({ path: process.env.E2E_SHOT });   // 看觀戰畫面長怎樣：E2E_SHOT=路徑.png
    ok(/觀戰「觀戰測試桌」/.test(sv.label) && /電腦/.test(sv.label), '觀戰列寫著哪一桌、坐在哪一家（電腦）後面', sv.label);
    ok(sv.seatIsAI, '視角坐在電腦守將的位置', JSON.stringify(sv));
    const z = sv.zones;
    ok(['top', 'left', 'right'].every(p => z[p].n >= 13 && z[p].back === 0) && z.bottom.n >= 13,
       '全知視角：四家的牌都攤開（沒有蓋著的牌）', JSON.stringify(z));

    // 即時：牌桌上有動靜，觀戰畫面跟著變
    const at0 = await C.page.evaluate(() => __test.spect.data.at);
    await A.page.evaluate(() => MJDev.republish());
    const live = await C.page.evaluate(async t => __until(() => __test.spect.data.at !== t, 8000), at0);
    ok(live, '即時：開桌的人發布一次，觀戰畫面馬上跟著更新');

    // ◀ ▶ 換座位
    const sw = await C.page.evaluate(async () => {
      const s0 = __test.spect.seat, l0 = document.getElementById('spect-label').title;
      document.getElementById('spect-next').click();
      return { s0, s1: __test.spect.seat, changed: document.getElementById('spect-label').title !== l0 };
    });
    ok(sw.s1 === (sw.s0 + 1) % 4 && sw.changed, '▶ 換到下一家坐（觀戰列跟著換）', JSON.stringify(sw));

    // ── 規則：牌桌上的人（甲，有登入）讀不到；匿名的丁讀不到；丙讀得到 ──
    const rA = await A.page.evaluate(k => __read('spect/' + k), key);
    ok(!rA.ok, '牌桌上的甲（有登入）讀不到觀戰資料（看不到別家的牌）', JSON.stringify(rA));
    const D = await player(browser, base, '丁');
    await openLobby(D.page);
    const rD = await D.page.evaluate(k => __read('spect/' + k), key);
    ok(!rD.ok, '沒登入的丁讀不到觀戰資料', JSON.stringify(rD));
    const dTry = await D.page.evaluate(async () => {
      await __until(() => document.querySelector('#lobby-groups .net-watch'), 15000);
      document.querySelector('#lobby-groups .net-watch').click();
      await __until(() => document.getElementById('ask-ov').classList.contains('show'), 5000);
      const msg = document.getElementById('ask-msg').textContent;
      document.getElementById('ask-ok').click();
      return { msg, spectating: document.body.classList.contains('spectating') };
    });
    ok(/觀戰要先登入/.test(dTry.msg) && !dTry.spectating, '沒登入按觀戰：提示要先登入、不進觀戰', JSON.stringify(dTry));
    const wD = await D.page.evaluate(async k => { try { await Net.db.ref('watch/' + k + '/' + Net.uid).set(true); return 'written'; } catch (e) { return 'denied'; } }, key);
    ok(wD === 'denied', '匿名的人不能登記觀戰（規則擋）', wD);

    // ── 丙離開觀戰：回大廳、觀戰登記拿掉 ──
    const out = await C.page.evaluate(async k => {
      const uid = Net.uid, bgmIn = MJDev.bgm();
      document.getElementById('spect-exit').click();
      const back = await __until(() => __vis(document.getElementById('net-lobby')) && !document.body.classList.contains('spectating'), 10000);
      await new Promise(r => setTimeout(r, 500));
      const w = await __read('watch/' + k + '/' + uid);
      return { back, watching: w.val, spect: __test.spect, bgmIn, bgm: MJDev.bgm() };
    }, key);
    ok(out.back, '離開觀戰：回到大廳', JSON.stringify(out));
    ok(out.watching === null && !out.spect, '觀戰登記拿掉了（開桌的人不用再發）', JSON.stringify(out));
    ok(out.bgmIn !== 'title' && out.bgm === 'title', '離開觀戰：配樂從牌桌曲換回大廳的曲子', JSON.stringify(out));

    // ── 再看一次，這次按左上的 ↩（v1.82）：跟「離開觀戰」同一條路 ──
    // v1.81 以前走單機的「回到標題畫面？牌局不會保留」，按了只換到標題畫面：觀戰沒收掉、牌桌曲一直播
    const back2 = await C.page.evaluate(async k => {
      [...document.querySelectorAll('#lobby-groups .net-watch')].find(b => /觀戰測試桌/.test(b.textContent)).click();
      await __until(() => __test.spect && __test.spect.match && __test.spect.match.hand, 15000);
      const uid = Net.uid, bgmIn = MJDev.bgm(), title = document.getElementById('hud-back').title;
      document.getElementById('hud-back').click();
      await new Promise(r => setTimeout(r, 300));
      const asked = document.getElementById('leave-ov').classList.contains('show');
      const back = await __until(() => __vis(document.getElementById('net-lobby')) && !document.body.classList.contains('spectating'), 10000);
      await new Promise(r => setTimeout(r, 500));
      const w = await __read('watch/' + k + '/' + uid);
      return { title, asked, back, spect: !!__test.spect, watching: w.val, bgmIn, bgm: MJDev.bgm(),
               bar: __vis(document.getElementById('spect-bar')), backTitle: document.getElementById('hud-back').title };
    }, key);
    ok(back2.title === '離開觀戰（B）', '觀戰時 ↩ 的提示是「離開觀戰（B）」', JSON.stringify(back2));
    ok(!back2.asked, '觀戰按 ↩：不跳單機的「牌局不會保留」確認框（跟離開觀戰一樣直接走）', JSON.stringify(back2));
    ok(back2.back && !back2.spect && !back2.bar && back2.watching === null, '觀戰按 ↩：回大廳、觀戰收掉、觀戰登記拿掉', JSON.stringify(back2));
    ok(back2.bgmIn !== 'title' && back2.bgm === 'title', '觀戰按 ↩：牌桌曲停掉、換回大廳的曲子', JSON.stringify(back2));
    ok(back2.backTitle === '回標題（B）', '離開觀戰後 ↩ 的提示換回「回標題（B）」', back2.backTitle);

    [A, C, D].forEach((p, i) => ok(p.errors.length === 0, '甲丙丁'[i] + '的頁面沒有 JavaScript 錯誤', p.errors.slice(0, 3).join(' | ')));
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
