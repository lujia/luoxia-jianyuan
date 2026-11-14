/* 地图数据验证器（Node 运行）：tools/verify_maps.js
 * 检查：行宽一致、关键坐标可行走、出生点→出口/Boss/宝箱 BFS 可达。 */
"use strict";
const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(path.join(__dirname, "..", "src", "maps.js"), "utf8");
const { TILES, Maps, mapSize } =
  eval(src + "\n;({ TILES, Maps, mapSize })");

let errors = 0, warns = 0;
const err = m => { console.log("  ✗ " + m); errors++; };
const ok = m => console.log("  ✓ " + m);
const warn = m => { console.log("  ! " + m); warns++; };

const walkable = (sc, x, y) => {
  if (y < 0 || y >= sc.map.length || x < 0 || x >= sc.map[0].length) return false;
  const t = TILES[sc.map[y][x]];
  return t && !t.solid && !t.water;
};

function bfs(sc, sx, sy) {
  const W = sc.map[0].length, H = sc.map.length;
  const seen = new Set([sx + "," + sy]);
  const q = [[sx, sy]];
  while (q.length) {
    const [x, y] = q.shift();
    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const nx = x + dx, ny = y + dy, k = nx + "," + ny;
      if (seen.has(k)) continue;
      if (!walkable(sc, nx, ny)) continue;
      seen.add(k); q.push([nx, ny]);
    }
  }
  return seen;
}

for (const [id, sc] of Object.entries(Maps.scenes)) {
  console.log("\n【场景 " + id + "】 " + sc.name);
  const W = Math.max(...sc.map.map(r => r.length)), H = sc.map.length;
  console.log("  尺寸 " + W + "×" + H);
  let ragged = false;
  sc.map.forEach((r, y) => {
    if (r.length !== W) { err("行 " + y + " 宽度 " + r.length + " ≠ " + W); ragged = true; }
    if (!r.split("").every(c => TILES[c])) err("行 " + y + " 含未知图例字符");
  });
  if (!ragged) ok("行宽全部一致为 " + W);

  /* 出生/入口点 */
  const start = sc.start || (sc.tileEvents && sc.tileEvents.length ? null : null);
  /* 找一个 BFS 起点：village 用 start；field 用村口；cave 用洞口 */
  let sx = null, sy = null;
  if (id === "village") { sx = sc.start[0]; sy = sc.start[1]; ok("出生点 (" + sx + "," + sy + ") 可行走: " + walkable(sc, sx, sy)); }
  if (id === "field")  { sx = 2; sy = 7; }
  if (id === "cave")   { sx = 28; sy = 3; }
  if (sx !== null) {
    if (!walkable(sc, sx, sy)) err("BFS 起点 (" + sx + "," + sy + ") 不可行走");
    const reach = bfs(sc, sx, sy);
    for (const e of (sc.exits || []))
      console.log("  " + (reach.has(e.x + "," + e.y) ? "✓" : "✗") + " 出口 (" + e.x + "," + e.y + ") → " + e.to + (reach.has(e.x + "," + e.y) ? "" : "  不可达!"));
    for (const t of (sc.tileEvents || [])) {
      let found = false;
      sc.map.forEach((r, y) => r.split("").forEach((c, x) => { if (c === t.tile && reach.has(x + "," + y)) found = true; }));
      console.log("  " + (found ? "✓" : "✗") + " 特殊瓦片 " + t.tile + " 可达 → " + t.to);
    }
    for (const n of (sc.npcs || []))
      console.log("  " + (walkable(sc, n.x, n.y) ? "✓" : "✗") + " NPC " + n.name + " (" + n.x + "," + n.y + ") 站位" + (walkable(sc, n.x, n.y) ? "" : " 不可行走(会被墙挡住)"));
    if (sc.boss) {
      const near = [[0,1],[0,-1],[1,0],[-1,0],[0,0]].some(([dx,dy]) => reach.has((sc.boss.x+dx) + "," + (sc.boss.y+dy)));
      console.log("  " + (near ? "✓" : "✗") + " Boss 触发点 (" + sc.boss.x + "," + sc.boss.y + ") 可接近");
    }
    /* 宝箱可开启（邻接可达） */
    sc.map.forEach((r, y) => r.split("").forEach((c, x) => {
      if (c === "C") {
        const near = [[0,1],[0,-1],[1,0],[-1,0]].some(([dx,dy]) => reach.has((x+dx) + "," + (y+dy)));
        console.log("  " + (near ? "✓" : "✗") + " 宝箱 (" + x + "," + y + ") 可开启");
      }
    }));
  }
}

/* 传送落点检查 */
console.log("\n【传送落点】");
const tele = [];
for (const [id, sc] of Object.entries(Maps.scenes)) {
  for (const e of (sc.exits || [])) tele.push([id + " 出口", e.to, e.toPos]);
  for (const t of (sc.tileEvents || [])) tele.push([id + " " + t.tile, t.to, t.toPos]);
}
for (const [from, to, pos] of tele) {
  const sc = Maps.scenes[to];
  const w = walkable(sc, pos[0], pos[1]);
  console.log("  " + (w ? "✓" : "✗") + " " + from + " → " + to + " (" + pos + ")" + (w ? "" : " 落点不可行走!"));
  if (!w) errors++;
  /* 落点不应踩在会立即回传的瓦片上 */
  const t = TILES[sc.map[pos[1]][pos[0]]];
  if (t && (sc.tileEvents || []).some(te => te.tile === sc.map[pos[1]][pos[0]]))
    { err(from + " → " + to + " 落点在即时传送瓦片上，会来回弹跳!"); errors++; }
}

console.log("\n结果：" + (errors ? "✗ " + errors + " 个错误" : "全部通过") + (warns ? "，" + warns + " 个提醒" : ""));
process.exit(errors ? 1 : 0);
