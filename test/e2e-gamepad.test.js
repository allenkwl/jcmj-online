/* 端對端：手把的按鈕（v2.10，src/input.js 的 edge）
   2026-10-25 使用者：「用手把試玩，很容易會發生按一下就一連串動作，不知需不需要 debounce 或是什麼原因？」
   原因：v1.00 起 A／B 用 repeat() 再把 n 設 99 想關掉連發，但 repeat() 只要 n≠1 就每 110ms 連發 ——
   按住超過 0.11 秒就再確定一次。改成只在按下去的那一瞬間算一次，放開後 80ms 內又「按下」（抖動）不算。
   用假手把（換掉 navigator.getGamepads）照時間按、放，數 onConfirm／onCancel／焦點移了幾格：
     ‧ A 按住 0.6 秒 → 只確定一次（舊版約 5 次）　‧ B 按住 0.6 秒 → 只取消一次
     ‧ A 連按兩下（各 0.1 秒、中間放 0.1 秒）→ 兩次　‧ A 抖動（按 30ms、放 16ms、再按）→ 一次
     ‧ 十字鍵按住 0.8 秒 → 照舊連續移動（刻意的）　‧ 十字鍵點一下 → 移一格
   ⚠️ src/input.js 是各版共用的，拿舊版頁面跑一樣會過；要確認測試抓得到錯，把 src/input.js 換回 v2.09 的那一份再跑。
   執行： node test/e2e-gamepad.test.js                                                        */
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
    console.log('═══ 端對端：手把的按鈕（' + latest + '）═══');
    await page.evaluate(() => {
      // 假手把：17 顆按鈕、4 軸，__press(i, on) 改狀態；pollPads 每一格讀 navigator.getGamepads()
      const pad = { connected: true, id: 'fake', index: 0, axes: [0, 0, 0, 0],
                    buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
      navigator.getGamepads = () => [pad];
      window.__press = (i, on) => { pad.buttons[i] = { pressed: on, value: on ? 1 : 0 }; };
      // 換掉遊戲的可選項與確定／取消：十顆無害的鈕，只計數
      const box = document.createElement('div');
      box.style.cssText = 'position:fixed;left:10px;top:10px;z-index:99999;display:flex;gap:4px';
      for (let i = 0; i < 10; i++) { const b = document.createElement('button'); b.textContent = i; box.appendChild(b); }
      document.body.appendChild(box);
      window.__n = { confirm: 0, cancel: 0 };
      MJInput.init({
        getItems: () => [...box.children], getScroller: () => null, beforeMove: null, beforeKey: null, onFocus: null,
        onConfirm: () => { __n.confirm++; return true; },
        onCancel: () => { __n.cancel++; },
      });
      MJInput.refresh(0);
      window.__idx = () => [...box.children].indexOf(MJInput.current());
    });
    const W = ms => page.waitForTimeout(ms);
    const press = async (i, ms) => { await page.evaluate(i => __press(i, true), i); await W(ms); await page.evaluate(i => __press(i, false), i); };
    const reset = () => page.evaluate(() => { __n.confirm = 0; __n.cancel = 0; MJInput.refresh(0); });
    const n = () => page.evaluate(() => Object.assign({ idx: __idx() }, __n));

    await reset(); await press(0, 600); await W(200);
    let r = await n();
    ok(r.confirm === 1, 'A 按住 0.6 秒：只確定一次（不連發）', JSON.stringify(r));

    await reset(); await press(1, 600); await W(200);
    r = await n();
    ok(r.cancel === 1, 'B 按住 0.6 秒：只取消一次', JSON.stringify(r));

    await reset(); await press(9, 600); await W(200);
    r = await n();
    ok(r.confirm === 1, 'Start 按住 0.6 秒：只確定一次', JSON.stringify(r));

    await reset(); await press(0, 100); await W(100); await press(0, 100); await W(200);
    r = await n();
    ok(r.confirm === 2, 'A 連按兩下：確定兩次', JSON.stringify(r));

    await reset(); await press(0, 30); await W(16); await press(0, 200); await W(200);
    r = await n();
    ok(r.confirm === 1, 'A 抖動（按 30ms、放一格、再按）：只算一次', JSON.stringify(r));

    await reset(); await press(15, 100); await W(200);
    r = await n();
    ok(r.idx === 1, '十字鍵右點一下：移一格', JSON.stringify(r));

    await reset(); await press(15, 800); await W(200);
    r = await n();
    ok(r.idx >= 3, '十字鍵右按住 0.8 秒：照舊連續移動', JSON.stringify(r));

    ok(errors.length === 0, '頁面沒有 JavaScript 錯誤', errors.slice(0, 3).join(' | '));
  } catch (e) {
    ok(false, '端對端測試跑完', String(e && e.stack || e).slice(0, 500));
  } finally {
    clearTimeout(kill);
    if (g) await g.close();
    finish();
  }
})();
