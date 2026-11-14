/* =========================================================================
 * engine.js —— 引擎核心
 *
 * 对应经典引擎的运行时部分：主循环、输入、地图行走/碰撞、镜头跟随、
 * 对话 UI、场景切换、随机遇敌（≈ RNG 场景遭遇机制）、音频、存档。
 * 分辨率致敬经典 320×200，整数倍放大显示。
 * ========================================================================= */
"use strict";

const VW = 320, VH = 200;            // 虚拟分辨率
const VIEW_TW = VW / TILE;           // 视口瓦片列数 20
const VIEW_TH = VH / TILE;           // 视口行数 12.5

/* ---------------- 全局游戏状态 ---------------- */
const GS = {
  mode: "title",                     // title/walk/dialog/shop/status/battle/gameover/ending/menu
  sceneId: "village",
  scene: null,
  px: 0, py: 0,                      // 玩家像素位置（精灵左上角）
  dir: 0,                            // 0下 1左 2右 3上
  moving: false, frame: 0, animT: 0,
  party: [],                         // 队伍成员（Actor）
  gold: 40,
  items: {},                        // {itemId: count}
  flags: {},
  steps: 0, encounterMeter: 0,
  followers: [],                     // 跟随者位置历史（沈月跟随）
  keys: {},
  tick: 0,
  musicOn: true
};

/* ---------------- 角色构造（≈ DATA.MKF 的角色定义实例化） -------- */
function makeActor(id) {
  const base = Data.LEVELS.party[id];
  const a = {
    id, name: base.name, title: base.title,
    level: base.level, xp: base.xp,
    maxHp: base.hp, hp: base.hp,
    maxMp: base.mp, mp: base.mp,
    atk: base.atk, def: base.def, spd: base.spd,
    magic: base.magic.slice()
  };
  return a;
}

/* ---------------- 主循环 ---------------- */
let cvs, ctx, scale = 3, rafLast = 0;

function boot() {
  cvs = document.getElementById("screen");
  ctx = cvs.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", () => { GS.keys = {}; });   // 失焦清键，防止卡键
  window.addEventListener("resize", fitScale);
  /* 鼠标/触摸：标题开始、对话确认（点击对输入法与触屏友好） */
  cvs.addEventListener("mousedown", () => {
    Audio.unlock();
    if (GS.mode === "title") mainStart(false);
    else if (GS.mode === "dialog") dialogKey(" ");
  });
  buildPat(); buildMgo(); fitScale();
  /* 高清美术资产异步加载：完成前/失败时自动用程序化像素画渲染 */
  if (typeof buildArt === "function") buildArt().catch(() => {});
  requestAnimationFrame(loop);
}

function fitScale() {
  const w = Math.max(1, Math.floor(window.innerWidth / VW));
  const h = Math.max(1, Math.floor(window.innerHeight / VH));
  scale = Math.max(1, Math.min(w, h));
  cvs.style.width = VW * scale + "px";
  cvs.style.height = VH * scale + "px";
}

function loop(ts) {
  const dt = Math.min(50, ts - rafLast); rafLast = ts;
  GS.tick += dt;
  try {
    update(dt);
    render();
  } catch (err) {           /* 兜底：任何异常都不让画面彻底冻结 */
    console.error(err);
    try {
      ctx.fillStyle = "#000"; ctx.fillRect(0, 0, VW, VH);
      text("引擎异常：" + err.message, 12, 90, "#e08080");
      text("按 F5 刷新页面重试", 12, 104, "#a0a0b0");
    } catch (_) {}
  }
  requestAnimationFrame(loop);
}

function update(dt) {
  switch (GS.mode) {
    case "title": break;
    case "walk":  updateWalk(dt); break;
    case "menu":  if (Menu.msgT > 0) Menu.msgT -= dt; break;
    case "shop":  if (Shop.msgT > 0) Shop.msgT -= dt; break;
    case "dialog": updateDialog(dt); break;
    case "battle": Battle.update(dt); break;
  }
  Audio.update(dt);
}

/* ---------------- 场景与行走 ---------------- */
function enterScene(id, pos) {
  GS.sceneId = id;
  GS.scene = Maps.scenes[id];
  /* pos 为“脚底所在瓦片”坐标：精灵上左角 = 瓦片位置 − (8, 8)，
   * 使 py+20 / px+8 的脚底判定正好落在目标瓦片上 */
  if (pos) { GS.px = pos[0] * TILE - 8; GS.py = pos[1] * TILE - 8; }
  GS.encounterMeter = 0;
  /* 预置跟随者轨迹：入队/切场景后沈月立刻站在主角身后，
   * 而不是要等走满 17 帧才出现。方向决定"身后"的偏移。 */
  GS.followers = [];
  const back = { 0:[0,-10], 1:[10,0], 2:[-10,0], 3:[0,10] }[GS.dir || 0];
  for (let i = 0; i < 24; i++) GS.followers.push([GS.px + back[0], GS.py + back[1], GS.dir || 0]);
  GS.pendingBossShown = false;
  /* 宝箱外观重置：先恢复原始地图，再按旗标重放已开启的宝箱。
   * 旧实现只在"有 flag"时改 C→c，从不反向恢复 —— 读旧档或开新游戏后，
   * 已经开过的宝箱会永久保持开启外观。 */
  if (Maps.pristine && Maps.pristine[id]) GS.scene.map = Maps.pristine[id].slice();
  /* 恢复已开启的宝箱外观（存档载入/切场景时） */
  for (const key in GS.flags) {
    const m = key.match(/^chest_(.+):(\d+):(\d+)$/);
    if (m && m[1] === id) {
      const row = GS.scene.map[+m[3]];
      GS.scene.map[+m[3]] = row.slice(0, +m[2]) + "c" + row.slice(+m[2] + 1);
    }
  }
  Audio.play(GS.scene.music);
}

function tileAt(tx, ty) {
  const sc = GS.scene;
  if (ty < 0 || ty >= sc.map.length || tx < 0 || tx >= sc.map[0].length) return "T";
  return sc.map[ty][tx];
}

function solidAt(tx, ty) {
  const t = TILES[tileAt(tx, ty)];
  return t ? t.solid : true;
}

function isWater(tx, ty) {
  const t = TILES[tileAt(tx, ty)];
  return t && t.water;
}

/* NPC 占位也视为实体（不能穿人） */
function npcAt(tx, ty) {
  for (const n of (GS.scene.npcs || []))
    if (n.x === tx && n.y === ty && !(n.id === "yue" && GS.flags.joined)) return n;
  return null;
}

function updateWalk(dt) {
  const speed = 0.11 * dt;                    // 像素/毫秒 ≈ 110px/s
  let dx = 0, dy = 0;
  if (GS.keys.ArrowLeft  || GS.keys.a) dx -= 1;
  if (GS.keys.ArrowRight || GS.keys.d) dx += 1;
  if (GS.keys.ArrowUp    || GS.keys.w) dy -= 1;
  if (GS.keys.ArrowDown  || GS.keys.s) dy += 1;
  if (dx && dy) dy = 0;                      // 不斜走（经典风）

  if (dx || dy) {
    GS.dir = dx < 0 ? 1 : dx > 0 ? 2 : dy < 0 ? 3 : 0;
    const nx = GS.px + dx * speed, ny = GS.py + dy * speed;
    /* 碰撞盒：精灵脚底 16×8 */
    const cx = dx > 0 ? nx + 16 : nx, cy = dy > 0 ? ny + 22 : ny + 16;
    const tx = Math.floor((dx ? cx : GS.px + 8) / TILE);
    const ty = Math.floor((dy ? cy : GS.py + 20) / TILE);
    const blocked = solidAt(tx, ty) || isWater(tx, ty) || !!npcAt(tx, ty);
    if (!blocked) {
      GS.px = nx; GS.py = ny; GS.moving = true;
      GS.animT += dt;
      /* 遇敌计数（≈ RNG 遭遇机制） */
      if (GS.scene.encounterRate) {
        GS.encounterMeter += GS.scene.encounterRate * dt / 16;
        if (GS.encounterMeter > 24 + Math.random() * 24) {
          GS.encounterMeter = 0;
          startEncounter();
          return;
        }
      }
    } else GS.moving = false;
  } else { GS.moving = false; GS.animT = 0; }

  /* 跟随者（沈月）：只在移动时记录轨迹。
   * 旧实现每帧无条件入队，站住不动时轨迹全是同一坐标，
   * 沈月会与主角完全重叠（看起来像少了一个人）。 */
  if (GS.moving) {
    GS.followers.unshift([GS.px, GS.py, GS.dir]);
    if (GS.followers.length > 40) GS.followers.pop();
  }

  checkTileEvents();
}

function checkTileEvents() {
  const fx = Math.floor((GS.px + 8) / TILE), fy = Math.floor((GS.py + 20) / TILE);
  const here = tileAt(fx, fy);
  /* 出口 */
  for (const e of (GS.scene.exits || []))
    if (e.x === fx && e.y === fy) { enterScene(e.to, e.toPos); return; }
  /* 特殊瓦片（洞口等） */
  for (const t of (GS.scene.tileEvents || []))
    if (t.tile === here) { enterScene(t.to, t.toPos); return; }
  /* Boss 触发（走近界碑即触发，击败后不再触发） */
  const boss = GS.scene.boss;
  if (boss && !GS.flags.bossDefeated && !GS.pendingBossShown) {
    if (Math.abs(fx - boss.x) + Math.abs(fy - boss.y) <= 1) {
      GS.pendingBossShown = true;
      startDialog([{ name:"", text:"寒气骤起，一团白影自洞窟深处掠来——" },
                   { name:"白霜妖狐", text:"好大的胆子，敢闯我的洞府！" }]);
      GS.pendingBoss = true;
    }
  }
}

/* 交互（空格/回车） */
function interact() {
  const fx = Math.floor((GS.px + 8) / TILE), fy = Math.floor((GS.py + 20) / TILE);
  const probe = { 0:[0,1], 1:[-1,0], 2:[1,0], 3:[0,-1] }[GS.dir];
  const tx = fx + probe[0], ty = fy + probe[1];
  /* NPC？ */
  for (const n of (GS.scene.npcs || [])) {
    if (n.x === tx && n.y === ty) { faceNpc(n); runSceneEvent(n.id); return; }
    if (n.x === fx && n.y === fy) { runSceneEvent(n.id); return; }  // 踩到头顶也算
  }
  /* 宝箱？ */
  if (tileAt(tx, ty) === "C") { openChest(tx, ty); return; }
  /* 招牌？ */
  if (tileAt(tx, ty) === "S") {
    startDialog([{ name:"", text:"『落霞村』——村口的老木牌，字迹已经斑驳。" }]); return;
  }
  if (tileAt(tx, ty) === "s") {
    startDialog([{ name:"", text:"界碑刻着古字：霜窟有主，止步。" }]); return;
  }
  /* 门（进屋提示） */
  if (TILES[tileAt(tx, ty)] && TILES[tileAt(tx, ty)].door) {
    startDialog([{ name:"", text:"屋里传来药香与炉火的暖意。" }]); return;
  }
}

function faceNpc(n) { n.dir = { 0:3, 3:0, 1:2, 2:1 }[n.dir != null ? n.dir : 0]; }

function openChest(tx, ty) {
  const key = GS.sceneId + ":" + tx + ":" + ty;
  if (GS.flags["chest_" + key]) return;
  const loot = Script.chests[key];
  if (!loot) { startDialog([{ name:"", text:"空空如也。" }]); return; }
  GS.flags["chest_" + key] = true;
  if (loot.gold) GS.gold += loot.gold;
  if (loot.item) GS.items[loot.item] = (GS.items[loot.item] || 0) + loot.n;
  const row = Maps.scenes[GS.sceneId].map[ty];
  Maps.scenes[GS.sceneId].map[ty] = row.slice(0, tx) + "c" + row.slice(tx + 1);
  startDialog([{ name:"", text: loot.text || "得到了东西。" }]);
}

/* ---------------- 事件执行（≈ SSS 剧本解释器） ---------------- */
function runSceneEvent(npcId) {
  const ev = (Script.events[GS.sceneId] || {})[npcId];
  if (!ev) { startDialog([{ name:"", text:"……" }]); return; }
  const out = ev(GS);
  const steps = Array.isArray(out) ? out : [out];
  runEventSteps(steps);
}

function runEventSteps(steps) {
  GS.eventQueue = steps.slice();
  nextEventStep();
}

function nextEventStep() {
  if (GS.pendingBoss) { GS.pendingBoss = false; Battle.start([Data.ENEMIES.fox], true); return; }
  const st = GS.eventQueue && GS.eventQueue.shift();
  if (!st) { GS.mode = "walk"; return; }
  if (st.type === "talk") { startDialog(st.lines); }
  else if (st.type === "run") {
    const msg = st.fn(GS);
    if (msg) startDialog([{ name:"", text: msg }]);
    else nextEventStep();
  }
  else if (st.type === "shop") { openShop(); }
  else if (st.type === "ending") { GS.mode = "ending"; }
}

/* ---------------- 对话系统 ---------------- */
const Dlg = { lines: [], idx: 0, chars: 0, done: false };

function startDialog(lines) {
  Dlg.lines = lines; Dlg.idx = 0; Dlg.chars = 0; Dlg.done = false;
  GS.mode = "dialog";
}

function updateDialog(dt) {
  const line = Dlg.lines[Dlg.idx];
  if (!line) { GS.mode = "walk"; nextEventStep(); return; }
  if (Dlg.chars < line.text.length) {
    Dlg.chars += dt / 22;
    if (Dlg.chars > line.text.length) Dlg.chars = line.text.length;
  }
}

/* 对话翻页/跳字：纯事件驱动（onKeyDown 分发），不受帧率与输入法影响 */
function dialogKey(k) {
  if (k !== " " && k !== "Enter") return;
  const line = Dlg.lines[Dlg.idx];
  if (!line) return;
  if (Dlg.chars < line.text.length) Dlg.chars = line.text.length;   // 第一下：跳过打字机
  else {                                                             // 第二下：翻页
    Dlg.idx++; Dlg.chars = 0;
    if (Dlg.idx >= Dlg.lines.length) { GS.mode = "walk"; nextEventStep(); }
  }
}

/* ---------------- 商店 ---------------- */
/* 商店：货单之外多一项"疗伤"服务（NPC 台词承诺过"买药还是疗伤"）。
 * 购买失败必须有反馈 —— 旧实现钱不够时静默返回，玩家会以为按键失灵。 */
const Shop = { sel: 0, msg: "", msgT: 0, HEAL_PRICE: 15 };

function openShop() { Shop.sel = 0; Shop.msg = ""; Shop.msgT = 0; GS.mode = "shop"; }
function shopMsg(s) { Shop.msg = s; Shop.msgT = 1800; }

function shopKey(k) {
  const goods = Script.shopGoods;
  const n = goods.length + 1;                    // +1 = 疗伤服务
  if (k === "ArrowUp" || k === "w") Shop.sel = (Shop.sel + n - 1) % n;
  else if (k === "ArrowDown" || k === "s") Shop.sel = (Shop.sel + 1) % n;
  else if (k === "Escape") GS.mode = "walk";
  else if (k === " " || k === "Enter") {
    if (Shop.sel >= goods.length) { healParty(); return; }
    const g = goods[Shop.sel];
    if (GS.gold >= g.price) {
      GS.gold -= g.price;
      GS.items[g.item] = (GS.items[g.item] || 0) + 1;
      Audio.blip();
      shopMsg("买下了" + Data.ITEMS[g.item].name + "。");
    } else {
      shopMsg("钱不够（还差 " + (g.price - GS.gold) + " 文）。");
    }
  }
}

/* 疗伤：全体回满，按人数计价；血满时婉拒并退款提示 */
function healParty() {
  const hurt = GS.party.filter(a => a.hp < a.maxHp);
  if (!hurt.length) { shopMsg("各位都精神得很，不用疗伤。"); return; }
  const cost = Shop.HEAL_PRICE * GS.party.length;
  if (GS.gold < cost) { shopMsg("疗伤要 " + cost + " 文，钱不够。"); return; }
  GS.gold -= cost;
  GS.party.forEach(a => { a.hp = a.maxHp; a.mp = a.maxMp; });
  Audio.blip();
  shopMsg("药到病除，全员生命与真气已复原（-" + cost + " 文）。");
}

/* ---------------- 状态栏 ---------------- */
/* 纯事件驱动：任何按键退出（onKeyDown 的 status 分支） */

/* ---------------- 遇敌 ---------------- */
function startEncounter() {
  const forms = GS.scene.formations;
  const f = Data.FORMATIONS[forms[Math.floor(Math.random() * forms.length)]];
  const enemies = f.map(id => Data.ENEMIES[id]);
  Battle.start(enemies, false);
}

/* ---------------- 输入 ---------------- */
/* 关键设计：所有"确认/翻页/菜单"动作都在 keydown 事件里即时处理，
 * 不做每帧轮询 —— 避免快速点按落在两帧之间被吞掉。
 * 键名统一用物理键码 e.code 归一化：中文输入法会把 e.key 报告为
 * "Process"，但 e.code 始终是真实物理键（Space/KeyA/...），对输入法免疫。 */
const CODE_ALIASES = {
  Space:" ", Enter:"Enter", NumpadEnter:"Enter", Escape:"Escape", Tab:"Tab",
  ArrowUp:"ArrowUp", ArrowDown:"ArrowDown", ArrowLeft:"ArrowLeft", ArrowRight:"ArrowRight",
  KeyW:"w", KeyA:"a", KeyS:"s", KeyD:"d", KeyN:"n", KeyC:"c", KeyI:"i",
  KeyL:"l", KeyX:"x"
};
function normKey(e) { return CODE_ALIASES[e.code] || e.key; }

function onKeyDown(e) {
  const k = normKey(e);
  GS.keys[k] = true;
  Audio.unlock();
  if (k === " " || k === "Tab" || k.indexOf("Arrow") === 0) e.preventDefault();
  if (e.repeat) return;                    // 菜单/对话不接受按键自动重复
  switch (GS.mode) {
    case "walk":
      if (k === " " || k === "Enter") interact();
      else if (k === "Tab" || k === "i") GS.mode = "status";
      else if (k === "n") GS.musicOn = !GS.musicOn;
      else if (k === "Escape") openSaveMenu();
      break;
    case "menu":    menuKey(k); break;
    case "dialog":  dialogKey(k); break;
    case "shop":    shopKey(k); break;
    case "status":  GS.mode = "walk"; break;
    case "battle":  Battle.key(k); break;
    case "title":
      if (k === "Enter" || k === " ") mainStart(false);
      else if (k === "c") mainStart(true);
      break;
    case "ending":  GS._endReq = true; break;
  }
}

function onKeyUp(e) {
  const k = normKey(e);
  GS.keys[k] = false;
}

/* ---------------- 渲染：主分发 ---------------- */
/* 高清渲染：逻辑坐标仍是 320×200，主画布按 RS 倍采样。
 * 每帧先把变换矩阵设为 RS 倍缩放，之后所有绘制代码（瓦片/精灵/UI/文字）
 * 继续用虚拟单位，无需改动即可渲染到高清画布。 */
function render() {
  ctx.setTransform(RS, 0, 0, RS, 0, 0);
  ctx.fillStyle = "#000"; ctx.fillRect(0, 0, VW, VH);
  switch (GS.mode) {
    case "title":   renderTitle(); break;
    case "battle":  Battle.render(); break;
    case "ending":  renderEnding(); break;
    case "menu":    renderWalk(); renderHud(); renderSaveMenu(); break;
    default:        renderWalk(); renderHud();
  }
}

/* ---------------- 渲染：地图 ---------------- */
function renderWalk() {
  const sc = GS.scene;
  if (!sc) return;
  const w = mapSize(sc).w, h = mapSize(sc).h;
  /* 镜头：跟随玩家并夹在地图范围内 */
  let camX = GS.px + 8 - VW / 2, camY = GS.py + 12 - VH / 2;
  camX = Math.max(0, Math.min(w * TILE - VW, camX));
  camY = Math.max(0, Math.min(h * TILE - VH, camY));
  const ox = Math.floor(camX), oy = Math.floor(camY);
  const tx0 = Math.floor(ox / TILE), ty0 = Math.floor(oy / TILE);

  /* 瓦片层：优先高清美术资产，未就绪/缺失时回退程序化像素画 */
  const waterFrame = Math.floor(GS.tick / 400) % 2;
  for (let ty = ty0; ty <= ty0 + VIEW_TH + 1; ty++) {
    for (let tx = tx0; tx <= tx0 + VIEW_TW + 1; tx++) {
      const ch = tileAt(tx, ty), t = TILES[ch];
      if (!t) continue;
      const pat = t.pat === "water" ? "water" + waterFrame : t.pat;
      /* 资产清单键全小写（chestopen），TILES 表用驼峰（chestOpen）：两键都查 */
      const hd = Art.tiles[pat] || Art.tiles[pat.toLowerCase()];
      if (hd) {                       // 高清贴图：已是 TILE*RS 物理像素，1:1 绘制
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(hd, tx * TILE - ox, ty * TILE - oy, TILE, TILE);
      } else {
        const img = Pat.tiles[pat];
        if (img) {
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(img, tx * TILE - ox, ty * TILE - oy, TILE, TILE);
        }
      }
    }
  }
  /* 排序绘制 NPC 与玩家（按脚 y）；入队后的沈月不再站在原地 */
  const actors = (sc.npcs || []).filter(n => !(n.id === "yue" && GS.flags.joined))
    .map(n => ({ x: n.x * TILE, y: n.y * TILE - 8,
                 spr: actorSprite(n.char, n.dir || 0, 0), name: n.name }));
  actors.push({ x: GS.px, y: GS.py, spr: playerSprite(), isPlayer: true });
  if (GS.party.length > 1 && GS.followers.length > 16) {
    const f = GS.followers[16];
    actors.push({ x: f[0], y: f[1], spr: actorSprite("yue", f[2], 0) });
  }
  actors.sort((a, b) => a.y - b.y);
  for (const a of actors) {
    ctx.imageSmoothingEnabled = !!(a.spr && a.spr._hd);
    /* 必须显式指定虚拟尺寸：高清精灵画布是 SPR_*×RS 物理像素，
     * 主画布又带 RS 倍变换，省略宽高会把角色画大 3 倍 */
    ctx.drawImage(a.spr, Math.round(a.x - ox), Math.round(a.y - oy), SPR_W, SPR_H);
  }
  /* NPC 名笺：头顶小字（高清下保持可读） */
  if (Art.ready) {
    for (const n of (sc.npcs || [])) {
      if (n.id === "yue" && GS.flags.joined) continue;
      const ax = n.x * TILE - ox, ay = n.y * TILE - 8 - oy;
      const w = ctx.measureText(n.name).width + 8;
      ctx.fillStyle = "#00000070";
      ctx.fillRect(ax + (SPR_W - w) / 2, ay - 12, w, 11);
      text(n.name, ax + (SPR_W - w) / 2 + 4, ay - 10, "#ffe8b0", "7px sans-serif");
    }
  }

  /* 对话框 */
  if (GS.mode === "dialog") renderDialog();
  if (GS.mode === "shop") renderShop();
  if (GS.mode === "status") renderStatus();
  if (GS.mode === "gameover") renderGameOver();
}

/* 角色精灵取用：高清层优先（带 _hd 标记供平滑开关判断），否则程序化像素画 */
function actorSprite(role, dir, frame) {
  const hd = Art.sprites[role] && Art.sprites[role][dir];
  if (hd) return hd[frame];
  return Mgo.sprites[role][dir][frame];
}

function playerSprite() {
  const f = GS.moving ? (Math.floor(GS.animT / 140) % 2 ? 1 : 2) : 0;
  return actorSprite("hero", GS.dir, f);
}

/* ---------------- 渲染：UI ---------------- */
/* 对话框/面板：深色渐变底 + 烫金双描边（高清画布下保持精致质感） */
function uiBox(x, y, w, h) {
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, "rgba(24,24,44,0.92)");
  g.addColorStop(1, "rgba(10,10,22,0.96)");
  ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = "rgba(255,240,200,0.06)"; ctx.fillRect(x + 2, y + 2, w - 4, 1);
  ctx.strokeStyle = "#d8c890"; ctx.lineWidth = 1;
  ctx.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);
  ctx.strokeStyle = "#6a5a3a";
  ctx.strokeRect(x + 3.5, y + 3.5, w - 7, h - 7);
}

function text(s, x, y, col, font) {
  ctx.fillStyle = col || "#f0ead0";
  ctx.font = font || "9px 'Courier New', monospace";
  ctx.textBaseline = "top";
  ctx.fillText(s, x, y);
}

function renderDialog() {
  const line = Dlg.lines[Dlg.idx];
  if (!line) return;
  uiBox(8, VH - 62, VW - 16, 54);
  if (line.name) text("【" + line.name + "】", 16, VH - 56);
  const shown = line.text.slice(0, Math.floor(Dlg.chars));
  wrapText(shown, 16, VH - 44, VW - 32);
  if (Dlg.chars >= line.text.length) {
    const blink = Math.floor(GS.tick / 300) % 2;
    if (!blink) text("▼", VW - 24, VH - 16, "#d8c890");
  }
}

function wrapText(s, x, y, w) {
  /* 简易中日文换行：按字符测量 */
  let line = "", cy = y;
  for (const ch of s) {
    if (ch === "\n") { text(line, x, cy); line = ""; cy += 12; continue; }
    line += ch;
    if (ctx.measureText(line).width > w) { text(line, x, cy); line = ch; cy += 12; }
  }
  if (line) text(line, x, cy);
}

function renderShop() {
  const goods = Script.shopGoods;
  uiBox(20, 14, 280, 148);
  text("百草堂 · 药铺（金 " + GS.gold + " 文）", 30, 22);
  goods.forEach((g, i) => {
    const it = Data.ITEMS[g.item];
    const sel = i === Shop.sel;
    if (sel) { ctx.fillStyle = "#3a3a58"; ctx.fillRect(28, 34 + i * 14, 246, 13); }
    text((sel ? "▶" : " ") + it.name, 32, 36 + i * 14, sel ? "#ffe89a" : "#f0ead0");
    text(g.price + " 文 ×" + (GS.items[g.item] || 0), 210, 36 + i * 14, "#a8b8d8");
  });
  /* 疗伤服务行 */
  const hy = 34 + goods.length * 14;
  const hsel = Shop.sel >= goods.length;
  if (hsel) { ctx.fillStyle = "#3a3a58"; ctx.fillRect(28, hy, 246, 13); }
  text((hsel ? "▶" : " ") + "疗伤（全体复原）", 32, hy + 2, hsel ? "#ffe89a" : "#b8e0b8");
  text(Shop.HEAL_PRICE + " 文/人", 210, hy + 2, "#a8b8d8");
  text("空格=购买/疗伤  Esc=离开", 32, 140, "#8a8aa0");
  if (Shop.msgT > 0 && Shop.msg) text(Shop.msg, 32, 152, "#90e0a0");
}

function renderStatus() {
  uiBox(20, 14, 280, 172);
  text("· 状 态 ·", 130, 22, "#ffe89a");
  GS.party.forEach((a, i) => {
    const y = 38 + i * 46;
    text(a.name + "（" + a.title + "） Lv" + a.level, 32, y);
    text("生命 " + a.hp + "/" + a.maxHp, 32, y + 12,
         a.hp < a.maxHp / 4 ? "#e08080" : "#f0ead0");
    text("真气 " + a.mp + "/" + a.maxMp, 130, y + 12, "#a8c8f0");
    text("攻 " + a.atk + "  防 " + a.def + "  敏 " + a.spd, 210, y + 12);
    text("法术：" + a.magic.map(m => Data.MAGIC[m].name).join("、"), 32, y + 24, "#c8b8e8");
  });
  const its = Object.keys(GS.items).filter(k => GS.items[k] > 0);
  text("物品：" + (its.map(k => Data.ITEMS[k].name + "×" + GS.items[k]).join(" ") || "无"),
       32, 130, "#f0ead0");
  text("金钱：" + GS.gold + " 文", 32, 144, "#ffe89a");
  text("按任意键返回", 32, 166, "#8a8aa0");
}

function renderHud() {
  /* 左上角迷你地名条 */
  ctx.fillStyle = "#000000a0"; ctx.fillRect(0, 0, VW, 11);
  text(GS.scene.name + "   金 " + GS.gold + "   Lv" + (GS.party[0] ? GS.party[0].level : 1),
       4, 2, "#d8c890");
}

function renderGameOver() {
  ctx.fillStyle = "#100408"; ctx.fillRect(0, 0, VW, VH);
  text("· 全 体 覆 没 ·", 112, 76, "#e06060");
  text("按空格回到落霞村", 104, 100, "#a8a8b0");
}

/* ---------------- 标题 / 结局 ---------------- */
function renderTitle() {
  /* 高清标题背景（AI 生成）；未就绪时回退程序化落日 */
  const bg = Art.bg.title;
  if (bg) {
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(bg, 0, 0, VW, VH);
  } else {
    const g = ctx.createLinearGradient(0, 0, 0, VH);
    g.addColorStop(0, "#1a1030"); g.addColorStop(0.55, "#4a2450"); g.addColorStop(1, "#c05838");
    ctx.fillStyle = g; ctx.fillRect(0, 0, VW, VH);
    ctx.fillStyle = "#e8a848";
    ctx.beginPath(); ctx.arc(240, 118, 34, 0, 7); ctx.fill();
    ctx.fillStyle = "#2a1430";
    ctx.beginPath(); ctx.moveTo(0, 150);
    ctx.lineTo(50, 96); ctx.lineTo(96, 140); ctx.lineTo(140, 86);
    ctx.lineTo(200, 150); ctx.lineTo(320, 120); ctx.lineTo(320, 200); ctx.lineTo(0, 200);
    ctx.fill();
  }
  /* 顶部/底部压暗，保证文字可读 */
  const shade = ctx.createLinearGradient(0, 0, 0, VH);
  shade.addColorStop(0, "rgba(8,6,20,0.55)");
  shade.addColorStop(0.45, "rgba(8,6,20,0.05)");
  shade.addColorStop(1, "rgba(8,6,20,0.65)");
  ctx.fillStyle = shade; ctx.fillRect(0, 0, VW, VH);
  /* 标题匾额 */
  uiBox(58, 22, 204, 46);
  text("落 霞 剑 缘", 96, 30, "#ffe8c0", "bold 26px 'Courier New', monospace");
  text("—— 经典 J-RPG 引擎复刻 · 原创致敬版 ——", 30, 62, "#d8b8e8");
  const blink = Math.floor(GS.tick / 500) % 2;
  if (!blink) text("回车 / 空格 开始新游戏      C 继续游戏", 52, 168, "#fff");
  text("机制致敬 · 内容全部原创", 84, 184, "#b09090");
}

function renderEnding() {
  ctx.fillStyle = "#0a0a18"; ctx.fillRect(0, 0, VW, VH);
  text("雪莲入药，师父痊愈。", 100, 60, "#f0ead0");
  text("雾隐洞的妖雾散了，青枫岭的枫叶正红。", 46, 80, "#f0ead0");
  text("· 谨以此复刻引擎，致敬一个时代 ·", 46, 120, "#d8c890");
  text("【 完 】", 140, 150, "#ffe89a");
}

/* =========================================================================
 * Audio —— 极简 WebAudio 芯片音乐（原创小曲，程序合成方波/三角波）
 * ========================================================================= */
const Audio = {
  ctx: null, gain: null, unlocked: false,
  song: null, seqT: 0, idx: 0, noteT: 0,
  /* 原创五声音阶小曲（音名, 八度, 时值)。全部为本项目自谱。 */
  songs: {
    village: { tempo: 190, mel: [
      ["G4",2],["A4",2],["C5",2],["A4",2],["G4",4],[null,2],
      ["E4",2],["G4",2],["A4",4],[null,2],
      ["A4",2],["C5",2],["D5",2],["E5",2],["D5",4],[null,2],
      ["C5",2],["A4",2],["G4",6],[null,2] ] },
    field: { tempo: 170, mel: [
      ["C5",1],["D5",1],["E5",2],["G5",2],["E5",2],["D5",2],["C5",2],["A4",2],
      ["G4",2],["A4",1],["C5",1],["D5",2],[null,2],
      ["E5",1],["D5",1],["C5",2],["A4",2],["G4",4],[null,2] ] },
    cave: { tempo: 150, mel: [
      ["A3",2],["C4",2],["E4",2],["D4",2],["C4",2],["A3",4],[null,2],
      ["E4",2],["D4",2],["C4",2],["D4",2],["A3",6],[null,2] ] },
    battle: { tempo: 210, mel: [
      ["A4",1],["A4",1],["C5",1],["E5",1],["D5",2],["C5",1],["D5",1],
      ["E5",2],["A4",2],["G4",2],["A4",2],[null,2] ] },
    boss: { tempo: 240, mel: [
      ["D4",1],["D5",1],["A4",1],["D5",1],["F5",1],["E5",1],["D5",1],["C5",1],
      ["A4",2],["G4",2],["F4",2],["G4",2],["A4",2],[null,1] ] }
  },
  freqs: (() => { const f = {}; "CDEFGAB".split("").forEach(n => f[n] = {});
    return f; })(),

  unlock() {
    if (this.unlocked) return;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.gain = this.ctx.createGain();
      this.gain.gain.value = 0.08;
      this.gain.connect(this.ctx.destination);
      this.unlocked = true;
    } catch (e) {}
  },
  play(name) { this.song = name ? this.songs[name] : null; this.idx = 0; this.noteT = 0; },
  noteFreq(n) {
    if (!n) return 0;                       // 休止符
    const names = { C:0, D:2, E:4, F:5, G:7, A:9, B:11 };
    const m = n.match(/^([A-G])(\d)$/);
    if (!m) return 0;
    const midi = 12 * (+m[2] + 1) + names[m[1]];
    return 440 * Math.pow(2, (midi - 69) / 12);
  },
  tone(freq, dur) {
    if (!freq) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = "square"; o.frequency.value = freq;
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.08, t + dur * 0.9);
    o.connect(g); g.connect(this.gain);
    o.start(t); o.stop(t + dur);
  },
  blip() { if (this.unlocked) this.tone(880, 0.06); },
  update(dt) {
    if (!this.unlocked || !GS.musicOn || !this.song) return;
    this.noteT -= dt / 1000;
    if (this.noteT > 0) return;
    const beat = 60 / this.song.tempo;
    const [n, len] = this.song.mel[this.idx];
    if (n) this.tone(this.noteFreq(n), beat * len * 0.9);  /* 休止符只占时值不发声 */
    this.noteT = beat * len;
    this.idx = (this.idx + 1) % this.song.mel.length;
  }
};

/* ---------------- 存档 ---------------- */
function saveGame() {
  try {
    localStorage.setItem("luoxia_save", JSON.stringify({
      sceneId: GS.sceneId, px: GS.px, py: GS.py,
      gold: GS.gold, items: GS.items, flags: GS.flags,
      party: GS.party
    }));
  } catch (e) {}
}
function loadGame() {
  try {
    const s = JSON.parse(localStorage.getItem("luoxia_save"));
    if (!s) return false;
    Object.assign(GS, { gold: s.gold, items: s.items, flags: s.flags, party: s.party });
    enterScene(s.sceneId, [s.px / TILE, s.py / TILE]);
    GS.px = s.px; GS.py = s.py;
    return true;
  } catch (e) { return false; }
}

/* ---------------- 多槽位手动存档（"menu" 模式，行走中按 Esc 呼出） --------
 * 与 saveGame() 自动存档相互独立：3 个手动槽，每槽 { meta, data }，
 * meta 供菜单列表显示，data 为完整恢复态（含朝向 dir）。键名 luoxia_slot1..3。 */
const Menu = { sel: 0, msg: "", msgT: 0 };

const SLOT_PREFIX = "luoxia_slot";
function slotMeta(i) {
  try {
    const s = JSON.parse(localStorage.getItem(SLOT_PREFIX + i));
    return s && s.meta ? s.meta : null;
  } catch (e) { return null; }
}
function saveSlot(i) {
  try {
    const p0 = GS.party[0] || {};
    const pack = {
      meta: { ts: Date.now(), sceneName: GS.scene ? GS.scene.name : "",
              level: p0.level || 1, gold: GS.gold, nParty: GS.party.length },
      data: { sceneId: GS.sceneId, px: GS.px, py: GS.py, dir: GS.dir,
              gold: GS.gold, items: GS.items, flags: GS.flags, party: GS.party }
    };
    localStorage.setItem(SLOT_PREFIX + i, JSON.stringify(pack));
    return true;
  } catch (e) { return false; }
}
function loadSlot(i) {
  try {
    const s = JSON.parse(localStorage.getItem(SLOT_PREFIX + i));
    if (!s || !s.data) return false;
    const d = s.data;
    Object.assign(GS, { gold: d.gold, items: d.items, flags: d.flags, party: d.party });
    enterScene(d.sceneId, [d.px / TILE, d.py / TILE]);
    GS.px = d.px; GS.py = d.py; GS.dir = d.dir || 0;
    return true;
  } catch (e) { return false; }
}
function deleteSlot(i) {
  try { localStorage.removeItem(SLOT_PREFIX + i); return true; }
  catch (e) { return false; }
}

function openSaveMenu() {
  Menu.sel = 0; Menu.msg = ""; Menu.msgT = 0;
  GS.mode = "menu";
  Audio.blip();
}
function setMenuMsg(s) { Menu.msg = s; Menu.msgT = 1600; }

function menuKey(k) {
  if (k === "Escape") { GS.mode = "walk"; return; }
  if (k === "ArrowUp" || k === "w")   { Menu.sel = (Menu.sel + 2) % 3; Audio.blip(); return; }
  if (k === "ArrowDown" || k === "s") { Menu.sel = (Menu.sel + 1) % 3; Audio.blip(); return; }
  if (k === "Enter" || k === " ") {
    if (saveSlot(Menu.sel + 1)) setMenuMsg("已存至槽位 " + (Menu.sel + 1));
    else setMenuMsg("存档失败（本地存储不可用）");
    Audio.blip();
    return;
  }
  if (k === "l") {
    if (!slotMeta(Menu.sel + 1)) { setMenuMsg("该槽位为空"); return; }
    if (loadSlot(Menu.sel + 1)) { GS.mode = "walk"; Audio.blip(); }
    else setMenuMsg("读档失败（数据损坏）");
    return;
  }
  if (k === "x") {
    if (slotMeta(Menu.sel + 1)) deleteSlot(Menu.sel + 1);
    setMenuMsg("已删除槽位 " + (Menu.sel + 1));
    return;
  }
}

function renderSaveMenu() {
  ctx.fillStyle = "rgba(0,0,0,0.45)"; ctx.fillRect(0, 0, VW, VH);
  uiBox(52, 30, 216, 142);
  text("· 存档 / 读档 ·", 118, 38, "#ffe89a");
  for (let i = 0; i < 3; i++) {
    const y = 56 + i * 26;
    const meta = slotMeta(i + 1);
    const sel = i === Menu.sel;
    if (sel) { ctx.fillStyle = "#3a3a58"; ctx.fillRect(60, y - 2, 200, 24); }
    text((sel ? "▶" : " ") + "槽位 " + (i + 1), 64, y, sel ? "#ffe89a" : "#f0ead0");
    if (meta) {
      const d = new Date(meta.ts);
      const pad = n => (n < 10 ? "0" : "") + n;
      text(meta.sceneName + " Lv" + meta.level + " 金" + meta.gold, 104, y + 11, "#a8b8d8");
      text(pad(d.getMonth() + 1) + "/" + pad(d.getDate()) + " " +
           pad(d.getHours()) + ":" + pad(d.getMinutes()), 190, y + 11, "#8a8aa0");
    } else {
      text("—— 空 ——", 104, y + 11, "#62627a");
    }
  }
  text("回车=存档  L=读档  X=删除  Esc=关闭", 64, 138, "#8a8aa0");
  if (Menu.msgT > 0 && Menu.msg) text(Menu.msg, 64, 152, "#90e0a0");
}
