/* 端對端：亡國（一場結算時國庫 < 0）
   ───────────────────────────────────────────────────────────────
   2026-10-15 使用者：「不可能讓我全部用遊戲測試」—— 亡國要打到破產才走得到，平常根本不會經過，
   壞了也不會有人發現。所以跟 e2e-claims 一樣直接開遊戲本體跑：
     MJDev.testCampaign（只在記憶體裡的戰役，不開存檔格、不寫存檔）→ 奏章、天下形勢、發牌、占卜
     → MJDev.finishMatch([分數]) 結算 → 分封 → 亡國動畫 → 點兩下回標題
   兩個情境：
     A 國庫 300、這一場輸 600（墊底，沒有戰利品）→ -300 → 要亡國，動畫、大字、戰績、回標題都要對
     B 國庫 2000、同樣輸 600 → 1400 → **不能**亡國，要出一般結算框
   兩個情境都要確認存檔前後一字不差。
   同一套操作也做成啟動台的工具：devtools/亡國動畫v0.2.html。
   執行： node test/e2e-fallen.test.js                                          */
'use strict';
const E = require('./_e2e.js');
const { ok, finish } = E.counter();
const chromium = E.findChromium();

async function runCase(page, c) {
  return page.evaluate(async (c) => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    /* ⚠️ 用「等到條件成立」，不要固定等幾秒：第一版固定等 1.5 秒看影片，電腦一忙就偶爾早一步檢查、整套測試失敗一次
       （2026-10-15 跑整套時出現過一次，單跑八次都過）。上限放寬，真的壞掉時照樣在上限到時失敗。 */
    const until = async (cond, max) => { const t0 = Date.now(); while (Date.now() - t0 < max) { if (cond()) return true; await wait(50); } return !!cond(); };
    const vis = el => el && el.offsetParent;
    const fp = () => JSON.stringify(MJSoloSlots.load(localStorage));
    const before = fp();
    const out = {};
    MJDev.testCampaign({ kingdom: c.kingdom, gold: c.gold, conquered: c.conquered, matches: c.matches });
    for (let i = 0; i < 600; i++) {
      ['dc-ok', 'map-ok'].forEach(id => { const b = document.getElementById(id); if (vis(b)) b.click(); });
      const fb = document.querySelector('#fortune-ov.show #f-bets button[data-bet="normal"]');
      if (fb) { fb.click(); out.reachedFortune = true; break; }
      await wait(50);
    }
    if (!out.reachedFortune) return out;
    await wait(400);
    MJDev.finishMatch(c.scores);
    let fal = null;
    for (let i = 0; i < 300; i++) {
      const okb = document.querySelector('#enf-ov.wait .enf-ok'); if (okb) okb.click();
      fal = document.querySelector('#fal-ov.show'); if (fal) break;
      if (i > 40 && vis(document.getElementById('end-pop'))) break;
      await wait(100);
    }
    out.fallen = !!fal;
    out.endPopTitle = (document.querySelector('#end-pop.show .ptitle') || {}).textContent || null;
    if (fal) {
      await until(() => { const v = fal.querySelector('video'); return v && (v.videoWidth > 0 || v.error); }, 10000);
      await until(() => { const t = fal.querySelector('.f-title img'); return t && t.complete && t.naturalWidth > 0; }, 6000);
      const v = fal.querySelector('video');
      out.video = v ? { src: v.src.split('/').pop(), w: v.videoWidth, err: !!v.error } : null;
      const t = fal.querySelector('.f-title img');
      out.title = t ? { alt: t.alt, ok: t.complete && t.naturalWidth > 0 } : null;
      fal.click();
      await until(() => fal.querySelector('.f-ok.on') && fal.querySelectorAll('.f-epi div.on').length >= 4, 6000);
      out.epitaph = [...fal.querySelectorAll('.f-epi div')].map(x => x.textContent);
      // 播完要玩家按「確定」才回標題（2026-10-15）：點背景、等一下都不能自己離開
      out.okShown = !!fal.querySelector('.f-ok.on');
      fal.click(); await wait(2500);
      out.stayedWithoutOk = !!document.querySelector('#fal-ov.show');
      out.focusOnOk = MJInput.current() === fal.querySelector('.f-ok');
      // 用 B 鍵確定（鍵盤／手把的路徑；滑鼠點按鈕由 devtools/亡國動畫v0.2 那邊測）
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', bubbles: true }));
      await until(() => document.querySelector('#title-screen.show') && !document.querySelector('#fal-ov.show'), 6000);
      out.backToTitle = !!document.querySelector('#title-screen.show') && !document.querySelector('#fal-ov.show');
    }
    out.savesUntouched = fp() === before;
    return out;
  }, c);
}

(async () => {
  if (!chromium) {
    ok(false, '找得到 Playwright', '請在專案資料夾跑：npm i -D playwright && npx playwright install chromium');
    return finish();
  }
  const kill = setTimeout(() => { console.log('超過 3 分鐘，強制結束'); process.exit(1); }, 180000);
  let g = null;
  try {
    g = await E.openGame(chromium);
    const { page, errors, latest } = g;
    console.log('═══ 端對端：亡國（' + latest + '）═══');

    // A 會亡國：國庫 300、這一場輸 600、墊底沒戰利品 → -300
    const a = await runCase(page, { kingdom: 'qin', gold: 300, conquered: ['qi', 'chu'], matches: 6,
                                    scores: [-600, 300, 180, 120] });
    ok(a.reachedFortune, 'A 走得到占卜（奏章、天下形勢、發牌）');
    ok(a.fallen, 'A 國庫 300 輸 600 → 亡國動畫出現');
    ok(a.video && a.video.src === 'qin.mp4' && a.video.w > 0 && !a.video.err, 'A 秦王倒下的影片放得出來', JSON.stringify(a.video));
    ok(a.title && a.title.ok && a.title.alt === '秦亡', 'A 「秦亡」大字', JSON.stringify(a.title));
    ok((a.epitaph || []).some(t => t.includes('國庫') && t.includes('-300')), 'A 戰績上的國庫是 -300', JSON.stringify(a.epitaph));
    ok((a.epitaph || []).some(t => t.includes('7 場') && t.includes('2 / 6')), 'A 戰績：第 7 場、征服 2 國', JSON.stringify(a.epitaph));
    ok(a.okShown, 'A 戰績畫面有「確定」按鈕');
    ok(a.stayedWithoutOk, 'A 沒按「確定」不會自己回標題（點背景、等 2.5 秒）');
    ok(a.focusOnOk, 'A 鍵盤焦點在「確定」上（Enter／A 可以按）');
    ok(a.backToTitle, 'A 按 B 鍵確定才回到標題');
    ok(a.savesUntouched, 'A 存檔完全沒被動到');

    // B 不會亡國：國庫 2000、同樣輸 600 → 1400
    const b = await runCase(page, { kingdom: 'zhao', gold: 2000, conquered: [], matches: 1,
                                    scores: [-600, 300, 180, 120] });
    ok(b.reachedFortune, 'B 走得到占卜');
    ok(!b.fallen, 'B 國庫 2000 輸 600 → 不能亡國');
    ok(b.endPopTitle === '一場結束', 'B 出的是一般結算框', b.endPopTitle);
    ok(b.savesUntouched, 'B 存檔完全沒被動到');

    ok(errors.length === 0, '頁面沒有 JavaScript 錯誤', errors.slice(0, 3).join(' | '));
  } catch (e) {
    ok(false, '端對端測試跑完', String(e && e.message || e));
  } finally {
    clearTimeout(kill);
    if (g) await g.close();
    finish();
  }
})();
