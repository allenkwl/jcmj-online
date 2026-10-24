/* 端對端：單機在真的遊戲裡宣戰（v1.92）
   ───────────────────────────────────────────────────────────────
   規則、計分、電腦在 test/declare.test.js；這一支驗畫面那一層 ——
   宣戰按鈕出不出來、挑牌模式擋不擋得住不聽的牌、宣戰後是不是強制代打摸切、結算有沒有翻裏祥瑞。

   安排：輪到上家摸牌時把四家的牌換掉 →
     我：1–9 萬＋東東東＋南（13 張），下一張摸西 → 打南或打西都聽（可以宣戰的就這兩張）
     別家：誰都胡不了、鳴不到的散牌；摸牌一律摸中、摸了就打中（__force）
   → 按「⚔ 宣戰」→ 點不聽的牌（擋掉）→ 點南（宣戰）→ 下一巡摸西 → 系統自摸
   執行： node test/e2e-declare.test.js                                       */
'use strict';
const E = require('./_e2e.js');
const { ok, finish } = E.counter();
const chromium = E.findChromium();

(async () => {
  if (!chromium) {
    ok(false, '找得到 Playwright', '請在專案資料夾跑：npm i -D playwright && npx playwright install chromium');
    return finish();
  }
  const kill = setTimeout(() => { console.log('超過 4 分鐘，強制結束'); process.exit(1); }, 240000);
  let g = null;
  try {
    g = await E.openGame(chromium);
    const { page, errors, latest } = g;
    console.log('═══ 端對端：宣戰（' + latest + '）═══');

    const r = await page.evaluate(async () => {
      const D = window.__test, wait = ms => new Promise(res => setTimeout(res, ms));
      const until = async (c, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (c()) return true; await wait(15); } return !!c(); };
      const vis = el => el && el.offsetParent;
      const deck = MJState.makeDeck(); let uid = 900000;
      const T = d => Object.assign({}, deck.find(x => x.display === d), { uid: uid++ });
      // 別家摸什麼打什麼由測試指定（照 e2e-claims 的做法：quickStart 之前換掉 flowHooks）
      if (!window.__origHooks) window.__origHooks = MJAI.flowHooks();
      const O = window.__origHooks;
      window.__force = {};
      MJAI.flowHooks = () => Object.assign({}, O, {
        chooseDiscard: (hand, seat, level) => {
          const i = hand.seats[seat].hand.findIndex(t => t.display === '中');
          return window.__force.on && i >= 0 ? i : O.chooseDiscard(hand, seat, level);
        },
      });
      MJDev.quickStart('qin', 2, 0);
      // 走到「上家要摸牌」：代打開著跑，跑到了關掉
      let chose = false, ready = false, restarts = 0;
      const t0 = Date.now();
      while (Date.now() - t0 < 45000 * (1 + restarts)) {
        ['dc-ok', 'map-ok'].forEach(id => { const b = document.getElementById(id); if (vis(b)) b.click(); });
        const fb = document.querySelector('#fortune-ov.show #f-bets button[data-bet="normal"]');
        if (fb) { fb.click(); chose = true; }
        const h = D.match && D.match.hand;
        if (chose && h && h.phase !== 'over' && !D.auto) MJDev.setAuto(true);
        if (chose && D.auto && h && h.turn === 3 && h.phase === 'draw' && !h.seats.some(s => s.declared)) { ready = true; break; }
        if (chose && h && h.phase === 'over' && restarts < 3) { restarts++; MJDev.setAuto(false); MJDev.quickStart('qin', 2, 0); chose = false; }
        await wait(25);
      }
      if (!ready) return { error: '等不到「上家要摸牌」的時機' };
      MJDev.setAuto(false);
      const h = D.match.hand;
      const SAFE = ['1筒', '3筒', '5筒', '7筒', '9筒', '1條', '3條', '5條', '7條', '9條', '北', '白', '中'];
      h.seats[0].hand = '1萬 2萬 3萬 4萬 5萬 6萬 7萬 8萬 9萬 東 東 東 南'.split(' ').map(T);
      h.seats[0].melds = []; h.seats[0].discards = []; h.seats[0].furitenTemp = false;
      [1, 2, 3].forEach(k => { h.seats[k].hand = SAFE.map(T); h.seats[k].melds = []; });
      window.__force.on = true;
      // 摸牌順序：上家、我（西）、下家、對家、上家、我（西 → 自摸）
      ['中', '西', '中', '中', '中', '西'].forEach((d, k) => { h.wall[h.drawIdx + k] = T(d); });
      MJDev.redraw();

      // 輪到我：宣戰按鈕
      if (!await until(() => D.waiting && D.waiting.kind === 'turn' && D.waiting.seat === 0 && h.seats[0].hand.length === 14, 15000))
        return { error: '等不到輪到我' };
      // 「你聽牌了」問代打的視窗：選自己來
      await wait(300);
      const self = [...document.querySelectorAll('#act-pop.show button')].find(b => b.textContent.includes('自己來'));
      if (self) self.click();
      await until(() => document.getElementById('si-declare'), 3000);
      const out = {};
      const btn = document.getElementById('si-declare');
      out.btn = btn ? btn.textContent : null;
      out.choices = (D.waiting.options.declare || []).map(i => h.seats[0].hand[i].display).sort().join(',');
      if (!btn) return Object.assign(out, { error: '沒有宣戰按鈕' });
      btn.click();
      await wait(100);
      out.picking = !!document.querySelector('#si-declare.picking');
      out.okTiles = [...document.querySelectorAll('#hand-bottom .decl-ok')].length;
      out.noTiles = [...document.querySelectorAll('#hand-bottom .decl-no')].length;
      // 點不聽的牌（1 萬）兩下：不能打出去
      const tileEl = i => document.querySelector('#hand-bottom [data-idx="' + i + '"]:not(.ph-wrap)');
      const i1 = h.seats[0].hand.findIndex(t => t.display === '1萬');
      tileEl(i1).click(); await wait(80); { const e2 = tileEl(i1); if (e2) e2.click(); } await wait(150);
      out.afterBad = { len: h.seats[0].hand.length, declared: !!h.seats[0].declared, picking: !!document.querySelector('#si-declare.picking') };
      // 點南兩下：宣戰
      const iS = h.seats[0].hand.findIndex(t => t.display === '南');
      tileEl(iS).click(); await wait(80); tileEl(iS).click();
      await until(() => h.seats[0].declared, 3000);
      await wait(150);
      out.declared = h.seats[0].declared;
      out.river = h.seats[0].discards.map(t => t.display).join(',');
      out.auto = D.auto;
      out.badge = [...document.querySelectorAll('.np-declare')].length;
      out.autoBtn = (document.getElementById('si-auto') || {}).textContent || '';
      MJDev.setAuto(false);                 // 宣戰了：停不下來
      out.autoAfterOff = D.auto;
      // 系統替我摸切／自摸
      await until(() => h.phase === 'over', 20000);
      const res = h.result || {};
      const w = (res.winners || [])[0] || {};
      out.result = { type: res.type, seat: w.seat, declared: w.value && w.value.declared, ura: w.value && w.value.uraIndicators,
                     stakes: (res.stakes || []).filter(x => x.declare).map(x => x.seat) };
      await until(() => document.querySelector('#end-pop.show .ho-title'), 5000);
      out.title = (document.querySelector('#end-pop.show .ho-title') || {}).textContent || '';
      out.uraRow = (document.querySelector('#end-pop.show .ho-ura') || {}).textContent || '';
      out.uraTiles = document.querySelectorAll('#end-pop.show .ho-ura .ura-t').length;
      out.money = (document.querySelector('#end-pop.show .ho-money') || {}).textContent || '';
      return out;
    });

    ok(!r.error, '走得到宣戰的場面', r.error + ' ' + JSON.stringify(r));
    if (r.error) throw new Error(r.error);
    ok(/宣戰/.test(r.btn), '輪到我、打掉某張就聽：手牌上方有「⚔ 宣戰」', JSON.stringify(r.btn));
    ok(r.choices === '南,西', '能宣戰的是南、西', r.choices);
    ok(r.picking && r.okTiles === 2 && r.noTiles === 12, '挑牌模式：兩張亮紅框、其餘變暗', JSON.stringify(r));
    ok(r.afterBad.len === 14 && !r.afterBad.declared && r.afterBad.picking, '點不聽的牌：沒打出去，還在挑牌模式', JSON.stringify(r.afterBad));
    ok(r.declared && r.declared.menzen === true, '點南：宣戰成功（門清）', JSON.stringify(r.declared));
    ok(/南$/.test(r.river), '南打進河裡', r.river);
    ok(r.auto === true, '宣戰後自動交給系統打', JSON.stringify(r.auto));
    ok(r.badge === 1, '我的名牌掛「⚔ 宣戰」', JSON.stringify(r.badge));
    ok(/宣戰中/.test(r.autoBtn), '代打按鈕換成「宣戰中・系統摸切」', r.autoBtn);
    ok(r.autoAfterOff === true, '宣戰了：代打關不掉', JSON.stringify(r.autoAfterOff));
    ok(r.result.type === 'tsumo' && r.result.seat === 0 && r.result.declared, '下一巡摸到西：系統替我自摸，算宣戰胡', JSON.stringify(r.result));
    ok(Array.isArray(r.result.ura) && r.result.ura.length >= 1, '結果帶著裏指示牌', JSON.stringify(r.result.ura));
    ok(/宣戰/.test(r.title), '結算標題寫宣戰', r.title);
    ok(/裏祥瑞/.test(r.uraRow) && r.uraTiles >= 1 && /宣戰 \+50/.test(r.uraRow), '結算翻開裏祥瑞、寫宣戰 +50（門清）', r.uraRow + ' ' + r.uraTiles);
    ok(r.result.stakes.join(',') === '0' && /宣戰，押金 50 兩進彩池/.test(r.money), '宣戰押金 50 兩寫在結算裡', r.money);
    ok(errors.length === 0, '頁面沒有 JavaScript 錯誤', errors.slice(0, 3).join(' | '));
  } catch (e) {
    ok(false, '端對端測試跑完', String(e && e.stack || e).slice(0, 500));
  } finally {
    clearTimeout(kill);
    if (g) await g.close();
    finish();
  }
})();
