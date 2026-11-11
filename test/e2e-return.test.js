/* 端對端：離開之後回來（v2.20）
   ───────────────────────────────────────────────────────────────
   2026-11-11 使用者：「玩家在接電話離開遊戲後回不來，可以選擇觀戰，但等到一局結束也進不來」
   「朋友的 iPhone 11 改不了名字」。本機 Firebase 模擬器＋無頭 Chromium：

   第一桌：甲（開桌）＋乙，都沒登入
     1 乙的頁面被收掉（接電話）→ 10 秒後武將代打 → 甲打到下一局 → 乙重開遊戲：
       大廳那一桌寫「你的座位還在，點這裡回到牌桌」、沒有「觀戰」→ 點下去回座
       → 牌局照常往前、乙出得了牌（v2.19：開桌那台等他押注、他那台不開占卜，整桌停在「等 乙 占卜⋯」）
       → 成員資料上的國家、已選國補回來了
     2 同一場打完、開下一場：乙那台照常占卜、牌局往前（v2.19：回座標記沒清，下一場第一局又跳過占卜、整桌停住）
   第二桌：丙（開桌）＋丁
     3 丁跳背景＋斷線，這段期間丙打完這一場、開了下一場（沒有丁）→ 丁回到前景：
       回到房間、寫「這一場打完你就入座」、是待入座、沿用原本的國、不跳擇國畫面（v2.19：畫面停在上一場，下一場也排不進去）
       → 丙再打完一場 → 丁入座
   手機橫放（808×340，沒登入）
     4 大廳最上面（標題、改名字）捲得到、沒有被切在畫面外；改名字的輸入框跟「確定」排同一列
   執行： node test/e2e-return.test.js（要 Java 與 firebase CLI）                     */
'use strict';
const fs = require('fs');
const path = require('path');
const E = require('./_e2e.js');
const { ok, finish } = E.counter();
const chromium = E.findChromium();

const HELPERS = `
  window.__until = async (cond, max) => { const t0 = Date.now(); while (Date.now() - t0 < (max || 10000)) { try { if (cond()) return true; } catch (_) {} await new Promise(r => setTimeout(r, 80)); } try { return !!cond(); } catch (_) { return false; } };
  window.__vis = el => { if (!el) return false; if (el.offsetParent) return true; const cs = getComputedStyle(el); return cs.position === 'fixed' && cs.display !== 'none' && cs.visibility !== 'hidden'; };
  window.__toast = () => [(document.getElementById('lobby-toast') || {}).textContent || '', (document.getElementById('toast') || {}).textContent || ''].join(' | ');
  /* 測試裡的玩家跳出鳴牌視窗就按「過」—— 不按的話視窗要等滿 20 秒逾時（規則本來就這樣），
     「牌局照常往前」會偶爾等不到（v1.94 查到：那張牌乙其實吃得到，不是換開桌出錯） */
  setInterval(() => {
    const b = [...document.querySelectorAll('#int-pop.show button')].find(x => x.textContent.trim() === '過');
    if (b) b.click();
  }, 300);
  /* 模擬跳背景／回前景。手機在背景時計時器會停，「正在哪一桌」也就不再更新 —— 無頭瀏覽器的計時器不會停，自己擋 */
  window.__bg = on => {
    if (on) { window.__claim = window.__claim || Net.claimSession; Net.claimSession = () => Promise.resolve(true); }
    else if (window.__claim) { Net.claimSession = window.__claim; }
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => !!on });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => on ? 'hidden' : 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  };
`;
async function newPlayer(browser, base, name) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await ctx.addInitScript(n => { try { localStorage.setItem('jcmj_intro_seen', '1'); localStorage.setItem('jcmj_my_name', n); } catch (_) {} }, name);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  if (process.env.E2E_DEBUG) page.on('console', m => console.log('  [' + name + ']', m.type(), m.text().slice(0, 200)));
  await page.goto(base);
  await page.waitForFunction(() => window.MJDev && window.MJLobby && typeof Net !== 'undefined', null, { timeout: 20000 });
  await page.evaluate(HELPERS);
  return { ctx, page, errors, name };
}
async function reload(p) {
  await p.page.reload();
  await p.page.waitForFunction(() => window.MJDev && window.MJLobby && typeof Net !== 'undefined', null, { timeout: 20000 });
  await p.page.evaluate(HELPERS);
}
async function openLobby(p) {
  return p.page.evaluate(async () => {
    if (window.MJIntro && MJIntro.isRunning && MJIntro.isRunning()) MJIntro.stop('skipped');
    document.getElementById('btn-online').click();
    return __until(() => __vis(document.getElementById('net-lobby')), 20000);
  });
}
async function pick(p, kingdom) {
  return p.page.evaluate(async (k) => {
    await __until(() => document.querySelector('#sel-screen.show.online') && document.querySelectorAll('#kg-home .kcard').length === 7, 15000);
    const card = document.querySelector('#kg-home .kcard[data-id="' + k + '"]');
    if (card) card.click();
    await __until(() => !document.getElementById('btn-start').disabled, 5000);
    document.getElementById('btn-start').click();
    return __until(() => __vis(document.getElementById('net-room')), 8000);
  }, kingdom);
}
async function createTable(p, name, kingdom) {
  await p.page.evaluate(async (n) => {
    document.getElementById('lobby-create').click();
    await __until(() => __vis(document.getElementById('ask-input')), 5000);
    document.getElementById('ask-input').value = n;
    document.getElementById('ask-ok').click();
  }, name);
  return pick(p, kingdom);
}
async function clickTable(p, name) {
  return p.page.evaluate(async (n) => {
    await __until(() => [...document.querySelectorAll('#lobby-groups .net-row')].some(r => r.textContent.includes(n)), 15000);
    const r = [...document.querySelectorAll('#lobby-groups .net-row')].find(x => x.textContent.includes(n));
    if (!r) return false;
    r.click();
    return true;
  }, name);
}

async function startTable(host, guest, name, kHost, kGuest) {
  ok(await openLobby(host), host.name + '進得了大廳');
  ok(await createTable(host, name, kHost), host.name + '開了「' + name + '」');
  ok(await openLobby(guest), guest.name + '進得了大廳');
  ok(await clickTable(guest, name), guest.name + '加入「' + name + '」');
  await pick(guest, kGuest);
  await guest.page.evaluate(async () => { await __until(() => !document.getElementById('room-ready').disabled, 8000); document.getElementById('room-ready').click(); });
  const started = await host.page.evaluate(async () => {
    await __until(() => !document.getElementById('room-start').disabled, 15000);
    document.getElementById('room-start').click();
    return __until(() => window.__test.match && window.__test.match.seats, 20000);
  });
  ok(started, name + '開打');
  const [a, b] = await Promise.all([toTable(host), toTable(guest)]);
  ok(a && b, name + '：兩邊都押完注');
}
/* 地圖按確認、占卜押平押 */
const toTable = p => p.page.evaluate(async () => {
  for (let i = 0; i < 400; i++) {
    const m = document.getElementById('map-ok'); if (__vis(m) && !m.disabled) m.click();
    const fb = document.querySelector('#fortune-ov.show #f-bets button[data-bet="normal"]'); if (fb) { fb.click(); return true; }
    await new Promise(r => setTimeout(r, 100));
  }
  return false;
});
const sleep = ms => new Promise(r => setTimeout(r, ms));
const discards = p => p.page.evaluate(() => { const h = window.__test.match && window.__test.match.hand; return h ? h.seats.reduce((n, s) => n + s.discards.length, 0) + h.handNo * 1000 : -1; });
const label = p => p.page.evaluate(() => (document.getElementById('phase-label') || {}).textContent);
async function moving(p, ms) { const d0 = await discards(p); let d1 = d0; for (let t = 0; t < ms && d1 <= d0; t += 500) { await sleep(500); d1 = await discards(p); } return { d0, d1, ok: d1 > d0 }; }
async function reopen(p, base) {
  p.page = await p.ctx.newPage();
  p.page.on('pageerror', e => p.errors.push(String(e)));
  await p.page.goto(base);
  await p.page.waitForFunction(() => window.MJDev && window.MJLobby && typeof Net !== 'undefined', null, { timeout: 20000 });
  await p.page.evaluate(HELPERS);
}
/* 開桌的人：牌山抽乾 → 流局 → 按「確認，下一局」→ 新的一局押平押 */
const hostNextHand = p => p.page.evaluate(async () => {
  const hn = window.__test.match.hand.handNo;
  MJDev.drainWall(); MJDev.setAuto(true); MJDev.republish();
  for (let i = 0; i < 400; i++) {
    const b = [...document.querySelectorAll('button')].find(x => /確認，下一局/.test(x.textContent) && __vis(x));
    if (b) { b.click(); break; }
    await new Promise(r => setTimeout(r, 100));
  }
  MJDev.setAuto(false);
  await __until(() => window.__test.match.hand && window.__test.match.hand.handNo > hn, 20000);
  for (let i = 0; i < 200; i++) {
    const fb = document.querySelector('#fortune-ov.show #f-bets button[data-bet="normal"]'); if (fb) { fb.click(); break; }
    await new Promise(r => setTimeout(r, 100));
  }
  return window.__test.match.hand.handNo;
});
/* 開桌的人：直接結算 → 分封按確認 → 繼續征戰 → 等新的一場 → 押平押 */
const hostNextMatch = p => p.page.evaluate(async () => {
  MJDev.setAuto(false);
  MJDev.finishMatch(window.__test.match.seats.map((x, i) => (4 - i) * 100));
  for (let i = 0; i < 400; i++) {
    const okb = document.querySelector('#enf-ov.wait .enf-ok'); if (okb) okb.click();
    const c = [...document.querySelectorAll('#end-pop button')].find(b => /繼續征戰/.test(b.textContent));
    if (c) { c.click(); break; }
    await new Promise(r => setTimeout(r, 100));
  }
  const seed0 = window.__test.match.seed;
  const got = await __until(() => window.__test.match.seed !== seed0 && window.__test.match.hand, 30000);
  for (let i = 0; i < 150; i++) {
    const m = document.getElementById('map-ok'); if (__vis(m) && !m.disabled) m.click();
    const fb = document.querySelector('#fortune-ov.show #f-bets button[data-bet="normal"]'); if (fb) { fb.click(); break; }
    await new Promise(r => setTimeout(r, 100));
  }
  return { got, seats: window.__test.match.seats.map(x => ({ name: x.name, human: !!x.clientId, k: x.kingdom })) };
});
const member = p => p.page.evaluate(async () => {
  const g = Net.groupKey ? await Net.db.ref('groups/' + Net.groupKey).get().then(s => s.val() || {}) : {};
  return (g.members && g.members[Net.clientId]) || null;
});

(async () => {
  if (!chromium) {
    ok(false, '找得到 Playwright', '請在專案資料夾跑：npm i -D playwright && npx playwright install chromium');
    return finish();
  }
  const kill = setTimeout(() => { console.log('超過 9 分鐘，強制結束'); process.exit(1); }, 540000);
  let emu = null, srv = null, browser = null;
  const all = [];
  try {
    emu = await E.startEmulators();
    srv = await E.serve();
    const latest = process.env.E2E_FILE || JSON.parse(fs.readFileSync(path.join(E.ROOT, 'latest.json'), 'utf8')).file;
    const base = `http://127.0.0.1:${srv.address().port}/${encodeURI(latest)}?emu=1#test&mute`;
    console.log('═══ 端對端：離開之後回來（' + latest + '，本機模擬器）═══');
    browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });

    // ── 第一桌：乙的頁面被收掉，跨過一局才回來 ──
    const A = await newPlayer(browser, base, '甲');
    const B = await newPlayer(browser, base, '乙');
    all.push(A, B);
    await startTable(A, B, '電話桌', 'chu', 'qi');
    await sleep(1500);
    await B.page.close();
    await sleep(12500);
    const subbed = await A.page.evaluate(() => { const s = window.__test.match.seats.find(x => x.name === '乙'); return !!(s && s.sub); });
    ok(subbed, '乙離開 10 秒：武將代打');
    const hn = await hostNextHand(A);
    ok(hn === 2, '甲打到第 2 局（乙不在，不等他押注）', String(hn));
    await A.page.evaluate(() => MJDev.setAuto(true));
    await sleep(2500);
    await reopen(B, base);
    ok(await openLobby(B), '乙重開遊戲、進得了大廳');
    const rows = await B.page.evaluate(async () => {
      await __until(() => [...document.querySelectorAll('#lobby-groups .net-row')].some(r => /電話桌/.test(r.textContent) && /你的座位還在/.test(r.textContent)), 10000);
      return [...document.querySelectorAll('#lobby-groups > *')].map(r => r.className + '：' + r.textContent);
    });
    ok(rows.some(t => /net-row/.test(t) && /mine/.test(t) && /電話桌/.test(t) && /你的座位還在，點這裡回到牌桌/.test(t)),
       '大廳：那一桌寫「你的座位還在，點這裡回到牌桌」', JSON.stringify(rows));
    ok(!rows.some(t => /net-watch/.test(t) && /電話桌/.test(t)), '大廳：有座位的那一桌不放「觀戰」（按了也只會被擋）', JSON.stringify(rows));
    ok(await clickTable(B, '電話桌'), '乙點那一桌');
    const back = await B.page.evaluate(async () => {
      const inGame = await __until(() => MJDev.net && window.__test.match && window.__test.match.hand, 12000);
      return { inGame, room: __vis(document.getElementById('net-room')), seated: inGame && window.__test.match.seats.some(s => s.clientId === Net.clientId) };
    });
    ok(back.inGame && back.seated && !back.room, '乙直接回到自己的座位', JSON.stringify(back));
    const unsub = await A.page.evaluate(() => __until(() => { const s = window.__test.match.seats.find(x => x.name === '乙'); return s && !s.sub; }, 8000));
    ok(unsub, '甲那台：乙的代打收回');
    const play = await B.page.evaluate(async () => {
      const me = MJDev.net.me, W = window.__test;
      const my = await __until(() => { const w = W.waiting; return w && w.kind === 'turn' && w.seat === me; }, 40000);
      if (!my) return { my };
      const n0 = W.match.hand.seats[me].discards.length;
      const did = MJDev.aiDiscard();
      const went = await __until(() => W.match.hand.seats[me].discards.length > n0 || W.match.hand.phase === 'over', 8000);
      return { my, did, went };
    });
    const lbA = await label(A);
    ok(play.my && play.did && play.went, '乙回來之後輪到他、出得了牌（整桌沒有停在「等 乙 占卜」）', JSON.stringify({ play, 甲畫面: lbA }));
    await B.page.evaluate(() => MJDev.setAuto(true));
    const mv1 = await moving(A, 20000);
    ok(mv1.ok, '牌局照常往前', JSON.stringify(mv1) + ' ' + await label(A));
    const mb = await member(B);
    ok(mb && mb.kingdom === 'qi' && mb.picked === true && !mb.pending, '回座後成員資料補回國家、已選國', JSON.stringify(mb));

    // 2 同一場打完、開下一場
    await Promise.all([A, B].map(p => p.page.evaluate(() => MJDev.setAuto(false))));
    const bCont = B.page.evaluate(async () => {
      for (let i = 0; i < 500; i++) {
        const okb = document.querySelector('#enf-ov.wait .enf-ok'); if (okb) okb.click();
        const c = [...document.querySelectorAll('#end-pop button')].find(b => /繼續征戰/.test(b.textContent));
        if (c) { c.click(); return true; }
        await new Promise(r => setTimeout(r, 100));
      }
      return false;
    });
    const [nm, bc] = await Promise.all([hostNextMatch(A), bCont]);
    ok(nm.got && bc && nm.seats.filter(x => x.human).map(x => x.name).sort().join(',') === '乙,甲', '下一場：甲、乙都留下來上桌', JSON.stringify({ nm, bc }));
    const fort = await B.page.evaluate(async () => {
      const shown = await __until(() => document.querySelector('#fortune-ov.show #f-bets button[data-bet="normal"]'), 30000);
      if (shown) document.querySelector('#fortune-ov.show #f-bets button[data-bet="normal"]').click();
      return shown;
    });
    ok(fort, '下一場：回座過的乙照常占卜（回座標記沒有留到下一場）');
    await Promise.all([A, B].map(p => p.page.evaluate(() => MJDev.setAuto(true))));
    const mv2 = await moving(A, 25000);
    ok(mv2.ok, '下一場牌局往前（沒有停在「等 乙 占卜」）', JSON.stringify(mv2) + ' ' + await label(A));

    // ── 第二桌：丁不在的時候換了一場 ──
    const C = await newPlayer(browser, base, '丙');
    const D = await newPlayer(browser, base, '丁');
    all.push(C, D);
    await startTable(C, D, '換場桌', 'yan', 'han');
    await sleep(1500);
    await D.page.evaluate(() => { __bg(true); firebase.database().goOffline(); });
    await sleep(12500);
    const nm2 = await hostNextMatch(C);
    ok(nm2.got && nm2.seats.filter(x => x.human).length === 1, '丁不在：丙打完這一場，下一場只有丙一位主公', JSON.stringify(nm2));
    await sleep(1500);
    await D.page.evaluate(() => { firebase.database().goOnline(); __bg(false); });
    const dBack = await D.page.evaluate(async () => {
      const room = await __until(() => __vis(document.getElementById('net-room')) && /這一場打完你就入座/.test(document.getElementById('room-count').textContent), 15000);
      await new Promise(r => setTimeout(r, 800));
      return { room, count: document.getElementById('room-count').textContent, net: MJDev.net,
               picking: !!document.querySelector('#sel-screen.show.online'), watch: __vis(document.getElementById('room-watch')),
               members: document.getElementById('room-members').textContent, toast: __toast() };
    });
    ok(dBack.room && !dBack.net, '丁回到前景：這一場沒有他的座位 → 回到房間，寫「這一場打完你就入座」', JSON.stringify(dBack));
    ok(!dBack.picking && /丁　韓國/.test(dBack.members), '沿用原本的韓國，不跳擇國畫面', JSON.stringify(dBack));
    const md = await member(D);
    ok(md && md.pending === true && md.picked === true && md.kingdom === 'han', '丁的成員資料：待入座、已選國（韓）', JSON.stringify(md));
    const seat2 = Promise.all([
      hostNextMatch(C),
      D.page.evaluate(async () => {
        const got = await __until(() => !__vis(document.getElementById('net-room')) && MJDev.net && window.__test.match && window.__test.match.hand
          && window.__test.match.seats.some(x => x.clientId === Net.clientId), 45000);
        return { got, k: got ? window.__test.match.seats.find(x => x.clientId === Net.clientId).kingdom : null };
      }),
    ]);
    const [nm3, dIn] = await seat2;
    ok(nm3.got && nm3.seats.filter(x => x.human).map(x => x.name).sort().join(',') === '丁,丙', '丙再打完一場：丁排進下一場', JSON.stringify(nm3));
    ok(dIn.got && dIn.k === 'han', '丁那台自動進了牌局，帶著韓國', JSON.stringify(dIn));
    const md2 = await member(D);
    ok(md2 && !md2.pending, '入座後不再是「待入座」', JSON.stringify(md2));

    // ── 手機橫放、沒登入：大廳最上面捲得到；改名字的對話框 ──
    const mctx = await browser.newContext({ viewport: { width: 808, height: 340 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await mctx.addInitScript(() => { try { localStorage.setItem('jcmj_intro_seen', '1'); } catch (_) {} });
    const M = { ctx: mctx, page: await mctx.newPage(), errors: [], name: '手機' };
    all.push(M);
    M.page.on('pageerror', e => M.errors.push(String(e)));
    await M.page.goto(base);
    await M.page.waitForFunction(() => window.MJDev && window.MJLobby && typeof Net !== 'undefined', null, { timeout: 20000 });
    await M.page.evaluate(HELPERS);
    ok(await openLobby(M), '手機橫放（808×340）進得了大廳');
    await sleep(600);
    const lay = await M.page.evaluate(() => {
      const box = document.getElementById('net-lobby'), card = box.querySelector('.net-card');
      box.scrollTop = 0;
      const c = card.getBoundingClientRect(), rn = document.getElementById('lobby-rename').getBoundingClientRect();
      const top = { card: Math.round(c.top), rename: Math.round(rn.top), cardH: Math.round(c.height), vh: innerHeight };
      box.scrollTop = 99999;
      const c2 = card.getBoundingClientRect();
      return Object.assign(top, { bottomAfterScroll: Math.round(c2.bottom), scrollable: box.scrollHeight > box.clientHeight });
    });
    ok(lay.cardH > lay.vh, '（測試前提）沒登入時大廳的卡片比畫面高', JSON.stringify(lay));
    ok(lay.card >= 0 && lay.rename >= 0, '大廳捲到最上面：卡片頂端、「改名字」都在畫面內（沒有被切在上面捲不到）', JSON.stringify(lay));
    ok(lay.scrollable && lay.bottomAfterScroll <= lay.vh + 1, '大廳捲到最下面：卡片底端也在畫面內', JSON.stringify(lay));
    const dlg = await M.page.evaluate(async () => {
      document.getElementById('net-lobby').scrollTop = 0;
      document.getElementById('lobby-rename').click();
      await __until(() => __vis(document.getElementById('ask-input')), 5000);
      const r = id => { const b = document.getElementById(id).getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), left: Math.round(b.left), right: Math.round(b.right) }; };
      const out = { input: r('ask-input'), ok: r('ask-ok'), cancel: r('ask-cancel'), vh: innerHeight };
      document.getElementById('ask-cancel').click();
      return out;
    });
    ok(dlg.ok.top < dlg.input.bottom && dlg.ok.bottom > dlg.input.top && dlg.ok.left >= dlg.input.right,
       '手機橫放：改名字的輸入框跟「確定」排同一列（鍵盤出來不會蓋住按鈕）', JSON.stringify(dlg));
    ok(dlg.input.top >= 0 && dlg.ok.bottom <= dlg.vh, '對話框整個在畫面內', JSON.stringify(dlg));

    all.forEach(p => ok(p.errors.length === 0, p.name + '：頁面沒有 JavaScript 錯誤', p.errors.slice(0, 3).join(' | ')));
  } catch (e) {
    ok(false, '端對端測試跑完', String(e && e.stack || e).slice(0, 600));
  } finally {
    clearTimeout(kill);
    try { if (browser) await browser.close(); } catch (_) {}
    try { if (srv) srv.close(); } catch (_) {}
    try { if (emu) await emu.stop(); } catch (_) {}
    finish();
  }
})();
