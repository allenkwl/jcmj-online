/* ═══════════════════════════════════════════════════════════════
   deal-anim.js — 發牌動畫
   ───────────────────────────────────────────────────────────────
   三段：四家的牌**背面**從牌桌中央飛出去 → 自己那 13 張翻開（仍是亂的）
        → 自動排序到正確位置。

   ── 為什麼要獨立一層 ──
   `render.js` 的 renderRow() 每次都 clear() 之後重建所有牌的元素，
   CSS transition 沒辦法跨越重繪。所以這裡自己疊一層動畫容器，
   跑完移除再交回正常渲染 —— 跟選國畫面的 revealFoes() 同一個模式。
   好處是完全不動 render.js，1055 項測試不受影響。

   ── ⚠️ 座標一律從實際畫面量 ──
   牌在動畫開始前**已經畫好了**（占卜蓋住之前就渲染完成），
   所以直接 getBoundingClientRect() 抄真實位置，不要自己算一份版面。
   理由跟對戰畫面編輯器那條一樣：抄一份過來自己畫，結構就會跟遊戲對不上。

   ── 四個前提 ──
     1. 可跳過 —— 任意鍵或點一下
     2. 四局都用同一個速度 —— 一度做過「第二局起加速」，
        實際玩起來節奏反而變得不一致，拿掉了。要快就按鍵跳過。
     3. #preview 完全跳過 —— 編輯器會量到動畫中途的座標
     4. 尊重 prefers-reduced-motion
   ═══════════════════════════════════════════════════════════════ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MJDealAnim = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
'use strict';

const ZONES = ['hand-bottom', 'hand-right', 'hand-top', 'hand-left'];

/* ── 節奏 ──────────────────────────────────────────────────
   數值集中在這裡，不要散回程式裡 —— 調一次動畫要改六個地方的話，
   下次就沒人敢動（layout.js 的 TUNE 也是同一個理由）。
   單位都是毫秒。整段大約 3.9 秒。

   ⚠️ 四局都用同一個速度。一度做過「第二局起加速 0.55 倍」，
   實際玩起來節奏反而變得不一致，拿掉了。要快就按鍵跳過。 */
const T_ = {
  flyStagger:  22,   // 每張牌起飛的間隔（53 張 → 約 1.2 秒鋪完）
  flyDur:     360,   // 單張的飛行時間
  flyTail:    260,   // 最後一張落地後的緩衝
  flipStagger: 72,   // 翻牌的間隔
  flipHalf:   165,   // 翻牌單邊（收合／展開各一次）
  flipTail:   220,   // 翻完的緩衝
  beforeSort: 420,   // 全部翻開之後、開始排序之前的停頓（讓玩家看清楚是亂的）
  sortDur:    520,   // 排序補間
  sortTail:   140,
};

/* 音效。刻意**不是每張牌都響** —— 53 張各響一次會變成雜訊。
   落地每四張響一次（＝真實牌桌一圈發一輪的節奏），翻牌才每張響。 */
function sfx(name) {
  try {
    const A = window.MJAudio || (window.MJ && window.MJ.audio);
    const S = A && A.SFX;
    if (S && typeof S[name] === 'function') S[name]();
  } catch (_) {}
}

const reduced = () => {
  try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) { return false; }
};

/* 量一排手牌裡每一張的位置。回傳的是**視窗座標**，動畫層用 position:fixed
   直接對得上，不必再換算容器的相對位置。 */
function measure(id) {
  const box = document.getElementById(id);
  if (!box) return [];
  return [...box.children].map(ch => {
    // 自己那排的牌包在 .ph-wrap 裡（下面還有數字鍵標籤），要量到裡面的 canvas
    const c = ch.tagName === 'CANVAS' ? ch : ch.querySelector('canvas');
    if (!c) return null;
    const r = c.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  }).filter(Boolean);
}

function shuffled(n, rnd) {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor((rnd ? rnd() : Math.random()) * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ── 主流程 ────────────────────────────────────────────────
   opts:
     match     讀手牌用
     mySeat    自己的座位（用來決定哪一排要翻開）
     preview   #preview 模式 → 直接不跑
   回傳 Promise，動畫結束（或被跳過）才 resolve。          */
function run(opts) {
  const o = opts || {};
  if (o.preview) return Promise.resolve('skip:preview');
  if (reduced()) return Promise.resolve('skip:reduced-motion');

  const hand = o.match && o.match.hand;
  if (!hand) return Promise.resolve('skip:nohand');

  // 動畫開始前先量好每一張的最終位置
  const targets = {};
  ZONES.forEach(id => { targets[id] = measure(id); });
  if (!targets['hand-bottom'].length) return Promise.resolve('skip:notrendered');

  const T = window.MJTiles;
  if (!T || !T.makeTile) return Promise.resolve('skip:notiles');

  // 牌從牌桌中央飛出去
  const stage = document.getElementById('center-stage') || document.getElementById('table');
  const sr = stage.getBoundingClientRect();
  const origin = { x: sr.left + sr.width / 2, y: sr.top + sr.height / 2 };

  const layer = document.createElement('div');
  layer.id = 'deal-anim';
  document.body.appendChild(layer);

  /* 真的牌先藏起來（用 visibility 不用 display —— 版面要留著，
     不然量到的座標會在動畫中途跑掉）。

     ⚠️ 中央的主公像也要一起藏。它代表的是「現在輪到誰打」，
     發牌階段還沒輪到任何人，先冒出來會讓人以為牌局已經開始了。 */
  const hidden = ZONES.map(id => document.getElementById(id))
    .concat([document.getElementById('center-lord')])
    .filter(Boolean);
  hidden.forEach(e => e.style.visibility = 'hidden');

  const myZone = 'hand-bottom';
  /* ⚠️ 拿**副本**。動畫要跑好幾秒（分頁在背景時計時器被節流會更久），
     這段期間原陣列若被改動（排序、打牌），翻牌那一段會拿到 undefined 直接炸。
     mj4.html 的 myTurn() 已經在動畫期間擋住輸入，這裡是第二道保險。 */
  const myTiles = hand.seats[o.mySeat] ? hand.seats[o.mySeat].hand.slice() : [];

  /* 建立一張動畫用的牌。face=null 代表牌背。 */
  function mk(face, pos, faceDown) {
    const c = T.makeTile(face, { w: Math.round(pos.w), h: Math.round(pos.h), faceDown });
    c.className += ' da-tile';
    c.style.left = pos.x + 'px';
    c.style.top = pos.y + 'px';
    layer.appendChild(c);
    return c;
  }

  const els = [];        // {el, target, idx} 只記自己那排，後面要翻牌與排序
  let skipped = false;
  let finish = null;

  const done = new Promise(res => { finish = res; });

  function cleanup(reason) {
    if (skipped) return;
    skipped = true;
    document.removeEventListener('keydown', onSkip, true);
    document.removeEventListener('pointerdown', onSkip, true);
    layer.remove();
    hidden.forEach(e => e.style.visibility = '');
    finish(reason);
  }
  function onSkip(e) {
    if (e && e.type === 'keydown' && e.key === 'Escape') return;   // Esc 留給老闆模式
    cleanup('skipped');
  }
  document.addEventListener('keydown', onSkip, true);
  document.addEventListener('pointerdown', onSkip, true);

  (async () => {
    // ── 第一段：四家的牌背面飛出去 ──
    const order = [];
    ZONES.forEach(id => targets[id].forEach((pos, i) => order.push({ id, pos, i })));
    // 一圈一圈發（每家各一張再輪下一張），比照真實牌桌
    order.sort((a, b) => a.i - b.i || ZONES.indexOf(a.id) - ZONES.indexOf(b.id));

    const myShuffle = shuffled(targets[myZone].length);
    let myN = 0;

    order.forEach((t, k) => {
      const isMine = t.id === myZone;
      // 自己那排先落在**打亂**的位置，之後才排序
      const slot = isMine ? targets[myZone][myShuffle[myN]] : t.pos;
      if (isMine) myN++;
      const el = mk(null, { x: origin.x - t.pos.w / 2, y: origin.y - t.pos.h / 2, w: t.pos.w, h: t.pos.h }, true);
      if (isMine) els.push({ el, slotIdx: myShuffle[myN - 1] });
      const delay = k * T_.flyStagger;
      setTimeout(() => {
        if (skipped) return;
        el.style.transition = `transform ${T_.flyDur}ms cubic-bezier(.2,.8,.3,1)`;
        el.style.transform = `translate(${slot.x - (origin.x - t.pos.w / 2)}px,${slot.y - (origin.y - t.pos.h / 2)}px)`;
      }, delay);
      // 落地聲要等它**飛到**才響，不是起飛就響
      if (k % 4 === 0) setTimeout(() => { if (!skipped) sfx('discard'); }, delay + T_.flyDur * 0.75);
    });

    const flyMs = order.length * T_.flyStagger + T_.flyDur + T_.flyTail;
    await sleep(flyMs);
    if (skipped) return;

    // ── 第二段：自己那 13 張翻開（仍是亂的）──
    // canvas 沒辦法「翻面」，用 scaleX 收到 0 再換成正面展開 —— 標準的翻牌手法
    els.forEach((rec, i) => setTimeout(() => {
      if (skipped) return;
      const el = rec.el;
      sfx('select');
      el.style.transition = `transform ${T_.flipHalf}ms ease-in`;
      const cur = el.style.transform;
      el.style.transform = cur + ' scaleX(0.02)';
      setTimeout(() => {
        if (skipped) return;
        const pos = targets[myZone][rec.slotIdx];
        const face = T.makeTile(myTiles[i], { w: Math.round(pos.w), h: Math.round(pos.h) });
        face.className += ' da-tile';
        face.style.left = el.style.left;
        face.style.top = el.style.top;
        face.style.transform = cur + ' scaleX(0.02)';
        layer.replaceChild(face, el);
        rec.el = face;
        // 強制一次版面計算把起始狀態刷進去，再開 transition。
        // ⚠️ 同樣不用 rAF —— 分頁在背景時不會觸發，動畫會卡在縮成一條的狀態。
        void face.offsetWidth;
        face.style.transition = `transform ${T_.flipHalf}ms ease-out`;
        face.style.transform = cur;
      }, T_.flipHalf);
    }, i * T_.flipStagger));

    await sleep(els.length * T_.flipStagger + T_.flipHalf * 2 + T_.flipTail);
    if (skipped) return;

    // ── 第三段：排序到正確位置 ──
    await sleep(T_.beforeSort);
    if (skipped) return;
    els.forEach((rec, i) => {
      const from = targets[myZone][rec.slotIdx];
      const to = targets[myZone][i];
      rec.el.style.transition = `transform ${T_.sortDur}ms cubic-bezier(.3,.7,.2,1)`;
      rec.el.style.transform =
        `translate(${to.x - parseFloat(rec.el.style.left)}px,${to.y - parseFloat(rec.el.style.top)}px)`;
    });
    sfx('draw');                     // 排好收尾，一聲就好
    await sleep(T_.sortDur + T_.sortTail);
    cleanup('done');
  })().catch(() => cleanup('error'));

  return done;
}

return { run };
});
