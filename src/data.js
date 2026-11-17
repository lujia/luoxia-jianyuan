/* =========================================================================
 * data.js —— 游戏数值数据（架构角色 ≈ 经典引擎的 DATA.MKF）
 *
 * 经典引擎把物品/法术/敌人/升级数值表打在 DATA.MKF；复刻版用同构的
 * 数据表（全部为原创内容与数值）。
 * 元素相克（原创设定）：雷 → 冰 → 火 → 雷（克制的伤害 ×1.6，被克 ×0.6）
 * ========================================================================= */
"use strict";

const Data = {

  /* ---- 元素 ---- */
  ELEMENTS: { none:"无", fire:"火", ice:"冰", bolt:"雷" },
  BEATS: { bolt:"ice", ice:"fire", fire:"bolt" },   // 键克制值

  /* ---- 物品（原创） ---- */
  /* 道具表。注意：这里只放「玩家真的能拿到、且真的有效果」的东西 ——
   * 旧版还有一项 antidote「清心散」（type:"cure"），但它既不在商店货单里、
   * 也不在任何宝箱里，而 GS 里根本没有状态异常字段，战斗中使用只弹一句
   * 「气息平复了些」。属于永远拿不到、拿到了也没用的死数据，已删除。
   * 若将来要加状态异常系统，请连同货单/宝箱/结算一起补齐。 */
  ITEMS: {
    huangChuang:  { name:"金创药",  desc:"恢复 60 点生命。",        type:"heal",  hp:60,  price:20 },
    huiYuan:      { name:"回元丹",  desc:"恢复 30 点真气。",        type:"mp",    mp:30,  price:25 },
    baiLuOint:    { name:"白露膏",  desc:"恢复 150 点生命。",       type:"heal",  hp:150, price:60 },
    fireCharm:    { name:"炎符",    desc:"投掷造成火元素伤害。",    type:"dmg",   elem:"fire", power:40, price:35 },
    boltCharm:    { name:"雷符",    desc:"投掷造成雷元素伤害。",    type:"dmg",   elem:"bolt", power:40, price:35 },
    snowLotus:    { name:"雪莲",    desc:"师父所需的灵药，尚未交付。", type:"quest", price:0 }
  },

  /* ---- 法术（原创） ---- */
  MAGIC: {
    yanBao:    { name:"炎爆咒", elem:"fire", power:26, mp:5,  desc:"凝聚烈焰轰击单个敌人。" },
    hanCi:     { name:"寒冰刺", elem:"ice",  power:24, mp:5,  desc:"冰锥刺击单个敌人。" },
    luoLei:    { name:"落雷符", elem:"bolt", power:30, mp:8,  desc:"召唤天雷劈击单个敌人。" },
    huiChun:    { name:"回春术", elem:"none", power:36, mp:6,  desc:"以灵力治愈一名同伴。", heal:true },
    shuangFeng: { name:"霜风咒", elem:"ice",  power:18, mp:9,  desc:"寒风扫过全体敌人。", all:true },
    yaoWu:      { name:"妖雾",   elem:"none", power:14, mp:0,  desc:"（敌人）毒雾笼罩全场。", all:true, enemy:true }
  },

  /* ---- 敌人（原创） ---- */
  ENEMIES: {
    wolf:   { name:"山狼",     hp:34,  atk:12, def:4,  spd:9,  xp:12, gold:8,  elem:"none", art:"wolf"   },
    boar:   { name:"野猪妖",   hp:52,  atk:15, def:8,  spd:5,  xp:20, gold:14, elem:"ice",  art:"boar"   },
    bat:    { name:"洞蝠",     hp:40,  atk:13, def:3,  spd:13, xp:16, gold:10, elem:"bolt", art:"bat"    },
    beetle: { name:"岩甲虫",   hp:66,  atk:16, def:14, spd:4,  xp:26, gold:18, elem:"fire", art:"beetle" },
    fox:    { name:"白霜妖狐", hp:320, atk:24, def:12, spd:12, xp:260, gold:300, elem:"ice", art:"fox",
              boss:true, magic:"yaoWu" }
  },

  /* ---- 遇敌编成表（原创） ---- */
  FORMATIONS: {
    field1: ["wolf"],
    field2: ["wolf", "wolf"],
    field3: ["wolf", "boar"],
    cave1:  ["bat"],
    cave2:  ["bat", "bat"],
    cave3:  ["beetle", "bat"],
    cave4:  ["beetle", "beetle"]
  },

  /* ---- 升级曲线（原创数值） ---- */
  LEVELS: {
    /* 升到 lv+1 所需经验。
     * 旧值 28*lv^1.55 偏陡：野外单场均值仅约 17 点经验，打完 6 场山狼
     * 才到 2 级（需 28+82=110 点），而主角 3 级才学第二个法术 ——
     * 正常通关流程里基本见不到落雷符。改为 18*lv^1.45 后，
     * 约 6 场战斗即可升到 3 级学会落雷符，沈月的霜风咒（5 级）
     * 需要多打几场或在洞窟深处探索，仍然是有分量的奖励。 */
    xpCurve: lv => Math.round(18 * Math.pow(lv, 1.45)),
    /* 每级成长表 */
    growth: {
      hero: { hp:9, mp:3, atk:2, def:1, spd:1 },
      yue:  { hp:7, mp:4, atk:1, def:1, spd:1 }
    },
    /* 各角色初始属性与习得法术（原创） */
    party: {
      hero: { name:"沈青崖", title:"落霞村弟子", level:1, xp:0,
              hp:64, mp:18, atk:14, def:6, spd:8,
              magic:["yanBao"] },
      yue:  { name:"沈月",   title:"青崖师妹",   level:1, xp:0,
              hp:52, mp:26, atk:10, def:5, spd:10,
              magic:["hanCi", "huiChun"] }
    },
    /* 按等级习得的法术 */
    learn: {
      hero: { 3:"luoLei" },
      yue:  { 5:"shuangFeng" }
    }
  }
};
