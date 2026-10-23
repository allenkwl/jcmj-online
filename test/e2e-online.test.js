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
     ‧ 連線國庫（v1.76）：一場打完國庫進出（輸贏＋戰利品）、結算框列出每個人「國庫 前 → 後」、牌桌頂列有國庫
     ‧ 連線亡國（v1.76）：第二場乙輸到國庫 < 0 → 乙播亡國動畫、進度刪掉、回大廳；
       甲的結算框寫著乙亡國，按繼續征戰後下一場沒有乙
     ‧ 中途加入（v1.79）：亡國回到大廳的乙看得到「進行中（東 1 局）」的牌桌 → 加入、擇國、待入座；
       甲的牌桌上有提示；甲打完按繼續征戰 → 乙自動入座下一場
     ‧ 同一個瀏覽器開第二個分頁 → 不能再上桌
     ‧ 等待室交棒（v1.81）：丙開桌、丁（待入座）戊加入 → 丙按離開，開桌馬上交給戊（不給待入座的丁、不等 10 秒）
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
    // 房間名單看得到彼此的國庫（v1.78）
    const roomTxt = await B.page.evaluate(async () => {
      await __until(() => /國庫 2,450 兩/.test(document.getElementById('room-members').textContent)
                        && /國庫 2,000 兩/.test(document.getElementById('room-members').textContent), 10000);
      return document.getElementById('room-members').textContent;
    });
    ok(/秦國.*征服 2 國・國庫 2,450 兩/.test(roomTxt) && /趙國.*國庫 2,000 兩/.test(roomTxt), '房間名單：本國・征服 N 國・國庫 X 兩', roomTxt);

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

    // ── 同一場的下一局：手牌比公開狀態晚到時，發牌動畫不能拿上一局的牌（v1.87）──
    // 2026-10-23 使用者：「發完牌是清一色，好像是上一局的牌，占卜時就是不一樣的，之後就是占卜看到的牌」。
    // 公開狀態與自己的手牌分開到；乙這台把手牌延遲 1.5 秒才交給遊戲，穩定重現「公開狀態先到」。
    await B.page.evaluate(() => {
      const ref = Net._handRef, cb0 = Net._handCb;
      window.__hand0 = cb0;
      ref.off('value', cb0);
      Net._handCb = snap => setTimeout(() => cb0(snap), 1500);
      ref.on('value', Net._handCb);
      window.__deal = [];
      const run0 = MJDealAnim.run;
      MJDealAnim.run = function (o) {
        const h = o.match.hand;
        window.__deal.push({ handNo: h.handNo, uids: (h.seats[o.mySeat].hand || []).map(t => t.uid).join(',') });
        return run0.apply(this, arguments);
      };
    });
    const hn1 = await A.page.evaluate(() => { MJDev.drainWall(); MJDev.setAuto(true); MJDev.republish(); return window.__test.match.hand.handNo; });
    await B.page.evaluate(() => MJDev.setAuto(true));
    const nextHand = p => p.evaluate(async () => {
      for (let i = 0; i < 400; i++) {
        const b = [...document.querySelectorAll('button')].find(x => /確認，下一局/.test(x.textContent) && __vis(x));
        if (b) { b.click(); return true; }
        await new Promise(r => setTimeout(r, 100));
      }
      return false;
    });
    const [na, nb] = await Promise.all([nextHand(A.page), nextHand(B.page)]);
    ok(na && nb, '第一局流局（牌山抽乾），兩邊按「確認，下一局」');
    const [, dealB] = await Promise.all([toTable(A.page), B.page.evaluate(async (hn1) => {
      // 等乙的占卜開出來，記下那一刻的手牌（押注之前）
      await __until(() => document.querySelector('#fortune-ov.show') && window.__test.match.hand.handNo > hn1, 20000);
      const m = window.__test.match, me = m.seats.findIndex(s => s.name === '乙');
      const now = m.hand.seats[me].hand.map(t => t.uid).join(',');
      const deal = window.__deal.filter(d => d.handNo === m.hand.handNo);
      const fb = document.querySelector('#fortune-ov.show #f-bets button[data-bet="normal"]'); if (fb) fb.click();
      // 手牌監聽換回原本的（後面的測試不要再延遲）
      Net._handRef.off('value', Net._handCb); Net._handCb = window.__hand0; Net._handRef.on('value', Net._handCb);
      return { handNo: m.hand.handNo, now, deal, all: window.__deal };
    }, hn1)]);
    ok(dealB.handNo === hn1 + 1, '進到同一場的第二局', JSON.stringify({ hn1, hn: dealB.handNo }));
    ok(dealB.deal.length === 1, '第二局的發牌動畫只跑一次', JSON.stringify(dealB.all.map(d => d.handNo)));
    ok(dealB.deal.length && dealB.deal[0].uids === dealB.now && dealB.now.length > 0,
       '發牌動畫拿的手牌＝占卜時的手牌（不是上一局的）', JSON.stringify({ deal: dealB.deal.map(d => d.uids.slice(0, 40)), now: dealB.now.slice(0, 40) }));

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

    // ── 連線國庫（v1.76）：甲 2,450＋400＋戰利品 300；乙 本錢 2,000＋200＋300 ──
    ok(aq && aq.gold === 3150, '甲的國庫：2,450 → 3,150（贏 400＋戰利品 300）', aq && aq.gold);
    ok(bz && bz.gold === 2500, '乙的國庫：2,000 → 2,500（贏 200＋戰利品 300）', bz && bz.gold);
    const popTxt = p => p.evaluate(() => document.getElementById('end-pop').textContent);
    const [pa, pb] = await Promise.all([popTxt(A.page), popTxt(B.page)]);
    ok(/國庫 2,450 → 3,150/.test(pa) && /國庫 2,000 → 2,500/.test(pa), '甲的結算框列出兩人的國庫（前 → 後）', pa.slice(0, 300));
    ok(/國庫 2,450 → 3,150/.test(pb) && /國庫 2,000 → 2,500/.test(pb), '乙的結算框也看得到甲的國庫', pb.slice(0, 300));

    // ── 第二場：兩人都繼續征戰 ──
    const gid1 = await A.page.evaluate(() => window.__test.match.seed);
    await Promise.all([A.page, B.page].map(p => p.evaluate(() => {
      const b = [...document.querySelectorAll('#end-pop button')].find(x => /繼續征戰/.test(x.textContent)); if (b) b.click();
    })));
    await Promise.all([A.page, B.page].map(p => p.evaluate(async () => {
      await __until(() => window.__test.match && window.__test.match.hand && !window.__test.match.finished, 20000);
    })));
    const [t2a, t2b] = await Promise.all([toTable(A.page), toTable(B.page)]);
    ok(t2a && t2b, '第二場：兩邊都走到占卜');
    const g2 = await B.page.evaluate(async () => {
      await __until(() => /國庫 2,500/.test((document.querySelector('.ci-gold') || {}).textContent || ''), 8000);
      const m = window.__test.match;
      return { top: (document.querySelector('.ci-gold') || {}).textContent || '', seatGold: m.seats.map(s => s.gold) };
    });
    ok(/國庫 2,500/.test(g2.top), '乙的牌桌頂列有自己的國庫（2,500 兩）', g2.top);
    ok(g2.seatGold.filter(x => typeof x === 'number').sort().join(',') === '2500,3150', '座位上帶著兩人開打時的國庫', JSON.stringify(g2.seatGold));

    // ── 名牌告急標（v1.78）：別家國庫 < 300 才出現；自己的不標 ──
    const lowTag = await A.page.evaluate(async () => {
      const m = window.__test.match, b = m.seats.findIndex(s => s.name === '乙'), a = m.seats.findIndex(s => s.name === '甲');
      const keep = [m.seats[a].gold, m.seats[b].gold];
      const tags = () => [...document.querySelectorAll('.np-lowgold')].map(x => x.textContent);
      const before = tags();
      m.seats[b].gold = 120 - (m.seats[b].matchScore || 0);
      m.seats[a].gold = 50 - (m.seats[a].matchScore || 0);
      MJDev.redraw();
      const after = tags();
      m.seats[a].gold = keep[0]; m.seats[b].gold = keep[1]; MJDev.redraw();
      return { before, after, back: tags() };
    });
    ok(lowTag.before.length === 0, '國庫充足：名牌沒有告急標', JSON.stringify(lowTag));
    ok(lowTag.after.length === 1 && lowTag.after[0] === '⚠️ 國庫 120', '乙的國庫 120：甲畫面上乙的名牌出現「⚠️ 國庫 120」，自己的不標', JSON.stringify(lowTag));
    ok(lowTag.back.length === 0, '國庫回來：告急標消失', JSON.stringify(lowTag));

    // ── 乙輸 3,000 → 國庫 -500 → 亡國 ──
    await A.page.evaluate(async () => { await new Promise(r => setTimeout(r, 800)); const s = window.__test.match.seats;
      MJDev.finishMatch(s.map(x => x.name === '甲' ? 500 : x.name === '乙' ? -3000 : 0)); });
    const fallB = B.page.evaluate(async () => {
      let fal = null;
      for (let i = 0; i < 300 && !fal; i++) {
        const okb = document.querySelector('#enf-ov.wait .enf-ok'); if (okb) okb.click();
        fal = document.querySelector('#fal-ov.show');
        await new Promise(r => setTimeout(r, 100));
      }
      const pop = document.getElementById('end-pop').textContent;
      if (!fal) return { fal: false, pop };
      fal.click();                                                     // 跳到戰績
      await __until(() => fal.querySelector('.f-ok.on'), 8000);
      fal.querySelector('.f-ok').click();                               // 確定
      const lobby = await __until(() => __vis(document.getElementById('net-lobby')) && !document.querySelector('#fal-ov.show'), 15000);
      return { fal: true, pop, lobby, toast: __toast(), prog: MJOnlineProgress.load(localStorage).kingdoms };
    });
    const contA = A.page.evaluate(async () => {
      for (let i = 0; i < 300; i++) {
        const okb = document.querySelector('#enf-ov.wait .enf-ok'); if (okb) okb.click();
        if ([...document.querySelectorAll('#end-pop button')].some(b => /繼續征戰/.test(b.textContent))) break;
        await new Promise(r => setTimeout(r, 100));
      }
      const pop = document.getElementById('end-pop').textContent;
      [...document.querySelectorAll('#end-pop button')].find(b => /繼續征戰/.test(b.textContent)).click();
      const seed0 = window.__test.match.seed;
      await __until(() => window.__test.match.seed !== seed0 && window.__test.match.hand, 30000);
      return { pop, seats: window.__test.match.seats.map(s => ({ name: s.name, ai: !!s.isAI })),
               prog: MJOnlineProgress.load(localStorage).kingdoms.qin };
    });
    const [fb, fa] = await Promise.all([fallB, contA]);
    ok(fb.fal, '乙：國庫跌破 0，播亡國動畫', fb.pop && fb.pop.slice(0, 200));
    ok(/💀 亡國/.test(fb.pop), '乙的結算框標著自己亡國', fb.pop && fb.pop.slice(0, 300));
    ok(fb.lobby, '乙：按確定之後回到連線大廳');
    ok(fb.prog && !fb.prog.zhao, '乙的趙國進度刪掉了', JSON.stringify(fb.prog));
    ok(/亡國/.test(fb.toast || ''), '乙回到大廳時有說明', fb.toast);
    ok(/乙 國庫跌破 0，亡國離桌/.test(fa.pop) && /💀 亡國/.test(fa.pop), '甲的結算框寫著乙亡國', fa.pop.slice(0, 400));
    ok(fa.seats.every(s => s.name !== '乙') && fa.seats.filter(s => !s.ai).length === 1, '甲按繼續征戰：下一場沒有乙（空位電腦補）', JSON.stringify(fa.seats));
    ok(fa.prog && fa.prog.gold === 3150 + 500 + (fa.prog.conquered.length - 3) * 300, '甲的國庫照常累積', JSON.stringify(fa.prog && { g: fa.prog.gold, c: fa.prog.conquered }));
    void gid1;

    // ── 中途加入（v1.79）：乙從大廳加入甲正在打的這一桌，下一場入座 ──
    await A.page.evaluate(() => {        // 甲那台把每一則提示記下來（提示框會被下一則蓋掉）
      window.__toasts = [];
      const watch = () => { const el = document.getElementById('lobby-toast'); if (!el) return setTimeout(watch, 100);
        new MutationObserver(() => window.__toasts.push(el.textContent)).observe(el, { childList: true, characterData: true, subtree: true }); };
      watch();
    });
    const listed = await B.page.evaluate(async () => {
      const row = () => [...document.querySelectorAll('#lobby-groups .net-row')].find(r => /測試桌/.test(r.textContent));
      await __until(() => row() && /進行中（東 \d 局）/.test(row().textContent), 15000);
      const r = row();
      return r ? { txt: r.textContent, disabled: r.disabled } : null;
    });
    ok(listed && /進行中（東 \d 局）・空 3 位/.test(listed.txt) && !listed.disabled, '大廳列出進行中的牌桌：進行中（東 N 局）・空 3 位', JSON.stringify(listed));
    await B.page.evaluate(() => [...document.querySelectorAll('#lobby-groups .net-row')].find(r => /測試桌/.test(r.textContent)).click());
    const bCards2 = await pick(B.page, 'zhao');
    ok(bCards2.qin.taken, '中途加入擇國：牌桌上甲的秦國不能選', JSON.stringify(bCards2.qin));
    const waitRoom = await B.page.evaluate(async () => {
      await __until(() => /這一場打完你就入座/.test(document.getElementById('room-count').textContent), 8000);
      return { count: document.getElementById('room-count').textContent, members: document.getElementById('room-members').textContent,
               ready: __vis(document.getElementById('room-ready')), start: __vis(document.getElementById('room-start')) };
    });
    ok(/牌桌進行中（東 \d 局）/.test(waitRoom.count) && /這一場打完你就入座/.test(waitRoom.count), '乙的房間：牌桌進行中、這一場打完就入座', waitRoom.count);
    ok(/甲.*牌桌上/.test(waitRoom.members) && /乙.*下一場入座/.test(waitRoom.members), '房間名單：甲在牌桌上、乙下一場入座', waitRoom.members);
    ok(!waitRoom.ready && !waitRoom.start, '待入座不用按準備（選好國就是排隊了）', JSON.stringify(waitRoom));
    const seen = await A.page.evaluate(async () => {
      await __until(() => window.__toasts.some(t => /乙 加入了這一桌，下一場入座/.test(t)), 8000);
      return window.__toasts;
    });
    ok(seen.some(t => /乙 加入了這一桌，下一場入座/.test(t)), '甲的牌桌上提示「乙 加入了這一桌，下一場入座」', JSON.stringify(seen));
    // 甲打完這一場、按繼續征戰 → 乙入座
    const seated = Promise.all([
      A.page.evaluate(async () => {
        await new Promise(r => setTimeout(r, 600));
        const s = window.__test.match.seats;
        MJDev.finishMatch(s.map(x => x.name === '甲' ? 300 : -100));
        for (let i = 0; i < 300; i++) {
          const okb = document.querySelector('#enf-ov.wait .enf-ok'); if (okb) okb.click();
          const c = [...document.querySelectorAll('#end-pop button')].find(b => /繼續征戰/.test(b.textContent));
          if (c) { c.click(); break; }
          await new Promise(r => setTimeout(r, 100));
        }
        const seed0 = window.__test.match.seed;
        await __until(() => window.__test.match.seed !== seed0 && window.__test.match.hand, 30000);
        return window.__test.match.seats.map(x => ({ name: x.name, k: x.kingdom, human: !!x.clientId }));
      }),
      B.page.evaluate(async () => {
        // ⚠️ 乙那台還留著亡國前那一場的牌局（裡面就有乙）—— 要等「換了一場、而且離開房間畫面」才算入座
        //    （用戶端的公開牌局沒有 seed，比對的是牌局物件換了一份）
        const old = window.__test.match;
        const ok = await __until(() => !__vis(document.getElementById('net-room')) && window.__test.match && window.__test.match.hand
          && window.__test.match !== old && window.__test.match.seats.some(x => x.name === '乙' && x.clientId === Net.clientId), 40000);
        const g = (await Net.db.ref('groups/' + Net.groupKey).once('value')).val() || {};
        return { ok, room: __vis(document.getElementById('net-room')), pending: !!(g.members && g.members[Net.clientId] && g.members[Net.clientId].pending) };
      }),
    ]);
    const [aSeats, bIn] = await seated;
    ok(aSeats.filter(x => x.human).map(x => x.name).sort().join(',') === '乙,甲', '下一場：甲、乙兩位主公上桌', JSON.stringify(aSeats));
    ok((aSeats.find(x => x.name === '乙') || {}).k === 'zhao', '乙帶著他選的趙國入座', JSON.stringify(aSeats));
    ok(bIn.ok && !bIn.room, '乙那台自動進了牌局（不再停在房間畫面）', JSON.stringify(bIn));
    ok(!bIn.pending, '入座後不再是「待入座」', JSON.stringify(bIn));
    const [t3a, t3b] = await Promise.all([toTable(A.page), toTable(B.page)]);
    ok(t3a && t3b, '新的一場：甲和新入座的乙都走到占卜（牌局真的動起來了）');

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

    // ── 等待室裡開桌的人按離開（v1.81）：開桌馬上交給最早加入、不是待入座的那位 ──
    // v1.80 以前 leaveGroup 先清 isHost 才記 wasHost → 從來沒交棒，要等大廳 watchHostGone 的 10 秒後援
    const C = await newPlayer(browser, base, { jcmj_my_name: '丙' });
    const D = await newPlayer(browser, base, { jcmj_my_name: '丁' });
    const F = await newPlayer(browser, base, { jcmj_my_name: '戊' });
    ok(await openLobby(C.page), '丙進得了大廳');
    await C.page.evaluate(async () => {
      document.getElementById('lobby-create').click();
      await __until(() => __vis(document.getElementById('ask-input')), 5000);
      document.getElementById('ask-input').value = '交棒桌';
      document.getElementById('ask-ok').click();
    });
    await pick(C.page, 'chu');
    const joinTable = async (p, k) => {
      await openLobby(p);
      await p.evaluate(async () => {
        const row = () => [...document.querySelectorAll('#lobby-groups .net-row')].find(r => /交棒桌/.test(r.textContent));
        await __until(row, 15000);
        row().click();
      });
      await pick(p, k);
    };
    await joinTable(D.page, 'qi');          // 丁先加入（照加入順序本來輪到他）
    await joinTable(F.page, 'yan');
    // 丁標成待入座（v1.79 的 pending：不在牌桌上的人）→ 開桌不能交給他
    const ids = {};
    for (const [n, p] of [['丙', C.page], ['丁', D.page], ['戊', F.page]]) ids[n] = await p.evaluate(() => Net.clientId);
    await D.page.evaluate(() => Net._meRef.child('pending').set(true));
    const before = await C.page.evaluate(async (n) => {
      let g = {};
      for (let i = 0; i < 80; i++) {
        g = (await Net.db.ref('groups/' + Net.groupKey).once('value')).val() || {};
        if (Object.keys(g.members || {}).length >= 3 && (g.members[n] || {}).pending) break;
        await new Promise(r => setTimeout(r, 100));
      }
      return { host: g.host, status: g.status, n: Object.keys(g.members || {}).length, pendingD: !!(g.members[n] || {}).pending };
    }, ids['丁']);
    ok(before.host === ids['丙'] && before.status === 'waiting' && before.n === 3 && before.pendingD,
       '（測試前提）交棒桌：丙開桌、三人在等待室、丁是待入座', JSON.stringify(before));
    const t0 = Date.now();
    await C.page.evaluate(() => document.getElementById('room-leave').click());
    const handed = await F.page.evaluate(async () => {
      const ok = await __until(() => Net.isHost && __vis(document.getElementById('room-start')), 6000);
      const g = (await Net.db.ref('groups/' + Net.groupKey).once('value')).val() || {};
      return { ok, host: g.host, flags: Object.keys(g.members || {}).map(id => [id, !!g.members[id].isHost]) };
    });
    const ms = Date.now() - t0;
    ok(handed.ok && handed.host === ids['戊'] && ms < 6000,
       '丙在等待室按離開：開桌馬上交給戊（跳過待入座的丁，不用等 10 秒）', JSON.stringify(Object.assign({ ms }, handed)));
    ok(handed.flags.length === 2 && handed.flags.every(([id, h]) => h === (id === ids['戊'])),
       '房間名單的開桌標記跟著換到戊、丁不是開桌', JSON.stringify(handed.flags));
    const dView = await D.page.evaluate(async () => {
      await __until(() => !__vis(document.getElementById('room-start')) && Net.groupKey, 3000);
      return { start: __vis(document.getElementById('room-start')), isHost: Net.isHost };
    });
    ok(!dView.start && !dView.isHost, '丁那台沒有變成開桌（沒有「開始牌局」）', JSON.stringify(dView));
    for (const X of [C, D, F]) ok(X.errors.length === 0, '交棒桌的頁面沒有 JavaScript 錯誤', X.errors.slice(0, 3).join(' | '));

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
