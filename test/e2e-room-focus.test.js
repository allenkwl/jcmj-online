/* 端對端：連線開一桌、擇國而立之後，焦點停在「開始牌局」，直接按空白鍵就開打（v2.13）
   2026-10-25 使用者：「擇國而立選好國家後回到主畫面 default 按鈕應該要在 開始牌局，接著直接按 A 或空白鍵就開始」。
   全程只用鍵盤（真的按鍵，不是 click()）：大廳 → 開一桌（桌名對話框 Enter）→ 擇國（選卡片、出戰）→ 房間 → 空白鍵。
   本機 Firebase 模擬器（線上同一份規則），一位玩家、其餘電腦。
   拿舊版跑要失敗： E2E_FILE=戰國麻將線上v2.12.html node test/e2e-room-focus.test.js
   執行： node test/e2e-room-focus.test.js                                                   */
'use strict';
const fs = require('fs');
const path = require('path');
const E = require('./_e2e.js');
const { ok, finish } = E.counter();
const chromium = E.findChromium();

(async () => {
  if (!chromium) {
    ok(false, '找得到 Playwright', '請在專案資料夾跑：npm i -D playwright && npx playwright install chromium');
    return finish();
  }
  let emu = null, srv = null, browser = null;
  const kill = setTimeout(async () => {
    console.log('超過 3 分鐘，強制結束');
    try { if (emu) await emu.stop(); } catch (_) {}
    process.exit(1);
  }, 180000);
  try {
    emu = await E.startEmulators({});
    srv = await E.serve();
    const latest = process.env.E2E_FILE || JSON.parse(fs.readFileSync(path.join(E.ROOT, 'latest.json'), 'utf8')).file;
    console.log('═══ 端對端：擇國之後焦點停在「開始牌局」（' + latest + '，本機模擬器）═══');
    browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    await ctx.addInitScript(() => { try { localStorage.setItem('jcmj_intro_seen', '1'); localStorage.setItem('jcmj_my_name', '測試'); } catch (_) {} });
    const p = await ctx.newPage();
    const errors = [];
    p.on('pageerror', e => errors.push(String(e)));
    await p.goto(`http://127.0.0.1:${srv.address().port}/${encodeURI(latest)}?emu=1#test&mute`);
    await p.waitForFunction(() => window.MJDev && window.MJLobby && typeof Net !== 'undefined', null, { timeout: 20000 });
    const cur = () => p.evaluate(() => { const c = MJInput.current(); return c ? (c.id || (c.classList.contains('kcard') ? 'kcard:' + [...document.querySelectorAll('#kg-home .kcard')].indexOf(c) : c.className)) : null; });
    const press = async (k, ms) => { await p.keyboard.press(k); await p.waitForTimeout(ms || 80); };

    await p.evaluate(() => document.getElementById('btn-online').click());
    await p.waitForFunction(() => Net.signedIn && getComputedStyle(document.getElementById('net-lobby')).display !== 'none', null, { timeout: 20000 });
    await p.waitForTimeout(600);
    for (let i = 0; i < 15 && (await cur()) !== 'lobby-create'; i++) await press('ArrowRight');
    ok((await cur()) === 'lobby-create', '（前提）方向鍵走到「開一桌」');
    await press('Enter', 400);                      // 桌名對話框
    await press('Enter', 0);                        // 用預設桌名
    const picked = await p.waitForFunction(() => document.getElementById('sel-screen').classList.contains('show'), null, { timeout: 15000 }).then(() => true, () => false);
    ok(picked, '（前提）開好桌，進到擇國而立');
    await p.waitForTimeout(500);
    await press('ArrowRight'); await press('Enter', 300);          // 選一國（第二張）
    for (let i = 0; i < 6 && (await cur()) !== 'btn-start'; i++) await press('ArrowDown');
    ok((await cur()) === 'btn-start', '（前提）走到「以此國出戰」');
    await press('Enter', 0);
    await p.waitForFunction(() => getComputedStyle(document.getElementById('net-room')).display !== 'none', null, { timeout: 15000 }).catch(() => {});
    await p.waitForTimeout(1200);
    const f = await cur();
    const sb = await p.evaluate(() => { const b = document.getElementById('room-start'); return { text: b.textContent, disabled: b.disabled }; });
    ok(f === 'room-start' && !sb.disabled, '回到房間：焦點停在「開始牌局」', JSON.stringify({ focus: f, start: sb }));
    await press(' ', 0);
    const started = await p.waitForFunction(() => window.__test && window.__test.match && window.__test.match.hand
      && getComputedStyle(document.getElementById('net-room')).display === 'none', null, { timeout: 20000 }).then(() => true, () => false);
    ok(started, '直接按空白鍵：牌局開始');
    ok(errors.length === 0, '頁面沒有 JavaScript 錯誤', errors.slice(0, 3).join(' | '));
  } catch (e) {
    ok(false, '端對端測試跑完', String(e && e.stack || e).slice(0, 500));
  } finally {
    clearTimeout(kill);
    try { if (browser) await browser.close(); } catch (_) {}
    try { if (srv) srv.close(); } catch (_) {}
    try { if (emu) await emu.stop(); } catch (_) {}
    finish();
  }
})();
