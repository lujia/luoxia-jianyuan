/* =========================================================================
 * script.js —— 事件脚本（架构角色 ≈ 经典引擎的 SSS.MKF 剧本）
 *
 * 经典引擎用字节码脚本驱动对话/传送/开箱/触发战斗；复刻版用
 * “事件表 + 脚本函数”表达同样的机制。剧情、人物、台词均为原创。
 *
 * 剧情旗标：quest(接取) → joined(沈月入队) → bossDefeated → delivered(通关)
 * ========================================================================= */
"use strict";

const Script = { events: {} };

/* 工具：对话序列 = [{name, text}...] */
function talk(...lines) {
  return { type:"talk", lines };
}
function run(fn) { return { type:"run", fn }; }
function flag(name, value) { return { type:"run", fn: gs => { gs.flags[name] = value; } }; }

/* ---------------- 村庄 NPC 事件 ---------------- */
Script.events.village = {

  /* 云松道长（师父）：剧情主线 */
  master: gs => {
    if (gs.flags.delivered) return talk(
      { name:"云松道长", text:"咳咳……为师已无大碍，多亏了你这雪莲。" },
      { name:"云松道长", text:"江湖路远，往后的路，你自己去闯吧。" },
      { name:"", text:"【 未完待续 】" });
    if (gs.flags.quest) return talk(
      { name:"云松道长", text:"雾隐洞在青枫岭北面……咳咳，路上小心。" },
      { name:"云松道长", text:"沈月那丫头担心你，让她与你同去吧。" });
    return [
      talk({ name:"沈青崖", text:"师父，您的咳嗽又重了！" },
           { name:"云松道长", text:"唉……为师这旧疾，寻常汤药已压不住了。" },
           { name:"云松道长", text:"若得雾隐洞深处的『雪莲』，或可痊愈。" },
           { name:"云松道长", text:"只是洞中盘踞着一只妖物，你此去务必谨慎。" },
           { name:"沈青崖", text:"师父放心，青崖去去便回！" }),
      flag("quest", true)
    ];
  },

  /* 王铁匠 */
  smith: gs => [
    talk({ name:"王铁匠", text:"青崖啊，要出远门？我这口老剑你拿去。" },
         { name:"王铁匠", text:"（攻击 +2！）" }),
    run(gs => { if (!gs.flags.swordGift) { gs.flags.swordGift = true; gs.party[0].atk += 2;
               return "得到了铁匠的旧剑（攻击+2）。"; } return null; })
  ],

  /* 百草翁（药铺：商店 + 治疗） */
  doc: gs => [
    talk({ name:"百草翁", text:"买药还是疗伤？都来吧。" }),
    { type:"shop" }
  ],

  /* 石头（小孩） */
  kid: gs => talk(
    { name:"石头", text:"青崖哥！听说村外有妖怪，你可别被吃掉呀。" },
    { name:"石头", text:"……我娘说雾隐洞里的狐狸会变成美女骗人！" }),

  /* 沈月（师妹：入队） */
  yue: gs => {
    if (gs.flags.joined) return talk(
      { name:"沈月", text:"哥哥，我们继续赶路吧！" });
    if (!gs.flags.quest) return talk(
      { name:"沈月", text:"师父又咳嗽了整夜……哥哥，我们得想想办法。" },
      { name:"沈月", text:"先去问问师父吧。" });
    return [
      talk({ name:"沈月", text:"我听见了！你要去雾隐洞采雪莲？" },
           { name:"沈青崖", text:"洞里有妖物，你留下看家。" },
           { name:"沈月", text:"呸！我的寒冰咒是白练的？一起去！" },
           { name:"", text:"沈月加入了队伍！" }),
      run(gs => { gs.flags.joined = true; gs.party.push(makeActor("yue")); return null; })
    ];
  }
};

/* ---------------- 野外事件 ---------------- */
Script.events.field = {};

/* ---------------- 洞窟事件 ---------------- */
Script.events.cave = {
  /* 宝箱由引擎按坐标自动处理（见 engine.js 的 chest 表） */
};

/* ---------------- 宝箱内容表（原创） ---------------- */
Script.chests = {
  "village:19:16": { gold: 30,  text:"得到了 30 文钱。" },
  "cave:28:26":    { item:"baiLuOint", n:2, text:"得到了白露膏 ×2。" },
  "cave:8:7":      { item:"boltCharm", n:3, text:"得到了雷符 ×3。" }
};

/* ---------------- 商店货单（原创） ---------------- */
Script.shopGoods = [
  { item:"huangChuang", price:20 },
  { item:"huiYuan",     price:25 },
  { item:"baiLuOint",   price:60 },
  { item:"fireCharm",   price:35 },
  { item:"boltCharm",   price:35 }
];
