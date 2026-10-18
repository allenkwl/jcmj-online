/* 端對端：老闆模式要讓整個遊戲安靜（v1.83）
   ───────────────────────────────────────────────────────────────
   2026-10-18 使用者：「老闆模式音樂沒停」—— 以前進老闆模式只把 BGM 停一次，
   底下牌局照跑，下一次重畫 syncBgm 就把曲子叫回來；出牌音效也照響。
   檢查（單機開一場）：
     ‧ 按 Esc 進老闆模式：BGM 停、音效關、動畫配樂的 <audio> 靜音
     ‧ 老闆模式中牌桌重畫幾次：BGM 還是停著（v1.82 會被叫回來）
     ‧ 按任意鍵出來：曲子回到現在該播的那首、音效開回來、<audio> 解除靜音
     ‧ 玩家自己按了靜音：進出老闆模式之後還是靜音（不能被老闆模式打開）
   ⚠️ 這支要讓 BGM 真的跑起來（不能帶 #mute，那會把 BGM 停用）—— 改用瀏覽器的 --mute-audio，測試時一樣不出聲。
   執行： node test/e2e-boss.test.js                                                        */
'use strict';
const fs = require('fs');
const path = require('path');
const E = require('./_e2e.js');
const { ok, finish } = E.counter();
const chromium = E.findChromium();

(async () => {
  if (!chromium) { ok(false, '找得到 Playwright'); return finish(); }
  const kill = setTimeout(() => { console.log('超過 2 分鐘，強制結束'); process.exit(1); }, 120000);
  let srv = null, browser = null;
  try {
    srv = await E.serve();
    const latest = process.env.E2E_FILE || JSON.parse(fs.readFileSync(path.join(E.ROOT, 'latest.json'), 'utf8')).file;
    console.log('═══ 端對端：老闆模式靜音（' + latest + '）═══');
    browser = await chromium.launch({ headless: true, args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required'] });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    await ctx.addInitScript(() => { try { localStorage.setItem('jcmj_intro_seen', '1'); } catch (_) {} });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.goto(`http://127.0.0.1:${srv.address().port}/${encodeURI(latest)}#test`);
    await page.waitForFunction(() => window.MJDev && window.__test && window.MJAudio, null, { timeout: 20000 });

    // 單機開一場，走到牌桌上、牌桌曲在播
    const table = await page.evaluate(async () => {
      const vis = el => !!el && (el.offsetParent || getComputedStyle(el).position === 'fixed') && getComputedStyle(el).display !== 'none';
      MJDev.quickStart('qin', 2, 0);
      const B = MJAudio.BGM;
      for (let i = 0; i < 400; i++) {
        ['dc-ok', 'map-ok'].forEach(id => { const b = document.getElementById(id); if (vis(b)) b.click(); });
        const fb = document.querySelector('#fortune-ov.show #f-bets button[data-bet="normal"]'); if (fb) fb.click();
        const want = MJDev.bgm();
        if (want && !/^(title|select)$/.test(want) && B.currentScene() === want && !document.querySelector('#fortune-ov.show')) break;
        await new Promise(r => setTimeout(r, 50));
      }
      return { want: MJDev.bgm(), playing: B.currentScene(), sfx: MJAudio.SFX.isEnabled() };
    });
    ok(table.playing && table.playing === table.want && !/^(title|select)$/.test(table.playing) && table.sfx,
       '（測試前提）牌桌上：牌桌曲在播、音效開著', JSON.stringify(table));

    const state = () => page.evaluate(() => ({
      boss: document.getElementById('boss-screen').classList.contains('show'),
      playing: MJAudio.BGM.currentScene(), bgmOn: MJAudio.BGM.isEnabled(), sfx: MJAudio.SFX.isEnabled(),
      introMuted: document.getElementById('intro-bgm').muted, want: MJDev.bgm(),
    }));

    // ── 進老闆模式 ──
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    const s1 = await state();
    ok(s1.boss, '按 Esc：老闆模式蓋上來', JSON.stringify(s1));
    ok(!s1.playing && !s1.sfx, '老闆模式：BGM 停、音效關', JSON.stringify(s1));
    ok(s1.introMuted, '老闆模式：動畫配樂的 <audio> 一起靜音', JSON.stringify(s1));

    // 底下牌局照跑：重畫幾次，BGM 不能被叫回來
    const s2 = await page.evaluate(async () => {
      for (let i = 0; i < 5; i++) { MJDev.redraw(); await new Promise(r => setTimeout(r, 200)); }
      await new Promise(r => setTimeout(r, 500));
      return { playing: MJAudio.BGM.currentScene(), sfx: MJAudio.SFX.isEnabled() };
    });
    ok(!s2.playing && !s2.sfx, '老闆模式中牌桌重畫：BGM 還是停著、音效還是關著', JSON.stringify(s2));

    // ── 出來 ──
    await page.keyboard.press('x');
    await page.waitForFunction(() => MJAudio.BGM.currentScene() === MJDev.bgm(), null, { timeout: 5000 }).catch(() => {});
    const s3 = await state();
    ok(!s3.boss, '按任意鍵：老闆模式收掉', JSON.stringify(s3));
    ok(s3.playing && s3.playing === s3.want && s3.sfx, '出來之後：牌桌曲回來、音效開回來', JSON.stringify(s3));
    ok(!s3.introMuted, '出來之後：<audio> 解除靜音', JSON.stringify(s3));

    // ── 玩家自己靜音的話，老闆模式進出之後還是靜音 ──
    await page.waitForTimeout(2200);                       // 出來後 2 秒內不會再進老闆模式（bossResuming）
    await page.evaluate(() => document.getElementById('hud-mute').click());
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    await page.keyboard.press('x');
    await page.waitForTimeout(800);
    const s4 = await state();
    ok(!s4.boss && !s4.playing && !s4.bgmOn && !s4.sfx, '玩家自己按了靜音：進出老闆模式之後還是靜音', JSON.stringify(s4));

    ok(errors.length === 0, '頁面沒有 JavaScript 錯誤', errors.slice(0, 3).join(' | '));
  } catch (e) {
    ok(false, '端對端測試跑完', String(e && e.stack || e).slice(0, 600));
  } finally {
    clearTimeout(kill);
    if (browser) await browser.close().catch(() => {});
    if (srv) srv.close();
    finish();
  }
})();
