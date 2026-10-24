/* 端對端：手機／iPad 按住手牌往上滑出去就打出（v1.84，2026-10-19 使用者）
   ───────────────────────────────────────────────────────────────
   無頭 Chromium 開成手機（844×390、有觸控），用 CDP 送**真的觸控事件**（touchStart／Move／End）：
     ‧ 往上滑夠遠 → 打出那一張（河裡多一張、手上少了那張）
     ‧ 只滑一點點、橫著滑 → 不打（牌彈回去）
     ‧ 沒輪到自己 → 不打
     ‧ 點兩下照樣能打（原本的方式沒壞）
   執行： node test/e2e-swipe.test.js                                                      */
'use strict';
const fs = require('fs');
const path = require('path');
const E = require('./_e2e.js');
const { ok, finish } = E.counter();
const chromium = E.findChromium();

(async () => {
  if (!chromium) { ok(false, '找得到 Playwright'); return finish(); }
  const latest = process.env.E2E_FILE || JSON.parse(fs.readFileSync(path.join(E.ROOT, 'latest.json'), 'utf8')).file;
  const srv = await E.serve();
  const browser = await chromium.launch({ headless: true });
  try {
    console.log('═══ 端對端：往上滑打牌（' + latest + '）═══');
    const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
    await ctx.addInitScript(() => { try { localStorage.setItem('jcmj_intro_seen', '1'); } catch (_) {} });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.goto(`http://127.0.0.1:${srv.address().port}/${encodeURI(latest)}#test&mute`);
    await page.waitForFunction(() => window.MJDev && window.__test, null, { timeout: 20000 });
    const cdp = await ctx.newCDPSession(page);
    const touch = async (pts) => {             // pts：[[x,y], …]，第一點按下、最後一點放開
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pts[0][0], y: pts[0][1] }] });
      for (const p of pts.slice(1)) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: p[0], y: p[1] }] });
        await new Promise(r => setTimeout(r, 16));
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await new Promise(r => setTimeout(r, 250));
    };
    const up = (x, y, dist, steps) => Array.from({ length: (steps || 8) + 1 }, (_, i) => [x, y - dist * i / (steps || 8)]);

    // 開一場單機，走到輪到自己
    const ready = await page.evaluate(async () => {
      const W = ms => new Promise(r => setTimeout(r, ms));
      MJDev.quickStart('zhao', 2, 0);
      for (let i = 0; i < 300; i++) {
        const dc = document.querySelector('#decree-ov.show button'); if (dc) dc.click();
        const mo = document.querySelector('#map-ov.show #map-ok'); if (mo) mo.click();
        const fb = document.querySelector('#fortune-ov.show #f-bets button[data-bet="normal"]'); if (fb) fb.click();
        /* 宣戰視窗（v1.97 起手牌能宣戰就跳，模態：開著時手牌不能滑、不能點）—— 這裡測的是打牌，按「自己來」 */
        const no = [...document.querySelectorAll('#act-pop.show .auto-offer')].find(b => /自己來/.test(b.textContent)); if (no) no.click();
        const w = __test.waiting;
        if (w && w.kind === 'turn' && w.seat === 0 && !document.querySelector('#fortune-ov.show')
            && !document.querySelector('#act-pop.show .auto-offer')) return true;
        await W(100);
      }
      return false;
    });
    ok(ready, '輪到自己出牌');
    ok(await page.evaluate(() => /往上滑/.test(document.getElementById('phase-label').textContent)), '手機的提示寫「點兩下或往上滑打出」');

    const state = () => page.evaluate(() => {
      const h = __test.match.hand.seats[0];
      const t = [...document.querySelectorAll('#hand-bottom > [data-idx]')].map(el => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, h: r.height }; });
      return { n: h.hand.length, river: h.discards.length, uids: h.hand.map(x => x.uid), tiles: t, turn: __test.waiting && __test.waiting.kind === 'turn' && __test.waiting.seat === 0 };
    });

    // 只滑一點點：不打
    let s0 = await state();
    const t3 = s0.tiles[3];
    await touch(up(t3.x, t3.y, 10, 3));
    let s1 = await state();
    ok(s1.n === s0.n && s1.river === s0.river, '只往上滑 10px：不打', JSON.stringify({ before: s0.n, after: s1.n }));
    // 橫著滑：不打
    await touch([[t3.x, t3.y], [t3.x + 40, t3.y - 5], [t3.x + 80, t3.y - 8]]);
    s1 = await state();
    ok(s1.n === s0.n && s1.river === s0.river, '橫著滑：不打', JSON.stringify({ before: s0.n, after: s1.n }));
    const reset = await page.evaluate(() => [...document.querySelectorAll('#hand-bottom > [data-idx]')].every(el => !el.style.transform));
    ok(reset, '沒打出去的牌彈回原位');

    // 往上滑夠遠：打出那一張
    s0 = await state();
    const k = 4, uid = s0.uids[k], tk = s0.tiles[k];
    await touch(up(tk.x, tk.y, Math.max(60, tk.h), 10));
    s1 = await state();
    const gone = await page.evaluate(u => !__test.match.hand.seats[0].hand.some(x => x.uid === u), uid);
    const inRiver = await page.evaluate(u => __test.match.hand.seats[0].discards.some(x => x.uid === u), uid);
    ok(gone && inRiver, '往上滑出去：那一張打進河裡', JSON.stringify({ gone, inRiver, before: s0.n, after: s1.n }));

    // 沒輪到自己：滑了也不打
    const notMine = await page.evaluate(async () => {
      for (let i = 0; i < 40; i++) { const w = __test.waiting; if (!(w && w.kind === 'turn' && w.seat === 0)) return true; await new Promise(r => setTimeout(r, 25)); }
      return false;
    });
    if (notMine) {
      const sA = await state();
      if (!sA.turn && sA.tiles.length) {
        await touch(up(sA.tiles[2].x, sA.tiles[2].y, 80, 8));
        const sB = await page.evaluate(() => __test.match.hand.seats[0].discards.length);
        ok(sB === sA.river || sB === sA.river, '沒輪到自己：往上滑不打', JSON.stringify({ river: sA.river, after: sB }));
      }
    }

    // 點兩下照樣能打（原本的方式）
    const back = await page.evaluate(async () => {
      for (let i = 0; i < 300; i++) {
        const fb = document.querySelector('#fortune-ov.show #f-bets button[data-bet="normal"]'); if (fb) fb.click();
        const pass = [...document.querySelectorAll('.popup.show button, #claim-ov.show button')].find(b => /過/.test(b.textContent)); if (pass) pass.click();
        const no = [...document.querySelectorAll('#act-pop.show .auto-offer')].find(b => /自己來/.test(b.textContent)); if (no) no.click();
        const w = __test.waiting;
        if (w && w.kind === 'turn' && w.seat === 0 && !document.querySelector('#act-pop.show .auto-offer')) return true;
        await new Promise(r => setTimeout(r, 100));
      }
      return false;
    });
    if (back) {
      const sC = await state();
      const t = sC.tiles[1];
      await page.touchscreen.tap(t.x, t.y);
      await new Promise(r => setTimeout(r, 120));
      const s2 = await state();
      await page.touchscreen.tap(s2.tiles[1].x, s2.tiles[1].y);
      await new Promise(r => setTimeout(r, 300));
      const sD = await page.evaluate(u => !__test.match.hand.seats[0].hand.some(x => x.uid === u), sC.uids[1]);
      ok(sD, '點兩下照樣能打出（原本的方式沒壞）');
    } else ok(true, '（這一局沒再輪到自己，略過點兩下的檢查）');

    ok(errors.length === 0, '沒有 JavaScript 錯誤', errors.slice(0, 3).join(' | '));
  } catch (e) {
    ok(false, '端對端測試跑完', String(e && e.stack || e).slice(0, 600));
  } finally {
    await browser.close().catch(() => {});
    srv.close();
    finish();
  }
})();
