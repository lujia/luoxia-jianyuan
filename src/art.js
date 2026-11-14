/* =========================================================================
 * art.js —— 高清美术资产层（AI 生成资产 + 程序化兜底）
 *
 * 架构角色：在原 PAT.MKF / MGO.MKF 复刻层之上增加「高清资产层」。
 * tiles/sprites/enemies/bg 四类图片在启动时异步加载（art_manifest.js 驱动，
 * 不用 fetch —— 保证 file:// 直接打开也能加载），加载期间与失败时游戏
 * 自动回退到原程序化像素画（Pat / Mgo），玩法完全不受影响。
 *
 * 高清渲染约定：
 *   虚拟坐标 320×200 不变，主画布按 RS 倍采样；绘制前统一
 *   ctx.setTransform(RS,0,0,RS,0,0)，游戏逻辑仍用虚拟单位。
 * ========================================================================= */
"use strict";

const RS = 3;                              // 渲染超采样倍率（逻辑像素 → 物理像素）
const POOL = "assets/";                    // 资产目录（相对 index.html）

/* 精灵/敌人在虚拟坐标中的尺寸（引擎据此绘制，均为原 MGO 比例的放大版） */
const SPR_W = 16, SPR_H = 24;              // 大地图角色行走精灵（同原版 16×24）
const PARTY_W = 24, PARTY_H = 36;          // 战斗画面我方队员（面向镜头的站立像）
const ENEMY_W = 40, ENEMY_H = 40;          // 战斗敌人立绘（原 24×24 的 1.6 倍）
const ENEMY_W_BOSS = 52, ENEMY_H_BOSS = 52;

const Art = {
  ready: false,                            // 全部资产就绪
  tiles: {},                               // name -> canvas（TILE*RS 物理像素）
  sprites: {},                             // role -> dir -> [canvas,canvas,canvas]
  party: {},                               // role -> dir -> canvas（战斗队员立绘）
  enemies: {},                             // name -> canvas（ENEMY_* * RS 物理像素）
  bg: {}                                   // name -> canvas（原图尺寸）
};

function artCanvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  c._hd = true;                       // 标记：引擎据此开关 drawImage 平滑
  return c;
}

function toCanvas(img) {
  const c = artCanvas(img.naturalWidth || img.width, img.naturalHeight || img.height);
  const g = c.getContext("2d");
  g.drawImage(img, 0, 0);
  return c;
}

function drawFit(g, img, w, h) {
  g.imageSmoothingEnabled = true;
  g.drawImage(img, 0, 0, w, h);
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("load fail: " + src));
    img.src = src;
  });
}

async function buildArt() {
  /* Node 冒烟测试没有 Image / manifest：直接跳过，走程序化兜底 */
  if (typeof Image === "undefined" || !window.ART_MANIFEST) return;
  const man = window.ART_MANIFEST;
  const jobs = [];

  /* 瓦片：缩放到 TILE*RS 物理分辨率 */
  for (const name in man.tiles) {
    jobs.push((async () => {
      const img = await loadImage(POOL + "tiles/" + name + ".png");
      const c = artCanvas(TILE * RS, TILE * RS);
      drawFit(c.getContext("2d"), img, TILE * RS, TILE * RS);
      Art.tiles[name] = c;
    })());
  }
  /* 角色精灵：role_dir → role[dir] = [站立, 迈步A, 迈步B]；
   * 同时渲染一份战斗队员立绘（PARTY_* 尺寸，面向镜头的 0 号方向） */
  for (const key in man.sprites) {
    const m = key.match(/^(.*)_([0-3])$/);
    if (!m) continue;
    const role = m[1], dir = +m[2];
    jobs.push((async () => {
      const img = await loadImage(POOL + "sprites/" + key + ".png");
      const c = artCanvas(SPR_W * RS, SPR_H * RS);
      drawFit(c.getContext("2d"), img, SPR_W * RS, SPR_H * RS);
      (Art.sprites[role] = Art.sprites[role] || {})[dir] = walkFrames(c);
      const p = artCanvas(PARTY_W * RS, PARTY_H * RS);
      drawFit(p.getContext("2d"), img, PARTY_W * RS, PARTY_H * RS);
      (Art.party[role] = Art.party[role] || {})[dir] = p;
    })());
  }
  /* 敌人立绘 */
  for (const name in man.enemies) {
    jobs.push((async () => {
      const img = await loadImage(POOL + "enemies/" + name + ".png");
      const boss = name === "fox", w = boss ? ENEMY_W_BOSS : ENEMY_W, h = boss ? ENEMY_H_BOSS : ENEMY_H;
      const c = artCanvas(w * RS, h * RS);
      drawFit(c.getContext("2d"), img, w * RS, h * RS);
      Art.enemies[name] = c;
    })());
  }
  /* 背景 */
  for (const name in man.bg) {
    jobs.push((async () => {
      const img = await loadImage(POOL + "bg/" + name + ".png");
      Art.bg[name] = toCanvas(img);
    })());
  }
  await Promise.all(jobs);
  Art.ready = true;
}

/* 行走帧：帧0 站立；帧1/2 由下半身前后错动合成（经典 JRPG 步法） */
const LEG_SPLIT = 0.52;                    // 腰部分割比例（从顶往下）
function walkFrames(stand) {
  const w = stand.width, h = stand.height;
  const split = Math.round(h * LEG_SPLIT);
  const out = [stand];
  for (const dy of [-Math.round(h * 0.035), Math.round(h * 0.035)]) {
    const c = artCanvas(w, h);
    const g = c.getContext("2d");
    g.drawImage(stand, 0, 0, w, split, 0, 0, w, split);
    g.drawImage(stand, 0, split, w, h - split, 0, split + dy, w, h - split);
    out.push(c);
  }
  return out;
}
