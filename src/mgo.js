/* =========================================================================
 * mgo.js —— 角色行走精灵与战斗图素（架构角色 ≈ 经典引擎的 MGO.MKF / ABC.MKF）
 *
 * 复刻版不搬运原版人物素材：所有角色都是启动时程序化绘制的原创像素小人。
 * 每个角色 4 方向 × 3 帧（站立/迈步A/迈步B），尺寸 16×24。
 * ========================================================================= */
"use strict";

const Mgo = { sprites: {}, battle: {} };   // sprites[id][dir][frame] = canvas

/* 以矩形/像素为单位绘制小人的工具 */
function mgoCanvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  return c.getContext("2d");
}

function px(g, x, y, w, h, col) { g.fillStyle = col; g.fillRect(x, y, w, h); }

/* 生成一套 16×24 四方向行走帧。
 * spec: { skin, hair, cloth, cloth2, belt, trim } 调色板
 * frame: 0=站立 1=迈步A 2=迈步B; dir: 0=下 1=左 2=右 3=上 */
function mgoChar(spec, dir, frame) {
  const g = mgoCanvas(16, 24);
  const s = spec;
  const stepOff = frame === 1 ? 1 : frame === 2 ? -1 : 0;
  /* 腿（走动时前后错位） */
  px(g, 4, 19, 3, 5, s.cloth2);
  px(g, 9, 19, 3, 5, s.cloth2);
  px(g, 4, 23 - (frame === 1 ? 1 : 0), 3, 1, "#2b2b33");     // 鞋
  px(g, 9, 23 - (frame === 2 ? 1 : 0), 3, 1, "#2b2b33");
  if (frame === 1) px(g, 9, 18, 3, 1, s.cloth2);
  if (frame === 2) px(g, 4, 18, 3, 1, s.cloth2);
  /* 身体 */
  px(g, 3, 12, 10, 7, s.cloth);
  px(g, 3, 16, 10, 1, s.belt);
  px(g, 3, 12, 10, 1, s.trim);
  /* 手臂（依方向/帧摆动） */
  if (dir === 0) {           // 朝下：双臂垂在身前
    px(g, 2, 13 + stepOff, 2, 5, s.cloth);
    px(g, 12, 13 - stepOff, 2, 5, s.cloth);
    px(g, 2, 17 + stepOff, 2, 2, s.skin);
    px(g, 12, 17 - stepOff, 2, 2, s.skin);
  } else if (dir === 3) {    // 朝上
    px(g, 2, 13 - stepOff, 2, 5, s.cloth);
    px(g, 12, 13 + stepOff, 2, 5, s.cloth);
  } else {                    // 朝左/右：单臂摆
    const front = dir === 1 ? 2 : 12;
    px(g, front, 13 + stepOff, 2, 5, s.cloth);
    px(g, front, 17 + stepOff, 2, 2, s.skin);
  }
  /* 头 */
  px(g, 4, 4, 8, 7, s.skin);
  px(g, 3, 3, 10, 2, s.hair);
  px(g, 3, 5, 2, 3, s.hair);
  px(g, 11, 5, 2, 3, s.hair);
  if (dir === 0) {           // 脸
    px(g, 5, 8, 1, 1, "#22222a");
    px(g, 10, 8, 1, 1, "#22222a");
    px(g, 6, 10, 4, 1, "#c46a5a");
  } else if (dir === 3) {    // 后脑勺
    px(g, 4, 5, 8, 5, s.hair);
  } else if (dir === 1) {    // 左脸
    px(g, 5, 8, 1, 1, "#22222a");
    px(g, 11, 5, 2, 6, s.hair);
  } else {                   // 右脸
    px(g, 10, 8, 1, 1, "#22222a");
    px(g, 3, 5, 2, 6, s.hair);
  }
  /* 剑客配剑（朝左/右时背在身后） */
  if (s.sword && (dir === 1 || dir === 2)) {
    const bx = dir === 1 ? 13 : 1;
    px(g, bx, 8, 1, 8, "#c8c8d4");
    px(g, bx, 16, 1, 2, "#8a5a36");
  }
  return g.canvas;
}

function buildMgo() {
  const cast = {
    /* 两位队员 */
    hero:  { skin:"#e8b890", hair:"#241c14", cloth:"#2a4a8a", cloth2:"#1c3058", belt:"#8a5a36", trim:"#7ab0e8", sword:true },
    yue:   { skin:"#f0c8a0", hair:"#3a2414", cloth:"#b0485a", cloth2:"#7c2c3c", belt:"#d8b04a", trim:"#f0a8b8" },
    /* 村民 NPC */
    master:{ skin:"#e0b088", hair:"#d8d8e0", cloth:"#6a5a9a", cloth2:"#4c3e74", belt:"#8a5a36", trim:"#c8b8f0" },
    smith: { skin:"#d8a878", hair:"#2c2018", cloth:"#5a5a66", cloth2:"#3c3c46", belt:"#26262e", trim:"#8a8a96" },
    doc:   { skin:"#e8c8a8", hair:"#88846a", cloth:"#3c6a4c", cloth2:"#2a4c38", belt:"#8a5a36", trim:"#a8d8b0" },
    kid:   { skin:"#f0c8a0", hair:"#141210", cloth:"#e8a84a", cloth2:"#b07c2c", belt:"#7c5424", trim:"#f8e8b8" },
    yue2:  { skin:"#f0c8a0", hair:"#3a2414", cloth:"#b0485a", cloth2:"#7c2c3c", belt:"#d8b04a", trim:"#f0a8b8" }
  };
  for (const id in cast) {
    Mgo.sprites[id] = {};
    for (let dir = 0; dir < 4; dir++)
      Mgo.sprites[id][dir] = [mgoChar(cast[id], dir, 0),
                               mgoChar(cast[id], dir, 1),
                               mgoChar(cast[id], dir, 2)];
  }
  buildBattleArt();
}

/* ---- 战斗敌人图素（程序化原创，24×24 / 32×32） ---- */
function buildBattleArt() {
  /* 山狼 */
  let g = mgoCanvas(24, 24);
  px(g, 3, 10, 18, 8, "#6a6a78");          // 身
  px(g, 5, 8, 12, 3, "#7a7a88");           // 背
  px(g, 18, 8, 5, 5, "#6a6a78");           // 头
  px(g, 22, 10, 2, 3, "#5a5a66");          // 吻
  px(g, 19, 6, 2, 3, "#5a5a66");           // 耳
  px(g, 20, 10, 1, 1, "#e04040");          // 眼
  px(g, 4, 17, 2, 6, "#5a5a66"); px(g, 9, 17, 2, 6, "#5a5a66");
  px(g, 14, 17, 2, 6, "#5a5a66"); px(g, 18, 17, 2, 6, "#5a5a66");
  px(g, 0, 11, 4, 3, "#7a7a88");           // 尾
  Mgo.battle.wolf = g.canvas;

  /* 野猪妖 */
  g = mgoCanvas(24, 24);
  px(g, 4, 9, 17, 11, "#8a6a52");
  px(g, 6, 7, 12, 3, "#9a7a5e");
  px(g, 18, 10, 6, 6, "#8a6a52");          // 头
  px(g, 23, 12, 1, 3, "#e8e8e0");          // 獠牙
  px(g, 19, 9, 2, 3, "#e8e8e0");           // 牙
  px(g, 21, 11, 1, 1, "#20c020");          // 眼
  px(g, 5, 19, 2, 5, "#6a4c3a"); px(g, 10, 19, 2, 5, "#6a4c3a");
  px(g, 15, 19, 2, 5, "#6a4c3a"); px(g, 19, 19, 2, 5, "#6a4c3a");
  px(g, 18, 8, 4, 2, "#d8a0a0");           // 耳
  Mgo.battle.boar = g.canvas;

  /* 洞蝠 */
  g = mgoCanvas(24, 24);
  px(g, 9, 8, 6, 9, "#4c3e5e");            // 身
  px(g, 10, 6, 4, 3, "#5c4c6e");
  px(g, 10, 9, 1, 1, "#e04040"); px(g, 13, 9, 1, 1, "#e04040");
  px(g, 2, 8, 8, 4, "#3c3050");            // 左翼
  px(g, 14, 8, 8, 4, "#3c3050");          // 右翼
  px(g, 4, 11, 5, 3, "#342a44");
  px(g, 15, 11, 5, 3, "#342a44");
  Mgo.battle.bat = g.canvas;

  /* 岩甲虫 */
  g = mgoCanvas(24, 24);
  px(g, 5, 10, 14, 10, "#8a8a78");
  px(g, 7, 8, 10, 3, "#9a9a86");
  px(g, 8, 12, 8, 2, "#6a6a58");          // 甲缝
  px(g, 4, 9, 2, 2, "#5a5a4a"); px(g, 18, 9, 2, 2, "#5a5a4a");
  px(g, 19, 13, 4, 4, "#9a9a86");          // 头
  px(g, 21, 14, 1, 1, "#20c020");
  px(g, 6, 19, 2, 4, "#5a5a4a"); px(g, 11, 19, 2, 4, "#5a5a4a");
  px(g, 15, 19, 2, 4, "#5a5a4a");
  Mgo.battle.beetle = g.canvas;

  /* Boss：白霜妖狐（32×32，三尾） */
  g = mgoCanvas(32, 32);
  px(g, 5, 14, 22, 10, "#e8e8f4");         // 身
  px(g, 8, 11, 15, 4, "#f4f4fa");         // 背毛
  px(g, 22, 10, 8, 8, "#e8e8f4");          // 头
  px(g, 29, 12, 3, 4, "#f4f4fa");          // 吻
  px(g, 23, 6, 2, 5, "#e8e8f4"); px(g, 27, 6, 2, 5, "#e8e8f4"); // 耳
  px(g, 24, 12, 1, 1, "#40c0f0"); px(g, 27, 12, 1, 1, "#40c0f0"); // 眼
  px(g, 0, 8, 6, 3, "#f4f4fa");            // 三条尾
  px(g, 0, 12, 6, 3, "#e8e8f4");
  px(g, 0, 16, 6, 3, "#d8d8e8");
  px(g, 7, 23, 3, 8, "#d8d8e6"); px(g, 13, 23, 3, 8, "#d8d8e6");
  px(g, 19, 23, 3, 8, "#d8d8e6");
  px(g, 23, 20, 4, 2, "#88c8f8");          // 雾气
  Mgo.battle.fox = g.canvas;
}
