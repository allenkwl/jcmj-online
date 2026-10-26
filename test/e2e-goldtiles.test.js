/* 端對端：別家的手牌立起來、金黃牌、決戰奏章（v2.15，devtools/立體牌/sprites/v3/README.md）
   2026-10-26 使用者：「另外三家的手牌……應該是立起來的」「整套牌一起畫……再另外畫一組金黃色……在最後要打最後一國改用金黃色牌，
   也可以特別在開打前秀出文武百官奏章」「只有打最後一國的玩家會看到黃金牌，連線模式也一樣」
   「連線也出奏章，從 4 國起……征服 4 國出〈掃平六合疏〉，征服 5 國（打最後一國）出文武百官的決戰奏章。金黃牌在 4 國時出現」。
   單機（testCampaign：只在記憶體裡的戰役，不碰存檔）：
     ‧ 征服 3 國：〈請伐三國疏〉、豬肝紅
     ‧ 征服 4 國：〈掃平六合疏〉、金黃（發牌動畫的牌牆也是金的）
     ‧ 征服 5 國：文武百官〈千秋大業疏〉（上款、按鈕都換）、金黃
     ‧ 三家的手牌是立著的（對家 standV、左右 standH）；自己的手牌維持平面
   連線（本機模擬器）：甲征服 4 國、乙從頭開始 ——
     ‧ 甲在天下形勢之前看到奏章，乙直接看到地圖（奏章只給自己征服四國以上的人）
     ‧ 甲的牌是金黃、乙的是豬肝紅（同一桌各看各的）
   拿舊版跑要失敗： E2E_FILE=戰國麻將線上v2.14.html node test/e2e-goldtiles.test.js
   執行： node test/e2e-goldtiles.test.js                                                    */
'use strict';
const fs = require('fs');
const path = require('path');
const E = require('./_e2e.js');
const { ok, finish } = E.counter();
const chromium = E.findChromium();

const HELPERS = () => {
  window.__W = ms => new Promise(r => setTimeout(r, ms));
  window.__until = async (cond, max) => { const t0 = Date.now(); while (Date.now() - t0 < (max || 10000)) { try { if (cond()) return true; } catch (_) {} await __W(80); } try { return !!cond(); } catch (_) { return false; } };
  window.__vis = el => { if (!el) return false; if (el.offsetParent) return true; const cs = getComputedStyle(el); return cs.position === 'fixed' && cs.display !== 'none' && cs.visibility !== 'hidden'; };
  window.__decree = () => ({ shown: document.getElementById('decree-ov').classList.contains('show'),
    head: document.getElementById('dc-head').textContent, title: document.getElementById('dc-title').textContent,
    btn: document.getElementById('dc-ok').textContent, body: document.getElementById('dc-body').textContent });
  /* 牌桌上：用哪一套、三家的手牌有幾張立著、自己的手牌有沒有被換掉 */
  window.__table = () => {
    const n = id => [...document.querySelectorAll('#' + id + ' canvas')];
    return { set: MJTiles.bodySet && MJTiles.bodySet(),
      stand: ['hand-top', 'hand-left', 'hand-right'].map(id => n(id).filter(c => c.classList.contains('stand')).length),
      own3d: n('hand-bottom').filter(c => c.classList.contains('tile3d')).length };
  };
  /* 發牌動畫的牌牆用哪一組圖（一路記下 #deal-anim 裡出現過的牌身） */
  window.__dealSeen = new Set();
  // ⚠️ addInitScript 跑的時候還沒有 documentElement —— 等頁面建好再掛
  const watch = () => new MutationObserver(() => document.querySelectorAll('#deal-anim img').forEach(im => {
    const m = (im.getAttribute('src') || '').match(/(tiles3d(?:-gold)?)\/(\w+)\.webp/); if (m) __dealSeen.add(m[1] + '/' + m[2]);
  })).observe(document.documentElement, { childList: true, subtree: true });
  if (document.documentElement) watch(); else document.addEventListener('DOMContentLoaded', watch, { once: true });
};

(async () => {
  if (!chromium) {
    ok(false, '找得到 Playwright', '請在專案資料夾跑：npm i -D playwright && npx playwright install chromium');
    return finish();
  }
  let emu = null, srv = null, browser = null;
  const kill = setTimeout(async () => {
    console.log('超過 5 分鐘，強制結束');
    try { if (emu) await emu.stop(); } catch (_) {}
    process.exit(1);
  }, 300000);
  try {
    srv = await E.serve();
    const latest = process.env.E2E_FILE || JSON.parse(fs.readFileSync(path.join(E.ROOT, 'latest.json'), 'utf8')).file;
    console.log('═══ 端對端：立著的別家手牌、金黃牌、決戰奏章（' + latest + '）═══');
    browser = await chromium.launch({ headless: true });

    /* ── 單機 ── */
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    await ctx.addInitScript(() => { try { localStorage.setItem('jcmj_intro_seen', '1'); } catch (_) {} });
    await ctx.addInitScript(HELPERS);
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', e => errs.push(String(e)));
    const soloCase = async conquered => {
      await p.goto(`http://127.0.0.1:${srv.address().port}/${encodeURI(latest)}#test&mute`);
      await p.waitForFunction(() => window.MJDev && window.MJTiles, null, { timeout: 20000 });
      await p.waitForFunction(() => !MJTiles.bodiesReady || MJTiles.bodiesReady(), null, { timeout: 10000 });
      return p.evaluate(async c => {
        MJDev.testCampaign({ kingdom: 'qin', conquered: c });
        await __until(() => __decree().shown, 5000);
        const d = __decree();
        document.getElementById('dc-ok').click();
        let bet = false;
        for (let i = 0; i < 300; i++) {
          const mo = document.querySelector('#map-ov.show #map-ok'); if (mo) mo.click();
          const fb = document.querySelector('#fortune-ov.show #f-bets button[data-bet="normal"]'); if (fb) { fb.click(); bet = true; }
          if (bet && !document.getElementById('deal-anim')) break;
          await __W(80);
        }
        await __W(300);
        return { d, t: __table(), deal: [...__dealSeen].sort() };
      }, conquered);
    };
    const c3 = await soloCase(['han', 'wei', 'zhao']);
    ok(c3.d.title === '請伐三國疏' && c3.d.head === '臣等謹奏', '單機征服 3 國：請伐三國疏（臣等謹奏）', JSON.stringify(c3.d.title + '／' + c3.d.head));
    ok(c3.t.set === 'maroon', '單機征服 3 國：豬肝紅', JSON.stringify(c3.t));
    ok(c3.t.stand.every(n => n >= 13), '三家的手牌都是立著的（對家、左右）', JSON.stringify(c3.t.stand));
    ok(c3.t.own3d === 0, '自己的手牌維持平面', JSON.stringify(c3.t));
    ok(c3.deal.includes('tiles3d/backV') && c3.deal.some(x => /tiles3d\/stand/.test(x)) && !c3.deal.some(x => /gold/.test(x)),
       '發牌動畫：豬肝紅的牌牆，飛到別家的是立著的牌', JSON.stringify(c3.deal));

    const c4 = await soloCase(['han', 'wei', 'zhao', 'yan']);
    ok(c4.d.title === '掃平六合疏' && /金牌/.test(c4.d.body), '單機征服 4 國：掃平六合疏（提到金牌）', c4.d.title);
    ok(c4.t.set === 'gold', '單機征服 4 國：金黃牌', JSON.stringify(c4.t));
    ok(c4.deal.includes('tiles3d-gold/backV') && c4.deal.some(x => /tiles3d-gold\/stand/.test(x)), '發牌動畫的牌牆、飛出去的牌都是金的', JSON.stringify(c4.deal));

    const c5 = await soloCase(['han', 'wei', 'zhao', 'yan', 'chu']);
    ok(c5.d.title === '千秋大業疏' && c5.d.head === '文武百官　謹奏', '單機征服 5 國（打最後一國）：文武百官〈千秋大業疏〉', JSON.stringify(c5.d.title + '／' + c5.d.head));
    ok(/千秋大業，勢在必得/.test(c5.d.body) && /決戰/.test(c5.d.btn), '內文「千秋大業，勢在必得」、按鈕「准奏，決戰」', c5.d.btn);
    ok(c5.t.set === 'gold', '單機征服 5 國：金黃牌', JSON.stringify(c5.t));
    ok(errs.length === 0, '單機頁面沒有 JavaScript 錯誤', errs.slice(0, 3).join(' | '));
    await ctx.close();

    /* ── 連線：甲征服 4 國、乙從頭開始 ── */
    emu = await E.startEmulators();
    const base = `http://127.0.0.1:${srv.address().port}/${encodeURI(latest)}?emu=1#test&mute`;
    const QIN4 = { v: 1, kingdoms: { qin: { seat: 0, name: '甲', isAI: false, kingdom: 'qin', conquered: ['han', 'wei', 'zhao', 'yan'],
      lastStreak: 0, boost: false, matches: 8, unified: false, gold: 3000 } } };
    const player = async (store) => {
      const c = await browser.newContext({ viewport: { width: 1280, height: 720 } });
      await c.addInitScript(s => { try { if (!sessionStorage.getItem('__seeded')) { Object.keys(s).forEach(k => localStorage.setItem(k, s[k])); sessionStorage.setItem('__seeded', '1'); } localStorage.setItem('jcmj_intro_seen', '1'); } catch (_) {} }, store);
      await c.addInitScript(HELPERS);
      const pg = await c.newPage();
      const er = []; pg.on('pageerror', e => er.push(String(e)));
      await pg.goto(base);
      await pg.waitForFunction(() => window.MJDev && window.MJLobby && window.MJOnlineProgress, null, { timeout: 20000 });
      await pg.evaluate(async () => { document.getElementById('btn-online').click(); await __until(() => __vis(document.getElementById('net-lobby')), 20000); });
      return { pg, er };
    };
    const pickK = (pg, k) => pg.evaluate(async kk => {
      await __until(() => document.querySelector('#sel-screen.show.online') && document.querySelectorAll('#kg-home .kcard').length === 7, 15000);
      document.querySelector('#kg-home .kcard[data-id="' + kk + '"]').click();
      await __until(() => !document.getElementById('btn-start').disabled, 5000);
      document.getElementById('btn-start').click();
      return __until(() => __vis(document.getElementById('net-room')), 8000);
    }, k);
    const A = await player({ jcmj_online_kingdoms: JSON.stringify(QIN4), jcmj_my_name: '甲' });
    const B = await player({ jcmj_my_name: '乙' });
    await A.pg.evaluate(async () => {
      document.getElementById('lobby-create').click();
      await __until(() => __vis(document.getElementById('ask-input')), 5000);
      document.getElementById('ask-input').value = '金牌桌';
      document.getElementById('ask-ok').click();
    });
    ok(await pickK(A.pg, 'qin'), '（前提）甲開桌、選秦國');
    const joined = await B.pg.evaluate(async () => {
      await __until(() => [...document.querySelectorAll('#lobby-groups .net-row')].some(r => /金牌桌/.test(r.textContent)), 15000);
      const r = [...document.querySelectorAll('#lobby-groups .net-row')].find(x => /金牌桌/.test(x.textContent));
      if (r) r.click(); return !!r;
    });
    ok(joined && await pickK(B.pg, 'zhao'), '（前提）乙加入、選趙國');
    await B.pg.evaluate(async () => { await __until(() => !document.getElementById('room-ready').disabled, 8000); document.getElementById('room-ready').click(); });
    await A.pg.evaluate(async () => { await __until(() => !document.getElementById('room-start').disabled, 15000); document.getElementById('room-start').click(); });
    const aDec = await A.pg.evaluate(async () => { await __until(() => __decree().shown, 15000); return Object.assign(__decree(), { map: document.getElementById('map-ov').classList.contains('show') }); });
    const bMap = await B.pg.evaluate(async () => { await __until(() => document.getElementById('map-ov').classList.contains('show'), 15000);
      return { map: document.getElementById('map-ov').classList.contains('show'), decree: __decree().shown }; });
    ok(aDec.shown && aDec.title === '掃平六合疏' && !aDec.map, '連線：征服 4 國的甲先看到〈掃平六合疏〉（地圖還沒開）', JSON.stringify({ t: aDec.title, map: aDec.map }));
    ok(bMap.map && !bMap.decree, '連線：從頭開始的乙沒有奏章，直接看到天下形勢', JSON.stringify(bMap));
    await A.pg.evaluate(() => document.getElementById('dc-ok').click());
    const aMap = await A.pg.evaluate(() => __until(() => document.getElementById('map-ov').classList.contains('show'), 8000));
    ok(aMap, '甲按「准奏」之後才開天下形勢');
    const toTable = pg => pg.evaluate(async () => {
      let bet = false;
      for (let i = 0; i < 400; i++) {
        const mo = document.querySelector('#map-ov.show #map-ok'); if (mo && !mo.disabled) mo.click();
        const fb = document.querySelector('#fortune-ov.show #f-bets button[data-bet="normal"]'); if (fb) { fb.click(); bet = true; }
        if (bet && !document.getElementById('deal-anim') && document.querySelectorAll('#hand-top canvas').length) break;
        await __W(80);
      }
      await __W(400);
      return Object.assign(__table(), { deal: [...__dealSeen].sort() });
    });
    const [aT, bT] = await Promise.all([toTable(A.pg), toTable(B.pg)]);
    ok(aT.set === 'gold' && aT.deal.some(x => /tiles3d-gold\/back/.test(x)), '連線：甲（征服 4 國）的牌是金黃、發牌也是金的', JSON.stringify(aT));
    ok(bT.set === 'maroon' && !bT.deal.some(x => /gold/.test(x)), '連線：同一桌的乙看到的是豬肝紅', JSON.stringify(bT));
    ok(aT.stand.every(n => n >= 13) && bT.stand.every(n => n >= 13), '連線：兩邊的三家手牌都是立著的', JSON.stringify({ a: aT.stand, b: bT.stand }));
    ok(A.er.length === 0 && B.er.length === 0, '連線頁面沒有 JavaScript 錯誤', A.er.concat(B.er).slice(0, 3).join(' | '));
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
