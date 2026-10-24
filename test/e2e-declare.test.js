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
        /* 這一局在準備好之前就結束了，或電腦先宣戰了（普通難度聽牌就宣戰，v1.92）—— 安排好的牌型會被打亂，重開一局 */
        if (chose && h && (h.phase === 'over' || h.seats.some(s => s.declared)) && restarts < 6) { restarts++; MJDev.setAuto(false); MJDev.quickStart('qin', 2, 0); chose = false; }
        await wait(25);
      }
      if (!ready) return { error: '等不到「上家要摸牌」的時機' };
      MJDev.setAuto(false);
      if (MJDev.offerReset) MJDev.offerReset();      // 關掉代打會被當成「不要再問」—— 這一局要再問一次
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
      const out = {};
      const key = k => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
      const focusIsBest = () => { const c = MJInput.current(); return !!(c && c.classList.contains('decl-ok')); };
      /* v1.97：聽牌視窗改問宣戰（取代「交給系統打」）—— 宣戰／自己來，預設在宣戰，Enter → 挑牌模式、焦點停在最好的那張 */
      await until(() => document.querySelector('#act-pop.show .auto-offer'), 5000);
      const pop = document.querySelector('#act-pop.show');
      out.offer = pop ? [...pop.querySelectorAll('button')].map(b => b.textContent.trim()).join('/') : null;
      out.offerTitle = pop ? pop.textContent : '';
      key('Enter'); await wait(150);
      out.popPick = !!document.querySelector('#si-declare.picking') && focusIsBest();
      /* v2.03 宣戰的比較表：每一種打法一列（打哪張 → 聽哪些、剩幾張），最好的打★；上鍵移到表上，那一列亮 */
      const rows = [...document.querySelectorAll('#decl-panel .decl-row')];
      out.panel = rows.map(r => ({ disp: r.dataset.disp, star: r.querySelector('.dp-star').textContent,
        tiles: r.querySelectorAll('canvas').length, left: r.querySelector('.dp-left').textContent, title: r.title }));
      key('ArrowUp'); await wait(60);
      const cur = MJInput.current();
      out.rowFocus = !!(cur && cur.classList.contains('decl-row') && cur.classList.contains('hl'));
      key('A'); await wait(120);                      // 再按一次 A：取消挑牌（測按鈕那一條路）
      out.panelGone = !document.getElementById('decl-panel');
      out.popCancel = !document.querySelector('#si-declare.picking');
      await until(() => document.getElementById('si-declare'), 3000);
      const btn = document.getElementById('si-declare');
      out.btn = btn ? btn.textContent : null;
      out.choices = (D.waiting.options.declare || []).map(i => h.seats[0].hand[i].display).sort().join(',');
      if (!btn) return Object.assign(out, { error: '沒有宣戰按鈕' });
      /* v1.96：真的點得到（v1.92～v1.95 這顆被 .selfinfo 的 pointer-events:none 蓋掉，滑鼠、手指都點不到，
         測試卻用 btn.click() 繞過去了）—— 看按鈕正中央點到的是不是它自己 */
      const rc = btn.getBoundingClientRect();
      out.hit = document.elementFromPoint(rc.left + rc.width / 2, rc.top + rc.height / 2) === btn;
      /* 手把／方向鍵選得到（v1.92～v1.95 不在 focusables 裡）：上 → 功能鈕那一組，左右找宣戰鈕，Enter 按下 */
      key('ArrowUp'); await wait(30);
      for (let i = 0; i < 10 && MJInput.current() !== btn; i++) { key('ArrowRight'); await wait(30); }
      out.focusable = MJInput.current() === btn;
      if (out.focusable) key('Enter'); else btn.click();
      await wait(150);
      out.picking = !!document.querySelector('#si-declare.picking');
      out.btnFocusBest = focusIsBest();
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
    ok(r.offer === '宣戰/自己來' && /可以宣戰/.test(r.offerTitle), '聽牌視窗問的是宣戰（不是交給系統打）', JSON.stringify(r.offer));
    ok(r.popPick === true, '視窗按宣戰（Enter）：進入挑牌、焦點停在可以宣戰的牌', JSON.stringify(r.popPick));
    ok(r.popCancel === true, '再按一次 A：取消挑牌', JSON.stringify(r.popCancel));
    ok(r.panel && r.panel.length === 2 && r.panel.map(x => x.disp).sort().join(',') === '南,西', '宣戰比較表：兩種打法（打南、打西）各一列', JSON.stringify(r.panel));
    ok(r.panel && r.panel[0].star === '★' && r.panel[1].star === '', '最好的那個打★、排第一', JSON.stringify(r.panel));
    // 剩幾張只算看得到的（別家前幾巡的牌河還在，南、西可能被打過）—— 格式對、★那一列剩最多
    const nleft = x => Number((x.left.match(/剩 (\d+) 張/) || [0, -1])[1]);
    ok(r.panel && r.panel.every(x => x.tiles === 2 && nleft(x) >= 0 && nleft(x) <= 3), '每一列：打的牌＋聽的牌畫成小牌，寫「剩 N 張」', JSON.stringify(r.panel));
    ok(r.panel && nleft(r.panel[0]) >= nleft(r.panel[1]), '★那一列剩的最多', JSON.stringify(r.panel));
    ok(r.panel && r.panel.some(x => x.disp === '南' && /^西 剩 \d/.test(x.title)) && r.panel.some(x => x.disp === '西' && /^南 剩 \d/.test(x.title)),
       '打南 → 聽西、打西 → 聽南', JSON.stringify(r.panel));
    ok(r.rowFocus === true, '方向鍵上：焦點移到表上的列，那一列亮起來', JSON.stringify(r.rowFocus));
    ok(r.panelGone === true, '取消挑牌：比較表收起來', JSON.stringify(r.panelGone));
    ok(r.btnFocusBest === true, '按手牌上方的宣戰鈕：焦點一樣停在可以宣戰的牌', JSON.stringify(r.btnFocusBest));
    ok(r.hit === true, '宣戰鈕滑鼠、手指點得到（不被上層蓋掉）', JSON.stringify(r.hit));
    ok(r.focusable === true, '宣戰鈕手把／方向鍵選得到，Enter 按得下去', JSON.stringify(r.focusable));
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
    /* ── 第二局：不能宣戰（v1.97：沒有免費代打，「就留宣戰就好」）──
         國庫不夠付押金 → 不跳視窗、宣戰鈕灰的寫「國庫不足」；牌山剩不到 4 張 → 什麼都不出現；D 鍵沒有作用（「只留 A 鍵」） */
    const fb = await page.evaluate(async () => {
      const D = window.__test, wait = ms => new Promise(res => setTimeout(res, ms));
      const until = async (c, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (c()) return true; await wait(15); } return !!c(); };
      const vis = el => el && el.offsetParent;
      const deck = MJState.makeDeck(); let uid = 800000;
      const T = d => Object.assign({}, deck.find(x => x.display === d), { uid: uid++ });
      window.__force.on = false;
      MJDev.quickStart('qin', 2, 0);
      let chose = false, ready = false, restarts = 0;
      const t0 = Date.now();
      while (Date.now() - t0 < 45000 * (1 + restarts)) {
        ['dc-ok', 'map-ok'].forEach(id => { const b = document.getElementById(id); if (vis(b)) b.click(); });
        const fbn = document.querySelector('#fortune-ov.show #f-bets button[data-bet="normal"]');
        if (fbn) { fbn.click(); chose = true; }
        const h = D.match && D.match.hand;
        if (chose && h && h.phase !== 'over' && !D.auto) MJDev.setAuto(true);
        if (chose && D.auto && h && h.turn === 3 && h.phase === 'draw' && !h.seats.some(s => s.declared)) { ready = true; break; }
        if (chose && h && (h.phase === 'over' || h.seats.some(s => s.declared)) && restarts < 6) { restarts++; MJDev.setAuto(false); MJDev.quickStart('qin', 2, 0); chose = false; }
        await wait(25);
      }
      if (!ready) return { error: '第二局等不到「上家要摸牌」' };
      MJDev.setAuto(false); MJDev.offerReset();
      const m = D.match, h = m.hand;
      const SAFE = ['1筒', '3筒', '5筒', '7筒', '9筒', '1條', '3條', '5條', '7條', '9條', '北', '白', '中'];
      h.seats[0].hand = '1萬 2萬 3萬 4萬 5萬 6萬 7萬 8萬 9萬 東 東 東 南'.split(' ').map(T);
      h.seats[0].melds = []; h.seats[0].discards = [];
      [1, 2, 3].forEach(k => { h.seats[k].hand = SAFE.map(T); h.seats[k].melds = []; });
      window.__force.on = true;
      ['中', '西'].forEach((d, k) => { h.wall[h.drawIdx + k] = T(d); });
      // 國庫只剩 20 兩：這一場先輸到快見底
      const g0 = (document.querySelector('.ci-gold') || {}).textContent || '';
      const gold = Number((g0.match(/([\d,]+)/) || [0, '0'])[1].replace(/,/g, ''));
      m.seats[0].matchScore = (m.seats[0].matchScore || 0) - (gold - 20);
      MJDev.redraw();
      if (!await until(() => D.waiting && D.waiting.kind === 'turn' && D.waiting.seat === 0, 15000)) return { error: '第二局等不到輪到我' };
      await wait(700);
      const out = { gold };
      const b = document.getElementById('si-declare');
      out.poor = { popup: !!document.querySelector('#act-pop.show .auto-offer'), btn: b ? b.textContent : null,
                   disabled: !!(b && b.disabled), auto: !!document.getElementById('si-auto') };
      // D 鍵：沒有作用
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', bubbles: true, cancelable: true }));
      await wait(150);
      out.dKey = !!document.querySelector('#si-declare.picking') || !!h.seats[0].declared;
      // 牌山剩 2 張（國庫恢復）：什麼都不出現
      m.seats[0].matchScore += (gold - 20);
      h.drawIdx = h.deadWallStart - 2;
      // 輪到我的那一刻就算好能宣戰的牌了（實際遊戲裡自己的回合中牌山不會變少）—— 改了牌山要照規則重算一次
      D.waiting.options = MJFlow.turnOptions(h, 0);
      MJDev.redraw(); await wait(300);
      out.late = { popup: !!document.querySelector('#act-pop.show .auto-offer'), btn: !!document.getElementById('si-declare'),
                   auto: !!document.getElementById('si-auto') };
      return out;
    });
    ok(!fb.error, '第二局走得到「不能宣戰」的場面', fb.error);
    if (!fb.error) {
      ok(!fb.poor.popup && fb.poor.btn === '宣戰（國庫不足）' && fb.poor.disabled && !fb.poor.auto,
         '國庫不夠：不跳視窗，宣戰鈕灰的寫「國庫不足」，沒有免費代打', JSON.stringify(fb));
      ok(fb.dKey === false, 'D 鍵沒有作用（只留 A 鍵）', JSON.stringify(fb.dKey));
      ok(!fb.late.popup && !fb.late.btn && !fb.late.auto, '牌山剩不到 4 張：視窗、宣戰鈕、代打鈕都不出現', JSON.stringify(fb.late));
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
