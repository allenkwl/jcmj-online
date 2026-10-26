/* 端對端：分封領地的主公不被地圖框切掉（v2.18，src/enfeoff.js）
   2026-10-26 使用者：「我一直覺得分封領地的動畫主公被截到不太好，能改嗎？先做測試程式，ok 再接進遊戲」
   「不能讓主公貼在標題上嗎？」→ 分封動畫 v0.3 看過 →「好，接進遊戲吧」。
     ‧ 打北邊的趙國（地圖上 y＝17%）：主公畫在 .enf-fx（不裁切），頭超出地圖上緣、整個看得到，沒有超出畫面
     ‧「征服」大印照舊蓋在主公上面
     ‧ 點一下跳到結果：主公收掉，不會留在畫面上（主公不在地圖裡了，paintMap 清不到 —— 接進遊戲時抓到的）
   用遊戲的 #enfeoff 預覽模式（只播動畫、不碰存檔）。
   執行： node test/e2e-enfeoff.test.js                                                    */
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
  const kill = setTimeout(() => { console.log('超過 2 分鐘，強制結束'); process.exit(1); }, 120000);
  let srv = null, browser = null;
  try {
    srv = await E.serve();
    const latest = process.env.E2E_FILE || JSON.parse(fs.readFileSync(path.join(E.ROOT, 'latest.json'), 'utf8')).file;
    console.log('═══ 端對端：分封領地的主公不被切掉（' + latest + '）═══');
    browser = await chromium.launch({ headless: true });
    const p = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errs = [];
    p.on('pageerror', e => errs.push(String(e)));
    await p.goto(`http://127.0.0.1:${srv.address().port}/${encodeURI(latest)}#enfeoff&mute`);
    await p.waitForFunction(() => window.MJEnfeoff && document.getElementById('ip-gate'), null, { timeout: 20000 });
    const r = await p.evaluate(async () => {
      const W = ms => new Promise(res => setTimeout(res, ms));
      const cap = () => (document.querySelector('#enf-ov .enf-cap') || {}).textContent || '';
      document.getElementById('ip-gate').style.display = 'none';
      MJEnfeoff.play({
        lords: [{ name: '小球貓', home: 'qi', conquered: ['wei'] }, { name: '阿明', home: 'chu', conquered: [] },
                { name: '小華', home: 'qin', conquered: [] }],
        awards: [{ rank: 1, name: '小球貓', gained: 'yan' }, { rank: 2, name: '阿明', gained: 'zhao' },
                 { rank: 3, name: '小華', gained: 'han' }],
      });
      for (let i = 0; i < 300 && !/征服 趙國/.test(cap()); i++) await W(50);
      await W(120);
      const out = {};
      const lord = document.querySelector('#enf-ov .lord');
      const map = document.querySelector('#enf-ov .enf-map').getBoundingClientRect();
      if (!lord) return { error: '沒有主公', cap: cap() };
      const lr = lord.getBoundingClientRect();
      out.parent = lord.parentElement.className;
      out.above = Math.round(map.top - lr.top);        // 頭超出地圖上緣幾 px（>0＝蓋到地圖外面）
      out.onScreen = lr.top >= 0;
      /* 主公、大印都是 pointer-events:none（elementFromPoint 會跳過）—— 量的時候暫時打開 */
      const st = document.querySelector('#enf-ov .stamp');
      const pe = [lord, lord.querySelector('img'), st].filter(Boolean);
      pe.forEach(n => { n.style.pointerEvents = 'auto'; });
      // 頭頂往下一點、主公正中間那一點：點到的是主公（沒被裁掉、沒被別的東西蓋住）
      const hit = document.elementFromPoint(lr.left + lr.width / 2, Math.max(lr.top + lr.height * 0.12, 1));
      out.headVisible = !!(hit && lord.contains(hit));
      if (st) {
        const sr = st.getBoundingClientRect();
        const h2 = document.elementFromPoint(sr.left + sr.width / 2, sr.top + sr.height / 2);
        out.stampOnTop = !!(h2 && (h2 === st || st.contains(h2)));
      }
      pe.forEach(n => { n.style.pointerEvents = ''; });
      // 第一名（燕）出兵途中點一下跳到結果：主公要收掉
      for (let i = 0; i < 200 && !document.querySelector('#enf-ov .lord'); i++) await W(30);
      await W(300);
      out.lordBeforeSkip = !!document.querySelector('#enf-ov .lord');
      document.getElementById('enf-ov').click();
      await W(300);
      out.lordAfterSkip = document.querySelectorAll('#enf-ov .lord').length;
      out.capAfterSkip = cap();
      return out;
    });
    ok(!r.error && r.parent === 'enf-fx', '主公畫在地圖上面那一層（.enf-fx，不裁切）', JSON.stringify(r));
    ok(r.above > 0 && r.onScreen, '打趙國（北邊）：主公的頭超出地圖上緣、蓋在標題上，沒有超出畫面', JSON.stringify({ above: r.above, onScreen: r.onScreen }));
    ok(r.headVisible, '主公的頭看得到（點得到的是主公，沒被切掉）', JSON.stringify(r.headVisible));
    ok(r.stampOnTop === true, '「征服」大印照舊蓋在主公上面', JSON.stringify(r.stampOnTop));
    ok(r.lordBeforeSkip && r.lordAfterSkip === 0, '點一下跳到結果：主公收掉、不留在畫面上', JSON.stringify({ before: r.lordBeforeSkip, after: r.lordAfterSkip }));
    ok(/小球貓.*燕.*阿明.*趙.*小華.*韓/.test(r.capAfterSkip || ''), '跳到結果後字幕是總結（誰拿了哪一國）', r.capAfterSkip);
    ok(errs.length === 0, '頁面沒有 JavaScript 錯誤', errs.slice(0, 3).join(' | '));
  } catch (e) {
    ok(false, '端對端測試跑完', String(e && e.stack || e).slice(0, 500));
  } finally {
    clearTimeout(kill);
    try { if (browser) await browser.close(); } catch (_) {}
    try { if (srv) srv.close(); } catch (_) {}
    finish();
  }
})();
