/* 端對端：連線的七國進度（docs/online-kingdoms.md 第一階段）
   ───────────────────────────────────────────────────────────────
   本機 Firebase 模擬器（線上同一份規則）＋ 無頭 Chromium 開兩位玩家（各自的瀏覽器資料、各自的匿名登入）：
     甲：瀏覽器裡已經有秦國的進度（征服韓魏、2,450 兩、打過 5 場），還有一份舊的一桌一段存檔
     乙：全新
   檢查：
     ‧ 進大廳時舊存檔清掉、提示一次
     ‧ 甲開桌 → 一進房間就擇國；秦國的卡片寫著自己的進度
     ‧ 乙加入 → 擇國時秦國已有主公（不能選）、趙國「尚未出征」
     ‧ 開打 → 牌桌上甲帶著征服地（韓、魏）
     ‧ 一場打完 → 甲的秦國進度更新（第 6 場）、乙的趙國進度建起來（第 1 場）
     ‧ 同一個瀏覽器開第二個分頁 → 不能再上桌
   執行： node test/e2e-online.test.js（要 Java 與 firebase CLI；整支約 1～2 分鐘）           */
'use strict';
const fs = require('fs');
const path = require('path');
const E = require('./_e2e.js');
const { ok, finish } = E.counter();
const chromium = E.findChromium();

const QIN = { v: 1, kingdoms: { qin: { seat: 0, name: '甲', isAI: false, kingdom: 'qin', conquered: ['han', 'wei'],
  lastStreak: 0, boost: false, matches: 5, unified: false, gold: 2450 } } };

/* 頁面裡用的小工具：等到條件成立（不要固定等幾秒，見 e2e-fallen 的教訓） */
const HELPERS = `
  window.__until = async (cond, max) => { const t0 = Date.now(); while (Date.now() - t0 < (max || 10000)) { try { if (cond()) return true; } catch (_) {} await new Promise(r => setTimeout(r, 80)); } try { return !!cond(); } catch (_) { return false; } };
  // ⚠️ 固定定位（position:fixed）的元素 offsetParent 一律是 null —— 大廳、房間都是，不能只看 offsetParent
  window.__vis = el => { if (!el) return false; if (el.offsetParent) return true; const cs = getComputedStyle(el); return cs.position === 'fixed' && cs.display !== 'none' && cs.visibility !== 'hidden'; };
  window.__toast = () => (document.getElementById('lobby-toast') || {}).textContent || '';
`;

async function newPlayer(browser, base, storage) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  if (storage) await ctx.addInitScript(s => { try { if (!sessionStorage.getItem('__seeded')) { Object.keys(s).forEach(k => localStorage.setItem(k, s[k])); sessionStorage.setItem('__seeded', '1'); } } catch (_) {} }, storage);
  await ctx.addInitScript(() => { try { localStorage.setItem('jcmj_intro_seen', '1'); } catch (_) {} });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  if (process.env.E2E_DEBUG) page.on('console', m => console.log('  [console]', m.type(), m.text().slice(0, 200)));
  await page.goto(base);
  await page.waitForFunction(() => window.MJDev && window.MJLobby && window.MJOnlineProgress, null, { timeout: 20000 });
  await page.evaluate(HELPERS);
  return { ctx, page, errors };
}

/* 進大廳 */
async function openLobby(p) {
  return p.evaluate(async () => {
    if (window.MJIntro && MJIntro.isRunning && MJIntro.isRunning()) MJIntro.stop('skipped');
    document.getElementById('btn-online').click();
    return __until(() => __vis(document.getElementById('net-lobby')), 20000);
  });
}

/* 擇國：等選國畫面出來，讀卡片上的字，點那一國，按出戰 */
async function pick(p, kingdom) {
  return p.evaluate(async (k) => {
    await __until(() => document.querySelector('#sel-screen.show.online') && document.querySelectorAll('#kg-home .kcard').length === 7, 15000);
    const cards = {};
    document.querySelectorAll('#kg-home .kcard').forEach(c => {
      cards[c.dataset.id] = { prog: (c.querySelector('.kprog') || {}).textContent || '', taken: c.classList.contains('dim') };
    });
    const card = document.querySelector('#kg-home .kcard[data-id="' + k + '"]');
    if (card) card.click();
    await __until(() => !document.getElementById('btn-start').disabled, 5000);
    document.getElementById('btn-start').click();
    await __until(() => __vis(document.getElementById('net-room')), 8000);
    return cards;
  }, kingdom);
}

(async () => {
  if (!chromium) {
    ok(false, '找得到 Playwright', '請在專案資料夾跑：npm i -D playwright && npx playwright install chromium');
    return finish();
  }
  const kill = setTimeout(() => { console.log('超過 5 分鐘，強制結束'); process.exit(1); }, 300000);
  let emu = null, srv = null, browser = null;
  try {
    emu = await E.startEmulators();
    srv = await E.serve();
    const latest = process.env.E2E_FILE || JSON.parse(fs.readFileSync(path.join(E.ROOT, 'latest.json'), 'utf8')).file;
    const base = `http://127.0.0.1:${srv.address().port}/${encodeURI(latest)}?emu=1#test&mute`;
    console.log('═══ 端對端：連線七國進度（' + latest + '，本機模擬器）═══');
    browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });

    const A = await newPlayer(browser, base, {
      jcmj_online_kingdoms: JSON.stringify(QIN),
      jcmj_online_saves: JSON.stringify([{ id: 'old-1', table: '舊桌', me: {} }]),
      jcmj_my_name: '甲',
    });
    const B = await newPlayer(browser, base, { jcmj_my_name: '乙' });

    // ── 甲：進大廳（舊存檔清掉）→ 開桌 → 擇國 ──
    ok(await openLobby(A.page), '甲進得了大廳');
    const a0 = await A.page.evaluate(() => ({
      old: localStorage.getItem('jcmj_online_saves'), toast: __toast(),
      listed: (document.getElementById('lobby-recent').textContent || ''),
    }));
    ok(a0.old === null, '舊的一桌一段存檔清掉了');
    ok(/舊的連線存檔已清除/.test(a0.toast), '清掉時有提示一次', a0.toast);
    ok(/秦國/.test(a0.listed) && /征服 2 國/.test(a0.listed), '大廳列出自己的連線進度（秦國・征服 2 國）', a0.listed);

    await A.page.evaluate(async () => {
      document.getElementById('lobby-create').click();
      await __until(() => __vis(document.getElementById('ask-input')), 5000);
      document.getElementById('ask-input').value = '測試桌';
      document.getElementById('ask-ok').click();
    });
    const aCards = await pick(A.page, 'qin');
    ok(/征服 2 國/.test(aCards.qin.prog) && /2,450 兩/.test(aCards.qin.prog) && /第 6 場/.test(aCards.qin.prog),
       '甲的秦國卡片寫著自己的進度', JSON.stringify(aCards.qin));
    ok(aCards.zhao.prog === '尚未出征', '甲沒打過的國寫「尚未出征」', JSON.stringify(aCards.zhao));

    // ── 乙：加入 → 擇國（秦國已有主公） ──
    ok(await openLobby(B.page), '乙進得了大廳');
    const joined = await B.page.evaluate(async () => {
      await __until(() => [...document.querySelectorAll('#lobby-groups .net-row')].some(r => /測試桌/.test(r.textContent)), 15000);
      const r = [...document.querySelectorAll('#lobby-groups .net-row')].find(x => /測試桌/.test(x.textContent));
      if (!r) return false;
      r.click();
      return true;
    });
    ok(joined, '乙在大廳看得到「測試桌」並加入');
    // 甲選定秦國之後，乙的選國畫面要馬上把秦國鎖起來
    await B.page.evaluate(() => __until(() => { const c = document.querySelector('#kg-home .kcard[data-id="qin"]'); return c && c.classList.contains('dim'); }, 10000));
    const bCards = await pick(B.page, 'zhao');
    ok(bCards.qin.taken, '乙的選國畫面：秦國已有主公（不能選）', JSON.stringify(bCards.qin));
    ok(bCards.zhao.prog === '尚未出征', '乙的趙國：尚未出征', JSON.stringify(bCards.zhao));

    // ── 準備、開打 ──
    await B.page.evaluate(async () => { await __until(() => !document.getElementById('room-ready').disabled, 8000); document.getElementById('room-ready').click(); });
    const started = await A.page.evaluate(async () => {
      await __until(() => !document.getElementById('room-start').disabled, 15000);
      document.getElementById('room-start').click();
      return __until(() => window.__test.match && window.__test.match.seats, 20000);
    });
    ok(started, '甲按開始、牌局建起來');
    const seats = await A.page.evaluate(() => window.__test.match.seats.map(s => ({ name: s.name, k: s.kingdom, c: s.conquered || [], ai: !!s.isAI })));
    const aSeat = seats.find(s => s.name === '甲'), bSeat = seats.find(s => s.name === '乙');
    ok(aSeat && aSeat.k === 'qin' && aSeat.c.join(',') === 'han,wei', '牌桌上甲是秦國、帶著征服地（韓、魏）', JSON.stringify(aSeat));
    ok(bSeat && bSeat.k === 'zhao' && bSeat.c.length === 0, '牌桌上乙是趙國、從頭開始', JSON.stringify(bSeat));
    ok(seats.filter(s => s.ai).length === 2, '空位由兩位電腦守將補上', JSON.stringify(seats));

    // 兩邊：天下形勢確認、占卜押普通
    const toTable = p => p.evaluate(async () => {
      for (let i = 0; i < 400; i++) {
        const m = document.getElementById('map-ok'); if (__vis(m) && !m.disabled) m.click();
        const fb = document.querySelector('#fortune-ov.show #f-bets button[data-bet="normal"]'); if (fb) { fb.click(); return true; }
        await new Promise(r => setTimeout(r, 100));
      }
      return false;
    });
    const [ta, tb] = await Promise.all([toTable(A.page), toTable(B.page)]);
    ok(ta && tb, '兩邊都走到占卜（天下形勢都確認了）');

    // ── 聽牌曲（v1.70）：群主用完整牌局算「有沒有人聽牌」，公開狀態只放有／沒有（bgmTenpai）；名牌只亮自己 ──
    // 把一家電腦換成聽牌的手（1–9 萬＋1–3 筒＋5 筒，單吊 4 筒），驗完換回原本的手，不影響後面的結算
    const tp = await A.page.evaluate(async () => {
      await new Promise(r => setTimeout(r, 600));
      const m = window.__test.match, h = m.hand;
      const me = m.seats.findIndex(s => s.name === '甲');
      const k = m.seats.findIndex((s, i) => s.isAI && h.seats[i].hand.length === 13 && h.turn !== i);
      if (k < 0) return { skip: true };
      let uid = 90000; const T = (suit, num) => ({ suit, num, display: num + suit, isHonor: false, uid: uid++ });
      window.__keep = { k, hand: h.seats[k].hand, melds: h.seats[k].melds };
      h.seats[k].hand = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => T('萬', n)).concat([1, 2, 3].map(n => T('筒', n)), [T('筒', 5)]);
      h.seats[k].melds = [];
      MJDev.redraw(); MJDev.republish();
      await new Promise(r => setTimeout(r, 300));
      const meTenpai = MJRules.isTenpaiHand(h.seats[me].hand, h.seats[me].melds);
      return { k, aiTenpai: MJRules.isTenpaiHand(h.seats[k].hand, []), lit: document.querySelectorAll('.np-tenpai').length,
               meTenpai, bgm: MJDev.bgm() };
    });
    if (!tp.skip) {
      ok(tp.aiTenpai, '（測試前提）電腦那一家真的聽牌了', JSON.stringify(tp));
      ok(tp.lit === (tp.meTenpai ? 1 : 0), '群主的名牌只亮自己的「🎯 聽」，別家（電腦）聽牌不亮', JSON.stringify(tp));
      ok(tp.bgm === 'tenpai', '群主的 BGM 切到聽牌曲', JSON.stringify(tp));
      const tb2 = await B.page.evaluate(async () => {
        await __until(() => MJDev.bgm() === 'tenpai', 8000);
        const st = await Net.db.ref('states/' + Net.groupKey).once('value').then(s => s.val() || {});
        const h = window.__test.match.hand;
        const me = window.__test.match.seats.findIndex(s => s.name === '乙');
        return { bgm: MJDev.bgm(), bgmTenpai: st.bgmTenpai, lit: document.querySelectorAll('.np-tenpai').length,
                 meTenpai: MJRules.isTenpaiHand(h.seats[me].hand, h.seats[me].melds) };
      });
      ok(tb2.bgmTenpai === true, '公開狀態只有 bgmTenpai（有人聽牌＝true），不說是誰', JSON.stringify(tb2));
      ok(tb2.bgm === 'tenpai', '乙那台也切到聽牌曲（照群主給的有／沒有）', JSON.stringify(tb2));
      ok(tb2.lit === (tb2.meTenpai ? 1 : 0), '乙的名牌只亮自己的「🎯 聽」', JSON.stringify(tb2));
      await A.page.evaluate(() => { const h = window.__test.match.hand, k = window.__keep;
        h.seats[k.k].hand = k.hand; h.seats[k.k].melds = k.melds; MJDev.redraw(); MJDev.republish(); });
    }

    // ── 群主直接結算：甲第一、乙第二 ──
    await A.page.evaluate(async () => { await new Promise(r => setTimeout(r, 800)); const s = window.__test.match.seats;
      MJDev.finishMatch(s.map(x => x.name === '甲' ? 400 : x.name === '乙' ? 200 : -300)); });
    const settle = p => p.evaluate(async () => {
      for (let i = 0; i < 300; i++) {
        const okb = document.querySelector('#enf-ov.wait .enf-ok'); if (okb) okb.click();
        if ([...document.querySelectorAll('#end-pop button')].some(b => /繼續征戰/.test(b.textContent))) break;
        await new Promise(r => setTimeout(r, 100));
      }
      return { prog: MJOnlineProgress.load(localStorage).kingdoms,
               buttons: [...document.querySelectorAll('#end-pop button')].map(b => b.textContent) };
    });
    const [sa, sb] = await Promise.all([settle(A.page), settle(B.page)]);
    const aq = sa.prog.qin, bz = sb.prog.zhao;
    ok(aq && aq.matches === 6 && aq.conquered.length === 3, '甲的秦國進度更新：第 6 場、征服變 3 國', JSON.stringify(aq && { m: aq.matches, c: aq.conquered }));
    ok(bz && bz.matches === 1 && bz.conquered.length === 1, '乙的趙國進度建起來：打過 1 場、征服 1 國', JSON.stringify(bz && { m: bz.matches, c: bz.conquered }));
    ok(sa.buttons.some(t => /繼續征戰/.test(t)) && !sa.buttons.some(t => /退出此牌局/.test(t)),
       '一場結束：有「繼續征戰」，沒有「退出此牌局」', JSON.stringify(sa.buttons));

    // ── 同一個瀏覽器的第二個分頁：不能再上桌 ──
    const A2 = await A.ctx.newPage();
    A2.on('pageerror', e => A.errors.push(String(e)));
    await A2.goto(base);
    await A2.waitForFunction(() => window.MJDev && window.MJLobby, null, { timeout: 20000 });
    await A2.evaluate(HELPERS);
    await openLobby(A2);
    const blocked = await A2.evaluate(async () => {
      document.getElementById('lobby-create').click();
      await __until(() => /另一個分頁/.test(__toast()), 5000);
      return { toast: __toast(), asked: __vis(document.getElementById('ask-input')) };
    });
    ok(/另一個分頁/.test(blocked.toast) && !blocked.asked, '同一個瀏覽器的第二個分頁不能開桌', JSON.stringify(blocked));

    ok(A.errors.length === 0, '甲的頁面沒有 JavaScript 錯誤', A.errors.slice(0, 3).join(' | '));
    ok(B.errors.length === 0, '乙的頁面沒有 JavaScript 錯誤', B.errors.slice(0, 3).join(' | '));
  } catch (e) {
    ok(false, '端對端測試跑完', String(e && e.stack || e).slice(0, 600));
  } finally {
    clearTimeout(kill);
    if (browser) await browser.close().catch(() => {});
    if (srv) srv.close();
    if (emu) await emu.stop();
    finish();
  }
})();
