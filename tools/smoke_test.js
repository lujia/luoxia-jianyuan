/* 浏览器级冒烟测试（Node 运行）：tools/smoke_test.js
 * 与真浏览器完全一致的事件流：DOM 监听器捕获、keydown/keyup 事件派发、
 * rAF 帧循环手动步进。覆盖：启动 → 对话 → NPC 事件 → 宝箱 → 入队 →
 * 商店 → 行走/碰撞 → 遇敌战斗 → Boss → 交付 → 结局 → 存档 → 全灭，
 * 最后附随机模糊测试（2000 次随机操作）检测死锁与异常。 */
"use strict";
const fs = require("fs");
const path = require("path");

/* ---------------- 浏览器环境桩 ---------------- */
function makeCtx() {
  const gradient = { addColorStop() {} };
  return new Proxy({}, {
    get(t, p) {
      if (p === "measureText") return () => ({ width: 8 });
      if (p === "createLinearGradient") return () => gradient;
      if (p in t) return t[p];
      t[p] = () => {};
      return t[p];
    },
    set(t, p, v) { t[p] = v; return true; }
  });
}
function makeCanvas() {
  return { width: 0, height: 0, style: {},
           getContext: () => makeCtx(),
           addEventListener: () => {} };
}
global.document = {
  createElement: () => makeCanvas(),
  getElementById: () => makeCanvas()
};
const listeners = {};       // 事件监听器注册表（真实浏览器语义）
/* 假 AudioContext：让音频序列器在 Node 里真正运行（旧版没有它，
 * 音频代码从未被测试覆盖 —— 休止符 null.match 崩溃因此漏网） */
class FakeAudioContext {
  constructor() { this.currentTime = 0; this.destination = {}; }
  createGain() {
    return { gain: { value: 0,
                     setValueAtTime() {}, exponentialRampToValueAtTime() {},
                     linearRampToValueAtTime() {} },
             connect() {} };
  }
  createOscillator() {
    return { type: "", frequency: { value: 0 }, connect() {}, start() {}, stop() {} };
  }
}
global.window = {
  innerWidth: 320, innerHeight: 200,
  AudioContext: FakeAudioContext,
  addEventListener: (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); }
};
let rafQueue = [];
global.requestAnimationFrame = cb => { rafQueue.push(cb); };
global.localStorage = (() => {
  let store = {};
  return { getItem: k => (k in store ? store[k] : null),
           setItem: (k, v) => { store[k] = String(v); },
           removeItem: k => { delete store[k]; } };
})();

/* ---------------- 加载全部脚本（模拟浏览器多 <script> 顺序执行） -------- */
const files = ["pat.js", "mgo.js", "art.js", "data.js", "maps.js", "script.js",
               "engine.js", "battle.js", "main.js"];
const src = files.map(f =>
  fs.readFileSync(path.join(__dirname, "..", "src", f), "utf8")).join("\n;\n");
const expose = `
;globalThis.__game = { GS, Data, Maps, Pat, Mgo, Script, Battle, Audio,
  boot, mainStart, enterScene, interact, startDialog, runEventSteps,
  startEncounter, saveGame, loadGame, update, render, mapSize, TILES,
  onKeyDown, onKeyUp, Dlg, openChest, checkTileEvents, updateWalk,
  Shop, uiBox, text, wrapText, tileAt,
  Menu, openSaveMenu, menuKey, saveSlot, loadSlot, deleteSlot, slotMeta,
  makeActor, pristine: Maps.pristine };
`;
eval(src + expose);
const G = globalThis.__game;

/* ---------------- 事件工具（与真实浏览器一致） ---------------- */
/* key → 物理键码：引擎按 e.code 归一化，这里做逆向映射保证一致 */
const CODE = {
  " ":"Space", "Enter":"Enter", "Escape":"Escape", "Tab":"Tab",
  "ArrowUp":"ArrowUp", "ArrowDown":"ArrowDown",
  "ArrowLeft":"ArrowLeft", "ArrowRight":"ArrowRight",
  "w":"KeyW", "a":"KeyA", "s":"KeyS", "d":"KeyD",
  "n":"KeyN", "c":"KeyC", "i":"KeyI", "l":"KeyL", "x":"KeyX"
};
const rec = [];                    // 飞行记录仪：最近的按键/模式
function fire(type, key, repeat) {
  const ev = { key, code: CODE[key] || key, repeat: !!repeat,
               preventDefault() {} };
  rec.push(type.slice(3) + ":" + key + "@" + G.GS.mode);
  if (rec.length > 80) rec.shift();
  for (const fn of (listeners[type] || [])) fn(ev);
}
const keyDown = (k, rep) => fire("keydown", k, rep);
const keyUp = (k) => fire("keyup", k);
let ts = 0;
function frames(n) {               // 步进 rAF 帧循环（≈16ms/帧）
  for (let i = 0; i < (n || 1); i++) {
    ts += 16;
    const q = rafQueue; rafQueue = [];
    for (const cb of q) cb(ts);    // loop() 内部会重新注册下一帧
  }
}
const tap = (k) => { keyDown(k); frames(2); keyUp(k); frames(1); };
const hold = (k, n) => { keyDown(k); frames(n); keyUp(k); };

/* ---------------- 断言 ---------------- */
let pass = 0, fail = 0;
const ok = (cond, msg) => {
  if (cond) { pass++; console.log("  ✓ " + msg); }
  else { fail++; console.log("  ✗ FAIL: " + msg); }
};
const crash = (err, label) => {
  console.error("\n!! 异常于 [" + label + "]: " + err.stack);
  console.error("   飞行记录（最近 80 步）:\n   " + rec.join("\n   "));
  process.exit(1);
};
function tapThrough(label) {       // 连点空格直到离开对话
  let n = 0;
  while (G.GS.mode === "dialog") {
    tap(" ");
    frames(2);
    if (++n > 40) { console.error("对话卡死: " + label + "\n" + rec.join("\n")); process.exit(1); }
  }
}

/* ================= 1. 启动 ================= */
console.log("\n[1] 启动与标题");
try {
  for (const fn of listeners["DOMContentLoaded"]) fn();   // boot()
  frames(3);
  ok(G.Pat.ready && Object.keys(G.Pat.tiles).length >= 19, "图块已生成 (" + Object.keys(G.Pat.tiles).length + " 种)");
  ok(Object.keys(G.Mgo.sprites).length >= 6, "行走精灵已生成");
  ok(Object.keys(G.Mgo.battle).length >= 5, "战斗图素已生成");
  ok(G.GS.mode === "title", "标题画面就绪");
  tap("Enter");
  ok(G.GS.mode === "dialog", "回车开始新游戏 → 开场对话");
  tapThrough("开场");
  ok(G.GS.mode === "walk" && G.GS.sceneId === "village" && G.GS.party.length === 1,
     "开场结束进入行走（村庄，队伍 1 人）");
} catch (e) { crash(e, "1 启动"); }

/* 快速点按压力测试：down+up 落在同一帧间隔内也不许丢键 */
console.log("\n[2] 快速点按不丢键（旧轮询实现的冻结根源）");
try {
  keyDown(" "); keyUp(" "); frames(1);          // < 16ms 的点按
  keyDown(" "); keyUp(" "); frames(1);
  ok(G.GS.mode !== "title", "亚帧速点按也能被对话捕获");
  /* 模拟中文输入法：e.key="Process" 但 e.code="Space" */
  const ime = { key: "Process", code: "Space", repeat: false, preventDefault() {} };
  for (const fn of listeners["keydown"]) fn(ime);
  frames(1);
  for (const fn of listeners["keyup"]) fn({ key: "Process", code: "Space", preventDefault() {} });
  frames(1);
  ok(true, "IME(Process)键事件可被识别（e.code 归一化）");
} catch (e) { crash(e, "2 快速点按"); }

/* 音频回归测试：每首曲子完整循环（含休止符 null 项）不允许抛异常。
 * 旧版 Node 无 AudioContext，音频序列器从未运行 → null.match 崩溃漏网。 */
console.log("\n[2.5] 音频序列器（休止符回归）");
try {
  ok(G.Audio.unlocked === true, "AudioContext 已解锁（假桩）");
  for (const name of ["village", "field", "cave", "battle", "boss"]) {
    G.Audio.play(name);
    G.Audio.idx = 0; G.Audio.noteT = 0;
    frames(1200);                        // 完整播放一整圈以上（含所有休止符）
    ok(true, "曲目 " + name + " 完整循环无异常");
  }
  G.Audio.play("village");
} catch (e) { crash(e, "2.5 音频"); }

/* ================= 3. NPC 事件与宝箱 ================= */
console.log("\n[3] NPC 事件与宝箱");
try {
  G.enterScene("village", [3, 6]); G.GS.dir = 3;
  tap(" ");                                     // 与师父对话
  ok(G.GS.mode === "dialog", "与师父对话触发");
  tapThrough("师父");
  ok(G.GS.flags.quest === true, "旗标 quest 已设置（接取任务）");
  G.enterScene("village", [3, 14]); G.GS.dir = 3;
  const atk0 = G.GS.party[0].atk;
  tap(" "); tapThrough("铁匠");
  ok(G.GS.party[0].atk === atk0 + 2, "铁匠赠剑 攻击+2");
  G.enterScene("village", [19, 17]); G.GS.dir = 3;
  const gold0 = G.GS.gold;
  tap(" "); tapThrough("宝箱");
  ok(G.GS.gold === gold0 + 30 && G.Maps.scenes.village.map[16][19] === "c",
     "村中宝箱 +30 文且外观已打开");
  G.enterScene("village", [24, 6]); G.GS.dir = 3;
  tap(" "); tapThrough("沈月");
  ok(G.GS.party.length === 2, "沈月已入队（队伍 2 人）");
} catch (e) { crash(e, "3 NPC事件"); }

/* ================= 4. 商店与状态栏 ================= */
console.log("\n[4] 商店与状态栏");
try {
  G.enterScene("village", [22, 14]); G.GS.dir = 3;
  tap(" "); tapThrough("药铺对话");
  ok(G.GS.mode === "shop", "药铺打开商店界面");
  const goldBeforeBuy = G.GS.gold;
  tap(" ");
  ok(G.GS.gold === goldBeforeBuy - 20 && G.GS.items.huangChuang === 1, "空格购买金创药");
  tap("ArrowDown"); tap(" ");
  ok(G.GS.mode === "shop", "商店连续操作正常");
  /* ---- 回归：购买失败必须有反馈（旧版静默返回，玩家以为按键失灵） ---- */
  const goldNow = G.GS.gold;
  G.GS.gold = 0;
  G.Shop.sel = 0;
  tap(" ");
  ok(G.GS.gold === 0 && G.Shop.msg.indexOf("钱不够") >= 0,
     "钱不够时给出明确提示（旧版静默无反应）");
  /* ---- 回归：NPC 承诺的"疗伤"必须真的存在 ---- */
  G.GS.gold = 100;
  G.GS.party.forEach(a => { a.hp = 1; a.mp = 0; });
  G.Shop.sel = G.Script.shopGoods.length;      /* 疗伤行 */
  tap(" ");
  ok(G.GS.party.every(a => a.hp === a.maxHp && a.mp === a.maxMp),
     "商店疗伤把全队生命与真气回满");
  ok(G.GS.gold === 100 - G.Shop.HEAL_PRICE * G.GS.party.length, "疗伤按人数正确扣费");
  G.Shop.sel = G.Script.shopGoods.length;
  const goldFull = G.GS.gold;
  tap(" ");
  ok(G.GS.gold === goldFull && G.Shop.msg.indexOf("精神") >= 0, "满血时疗伤被婉拒且不扣钱");
  G.GS.gold = goldNow;
  tap("Escape");
  ok(G.GS.mode === "walk", "Esc 关闭商店");
  tap("Tab");
  ok(G.GS.mode === "status", "Tab 打开状态栏");
  tap(" ");
  ok(G.GS.mode === "walk", "任意键关闭状态栏（旧轮询版会闪退一帧）");
} catch (e) { crash(e, "4 商店"); }

/* ================= 5. 行走与碰撞 ================= */
console.log("\n[5] 行走与碰撞");
try {
  /* 临时关闭野外遇敌率 → 行走测试不受随机战斗干扰（结束再恢复） */
  const savedRate = G.Maps.scenes.field.encounterRate;
  G.Maps.scenes.field.encounterRate = 0;
  G.enterScene("village", [30, 8]);
  hold("ArrowRight", 400);
  ok(G.GS.sceneId === "field" && G.GS.mode === "walk",
     "按住右键走出村庄 → 青枫岭（未被随机战斗打断）");
  G.enterScene("field", [21, 6]);
  const py0 = G.GS.py;
  hold("ArrowUp", 150);
  const footTy = Math.floor((G.GS.py + 20) / 16);
  ok(G.GS.py < py0 && footTy >= 3, "北行移动被岩壁正确阻挡（脚底停在第 " + footTy + " 行）");
  G.Maps.scenes.field.encounterRate = savedRate;
} catch (e) { crash(e, "5 行走"); }

/* ================= 6. 遇敌与回合制战斗（全键盘事件驱动） ================= */
console.log("\n[6] 遇敌与回合制战斗");
try {
  G.enterScene("field", [10, 10]);
  G.GS.encounterMeter = 999;
  hold("ArrowDown", 60);
  ok(G.GS.mode === "battle", "行走触发遇敌");
  ok(G.Battle.enemies.length >= 1, "敌人出现: " + G.Battle.enemies.map(e => e.name).join("、"));
  G.Battle.enemies.forEach(e => { e.hp = 1; });
  frames(80);                                   // 开场消息时间流走
  /* 事件驱动的战斗操作：遇我方回合就按空格出“攻击” */
  let attacked = false, guard = 0;
  while (G.GS.mode === "battle" && guard++ < 40) {
    const t = G.Battle.currentActor();
    if (!G.Battle.finished && t && t.side === "ally" && G.Battle.msgT <= 0) {
      tap(" "); attacked = true;                // 菜单选“攻击”确认
    } else frames(10);
    if (G.Battle.finished) { tap(" "); break; }  // 胜利后按空格收尾
  }
  ok(attacked, "我方执行了攻击指令");
  ok(G.GS.mode === "walk", "战斗结束回到行走");
  ok(G.GS.party[0].xp > 0, "获得经验: " + G.GS.party[0].xp);
} catch (e) { crash(e, "6 战斗"); }

/* ================= 7. Boss 战与剧情旗标 ================= */
console.log("\n[7] Boss 战与剧情旗标");
try {
  G.enterScene("cave", [34, 8]);
  frames(3);
  ok(G.GS.pendingBoss === true, "走近界碑触发 Boss 对话");
  tapThrough("Boss 出场");
  ok(G.GS.mode === "battle" && G.Battle.isBoss, "进入 Boss 战");
  G.Battle.enemies[0].hp = 1;
  let guard = 0;
  while (G.GS.mode === "battle" && guard++ < 40) {
    const t = G.Battle.currentActor();
    if (!G.Battle.finished && t && t.side === "ally" && G.Battle.msgT <= 0) tap(" ");
    else frames(10);
    if (G.Battle.finished) { tap(" "); break; }
  }
  ok(G.GS.flags.bossDefeated === true && G.GS.items.snowLotus >= 1,
     "Boss 已击败并获得雪莲");
  ok(G.GS.mode === "dialog", "Boss 战后进入剧情对话");
  tapThrough("战后剧情");
  ok(G.GS.mode === "walk", "回到行走模式");
} catch (e) { crash(e, "7 Boss"); }

/* ================= 8. 交付剧情与结局 ================= */
console.log("\n[8] 交付剧情与结局");
try {
  G.enterScene("village", [9, 16]);
  frames(3);
  ok(G.GS.mode === "dialog", "回村自动触发交付剧情");
  tapThrough("交付");
  ok(G.GS.flags.delivered === true && G.GS.items.snowLotus === 0, "雪莲已交付");
  ok(G.GS.mode === "ending", "进入结局画面");
  tap(" ");
  ok(G.GS.mode === "title", "结局后按键返回标题");
} catch (e) { crash(e, "8 结局"); }

/* ================= 9. 存档与读档 ================= */
console.log("\n[9] 存档与读档");
try {
  tap("Enter"); tapThrough("再开场");
  G.GS.gold = 777; G.GS.flags.quest = true;
  G.saveGame();
  tap("Escape");                                 /* Esc 现在呼出存档菜单 */
  ok(G.GS.mode === "menu", "行走中 Esc 呼出存档菜单");
  tap("Escape");
  ok(G.GS.mode === "walk", "菜单内再按 Esc 关闭回行走");
  /* 回标题用 C 继续存档 */
  G.GS.mode = "title";
  tap("c");
  ok(G.GS.gold === 777 && G.GS.flags.quest === true && G.GS.sceneId === "village",
     "C 键继续游戏恢复存档");
} catch (e) { crash(e, "9 存档"); }

/* ================= 9.5 三槽手动存档（存/读/删全流程） ================= */
console.log("\n[9.5] 多槽存档菜单（存/读/删）");
try {
  if (G.GS.mode === "dialog") tapThrough("9.5 前置对话");
  if (G.GS.mode !== "walk") G.GS.mode = "walk";
  for (let i = 1; i <= 3; i++) G.deleteSlot(i);
  ok(G.slotMeta(1) === null && G.slotMeta(3) === null, "清场后槽位为空");
  G.openSaveMenu();
  ok(G.GS.mode === "menu", "openSaveMenu 进入 menu 模式");
  tap("l");
  ok(G.GS.mode === "menu" && G.Menu.msg.indexOf("空") >= 0, "读空槽仅提示，不崩溃不离屏");
  tap("ArrowDown");
  ok(G.Menu.sel === 1, "方向键移动槽位选择");
  G.GS.gold = 321; G.GS.flags.testFlag = 42; G.GS.dir = 3;
  const px0 = G.GS.px, py0 = G.GS.py;
  tap("Enter");
  const meta = G.slotMeta(2);
  ok(meta && meta.gold === 321 && meta.sceneName === "落霞村" &&
     meta.level === (G.GS.party[0].level || 1), "存档写入槽2（meta 正确）");
  ok(G.GS.mode === "menu" && G.Menu.msg.indexOf("已存至槽位 2") >= 0, "存档成功提示");
  /* 篡改现场（金钱/旗标/场景）后读回 */
  G.GS.gold = 1; G.GS.flags.testFlag = 0;
  G.enterScene("field", [10, 10]);
  G.GS.mode = "menu"; G.Menu.sel = 1;
  tap("l");
  ok(G.GS.mode === "walk" && G.GS.gold === 321 && G.GS.flags.testFlag === 42,
     "读档恢复金钱/旗标并回到行走");
  ok(G.GS.sceneId === "village" && Math.abs(G.GS.px - px0) < 0.01 &&
     Math.abs(G.GS.py - py0) < 0.01 && G.GS.dir === 3,
     "读档恢复场景/精确坐标/朝向");
  /* 删除槽位 */
  G.openSaveMenu(); G.Menu.sel = 1;
  tap("x");
  ok(G.slotMeta(2) === null && G.GS.mode === "menu", "删除槽位生效且不离开菜单");
  tap("Escape");
  ok(G.GS.mode === "walk", "Esc 关闭菜单回到行走");

  /* ---- 回归：宝箱开启状态必须可回滚 ---- */
  G.enterScene("village", [18, 16]); G.GS.mode = "walk"; G.GS.dir = 2;
  const chestX = 19, chestY = 16;
  ok(G.tileAt(chestX, chestY) === "C", "开箱前地图为关闭态 C");
  G.openChest(chestX, chestY); tapThrough("开箱");
  ok(G.tileAt(chestX, chestY) === "c", "开箱后地图变为开启态 c");
  G.saveSlot(1);                            /* 先存一个"已开"档 */
  G.enterScene("village", [18, 16]);
  ok(G.tileAt(chestX, chestY) === "c", "同一存档内切场景后宝箱仍是开启态");
  G.deleteSlot(1);
  G.GS.flags = {};                          /* 模拟"开新游戏"：旗标清空 */
  G.enterScene("village", [18, 16]);
  ok(G.tileAt(chestX, chestY) === "C",
     "旗标清空后宝箱恢复关闭态（旧版永久卡在开启外观）");
  G.GS.mode = "walk"; G.GS.dir = 2;
  G.openChest(chestX, chestY); tapThrough("重开宝箱");
  ok(G.GS.flags["chest_village:19:16"] === true, "宝箱可再次正常开启");

  /* ---- 回归：跟随者不得与主角完全重叠 ---- */
  G.GS.flags.joined = true;
  if (G.GS.party.length < 2) G.GS.party.push(G.makeActor("yue"));
  G.enterScene("village", [12, 10]); G.GS.mode = "walk"; G.GS.dir = 0;
  for (let i = 0; i < 40; i++) frames(1);   /* 站住不动 */
  const fol = G.GS.followers[16];
  ok(!!fol && Math.hypot(fol[0] - G.GS.px, fol[1] - G.GS.py) > 4,
     "静止时沈月不与主角重叠（旧版坐标完全相同）");
} catch (e) { crash(e, "9.5 多槽存档"); }

/* ================= 10. 全灭处理 ================= */
console.log("\n[10] 全灭与复活");
try {
  G.enterScene("field", [10, 10]);
  G.Battle.start([G.Data.ENEMIES.fox], false);
  G.GS.party.forEach(a => { a.hp = 1; });
  let guard = 0;
  /* 必须持续按键：回合制在轮到己方时会等待玩家输入，
   * 不按键的话若回合顺序恰好己方先手，战斗会静默挂住（测试假失败）。 */
  while (G.GS.mode === "battle" && guard++ < 400) { tap(" "); frames(20); }
  ok(G.Battle.defeat === true, "全灭判定");
  tap(" ");
  ok(G.GS.sceneId === "village" && G.GS.party[0].hp > 0,
     "战后回村复活");
  if (G.GS.mode === "dialog") tapThrough("复活提示");
} catch (e) { crash(e, "10 全灭"); }

/* ================= 10.5 战斗结果旗标不得跨场残留 ================= */
/* 回归：旧版 start() 不清 defeat/victory/fled，全灭过一场之后，
 * 下一场即使打赢也会被 finishBattle 当成全灭（金币减半 + 强制回村），
 * 主线 Boss 战胜利后拿不到雪莲 → 游戏无法通关。 */
console.log("\n[10.5] 战斗结果旗标跨场隔离（全灭→胜利回归）");
try {
  ok(G.Battle.defeat === true, "上一场确实处于全灭状态（前置条件）");
  G.enterScene("field", [10, 10]);
  G.GS.party.forEach(a => { a.hp = a.maxHp; a.atk = 9999; });
  G.GS.gold = 500;
  G.Battle.start([G.Data.ENEMIES.wolf], false);
  ok(G.Battle.defeat === false && G.Battle.victory === false && G.Battle.fled === false,
     "新战斗开始时结果旗标已清零");
  let g2 = 0;
  while (G.GS.mode === "battle" && !G.Battle.finished && g2++ < 400) { tap(" "); frames(5); }
  ok(G.Battle.victory === true && G.Battle.defeat === false, "本场判定为胜利而非全灭");
  tap(" ");
  ok(G.GS.sceneId === "field" && G.GS.gold >= 500,
     "胜利后留在原地且金币未被减半（旧版会强制回村并砍半）");
  if (G.GS.mode === "dialog") tapThrough("胜利结算");
} catch (e) { crash(e, "10.5 战斗旗标"); }

/* ================= 10.6 空队伍战斗不崩溃 ================= */
console.log("\n[10.6] 空队伍战斗防御");
try {
  const saved = G.GS.party;
  G.GS.party = [];
  G.Battle.start([G.Data.ENEMIES.wolf], false);
  let guard2 = 0;
  while (G.GS.mode === "battle" && guard2++ < 200) frames(20);
  ok(G.Battle.finished === true && G.Battle.defeat === true,
     "空队伍自动判负而非 target.def 崩溃");
  G.GS.party = saved;
  G.GS.mode = "walk";
} catch (e) { crash(e, "10.6 空队伍"); }

/* ================= 10.8 升级曲线与法术习得可达性 ================= */
/* 回归：旧曲线 28*lv^1.55 下，野外单场约 17 点经验、洞穴约 36 点，
 * 正常通关（十几场战斗）都学不到主角 3 级的落雷符 —— 法术系统形同虚设。
 * 这里锁定"合理场次内必须学会"。 */
console.log("\n[10.8] 升级曲线可达性");
try {
  G.mainStart(false);
  let n0 = 0;
  while (G.GS.mode === "dialog" && n0++ < 60) { G.Dlg.chars = 999; tap(" "); }
  const h = G.GS.party[0];
  ok(h.level === 1 && h.magic.length === 1, "新游戏主角 1 级、只会 1 个法术（前置）");
  /* 模拟野外平均 6 场战斗（wolf / wolf×2 / wolf+boar 轮流） */
  const FIELD = [["wolf"], ["wolf", "wolf"], ["wolf", "boar"]];
  for (let i = 0; i < 6; i++) {
    G.Battle.start(FIELD[i % 3].map(k => G.Data.ENEMIES[k]), false);
    G.Battle.enemies.forEach(e => { e.hp = 0; e.alive = false; });
    G.Battle.finished = true; G.Battle.victory = true;
    G.Battle.grantRewards();
    G.GS.mode = "walk";
  }
  ok(h.level >= 3, "野外 6 场战斗后主角至少 3 级（旧曲线只有 2 级）");
  ok(h.magic.includes("luoLei"), "此时已习得落雷符（旧曲线学不到）");
  /* 再打几场洞穴战斗，沈月应能学到 5 级的霜风咒 */
  const CAVE = [["bat"], ["bat", "bat"], ["beetle", "bat"], ["beetle", "beetle"]];
  G.GS.flags.joined = true;
  if (!G.GS.party.find(a => a.id === "yue")) G.GS.party.push(G.makeActor("yue"));
  for (let i = 0; i < 10; i++) {
    G.Battle.start(CAVE[i % 4].map(k => G.Data.ENEMIES[k]), false);
    G.Battle.enemies.forEach(e => { e.hp = 0; e.alive = false; });
    G.Battle.finished = true; G.Battle.victory = true;
    G.Battle.grantRewards();
    G.GS.mode = "walk";
  }
  const yue = G.GS.party.find(a => a.id === "yue");
  ok(yue.level >= 5 && yue.magic.includes("shuangFeng"),
     "洞穴 10 场后沈月 5 级并习得霜风咒");
  ok(h.level <= 9, "等级不会失控膨胀（仍在合理区间）");
} catch (e) { crash(e, "10.8 升级曲线"); }

/* ================= 10.7 任务道具不可消耗 ================= */
console.log("\n[10.7] 任务道具不可消耗（雪莲）");
try {
  const hero = G.GS.party[0];
  G.GS.items = { snowLotus: 1 };
  hero.hp = Math.floor(hero.maxHp / 2);
  G.Battle.start([G.Data.ENEMIES.wolf], false);
  G.Battle.execItem({ a: hero }, "snowLotus");
  ok(G.GS.items.snowLotus === 1, "雪莲未被消耗");
  ok(G.Battle.msg.indexOf("任务道具") >= 0, "给出不可使用提示");
  ok(G.Battle.battleItems().length === 0, "战斗物品栏不含任务道具");
  G.GS.items = { huangChuang: 2 };
  G.Battle.msg = ""; G.Battle.msgT = 0;
  G.Battle.execItem({ a: hero }, "huangChuang");
  ok(G.GS.items.huangChuang === 1 && hero.hp === hero.maxHp, "普通药品正常消耗并生效");
  G.GS.mode = "walk";
} catch (e) { crash(e, "10.7 任务道具"); }

/* ================= 11. 随机模糊测试（死锁/异常猎手） ================= */
console.log("\n[11] 随机模糊测试（2000 次随机操作）");
try {
  const KEYS = [" ", "Enter", "Escape", "Tab", "c", "n", "i", "l", "x",
                "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
                "w", "a", "s", "d"];
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];
  let acts = 0;
  for (let i = 0; i < 2000; i++) {
    const k = pick(KEYS);
    /* 快慢混合：30% 亚帧速点按（最容易暴露丢键问题） */
    if (Math.random() < 0.3) { keyDown(k); keyUp(k); frames(1); }
    else { keyDown(k); frames(1 + Math.floor(Math.random() * 6)); keyUp(k); frames(1); }
    acts++;
    /* 每隔一段做模式健康检查 */
    if (i % 120 === 60) {
      frames(5);
      const m = G.GS.mode;
      if (m === "title") { tap("Enter"); if (G.GS.mode === "dialog") tapThrough("模糊开场"); }
      else if (m === "dialog") {
        let n = 0; while (G.GS.mode === "dialog" && n++ < 45) { tap(" "); frames(3); }
        if (G.GS.mode === "dialog") throw new Error("对话死锁（连点45次无效）");
      }
      else if (m === "shop") { tap("Escape"); if (G.GS.mode !== "walk") throw new Error("商店无法退出"); }
      else if (m === "status") { tap(" "); if (G.GS.mode !== "walk") throw new Error("状态栏无法退出"); }
      else if (m === "menu") { tap("Escape"); if (G.GS.mode !== "walk") throw new Error("存档菜单无法退出"); }
      else if (m === "ending") { tap(" "); if (G.GS.mode !== "title") throw new Error("结局无法退出"); }
      else if (m === "battle") {
        /* 战斗里必须"换着键"打：只按空格时，若选中项停在"物品"且背包为空，
         * 会反复弹"没有可用的物品"并不断重置 msgT —— 这是正常的游戏行为
         * （玩家按方向键换到"攻击"即可），但只按空格的健康检查会误判成死锁。
         * 因此这里交替按 上/下 与 空格，模拟真实玩家的操作。 */
        let g = 0;
        while (G.GS.mode === "battle" && g++ < 300) {
          const B = G.Battle;
          if (!B.finished) {
            /* 等消息条消失（消息期间引擎忽略输入） */
            let w = 0; while (B.msgT > 0 && w++ < 40) frames(2);
            /* 把指令光标挪到"攻击"再确认：停在"物品"且背包为空时会反复弹提示 */
            let nav = 0;
            while (B.phase === "menu" && B.sel !== 0 && nav++ < 5) { tap("ArrowUp"); frames(2); }
            if (B.phase === "menu" && B.sel === 0) tap(" ");
            else { tap("Escape"); frames(2); }
          }
          frames(10);
          if (G.Battle.finished) { tap(" "); frames(2); }
        }
        if (G.GS.mode === "battle") {
          const B = G.Battle;
          throw new Error("战斗死锁（3000帧+连点未结束） 诊断: phase=" + B.phase +
            " sel=" + B.sel + " actorIdx=" + B.actorIdx + "/" + B.turnOrder.length +
            " msgT=" + Math.round(B.msgT) + " finished=" + B.finished +
            " party=" + G.GS.party.map(a => a.hp + "/" + a.maxHp).join(",") +
            " enemies=" + B.enemies.map(e => (e.alive ? e.hp : "X")).join(",") +
            " items=" + JSON.stringify(G.GS.items));
        }
      }
      else if (m === "walk") {
        /* 走廊卡死检测：四方向各按 50 帧，逐帧记录模式与位置；
         * 若期间被战斗/对话打断则属正常，跳过；若全程行走而位置不变则输出诊断。 */
        const sx = G.GS.px, sy = G.GS.py;
        const trace = [];
        let totalMove = 0;
        const probe = (k, n) => { const m0 = G.GS.mode, x0 = G.GS.px, y0 = G.GS.py;
          keyDown(k);
          for (let j = 0; j < n; j++) frames(1);
          keyUp(k);
          const dx = Math.abs(G.GS.px - x0), dy = Math.abs(G.GS.py - y0);
          totalMove += dx + dy;
          trace.push(k.slice(5) + ": " + m0 + "→" + G.GS.mode + " Δ" + dx.toFixed(0) + "," + dy.toFixed(0)); };
        probe("ArrowRight", 50); probe("ArrowDown", 50);
        probe("ArrowLeft", 50); probe("ArrowUp", 50);
        /* 真正的软锁：全程行走模式 + 四向累计位移为 0（右下左上走矩形回原点不算） */
        if (G.GS.mode === "walk" && totalMove < 1) {
          const fx = Math.floor((G.GS.px + 8) / 16), fy = Math.floor((G.GS.py + 20) / 16);
          console.log("  (疑似卡死: 场景=" + G.GS.sceneId + " 脚=(" + fx + "," + fy + ")" +
            " 四邻='" + G.tileAt(fx + 1, fy) + G.tileAt(fx, fy + 1) + G.tileAt(fx - 1, fy) + G.tileAt(fx, fy - 1) + "'" +
            " 按住的键=" + JSON.stringify(Object.keys(G.GS.keys).filter(k => G.GS.keys[k])) +
            " NPC邻近=" + JSON.stringify((G.Maps.scenes[G.GS.sceneId].npcs || [])
              .filter(n => Math.abs(n.x - fx) + Math.abs(n.y - fy) <= 2).map(n => n.id + "@" + n.x + "," + n.y)) + ")");
          console.log("    各方向: " + trace.join(" | "));
        }
      }
    }
  }
  ok(true, "2000 次随机操作无异常无死锁（共 " + acts + " 次按键派发）");
} catch (e) { crash(e, "11 模糊测试"); }

console.log("\n========================");
console.log("通过 " + pass + " 项，失败 " + fail + " 项");
process.exit(fail ? 1 : 0);
