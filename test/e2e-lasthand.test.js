/* 端對端：最後一局的結算畫面（v2.09）
   2026-10-25 使用者看到流局寫「彩池 360 兩留到下一局」→「也幫我確認最後一局是不是顯示正確」→「好改正確」。
   以前最後一局一樣寫「留到下一局」、按鈕寫「下一局」—— 其實沒有下一局，剩下的彩池在整場結算時歸第一名（scoring 的 potToLeader）。
     A. 不是最後一局流局：「彩池 N 兩留到下一局」、按鈕「下一局」、按了進下一局
     B. 最後一局流局：「這一場打完了，彩池 N 兩歸第一名（名字）」、按鈕「看整場結算」、按了之後整場結算寫「剩下的彩池 N 兩歸第一名」
   流局用 MJDev.drainWall()（牌山抽乾）逼出來；最後一張被榮和的話重來一局。
   拿舊版跑要失敗： E2E_FILE=戰國麻將線上v2.08.html node test/e2e-lasthand.test.js
   執行： node test/e2e-lasthand.test.js                                                     */
'use strict';
const E = require('./_e2e.js');
const { ok, finish } = E.counter();
const chromium = E.findChromium();

(async () => {
  if (!chromium) {
    ok(false, '找得到 Playwright', '請在專案資料夾跑：npm i -D playwright && npx playwright install chromium');
    return finish();
  }
  const kill = setTimeout(() => { console.log('超過 4 分鐘，強制結束'); process.exit(1); }, 240000);
  let g = null;
  try {
    g = await E.openGame(chromium);
    const { page, errors, latest } = g;
    console.log('═══ 端對端：最後一局的結算畫面（' + latest + '）═══');
    // 輔助函式：現在裝一次，之後每次重新整理也自動裝（addInitScript）
    const helpers = () => {
      window.__W = ms => new Promise(r => setTimeout(r, ms));
      window.__vis = el => !!el && (!!el.offsetParent || getComputedStyle(el).position === 'fixed' && getComputedStyle(el).display !== 'none');
      window.__btn = re => [...document.querySelectorAll('button')].find(b => re.test(b.textContent) && __vis(b));
      /* 開打前的那幾個畫面（奏章、天下形勢、占卜）一律放行 */
      window.__pass = () => {
        const dc = document.querySelector('#decree-ov.show button'); if (dc) dc.click();
        const mo = document.querySelector('#map-ov.show #map-ok'); if (mo) mo.click();
        const fb = document.querySelector('#fortune-ov.show #f-bets button[data-bet="normal"]'); if (fb) { fb.click(); window.__bet = true; }
      };
      /* 等到可以出牌，放彩池、抽乾牌山、交給電腦打，等這一局結算出來。是流局就回傳畫面上的字，被胡了回 null */
      /* ⚠️ 要等占卜押完注、發牌動畫播完才動手：quickStart 一呼叫 waiting 就已經是「輪到自己」，
         那時奏章、占卜都還沒跳出來 —— 在那時抽乾牌山，這一局在開打前就流局了，結算畫面根本不會出現 */
      window.__drawHand = async (setup) => {
        window.__bet = false;
        for (let i = 0; i < 300; i++) {
          __pass();
          const w = __test.waiting;
          if (__bet && w && w.kind === 'turn' && !document.querySelector('#fortune-ov.show') && !document.getElementById('deal-anim')) break;
          await __W(100);
        }
        const m = __test.match;
        setup(m);
        m.pot = 360;
        MJDev.drainWall();
        MJDev.setAuto(true);
        for (let i = 0; i < 300; i++) {
          const money = document.querySelector('.ho-money');
          if (money) {
            MJDev.setAuto(false);
            const r = m.hand.result || {};
            if (r.type !== 'draw') return { draw: false };
            const b = __btn(/下一局|整場結算/);
            return { draw: true, money: money.textContent, btn: b && b.textContent, handNo: m.hand.handNo,
                     // 第一名的顯示名稱：結算表第 seat 列的名字（表是照座位排的）
                     leader: (document.querySelectorAll('.ho-table .ho-row .ho-name')[MJScore.standings(m)[0].seat] || {}).textContent,
                     leaderSeat: MJScore.standings(m)[0].seat };
          }
          await __W(100);
        }
        return { timeout: true };
      };
    };
    await page.addInitScript(helpers);
    await page.evaluate(helpers);

    /* ── A. 第一局流局（不是最後一局）── */
    let a = null;
    for (let tries = 0; tries < 4 && !(a && a.draw); tries++) {
      if (tries) { await page.reload(); await page.waitForFunction(() => window.MJDev && window.__test); }
      a = await page.evaluate(async () => { MJDev.quickStart('qin', 2, 0); return __drawHand(() => {}); });
    }
    ok(a && a.draw, '（前提）第一局流局', JSON.stringify(a));
    ok(a && /彩池 \d[\d,]* 兩留到下一局/.test(a.money), '不是最後一局：「彩池 N 兩留到下一局」', a && a.money);
    ok(a && a.btn === '下一局', '不是最後一局：按鈕是「下一局」', a && a.btn);
    const nextOk = await page.evaluate(async () => {
      const hn = __test.match.hand.handNo;
      __btn(/下一局/).click();
      for (let i = 0; i < 100; i++) { if (__test.match.hand.handNo === hn + 1) return true; await __W(100); }
      return false;
    });
    ok(nextOk, '按了進到下一局');

    /* ── B. 最後一局流局：把這一場改成到這一局為止 ── */
    let b = null;
    for (let tries = 0; tries < 4 && !(b && b.draw); tries++) {
      if (tries) {
        await page.reload(); await page.waitForFunction(() => window.MJDev && window.__test);
        await page.evaluate(async () => { MJDev.quickStart('qin', 2, 0); });
      }
      b = await page.evaluate(async () => __drawHand(m => { m.totalHands = m.hand.handNo; }));
    }
    ok(b && b.draw, '（前提）最後一局流局', JSON.stringify(b));
    ok(b && new RegExp('這一場打完了，彩池 \\d[\\d,]* 兩歸第一名（' + b.leader + '）').test(b.money),
       '最後一局：「這一場打完了，彩池 N 兩歸第一名（名字）」，名字是現在的第一名', b && (b.money + '｜第一名 ' + b.leader));
    ok(b && !/留到下一局/.test(b.money), '最後一局：不再寫「留到下一局」', b && b.money);
    ok(b && b.btn === '看整場結算', '最後一局：按鈕是「看整場結算」', b && b.btn);
    const end = await page.evaluate(async () => {
      __btn(/整場結算|下一局/).click();
      // 整場結算前先播分封領地：點一下跳到結果、再按確認，結算框才出來
      for (let i = 0; i < 200; i++) {
        const ok = document.querySelector('#enf-ov.wait .enf-ok'); if (ok) ok.click();
        else { const enf = document.querySelector('#enf-ov.show'); if (enf) enf.click(); }
        if (__test.match.finished && /剩下的彩池/.test(document.body.innerText)) {
          return { finished: true, line: (document.body.innerText.match(/剩下的彩池[^\n]*/) || [''])[0], award: __test.match.potAward };
        }
        await __W(100);
      }
      return { finished: __test.match.finished, award: __test.match.potAward };
    });
    ok(end.finished && /剩下的彩池 \d[\d,]* 兩歸第一名/.test(end.line || ''), '按了進整場結算，寫「剩下的彩池 N 兩歸第一名」', JSON.stringify(end));
    ok(end.award && b && end.award.seat === b.leaderSeat, '彩池真的給了結算畫面上說的那一位', JSON.stringify({ award: end.award, said: b && b.leaderSeat }));
    ok(errors.length === 0, '頁面沒有 JavaScript 錯誤', errors.slice(0, 3).join(' | '));
  } catch (e) {
    ok(false, '端對端測試跑完', String(e && e.stack || e).slice(0, 500));
  } finally {
    clearTimeout(kill);
    if (g) await g.close();
    finish();
  }
})();
