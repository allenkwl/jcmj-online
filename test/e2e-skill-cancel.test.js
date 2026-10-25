/* 端對端：換牌技能挑牌時可以取消（v2.11）
   2026-10-25 使用者：「誤按到宣戰應該按 B 還可以取消，但是按 B 就是要退出遊戲，可以改一下，加一個取消鈕和按 B 的功能」。
   宣戰的部分在 test/e2e-declare.test.js；換牌技能（韓「精兵」、趙「騎射」）的挑牌模式是同一個毛病，一起改：
     ‧ 按 S 進挑牌模式 → 技能鈕旁邊有「取消（B）」
     ‧ 按 B：取消挑牌、技能次數沒有用掉、不會問要不要離開牌桌
     ‧ 再按 S、點「取消」：一樣取消
   拿舊版跑要失敗： E2E_FILE=戰國麻將線上v2.10.html node test/e2e-skill-cancel.test.js
   執行： node test/e2e-skill-cancel.test.js                                                  */
'use strict';
const E = require('./_e2e.js');
const { ok, finish } = E.counter();
const chromium = E.findChromium();

(async () => {
  if (!chromium) {
    ok(false, '找得到 Playwright', '請在專案資料夾跑：npm i -D playwright && npx playwright install chromium');
    return finish();
  }
  const kill = setTimeout(() => { console.log('超過 2 分鐘，強制結束'); process.exit(1); }, 120000);
  let g = null;
  try {
    g = await E.openGame(chromium);
    const { page, errors, latest } = g;
    console.log('═══ 端對端：換牌技能挑牌時可以取消（' + latest + '）═══');
    const r = await page.evaluate(async () => {
      const W = ms => new Promise(res => setTimeout(res, ms));
      const key = k => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
      const skillText = () => (document.getElementById('si-skill') || {}).textContent || '';
      MJDev.quickStart('zhao', 2, 0);
      let bet = false;
      for (let i = 0; i < 300; i++) {
        const dc = document.querySelector('#decree-ov.show button'); if (dc) dc.click();
        const mo = document.querySelector('#map-ov.show #map-ok'); if (mo) mo.click();
        const fb = document.querySelector('#fortune-ov.show #f-bets button[data-bet="normal"]'); if (fb) { fb.click(); bet = true; }
        const no = [...document.querySelectorAll('#act-pop.show .auto-offer')].find(b => /自己來/.test(b.textContent)); if (no) no.click();
        const w = __test.waiting;
        const sk = document.getElementById('si-skill');
        if (bet && w && w.kind === 'turn' && w.seat === 0 && !document.getElementById('deal-anim')
            && !document.querySelector('#act-pop.show .auto-offer') && sk && !sk.disabled) break;
        await W(100);
      }
      const out = { before: skillText() };
      key('s'); await W(150);
      out.picking = !!document.querySelector('#si-skill.picking');
      const cb = document.getElementById('si-pick-cancel');
      const rc = cb && cb.getBoundingClientRect();
      out.cancelBtn = { text: cb && cb.textContent, hit: !!cb && document.elementFromPoint(rc.left + rc.width / 2, rc.top + rc.height / 2) === cb };
      key('b'); await W(150);
      out.bCancel = { picking: !!document.querySelector('#si-skill.picking'), leave: document.getElementById('leave-ov').classList.contains('show'),
                      gone: !document.getElementById('si-pick-cancel'), text: skillText() };
      key('s'); await W(150);
      out.reenter = !!document.querySelector('#si-skill.picking');
      const cb2 = document.getElementById('si-pick-cancel');
      if (cb2) cb2.click();
      await W(150);
      out.clickCancel = { picking: !!document.querySelector('#si-skill.picking'), text: skillText() };
      return out;
    });
    ok(r.picking, '按 S：進換牌的挑牌模式', JSON.stringify(r));
    ok(r.cancelBtn && r.cancelBtn.text === '取消（B）' && r.cancelBtn.hit, '技能鈕旁邊有「取消（B）」，點得到', JSON.stringify(r.cancelBtn));
    ok(r.bCancel && !r.bCancel.picking && !r.bCancel.leave && r.bCancel.gone, '按 B：取消挑牌，不會問要不要離開牌桌', JSON.stringify(r.bCancel));
    ok(r.bCancel && r.bCancel.text === r.before, '取消不會用掉技能次數', JSON.stringify({ before: r.before, after: r.bCancel && r.bCancel.text }));
    ok(r.reenter, '取消之後還能再按 S');
    ok(r.clickCancel && !r.clickCancel.picking && r.clickCancel.text === r.before, '點「取消」：一樣取消、次數不變', JSON.stringify(r.clickCancel));
    ok(errors.length === 0, '頁面沒有 JavaScript 錯誤', errors.slice(0, 3).join(' | '));
  } catch (e) {
    ok(false, '端對端測試跑完', String(e && e.stack || e).slice(0, 500));
  } finally {
    clearTimeout(kill);
    if (g) await g.close();
    finish();
  }
})();
