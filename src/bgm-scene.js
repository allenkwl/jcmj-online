/* ═══════════════════════════════════════════════════════════════
   bgm-scene.js — 牌桌上現在該播哪一首 BGM
   ───────────────────────────────────────────────────────────────
   2026-10-16 使用者定：
     ‧ 對局時「**誰是東（莊家）就播那一國的曲**」（舊兩人版播對手那一國；四人有三家對手，改成看莊家）
       → 莊家換人，下一局的曲子跟著換
     ‧ 有人聽牌就切到聽牌曲，沒人聽了切回來（舊版就有）。「有人」＝名牌上亮「🎯 聽」的那幾家：
       單機四家都看得到，連線只看得到自己（別家的牌不在這台上）—— 跟名牌用同一個判斷（MJRender.showsTenpai），
       畫面亮了音樂就跟著換。
       ⚠️ 連線要看得到別家聽牌，靠的是「宣戰」（公開宣告聽牌，docs/dora-and-declare.md，2026-09-29 草案、還沒實作）。
          做的時候讓 render.js 的 showsTenpai 也認宣戰的人（名牌的宣戰章本來就規劃放同一個位置），這裡不用改
     ‧ 連線（使用者 2026-10-16：「統一由開桌的電腦做，玩家不會知道」）：群主手上有完整牌局，算「有沒有人聽牌」，
       只把一個有／沒有放進公開狀態（bgmTenpai）。各台照它切聽牌曲 —— 聽得出「有人聽了」，不知道是誰，跟單機一樣。
       → tableScene(match, { anyTenpai }) 帶了 anyTenpai 就照它，不自己算（用戶端手上本來就沒有別家的牌）
     ‧ 莊家的國不認得（預覽、資料缺）→ 通用的「對局」曲（game）
   只算場景名，不碰聲音；播放在 src/audio.js 的 BGM.play。
   ═══════════════════════════════════════════════════════════════ */
(function (root, factory) {
  const api = factory(typeof require === 'function' ? require('./render.js') : root.MJRender);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MJBgmScene = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Rd) {
'use strict';

const KINGDOM_SCENES = ['qi', 'chu', 'yan', 'han', 'wei', 'zhao', 'qin'];

/* 名牌上亮「🎯 聽」的座位 */
function tenpaiSeats(hand) {
  if (!hand || !hand.seats || !Rd || !Rd.showsTenpai) return [];
  return hand.seats.map((_, i) => i).filter(i => Rd.showsTenpai(hand, i));
}

/* 莊家那一國的曲；不認得就 game */
function dealerScene(match) {
  const h = match && match.hand;
  const seat = h && match.seats && match.seats[h.dealer];
  const k = seat && seat.kingdom;
  return KINGDOM_SCENES.indexOf(k) >= 0 ? k : 'game';
}

/* 完整牌局裡有沒有人聽牌（群主、單機用；**不看名牌能不能亮**，只用來決定音樂） */
function anyTenpaiFull(hand, isTenpai) {
  return !!(hand && hand.phase !== 'over' && hand.seats && hand.seats.some(st => st && isTenpai(st)));
}

/* 有沒有人宣戰（v2.01 起聽牌曲只看這個）—— 2026-10-24 使用者：「只在有人宣戰時才放，自己聽牌但沒宣戰就不放，
   若幾個人一起玩才不會讓旁人聽到自己聽牌」「觀戰和玩家一致」。宣戰是公開的，每一台（含觀戰）自己算得出來 */
function anyDeclared(hand) {
  return !!(hand && hand.phase !== 'over' && hand.seats && hand.seats.some(st => st && st.declared));
}

/* 牌桌上現在該播的：有人聽牌 → tenpai；否則莊家那一國。
   opts.anyTenpai：連線時群主算好的有／沒有（帶了就照它） */
function tableScene(match, opts) {
  if (!match || !match.hand) return 'game';
  const any = opts && typeof opts.anyTenpai === 'boolean' ? opts.anyTenpai : tenpaiSeats(match.hand).length > 0;
  return any && match.hand.phase !== 'over' ? 'tenpai' : dealerScene(match);
}

return { KINGDOM_SCENES, tenpaiSeats, dealerScene, tableScene, anyTenpaiFull, anyDeclared };
});
