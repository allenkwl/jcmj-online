/* 端對端：擇國而立按下主公 → 主公說一句台詞（v1.89）
   2026-10-23 使用者：「擇國而立時，可以按到哪一個主公就讓他發個聲音嗎？」
   測試一律靜音（#mute）：靜音時不出聲，但 MJAudio.BGM.lastVoice() 仍記下「這次要說的是誰」—— 驗的是那個。
   另外確認七個音檔都在、解得開、長度合理（OfflineAudioContext 解碼，不出聲）。
   執行： node test/e2e-voice.test.js                                        */
'use strict';
const E = require('./_e2e.js');
const { ok, finish } = E.counter();
const chromium = E.findChromium();

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
    console.log('═══ 端對端：主公台詞（' + latest + '）═══');

    const r = await page.evaluate(async () => {
      const wait = ms => new Promise(res => setTimeout(res, ms));
      const until = async (c, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (c()) return true; await wait(50); } return !!c(); };
      const vis = el => { if (!el) return false; if (el.offsetParent) return true; const cs = getComputedStyle(el); return cs.position === 'fixed' && cs.display !== 'none'; };
      // 標題 → 開始征途 → 擇國而立（第一次會先播開場序章：#test 下跳過）
      await until(() => vis(document.getElementById('btn-journey')), 15000);
      try { localStorage.setItem('jcmj_intro_seen', '1'); } catch (_) {}   // 新的瀏覽器第一次會先播開場序章
      document.getElementById('btn-journey').click();
      await wait(500);
      try { if (window.MJIntro && MJIntro.isRunning()) MJIntro.stop('skip'); } catch (_) {}
      const reached = await until(() => document.querySelector('#sel-screen.show #kg-home .kcard'), 15000);
      if (!reached) return { error: '進不了擇國畫面：' + [...document.querySelectorAll('.show')].map(e => e.id || e.className).join('/') };
      await wait(2200);                                   // 卡片進場動畫（第一張 1.5 秒）
      const before = MJAudio.BGM.lastVoice();
      const said = {};
      for (const id of ['qin', 'chu', 'qi', 'yan', 'han', 'wei', 'zhao']) {
        const card = document.querySelector('#kg-home .kcard[data-id="' + id + '"]');
        if (card) card.click();
        await wait(150);
        said[id] = MJAudio.BGM.lastVoice();
      }
      // 音檔：七個都要在、解得開
      const files = {};
      for (const id of Object.keys(said)) {
        try {
          const ab = await fetch('assets/audio/voice/' + id + '.mp3').then(x => x.ok ? x.arrayBuffer() : null);
          if (!ab) { files[id] = 'missing'; continue; }
          const oc = new OfflineAudioContext(2, 44100, 44100);
          const buf = await oc.decodeAudioData(ab);
          files[id] = +buf.duration.toFixed(2);
        } catch (e) { files[id] = 'error: ' + e; }
      }
      return { before, said, files, sfx: MJAudio.SFX.isEnabled() };
    });

    ok(!r.error, '進得了擇國畫面', r.error);
    if (r.error) throw new Error(r.error);
    ok(r.before === null, '進擇國畫面之前沒有說過話', JSON.stringify(r.before));
    ok(r.sfx === false, '（測試前提）#mute：音效關著，不會真的出聲', JSON.stringify(r.sfx));
    for (const id of Object.keys(r.said)) {
      ok(r.said[id] === id, '按下「' + id + '」的主公 → 說的是' + id + '的台詞', JSON.stringify(r.said[id]));
    }
    for (const id of Object.keys(r.files)) {
      const d = r.files[id];
      ok(typeof d === 'number' && d > 0.8 && d < 6, id + ' 的音檔在、解得開，長度合理（' + d + ' 秒）', JSON.stringify(d));
    }
    ok(errors.length === 0, '頁面沒有 JavaScript 錯誤', errors.slice(0, 3).join(' | '));
  } catch (e) {
    ok(false, '端對端測試跑完', String(e && e.stack || e).slice(0, 500));
  } finally {
    clearTimeout(kill);
    if (g) await g.close();
    finish();
  }
})();
