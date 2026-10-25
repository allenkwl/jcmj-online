/* 端對端：問名字的對話框（開一桌的桌名、改名字…）鍵盤與手把都能操作（v2.12）
   2026-10-25 使用者：「連線對戰選擇開一桌之後，就無法使用鍵盤或手把操作」→（截圖）「是這個畫面無法使用鍵盤控制」。
   以前：游標在輸入框裡，方向鍵、B 全被輸入框吃掉，只剩 Enter；對話框打開時也沒更新焦點，手把的焦點框還停在後面的大廳。
   現在：
     ‧ 打開：游標在輸入框（可以直接打字、Enter 送出），焦點框停在「確定」
     ‧ 輸入框裡按下（或 Tab）→ 到按鈕那一排，左右換、B 取消
     ‧ 按上回到輸入框，接著打字
     ‧ 手把 A＝確定、B＝取消
   直接叫 window.MJAsk（標題畫面、不連線）。拿舊版跑要失敗： E2E_FILE=戰國麻將線上v2.11.html node test/e2e-ask-keys.test.js
   執行： node test/e2e-ask-keys.test.js                                                         */
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
    console.log('═══ 端對端：問名字的對話框，鍵盤與手把（' + latest + '）═══');
    const W = ms => page.waitForTimeout(ms);
    const open = () => page.evaluate(() => {
      window.__ans = undefined;
      window.MJAsk('這一桌叫什麼名字？', '小球貓的牌桌').then(v => { window.__ans = v; });
    }).then(() => W(200));
    const st = () => page.evaluate(() => {
      const c = MJInput.current();
      return { active: document.activeElement && document.activeElement.id || document.activeElement.tagName,
               cur: c && c.id, shown: document.getElementById('ask-ov').classList.contains('show'), ans: window.__ans };
    });

    // 1. 打開
    await open();
    let s = await st();
    ok(s.shown && s.active === 'ask-input', '打開：游標在輸入框，可以直接打字', JSON.stringify(s));
    ok(s.cur === 'ask-ok', '打開：焦點框停在「確定」（不是後面的大廳）', JSON.stringify(s));
    // 2. 下 → 按鈕那一排；右 → 取消；B → 取消
    await page.keyboard.press('ArrowDown'); await W(80);
    s = await st();
    ok(s.active !== 'ask-input' && s.cur === 'ask-ok', '輸入框裡按下：離開輸入框，到「確定」', JSON.stringify(s));
    await page.keyboard.press('ArrowRight'); await W(80);
    s = await st();
    ok(s.cur === 'ask-cancel', '再按右：到「取消」', JSON.stringify(s));
    await page.keyboard.press('b'); await W(150);
    s = await st();
    ok(!s.shown && s.ans === null, '按 B：取消，對話框關掉', JSON.stringify(s));

    // 3. 直接打字、Enter 送出
    await open();
    await page.keyboard.type('楚漢'); await page.keyboard.press('Enter'); await W(150);
    s = await st();
    ok(!s.shown && s.ans === '楚漢', '直接打字、Enter：用打的名字', JSON.stringify(s));

    // 4. 下 → 上回到輸入框接著打 → 下 → Enter（在「確定」上）
    await open();
    await page.keyboard.press('ArrowDown'); await W(80);
    await page.keyboard.press('ArrowUp'); await W(80);
    s = await st();
    ok(s.active === 'ask-input' && s.cur === 'ask-input', '從按鈕按上：回到輸入框，游標也進去', JSON.stringify(s));
    await page.keyboard.type('秦'); await W(50);
    await page.keyboard.press('Tab'); await W(80);
    await page.keyboard.press('Enter'); await W(150);
    s = await st();
    ok(!s.shown && s.ans === '秦', '回輸入框重打、Tab 到確定、Enter：用新打的名字', JSON.stringify(s));

    // 5. 手把：A＝確定（預設名字）；B＝取消
    await page.evaluate(() => {
      const pad = { connected: true, id: 'fake', index: 0, axes: [0, 0, 0, 0],
                    buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
      navigator.getGamepads = () => [pad];
      window.__press = (i, on) => { pad.buttons[i] = { pressed: on, value: on ? 1 : 0 }; };
    });
    const press = async i => { await page.evaluate(i => __press(i, true), i); await W(120); await page.evaluate(i => __press(i, false), i); await W(150); };
    await open();
    await press(0);
    s = await st();
    ok(!s.shown && s.ans === '小球貓的牌桌', '手把 A：確定（用預設名字）', JSON.stringify(s));
    await open();
    await press(15);                          // 右 → 取消
    s = await st();
    ok(s.cur === 'ask-cancel', '手把右：到「取消」', JSON.stringify(s));
    await press(0);
    s = await st();
    ok(!s.shown && s.ans === null, '手把在「取消」上按 A：取消', JSON.stringify(s));
    await open();
    await press(1);
    s = await st();
    ok(!s.shown && s.ans === null, '手把 B：取消', JSON.stringify(s));

    ok(errors.length === 0, '頁面沒有 JavaScript 錯誤', errors.slice(0, 3).join(' | '));
  } catch (e) {
    ok(false, '端對端測試跑完', String(e && e.stack || e).slice(0, 500));
  } finally {
    clearTimeout(kill);
    if (g) await g.close();
    finish();
  }
})();
