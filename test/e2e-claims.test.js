/* 端對端：在**真的遊戲**裡測宣告視窗（榮和、碰）
   ───────────────────────────────────────────────────────────────
   2026-10-15 抓到的大錯：v1.05～v1.63 單機的每一個宣告視窗都被畫面自動按「過」——
   別人打出你要的牌，榮和、碰、吃、明槓全部沒機會，只能自摸。規則與流程的測試全部通過，
   因為錯在**畫面那一層**（renderPopups 用 !opt.any 判斷「鳴不了就替他回過」，而單機視窗裡的選項沒有 any）。
   使用者：「這樣的錯誤真的不行，補測試」。所以這一支直接開遊戲本體來跑。

   做法：自己起一個靜態伺服器 → 無頭 Chromium 開最新版遊戲（#test&mute：靜音、掛出唯讀的牌局狀態）
   → MJDev.quickStart 開一場 → 輪到對家時把手牌換掉，安排好「下家打出我要的那張」→ 看遊戲怎麼反應。
   三個情境：
     A 代打開著、聽七條，下家打七條 → 代打要榮和
     B 代打關著、聽七條，下家打七條 → 要跳出「榮和！」，按下去要胡
     C 手上一對發，下家打發 → 要跳出「碰」（不能被自動過掉）

   需要 Playwright（npm 的 playwright，加上它的 Chromium）。找不到就算失敗並說明怎麼裝 ——
   不能靜靜跳過，跳過就等於沒有這道防線。
   執行： node test/e2e-claims.test.js                                         */
'use strict';
const E = require('./_e2e.js');      // 共用：計數、找 Playwright、靜態伺服器、開遊戲
const { ok, finish } = E.counter();
const chromium = E.findChromium();

/* ── 在頁面裡跑的部分 ── */
async function scenario(page, s) {
  return page.evaluate(async (s) => {
    const D = window.__test, wait = ms => new Promise(r => setTimeout(r, ms));
    const deck = MJState.makeDeck(); let uid = 900000;
    const T = d => Object.assign({}, deck.find(x => x.display === d), { uid: uid++ });
    const vis = el => el && el.offsetParent;
    /* 下家要打哪一張由測試指定（不靠 AI 的判斷：第三版就是 AI 決定先打南、不打七條，測試白等）。
       遊戲在開一場時才呼叫 AI.flowHooks()，所以在 quickStart 之前換掉它就好 —— 我這一家的流程完全不碰。 */
    if (!window.__origHooks) window.__origHooks = MJAI.flowHooks();
    const O = window.__origHooks;
    window.__force = {};
    MJAI.flowHooks = () => ({
      chooseDiscard: (hand, seat, level) => {
        const f = window.__force[seat];
        const i = f ? hand.seats[seat].hand.findIndex(t => t.display === f) : -1;
        if (i >= 0) { delete window.__force[seat]; return i; }
        return O.chooseDiscard(hand, seat, level);
      },
      decideClaim: O.decideClaim,
    });
    MJDev.quickStart('qin', 2, 0);
    // 奏章 → 天下形勢 → 發牌動畫 → 占卜（押普通）→ 開代打，等到對家要摸牌
    /* ⚠️ 一律照**時間**等，不照圈數：電腦很忙（整套測試同時跑）時一圈遠不只 25ms，
       照圈數等的話等不到就默默往下走 —— 情境 C 曾因此偶爾失敗（代打沒關掉，碰被代打自動過掉，看起來像「沒跳出碰」） */
    const until = async (cond, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (cond()) return true; await wait(15); } return !!cond(); };
    let chose = false, ready = false, restarts = 0;
    const tStart = Date.now();
    /* 準備階段的狀態記錄：等不到時一起回報，才知道卡在哪（之前只回一句「等不到」，只能猜） */
    const setup = []; let lastS = '';
    const note = () => {
      const H = D.match && D.match.hand, w = D.waiting;
      const k = (H ? 'turn' + H.turn + ':' + H.phase : 'nohand') + ':' + (w ? w.kind + (w.seat != null ? w.seat : '') : '-')
        + ':auto=' + D.auto + ':chose=' + chose
        + ':pops=' + [...document.querySelectorAll('.show')].map(e => e.id || e.className).join('/');
      if (k !== lastS) { setup.push(((Date.now() - tStart) / 1000).toFixed(1) + 's ' + k); lastS = k; }
    };
    while (Date.now() - tStart < 45000 * (1 + restarts)) {
      note();
      ['dc-ok', 'map-ok'].forEach(id => { const b = document.getElementById(id); if (vis(b)) b.click(); });
      const fb = document.querySelector('#fortune-ov.show #f-bets button[data-bet="normal"]');
      if (fb) { fb.click(); chose = true; }
      const h = D.match && D.match.hand;
      if (chose && h && h.phase !== 'over' && !D.auto) MJDev.setAuto(true);
      // 對家或上家要摸牌的時候動手（只等對家的話，有人碰牌跳過摸牌就會等不到）
      if (chose && D.auto && h && (h.turn === 2 || h.turn === 3) && h.phase === 'draw') { ready = true; break; }
      /* 還沒等到就**合法地結束了**（2026-10-23 查到的偶發失敗）：玩家坐莊開代打第一手就自摸（天和）、
         頭一兩張就被榮和 —— 模擬 3000 局約 0.3%。遊戲沒錯，是這裡只會一直等「對家摸牌」，
         結算框跳出來沒人按，等滿 45 秒就報「開局流程卡住」。→ 重開一局（最多 3 次） */
      if (chose && h && h.phase === 'over' && restarts < 3) {
        restarts++;
        setup.push(((Date.now() - tStart) / 1000).toFixed(1) + 's 這一局在準備好之前就結束了（' + ((h.result && h.result.type) || '?') + '），重開');
        MJDev.setAuto(false);
        MJDev.quickStart('qin', 2, 0);
        chose = false;
      }
      await wait(25);
    }
    if (!ready) return { error: '等不到「對家要摸牌」的時機（開局流程卡住？）', setup: setup.slice(-25) };

    // 換牌：四家都換成安排好的。
    // ⚠️ 對家、上家也要整副換掉（全是筒＋北）、連摸的牌也指定：第一版只拿掉幾張，
    //    上家打出我能吃的條、對家打出下家能碰的東，視窗順序就亂了（測試自己出錯，不是遊戲）
    const h = D.match.hand;
    h.seats[0].hand = s.mine.map(T); h.seats[0].discards = []; h.seats[0].furitenTemp = false;
    h.seats[1].hand = s.next.map(T);
    window.__force[1] = s.nextDiscard;           // 下家摸完牌就打這一張
    // ⚠️ 這副要「誰都胡不了、誰都鳴不到」：第二版用 1～9 筒＋對子，對家差一點就九蓮，直接榮和了上家
    const SAFE = ['1筒', '3筒', '5筒', '7筒', '9筒', '1萬', '3萬', '5萬', '7萬', '9萬', '北', '西', '中'];
    [2, 3].forEach(k => { h.seats[k].hand = SAFE.map(T); });
    // 摸牌順序從現在要摸的那家排起：…、我、下家
    const order = h.turn === 2 ? [2, 3, 0, 1] : [3, 0, 1];
    order.forEach((seat, k) => {
      h.wall[h.drawIdx + k] = T(seat === 0 ? s.myDraw : seat === 1 ? s.nextDraw : '中');
    });

    // 我打完之後要不要關代打
    if (!s.auto) {
      if (!await until(() => D.match.hand.seats[0].discards.length > 0, 30000))
        return { error: '等不到我這一家打出第一張（代打沒動？）—— 測試的前提沒成立，不是宣告視窗的問題' };
      MJDev.setAuto(false);
    }
    const out = { popup: null, clicked: null, trace: [], setupTurn: h.turn };
    const t0 = Date.now(); let lastK = '';
    while (Date.now() - t0 < 30000) {
      { const H = D.match.hand, w = D.waiting;
        const k = H.turn + ':' + H.phase + ':' + (w ? w.kind + (w.seats ? '[' + w.seats + ']' : '') + (w.window ? w.window.tile.display + '<' + w.window.from : '') : '-')
          + ':auto=' + D.auto + ':vis=' + document.visibilityState + ':pops=' + [...document.querySelectorAll('.show')].map(e => e.id || e.className).join('/');
        if (k !== lastK) { out.trace.push(k); lastK = k; } }
      const p = document.querySelector('#int-pop.show');
      if (p && !out.popup) {
        out.popup = [...p.querySelectorAll('button')].map(b => b.innerText.replace(/\s+/g, ''));
        if (s.click) {
          const b = [...p.querySelectorAll('button')].find(x => x.innerText.includes(s.click));
          if (b) { b.click(); out.clicked = s.click; }
        }
        if (!s.waitForEnd) break;
      }
      if (D.match.hand.phase === 'over') break;
      await wait(15);
    }
    const r = D.match.hand.result;
    out.result = r ? { type: r.type, winners: (r.winners || []).map(w => w.seat), from: r.from } : null;
    out.disc = D.match.hand.seats.map(x => x.discards.map(t => t.display).join(','));
    return out;
  }, s);
}

(async () => {
  if (!chromium) {
    ok(false, '找得到 Playwright', '請在專案資料夾跑：npm i -D playwright && npx playwright install chromium');
    return finish();
  }
  const kill = setTimeout(() => { console.log('超過 5 分鐘，強制結束'); process.exit(1); }, 300000);
  let g = null;
  try {
    g = await E.openGame(chromium);
    const { page, errors, latest } = g;
    console.log('═══ 端對端：宣告視窗（' + latest + '）═══');

    const WAIT7 = ['1條', '2條', '3條', '4條', '5條', '6條', '8條', '9條', '發', '發', '白', '白', '白'];
    const NEXT7 = ['1萬', '2萬', '3萬', '4萬', '5萬', '6萬', '7萬', '8萬', '9萬', '東', '東', '南', '7條'];

    // A 代打開著
    const a = await scenario(page, { mine: WAIT7, next: NEXT7, myDraw: '西', nextDraw: '南', nextDiscard: '7條',
                                     avoid: ['7條', '發', '白'], auto: true, waitForEnd: true });
    ok(!a.error, 'A 開局流程走得到', a.error && a.error + '\n      ' + (a.setup || []).join('\n      '));
    ok(a.result && a.result.type === 'ron' && a.result.winners.includes(0) && a.result.from === 1,
       'A 代打：聽七條、下家打七條 → 代打榮和', JSON.stringify({ r: a.result, setup: a.setupTurn, trace: a.trace, disc: a.disc }));

    // B 代打關著
    const b = await scenario(page, { mine: WAIT7, next: NEXT7, myDraw: '西', nextDraw: '南', nextDiscard: '7條',
                                     avoid: ['7條', '發', '白'], auto: false, click: '榮和', waitForEnd: true });
    ok(!b.error, 'B 開局流程走得到', b.error && b.error + '\n      ' + (b.setup || []).join('\n      '));
    ok(b.popup && b.popup.some(t => t.includes('榮和')), 'B 手動：跳出「榮和！」', JSON.stringify({ p: b.popup, setup: b.setupTurn, trace: b.trace, disc: b.disc }));
    ok(b.result && b.result.type === 'ron' && b.result.winners.includes(0),
       'B 手動：按下榮和就胡', JSON.stringify(b.result));

    // C 碰
    const c = await scenario(page, {
      mine: ['1萬', '4萬', '7萬', '2筒', '5筒', '8筒', '3條', '6條', '9條', '東', '南', '發', '發'],
      next: ['1萬', '2萬', '3萬', '4萬', '5萬', '6萬', '7萬', '8萬', '9萬', '東', '東', '南', '發'],
      myDraw: '西', nextDraw: '南', nextDiscard: '發', avoid: ['發'], auto: false, click: '過' });
    ok(!c.error, 'C 開局流程走得到', c.error && c.error + '\n      ' + (c.setup || []).join('\n      '));
    ok(c.popup && c.popup.some(t => t.includes('碰')), 'C 下家打出我有一對的發 → 跳出「碰」', JSON.stringify(c.popup));
    ok(c.popup && c.popup.some(t => t.includes('過')), 'C 視窗裡也有「過」', JSON.stringify(c.popup));

    ok(errors.length === 0, '頁面沒有 JavaScript 錯誤', errors.slice(0, 3).join(' | '));
  } catch (e) {
    ok(false, '端對端測試跑完', String(e && e.message || e));
  } finally {
    clearTimeout(kill);
    if (g) await g.close();
    finish();
  }
})();
