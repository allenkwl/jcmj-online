/* 端對端：立體麻將牌（v1.95）
   2026-10-24 使用者：「正面的牌也能畫成立體嗎？遊戲畫面全改成立體麻將牌」→ devtools/立體牌、發牌實驗台 v0.4 看過 →「好，接進遊戲吧」。
   定案（都在這裡釘住）：
     ‧ 牌河、副露、別家的手牌、牌背是立體牌（tiles.js 的 setBodies；canvas 多一個 class tile3d）
     ‧ 自己的手牌維持平面（「玩家手牌改立體會變小，玩家的手牌不要改吧」）
     ‧ 左右兩家一列互相疊著（render.js 的 pack3D：下面那張蓋住上面那張的前緣）
     ‧ 左右兩家的橫牌照圖的真實比例，不塞進平面牌的框（「兩側的牌壓得太扁」）
     ‧ 發牌動畫用立體版（MJDealAnim3D：牌牆是立體牌的圖）
     ‧ 擲骰照小球貓電鐵（v2.08）：骰子從莊家手邊沿拋物線飛過來（飛行中有動畫、大小會變），落地亮「擲出 N 點」，N＝這一局的骰子
   執行： node test/e2e-tiles3d.test.js                                       */
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
    console.log('═══ 端對端：立體麻將牌（' + latest + '）═══');
    const r = await page.evaluate(async () => {
      const wait = ms => new Promise(res => setTimeout(res, ms));
      const until = async (c, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (c()) return true; await wait(30); } return !!c(); };
      const vis = el => el && el.offsetParent;
      await until(() => window.MJTiles && MJTiles.bodiesReady && MJTiles.bodiesReady(), 10000);
      const out = { ready: MJTiles.bodiesReady() };
      // 發牌動畫：記下用的是哪一支、牌牆是不是立體牌的圖
      const used = [];
      [['flat', window.MJDealAnim], ['3d', window.MJDealAnim3D]].forEach(([k, A]) => {
        if (!A) return;
        const r0 = A.run;
        A.run = function () { used.push(k); return r0.apply(this, arguments); };
      });
      MJDev.quickStart('qin', 2, 0);
      let wallImgs = 0, pill = '', flying = 0, scales = new Set();
      const t0 = Date.now();
      while (Date.now() - t0 < 20000) {
        ['dc-ok', 'map-ok'].forEach(id => { const b = document.getElementById(id); if (vis(b)) b.click(); });
        const n = document.querySelectorAll('#deal-anim img').length;
        if (n > wallImgs) wallImgs = n;
        // 擲骰：飛行中的骰子（有動畫在跑）、大小有沒有變；膠囊的字
        document.querySelectorAll('#deal-anim img[src*="dice/die"]').forEach(d => {
          if (d.getAnimations().some(a => a.playState === 'running')) {
            flying++;
            scales.add(Math.round(d.getBoundingClientRect().width / 4));
          }
        });
        const pl = [...document.querySelectorAll('#deal-anim div')].find(e => /擲出/.test(e.textContent));
        if (pl && !pill) pill = pl.textContent;
        const fb = document.querySelector('#fortune-ov.show #f-bets button[data-bet="normal"]');
        if (fb) { fb.click(); break; }
        await wait(40);
      }
      out.used = used; out.wallImgs = wallImgs;
      out.pill = pill; out.flying = flying; out.sizes = scales.size;
      out.total = window.MJDealAnim3D && MJDealAnim3D.lastInfo ? MJDealAnim3D.lastInfo.total : null;
      await wait(400);
      MJDev.setAuto(true);
      await until(() => document.querySelectorAll('#rv-left canvas, #rv-right canvas').length >= 2, 30000);
      MJDev.setAuto(false);
      await wait(300);
      const cls = sel => [...document.querySelectorAll(sel)].map(c => c.classList.contains('tile3d'));
      out.own = cls('#hand-bottom canvas');
      out.opp = cls('#hand-left canvas, #hand-right canvas, #hand-top canvas');
      out.river = cls('#rv-bottom canvas, #rv-left canvas, #rv-right canvas, #rv-top canvas');
      // 左右兩家：一列互相疊著（相鄰兩張的間距 < 一張的高度）、橫牌照真實比例（比平面牌的框高）
      const col = [...document.querySelectorAll('#hand-left canvas')].map(c => c.getBoundingClientRect());
      out.colStep = col.length > 1 ? Math.round(col[1].top - col[0].top) : null;
      out.colH = col.length ? Math.round(col[0].height) : null;
      out.colW = col.length ? Math.round(col[0].width) : null;
      return out;
    });
    ok(r.ready, '牌身的圖都載完（MJTiles.bodiesReady）', JSON.stringify(r));
    ok(r.used.length && r.used.every(k => k === '3d'), '發牌動畫用立體版（MJDealAnim3D）', JSON.stringify(r.used));
    ok(r.wallImgs >= 136, '發牌動畫的牌牆是立體牌的圖（136 張）', String(r.wallImgs));
    ok(r.flying > 0 && r.sizes >= 3, '骰子是丟過來的：飛行中有動畫、大小一路在變（電鐵式擲骰）', JSON.stringify({ flying: r.flying, sizes: r.sizes }));
    ok(r.total != null && r.pill.replace(/\s/g, '') === '擲出' + r.total + '點', '落地亮「擲出 N 點」，N＝這一局的骰子', JSON.stringify({ pill: r.pill, total: r.total }));
    ok(r.own.length >= 13 && r.own.every(x => !x), '自己的手牌維持平面', JSON.stringify(r.own));
    ok(r.opp.length >= 30 && r.opp.every(Boolean), '別家的手牌是立體牌', JSON.stringify(r.opp.length));
    // ≥1 就夠驗「都是立體牌」：停下來的瞬間可能剛好有人碰走一張（2026-10-25 整套跑時量到 [true] 一張）
    ok(r.river.length >= 1 && r.river.every(Boolean), '牌河是立體牌', JSON.stringify(r.river));
    ok(r.colStep != null && r.colStep < r.colH - 2, '左右兩家一列互相疊著（下面那張蓋住上面那張的前緣）', JSON.stringify(r));
    ok(r.colH / r.colW > 0.76, '左右兩家的橫牌照真實比例（不壓扁）', JSON.stringify({ h: r.colH, w: r.colW }));
    ok(errors.length === 0, '頁面沒有 JavaScript 錯誤', errors.slice(0, 3).join(' | '));
  } catch (e) {
    ok(false, '端對端測試跑完', String(e && e.stack || e).slice(0, 500));
  } finally {
    clearTimeout(kill);
    if (g) await g.close();
    finish();
  }
})();
