/* 行走问题追踪：tools/trace_walk.js */
"use strict";
const fs = require("fs");
const path = require("path");

function makeCtx() {
  const g = { addColorStop() {} };
  return new Proxy({}, {
    get(t, p) {
      if (p === "measureText") return () => ({ width: 8 });
      if (p === "createLinearGradient") return () => g;
      if (p in t) return t[p];
      t[p] = () => {};
      return t[p];
    },
    set(t, p, v) { t[p] = v; return true; }
  });
}
function makeCanvas() {
  return { width: 0, height: 0, style: {}, getContext: () => makeCtx(),
           addEventListener: () => {} };
}
global.document = { createElement: () => makeCanvas(), getElementById: () => makeCanvas() };
const listeners = {};
global.window = { innerWidth: 320, innerHeight: 200,
  addEventListener: (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); } };
let rafQueue = [];
global.requestAnimationFrame = cb => { rafQueue.push(cb); };
global.localStorage = (() => { let s = {}; return {
  getItem: k => (k in s ? s[k] : null), setItem: (k, v) => { s[k] = String(v); } }; })();

const files = ["pat.js","mgo.js","art.js","data.js","maps.js","script.js","engine.js","battle.js","main.js"];
const src = files.map(f => fs.readFileSync(path.join(__dirname,"..","src",f),"utf8")).join("\n;\n");
eval(src + `
;globalThis.__game = { GS, Maps, TILES, boot, mainStart, enterScene,
  startDialog, solidAt, npcAt, tileAt, updateWalk, mapSize };`);
const G = globalThis.__game;

const CODE = { " ":"Space", "ArrowRight":"ArrowRight", "ArrowUp":"ArrowUp" };
function fire(type, key) {
  const ev = { key, code: CODE[key] || key, repeat: false, preventDefault() {} };
  for (const fn of (listeners[type] || [])) fn(ev);
}
let ts = 0;
function frames(n) { for (let i = 0; i < n; i++) { ts += 16;
  const q = rafQueue; rafQueue = []; for (const cb of q) cb(ts); } }
function tap(k) { fire("keydown", k); frames(2); fire("keyup", k); frames(1); }

for (const fn of listeners["DOMContentLoaded"]) fn();
frames(2);
tap("Enter");
while (G.GS.mode === "dialog") tap(" ");
frames(5);

console.log("=== 场景村庄 → 东行 ===");
G.enterScene("village", [30, 8]);
fire("keydown", "ArrowRight");
for (let i = 0; i < 400; i++) {
  frames(1);
  if (i % 40 === 0) {
    const fx = Math.floor((G.GS.px + 8) / 16), fy = Math.floor((G.GS.py + 20) / 16);
    console.log(`帧${i} mode=${G.GS.mode} scene=${G.GS.sceneId} px=${G.GS.px.toFixed(0)} 脚=(${fx},${fy}) 瓦片='${G.tileAt(fx, fy)}' 右键=${!!G.GS.keys.ArrowRight}`);
  }
  if (G.GS.sceneId === "field") { console.log("→ 到达 field，帧 " + i); break; }
}
fire("keyup", "ArrowRight");
console.log("最终: scene=" + G.GS.sceneId + " px=" + G.GS.px.toFixed(0) + " mode=" + G.GS.mode);

console.log("\n=== 场景青枫岭(21,6) → 北行 ===");
G.enterScene("field", [21, 6]);
const py0 = G.GS.py;
console.log("起点 py=" + py0 + " 瓦片(21,6)='" + G.tileAt(21, 6) + "' (21,5)='" + G.tileAt(21, 5) + "' (21,4)='" + G.tileAt(21, 4) + "' (21,3)='" + G.tileAt(21, 3) + "' (21,2)='" + G.tileAt(21, 2) + "'");
fire("keydown", "ArrowUp");
for (let i = 0; i < 150; i++) {
  frames(1);
  if (i % 25 === 0) {
    const fx = Math.floor((G.GS.px + 8) / 16), fy = Math.floor((G.GS.py + 20) / 16);
    console.log(`帧${i} mode=${G.GS.mode} py=${G.GS.py.toFixed(1)} 脚=(${fx},${fy}) 上探='${G.tileAt(fx, fy - 1)}'`);
  }
}
fire("keyup", "ArrowUp");
console.log("最终: py=" + G.GS.py.toFixed(1) + " (起点 " + py0 + ")");

console.log("\n=== 直接设置 GS.keys.ArrowRight 对照 ===");
G.enterScene("village", [30, 8]);
G.GS.keys.ArrowRight = true;
for (let i = 0; i < 200; i++) { frames(1); if (G.GS.sceneId === "field") { console.log("→ 直设按键 到达 field，帧 " + i); break; } }
G.GS.keys.ArrowRight = false;
console.log("最终: scene=" + G.GS.sceneId);
