/* ═══════════════════════════════════════════════════════════════
   kingdoms.js — 七國資料
   ───────────────────────────────────────────────────────────────
   ⚠️ 由 `tools/build-kingdoms.py` 從舊版抽出，**不要手改**。

   只有國家的基本資料（id／名稱／君主／顏色／戰力）。
   **技能不在這裡** —— 七國技能已在 `docs/skill-conflicts.md` 第六節
   重新設計過，四人版的係數在 `src/scoring.js` 的 QI_PAY / CHU_WIN / QIN_SPEC。
   舊版的 KINGDOM_SKILLS 若也抽過來，就會有兩份互相矛盾的真相。

   頭像：`assets/avatar/<id>.webp`（小）與 `<id>_big.webp`（大），
   由 `tools/build-avatars.py` 從舊版的 KING_AVATARS / KING_AVATARS_ACTION 壓出來。
   ═══════════════════════════════════════════════════════════════ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MJKingdoms = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
'use strict';

/* general：主公斷線時代打的武將（「齊國主公斷線，現由田忌代打」）。
   盡量挑**同一位君主在位時**的名將：
     田忌（齊威王，桂陵／馬陵主將）　昭陽（楚懷王，破魏於襄陵）
     樂毅（燕昭王，破齊七十餘城）　　龐涓（魏惠王）　王翦（秦王政，滅趙楚）
   ⚠️ 兩位年代稍晚、是刻意選知名度：
     暴鳶 —— 韓襄王／釐王時的將領。宣惠王時同年代的韓將（如申差）幾乎沒人知道。
     廉頗 —— 惠文王（武靈王之子）時成名。武靈王時的將領（牛翦、趙固）同樣冷門。 */
const KINGDOMS = [
  {id:'qi', char:'齊',name:'齊國',kingName:'齊威王田因齊',color:'#4a90d9',desc:'東方大國，富庶之地',general:'田忌',skill:'善守',atk:3,def:5,bg:'qi'},
  {id:'chu',char:'楚',name:'楚國',kingName:'楚懷王熊槐',  color:'#27ae60',desc:'南方霸主，地廣兵強',general:'昭陽',skill:'雄兵',atk:5,def:3,bg:'chu'},
  {id:'yan',char:'燕',name:'燕國',kingName:'燕昭王姬職',  color:'#9b59b6',desc:'北境寒地，奇謀迭出',general:'樂毅',skill:'奇謀',atk:4,def:3,bg:'yan'},
  {id:'han',char:'韓',name:'韓國',kingName:'韓宣惠王韓康', color:'#e67e22',desc:'兵器精良，守城有術',general:'暴鳶',skill:'精兵',atk:3,def:4,bg:'han'},
  {id:'wei',char:'魏',name:'魏國',kingName:'魏惠王魏罃',  color:'#e74c3c',desc:'中原要衝，四戰之地',general:'龐涓',skill:'鐵騎',atk:5,def:2,bg:'wei'},
  {id:'zhao',char:'趙',name:'趙國',kingName:'趙武靈王趙雍',color:'#1abc9c',desc:'騎射天下第一',general:'廉頗',skill:'騎射',atk:4,def:4,bg:'zhao'},
  {id:'qin',char:'秦',name:'秦國',kingName:'秦王嬴政',    color:'#f39c12',desc:'虎狼之師，六合必歸',general:'王翦',skill:'虎狼',atk:5,def:5,bg:'qin'},
];

const BY_ID = {};
const BY_CHAR = {};
KINGDOMS.forEach(k => { BY_ID[k.id] = k; BY_CHAR[k.char] = k; });

/* 吃得下 'qin' 也吃得下 '秦' —— 畫面層用漢字、狀態層用 id，兩邊都會傳進來 */
function get(idOrChar) {
  if (!idOrChar) return null;
  return BY_ID[idOrChar] || BY_CHAR[idOrChar] || null;
}
/* general＝要守將的圖（電腦座位、斷線代打），不給就是主公。
   主公是真人、守將是電腦 —— 名牌上一眼分得出來（docs/character-design.md 第一節）。 */
function avatarUrl(idOrChar, big, general) {
  const k = get(idOrChar);
  return k ? 'assets/avatar/' + k.id + (general ? '_g' : '') + (big ? '_big' : '') + '.webp' : null;
}

/* 守將的稱呼：「楚將昭陽」。電腦座位的名牌、結算、宣告視窗都用這個。 */
function generalTitle(idOrChar) {
  const k = get(idOrChar);
  return k ? k.char + '將' + k.general : '';
}

/* 出征三格（蓄勢 → 出招 → 進攻），最後一格就是 avatarUrl(id, true) 那張。
   來源與做法見 docs/character-design.md 第四節、tools/build-avatars.py。 */
function warFrames(idOrChar, general) {
  const k = get(idOrChar);
  if (!k) return [];
  const b = 'assets/avatar/' + k.id + (general ? '_g' : '');
  return [b + '_war1.webp', b + '_war2.webp', b + '_big.webp'];
}

/* 打完勝仗的平靜姿勢（結算框：先播出征三格，再停在這張）。
   主公用先前畫的單張動作圖（鶴飛起、抱錢幣……），守將是另外補畫的一套。 */
function calmUrl(idOrChar, general) {
  const k = get(idOrChar);
  return k ? 'assets/avatar/' + k.id + (general ? '_g' : '') + '_calm.webp' : null;
}

return { KINGDOMS, get, avatarUrl, warFrames, calmUrl, generalTitle, BY_ID, BY_CHAR };
});
