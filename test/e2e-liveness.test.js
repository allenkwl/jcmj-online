/* 端對端：在不在場（v1.93，docs/host-liveness.md）
   ───────────────────────────────────────────────────────────────
   2026-10-24 使用者回報：手機開桌、離開後換電腦（同一帳號）回來，另一位真人在桌上 —— 整桌卡住。
   本機 Firebase 模擬器＋無頭 Chromium，計時縮短（MJDev.netTiming）：

   第一桌：手機（帳號 X，開桌）＋ 乙（匿名）
     1 久久不動：輪到手機出牌不動 → 中央倒數「N 秒後由○○代打」→ 武將代打（idle）→ 一碰畫面就回來
     2 手機跳背景（凍住、不再更新「正在哪一桌」）→ 電腦用同一帳號從大廳點那一桌 →
       直接回到座位、接著當開桌的人（不是待入座、不重開一場）；乙沒有接手、牌局照常往前
       → 手機回到前景：被擋「你的帳號正在…（另一台裝置）」、回大廳；成員節點還在（是電腦在用）
   第二桌：丙（匿名，開桌）＋ 丁（匿名）
     3 丙跳背景 → 丁問他、他不回答 → 約 10 秒後丁接手 → 丙回到前景：退成一般玩家，牌局照常
   執行： node test/e2e-liveness.test.js（要 Java 與 firebase CLI）                     */
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
  /* 模擬跳背景／回前景。手機在背景時計時器會停，「正在哪一桌」也就不再更新 —— 無頭瀏覽器的計時器不會停，自己擋 */
  window.__bg = on => {
    if (on) { window.__claim = window.__claim || Net.claimSession; Net.claimSession = () => Promise.resolve(true); }
    else if (window.__claim) { Net.claimSession = window.__claim; }
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => !!on });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => on ? 'hidden' : 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  };
`;
const FAST = { turnMs: 5000, warnMs: 4000, stallMs: 2000 };

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
  const toTable = p => p.page.evaluate(async (fast) => {
    MJDev.netTiming(fast);
    for (let i = 0; i < 400; i++) {
      const m = document.getElementById('map-ok'); if (__vis(m) && !m.disabled) m.click();
      const fb = document.querySelector('#fortune-ov.show #f-bets button[data-bet="normal"]'); if (fb) { fb.click(); return true; }
      await new Promise(r => setTimeout(r, 100));
    }
    return false;
  }, FAST);
  const [a, b] = await Promise.all([toTable(host), toTable(guest)]);
  ok(a && b, name + '：兩邊都押完注');
}
const net = p => p.page.evaluate(() => MJDev.net);
const discards = p => p.page.evaluate(() => { const h = window.__test.match && window.__test.match.hand; return h ? h.seats.reduce((n, s) => n + s.discards.length, 0) + h.handNo * 1000 : -1; });

(async () => {
  if (!chromium) {
    ok(false, '找得到 Playwright', '請在專案資料夾跑：npm i -D playwright && npx playwright install chromium');
    return finish();
  }
  const kill = setTimeout(() => { console.log('超過 6 分鐘，強制結束'); process.exit(1); }, 360000);
  let emu = null, srv = null, browser = null;
  const all = [];
  try {
    emu = await E.startEmulators();
    srv = await E.serve();
    const latest = process.env.E2E_FILE || JSON.parse(fs.readFileSync(path.join(E.ROOT, 'latest.json'), 'utf8')).file;
    const base = `http://127.0.0.1:${srv.address().port}/${encodeURI(latest)}?emu=1#test&mute`;
    console.log('═══ 端對端：在不在場（' + latest + '，本機模擬器）═══');
    browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });

    // ── 第一桌：手機（帳號 X）＋乙 ──
    const P = await newPlayer(browser, base, '手機');
    const O = await newPlayer(browser, base, '乙');
    const C = await newPlayer(browser, base, '電腦');
    all.push(P, O, C);
    await P.page.evaluate(async () => { Net.init(); await firebase.auth().createUserWithEmailAndPassword('x@example.com', 'pass1234'); });
    await reload(P);
    await C.page.evaluate(async () => { Net.init(); await firebase.auth().signInWithEmailAndPassword('x@example.com', 'pass1234'); });
    await reload(C);
    await startTable(P, O, '活桌', 'qin', 'zhao');
    const uidP = await P.page.evaluate(() => Net.clientId);

    // 1 久久不動（手機坐莊，第一手就是他）
    const idle = await P.page.evaluate(async () => {
      const me = MJDev.net.me;
      const myTurn = () => { const w = window.__test.waiting; return w && w.kind === 'turn' && w.seat === me; };
      if (!await __until(myTurn, 15000)) return { error: '等不到輪到手機' };
      const warned = await __until(() => document.getElementById('idle-warn').classList.contains('show'), 6000);
      const text = document.getElementById('idle-warn').textContent;
      const subbed = await __until(() => { const s = window.__test.match.seats[me].sub; return s && s.idle; }, 8000);
      const played = await __until(() => window.__test.match.hand.seats[me].discards.length > 0, 8000);
      document.dispatchEvent(new Event('pointerdown'));
      const back = await __until(() => !window.__test.match.seats[me].sub, 5000);
      return { warned, text, subbed, played, back, subbedFlag: !!window.__test.match.seats[me].subbed };
    });
    ok(!idle.error, '輪到手機出牌', idle.error);
    ok(idle.warned && /\d+ 秒後由 .+ 代打/.test(idle.text), '最後幾秒：畫面中央倒數「N 秒後由○○代打」', JSON.stringify(idle.text));
    ok(idle.subbed, '時間到：武將代打（久久不動）', JSON.stringify(idle));
    ok(idle.played, '武將替他出了牌，牌局沒停');
    ok(idle.back, '一碰畫面：代打收回', JSON.stringify(idle));
    ok(!idle.subbedFlag, '久久不動不是斷線：戰果照記', JSON.stringify(idle));

    // 2 手機跳背景 → 電腦同一帳號回座、接著當開桌的人
    await C.page.evaluate(fast => { Net.SESSION_TTL_MS = 4000; MJDev.netTiming(fast); }, FAST);   // 測試：「正在哪一桌」4 秒就算過期（線上 30 秒）
    ok(await openLobby(C), '電腦進得了大廳');
    await P.page.evaluate(() => __bg(true));
    ok(await P.page.evaluate(() => MJDev.netFrozen), '手機跳背景：凍住');
    await new Promise(r => setTimeout(r, 4600));
    ok(await clickTable(C, '活桌'), '電腦在大廳點「活桌」');
    const cIn = await C.page.evaluate(async () => {
      const inGame = await __until(() => MJDev.net && MJDev.net.isHost, 12000);
      const st = await Net.db.ref('groups/' + Net.groupKey).get().then(s => s.val() || {});
      const mine = st.members && st.members[Net.clientId];
      return { inGame, net: MJDev.net, host: st.host, pending: !!(mine && mine.pending), seated: window.__test.match ? window.__test.match.seats.some(s => s.clientId === Net.clientId) : false };
    });
    ok(cIn.inGame && cIn.net.isHost, '電腦直接回到座位、接著當開桌的人', JSON.stringify(cIn));
    ok(cIn.host === uidP && !cIn.pending && cIn.seated, '開桌的還是這個帳號、不是待入座、坐在原本的座位', JSON.stringify(cIn));
    const d0 = await discards(O);
    let d1 = d0;
    for (let i = 0; i < 30 && d1 <= d0; i++) { await new Promise(r => setTimeout(r, 500)); d1 = await discards(O); }
    await new Promise(r => setTimeout(r, 2000));
    const oNet = await net(O);
    ok(oNet && !oNet.isHost, '乙沒有接手（開桌的人回來了）', JSON.stringify(oNet));
    const diag = await C.page.evaluate(() => { const h = window.__test.match.hand, w = window.__test.waiting;
      return { w: w && { kind: w.kind, seat: w.seat, seats: w.seats }, phase: h.phase, turn: h.turn, me: MJDev.net.me,
               subs: window.__test.match.seats.map(s => s.sub && { idle: s.sub.idle }), auto: window.__test.auto,
               pops: [...document.querySelectorAll('.show')].map(e => e.id || e.className).join('/'), d: MJDev.netDiag() }; });
    ok(d1 > d0, '牌局照常往前（乙看到的出牌數增加）', d0 + ' → ' + d1 + ' ' + JSON.stringify(diag));
    // 手機回到前景：被擋
    await P.page.evaluate(() => __bg(false));
    const pBack = await P.page.evaluate(async () => {
      const out = await __until(() => !MJDev.net, 10000);
      await __until(() => /另一台裝置/.test(__toast()), 4000);
      return { out, toast: __toast(), lobby: __vis(document.getElementById('net-lobby')) };
    });
    ok(pBack.out && /你的帳號正在「活桌」（另一台裝置）/.test(pBack.toast), '手機回前景：被擋「你的帳號正在「活桌」（另一台裝置）」', JSON.stringify(pBack));
    ok(pBack.lobby, '手機回到大廳', JSON.stringify(pBack));
    const after = await C.page.evaluate(async () => {
      await new Promise(r => setTimeout(r, 3000));
      const st = await Net.db.ref('groups/' + Net.groupKey).get().then(s => s.val() || {});
      return { node: !!(st.members && st.members[Net.clientId]), net: MJDev.net };
    });
    ok(after.node && after.net && after.net.isHost, '電腦還在桌上當開桌的人，成員節點還在', JSON.stringify(after));
    // 電腦的牌桌畫面拿到的是自己的手牌
    const cHand = await C.page.evaluate(() => { const h = window.__test.match.hand; return h.seats[MJDev.net.me].hand.filter(t => !t.hidden).length; });
    ok(cHand >= 10, '電腦看得到自己的手牌', String(cHand));

    // ── 第二桌：丙（開桌）跳背景 → 丁接手 ──
    const Q = await newPlayer(browser, base, '丙');
    const R = await newPlayer(browser, base, '丁');
    all.push(Q, R);
    await startTable(Q, R, '背景桌', 'chu', 'qi');
    await new Promise(r => setTimeout(r, 1500));
    await Q.page.evaluate(() => __bg(true));
    const take = await R.page.evaluate(async () => {
      const t0 = Date.now();
      const got = await __until(() => MJDev.net && MJDev.net.isHost, 25000);
      return { got, secs: (Date.now() - t0) / 1000 };
    });
    ok(take.got, '丙在背景：丁問了沒回答，接手開桌', JSON.stringify(take));
    ok(take.secs >= 6 && take.secs <= 20, '大約 10 秒才換（不是一跳背景就換）', JSON.stringify(take));
    await Q.page.evaluate(() => __bg(false));
    const qBack = await Q.page.evaluate(async () => {
      const demoted = await __until(() => MJDev.net && !MJDev.net.isHost && !MJDev.netFrozen, 10000);
      return { demoted, net: MJDev.net };
    });
    ok(qBack.demoted, '丙回前景：發現被接手了，退成一般玩家', JSON.stringify(qBack));
    const r0 = await discards(Q);
    await new Promise(r => setTimeout(r, 8000));
    const r1 = await discards(Q);
    ok(r1 > r0, '丙那台看得到牌局照常往前', r0 + ' → ' + r1);

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
