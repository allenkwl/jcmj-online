/* ═══════════════════════════════════════════════════════════════
   decree.js — 出師奏章
   ───────────────────────────────────────────────────────────────
   一場四局開打之前的竹簡。舊版叫 `WAR_DECL`，畫面是
   `#war-decl` / `#war-scroll-wrap`，按鈕是「⚔ 准奏，出兵！」。

   ── 為什麼不能照抄舊版 ──
   舊版是**一對一**：〈討齊國疏〉〈再討齊國疏〉，標題就寫死一個對手，
   而且按「上次為什麼失敗」分歧（輸了／平局／第三次），
   七國 × 約四種＝ 28 篇。

   四人版一次打三國，「討齊國疏」對不上任何一件事。所以改成：

     ‧ **一場一篇**，不是一局一篇 —— 一場約 20 分鐘，開場一篇剛好；
       每局都來會變成障礙
     ‧ 標題與內文講「會戰」，三國的名字動態填進去
     ‧ 分歧條件改用 `campaign.js` 已經在追的 `lastStreak` 與 `conquered`
       （舊版按失敗原因分歧，四人版沒有單一對手可歸咎；
        「連敗幾場」是現成的，而且語氣正好對得上）

   四篇就夠，不用 28 篇。

   ── 這裡只有資料與選擇邏輯 ──
   不吐 HTML、不碰 DOM。竹簡長什麼樣是畫面層的事。
   ═══════════════════════════════════════════════════════════════ */
(function (root, factory) {
  const api = factory(
    typeof require === 'function' ? require('./kingdoms.js') : root.MJKingdoms);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MJDecree = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (K) {
'use strict';

/* 可用的替換記號：
     {本國} {我}      玩家的本國（齊國／楚國…）
     {三國}           這一場三個對手，以「、」相連
     {甲} {乙} {丙}   三個對手各自
     {征服數}         已征服幾國
     {場次}           打過幾場                                    */
const DECREES = [
  {
    id: 'first',
    when: '首戰，或上一場有進帳',
    title: '請伐三國疏',
    body:
      '臣等伏惟：今{三國}會盟於中原，各擁甲兵，虎視我{本國}疆土。'
      + '兵法有云「先發者制人，後發者制於人」，與其坐待三面來犯，不如先聲奪人。'
      + '今我倉廩已實，士卒思戰，牌山列陣如兵，六合之勢可圖。'
      + '伏請陛下頒下征令，一戰而定名次，取其一國之地，以壯我{本國}之威！',
  },
  {
    id: 'again',
    when: '連敗一場',
    title: '再請出師疏',
    body:
      '臣等謹按：前役失利，非將士不用命，實乃臣等輕敵之過。'
      + '今已嚴申軍紀、重整糧道，復遣細作深入{甲}、{乙}、{丙}三境，其虛實盡在掌中。'
      + '勝負本無常勢，一戰之失不足以奪志；昔曹孟德敗於宛城而終定北方，正是此理。'
      + '伏請陛下再賜兵符，此番出師，必雪前恥。',
  },
  {
    id: 'desperate',
    when: '連敗兩場以上',
    title: '背水疏',
    body:
      '臣等泣血上言：連戰不利，寸土未得，臣等罪在不赦。'
      + '然項羽破釜沉舟於鉅鹿，韓信背水列陣於井陘，皆置之死地而後生。'
      + '今{三國}以為我師已疲，其防必懈，此正天授之機。'
      + '臣等願以全族性命為質，此戰不勝，不復生還。伏請陛下再準臣等出師一次！',
  },
  {
    id: 'closing',
    when: '已征服四國以上',
    title: '掃平六合疏',
    body:
      '臣等賀曰：陛下自{本國}興兵，席捲諸侯，今已得{征服數}國之地，'
      + '天下大勢已定其半。所餘者惟{三國}，皆殘兵敗將，不足為患。'
      + '六合歸一之期在即，願陛下親頒征令，掃平餘燼，成萬世不易之業！',
  },
];

/* 統一天下之後的詔書。對應舊版的勝利誦文（`vic-story`）。 */
const PROCLAMATION = {
  id: 'unified',
  title: '告天下書',
  body:
    '{本國}王詔曰：朕自{本國}起兵，歷{場次}場征戰，以麻將之道服六國之心。'
    + '今{六國}盡入版圖，四海為一，兵戈可息。'
    + '自今日始，天下再無戰國，惟有{本國}。布告中外，咸使聞知。',
};

const BUTTON = '⚔ 准奏，出兵！';
const BUTTON_UNIFIED = '⚑ 布告天下';

function nameOf(idOrChar) {
  const k = K && K.get(idOrChar);
  return k ? k.name : String(idOrChar || '');
}

/* 選哪一篇。

   ⚠️ 順序有意義：「快統一了」要蓋過「連敗」——
   手上五國的人連輸一場，收到〈再請出師疏〉那種「非將士不用命」的語氣
   會很怪，他明明快贏了。所以先看征服數。 */
function choose(player) {
  const p = player || {};
  const conquered = (p.conquered || []).length;
  const streak = p.lastStreak || 0;
  if (conquered >= 4) return DECREES.find(d => d.id === 'closing');
  if (streak >= 2) return DECREES.find(d => d.id === 'desperate');
  if (streak >= 1) return DECREES.find(d => d.id === 'again');
  return DECREES.find(d => d.id === 'first');
}

function fill(text, ctx) {
  const c = ctx || {};
  const foes = (c.foes || []).map(nameOf);
  const map = {
    '{本國}': nameOf(c.kingdom),
    '{我}': nameOf(c.kingdom),
    '{三國}': foes.join('、'),
    '{甲}': foes[0] || '', '{乙}': foes[1] || '', '{丙}': foes[2] || '',
    '{征服數}': String((c.conquered || []).length),
    '{場次}': String(c.matches || 0),
    '{六國}': (c.conquered || []).map(nameOf).join('、'),
  };
  return Object.keys(map).reduce((s, k) => s.split(k).join(map[k]), text);
}

/* ── 進入點 ──────────────────────────────────────────────────
   player：campaign.js 的玩家進度（吃 kingdom／conquered／lastStreak／matches）
   foes：這一場三個對手的國家 id
   回傳已經填好字的 { id, title, body, button }。                 */
function forMatch(player, foes) {
  const d = choose(player);
  const ctx = Object.assign({}, player, { foes: foes || [] });
  return {
    id: d.id,
    title: fill(d.title, ctx),
    body: fill(d.body, ctx),
    button: BUTTON,
  };
}

function forVictory(player) {
  const ctx = Object.assign({}, player, { foes: [] });
  return {
    id: PROCLAMATION.id,
    title: fill(PROCLAMATION.title, ctx),
    body: fill(PROCLAMATION.body, ctx),
    button: BUTTON_UNIFIED,
  };
}

return {
  DECREES, PROCLAMATION, BUTTON, BUTTON_UNIFIED,
  choose, fill, forMatch, forVictory,
};
});
