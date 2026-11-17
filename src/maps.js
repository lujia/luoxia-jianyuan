/* =========================================================================
 * maps.js —— 场景与地图数据（架构角色 ≈ 经典引擎的 MAP.MKF + RNG.MKF）
 *
 * 经典引擎：MAP.MKF 存瓦片布局，RNG.MKF 存场景对象/敌人遭遇。
 * 复刻版把两者合并为“场景表”。室外场景用字符画描述（每字符 = 一瓦片，
 * 全部 40 列宽），洞窟用程序化“挖洞”生成。场景、地名、布局均为原创。
 *
 * 图例： G草 f花 P路 W水 T树 R岩 H房墙 r屋顶 D门 S牌
 *        C宝箱 c空箱 .洞地 #洞壁 V洞口 L出口 s碑
 *
 * 注意：pat.js / 资产清单里还有一个 "bridge" 木桥瓦片，但 TILES 表从未映射它
 * （旧版图例曾写「B桥」，实际没有任何地图使用 B），属不可达的美术资源。
 * 保留它的唯一理由是 assets/ 里的成品 png —— 若要删，需连同
 * assets/raw/tiles/bridge.png、gen_assets.py 的提示词、art_manifest.js 一起清。
 * ========================================================================= */
"use strict";

const TILES = {
  "G": { pat:"grass",     solid:false },
  "f": { pat:"flower",    solid:false },
  "P": { pat:"path",      solid:false },
  "W": { pat:"water",     solid:false, water:true },
  "T": { pat:"tree",      solid:true  },
  "R": { pat:"rock",      solid:true  },
  "H": { pat:"hwall",     solid:true  },
  "r": { pat:"roof",      solid:true  },
  "D": { pat:"door",      solid:false, door:true },
  "S": { pat:"sign",      solid:true  },
  "C": { pat:"chest",     solid:true  },
  "c": { pat:"chestOpen", solid:true  },
  ".": { pat:"cfloor",    solid:false },
  "#": { pat:"cwall",     solid:true  },
  "V": { pat:"cavein",    solid:false },   // 洞口：踏上即进入
  "L": { pat:"exitup",    solid:false },   // 洞内出口：踏上即出洞
  "s": { pat:"stele",     solid:true  }
};

const Maps = { scenes: {} };

/* ---- 洞窟地图：程序化挖洞（40×32） ---- */
function carveCave() {
  const W = 40, H = 32;
  const grid = [];
  for (let y = 0; y < H; y++) { grid.push([]); for (let x = 0; x < W; x++) grid[y].push("#"); }
  const room = (x0, y0, w, h) => {
    for (let y = y0; y < y0 + h; y++)
      for (let x = x0; x < x0 + w; x++)
        if (x > 0 && y > 0 && x < W - 1 && y < H - 1) grid[y][x] = ".";
  };
  const hall = (x0, y0, x1, y1) => {           // 挖 L 形走廊
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) grid[y0][x] = ".";
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) grid[y][x1] = ".";
  };
  room(2, 26, 8, 4);                            // 入口大厅（左下）
  hall(6, 26, 6, 6);                            // 西侧纵向主通道
  hall(6, 6, 33, 6);                            // 北部横向主通道
  room(4, 4, 10, 6);                            // 西侧厅
  room(20, 3, 12, 6);                           // 东侧厅（入口）
  hall(6, 14, 34, 14);                          // 中层横廊
  hall(20, 6, 20, 20); hall(20, 20, 34, 20);    // 中部环路
  room(28, 9, 8, 4); hall(32, 12, 32, 14);      // 东中室（接中层横廊）
  room(31, 1, 7, 8);                            // Boss 竖室（右上）
  room(26, 23, 8, 5); hall(30, 23, 30, 20);     // 宝箱室（南）
  grid[28][2] = "L";                            // 洞口（回地面）x=2,y=28
  grid[26][28] = "C";                           // 南宝箱 (28,26)
  grid[7][34]  = "s";                           // Boss 界碑 (34,7)
  grid[7][8]   = "C";                           // 西宝箱 (8,7)
  return grid.map(row => row.join(""));
}

Maps.scenes = {

  /* ================= 落霞村（起始村庄，40×19） ================= */
  village: {
    name: "落霞村",
    music: "village",
    pad: "T",
    encounters: null,                       // 村内安全
    start: [9, 16],
    map: [
      "TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT",
      "TTrrrrTTTTrrrrrTTTTTrrrrrrTTTTTTTrrrrTTT",
      "TrrrrrrTTrrrrrrrTTTTrrrrrrrrTTTTrrrrrrTT",
      "THHHHHTTTHHHHHHTTTTTHHHHHHHTTTTTHHHHHTTT",
      "THDHDHTTTHDDHDHTTTTTHDDHDHHTTTTTHDHDHTTT",
      "TGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGT",
      "TGGfGGGGGGGGGGfGGGGGGGGGGfGGGGGGGGGGGfGT",
      "TGPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP",
      "TGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG",
      "TGrrrrrrGGGGTTTTGGGGrrrrrrrGGGGGTTTTTTGT",
      "TGrrrrrrrGGGTTTTTTGGrrrrrrrrGGGGTTTTTTGT",
      "TGHHHHHTGGGGTTTTTTGGHHHHHHHGGGGGGTTTTTGT",
      "TGHDHDHTGGGGTTTTTTGGHDDHDHGGGGGGGTTTTTGT",
      "TGGGGGGGGGGGGTTTTTGGGGGGGGGGfGGGGTTTTTGT",
      "TGGGGGGGGGGGGTTTTTTTGGGGGGGGGGGGGGTTTTGT",
      "TGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGT",
      "TGGGGfGGGGGGGGGGGGGCGGGGGGGGGGGGGfGGGGGT",
      "TGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGT",
      "TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT"
    ],
    /* NPC 放置（≈ RNG.MKF 的场景对象）：坐标均为可行走地面 */
    npcs: [
      { id:"master", x:3,  y:5,  char:"master", dir:0, name:"云松道长" },
      { id:"smith",  x:3,  y:13, char:"smith",  dir:0, name:"王铁匠"   },
      { id:"doc",    x:22, y:13, char:"doc",    dir:0, name:"百草翁"   },
      { id:"kid",    x:14, y:8,  char:"kid",    dir:2, name:"石头"     },
      { id:"yue",    x:24, y:5,  char:"yue",    dir:0, name:"沈月"     }
    ],
    /* 出口 → 场景切换（东口出村） */
    exits: [
      { x:39, y:7, to:"field", toPos:[2, 7] },
      { x:39, y:8, to:"field", toPos:[2, 8] }
    ]
  },

  /* ================= 青枫岭（村外野外，40×20） ================= */
  field: {
    name: "青枫岭",
    music: "field",
    pad: "T",
    encounterRate: 0.9,
    formations: ["field1","field2","field3"],
    map: [
      "T".repeat(40),
      "T".repeat(12) + "R".repeat(8) + "T".repeat(20),
      "TTT"+"GGGG"+"TTTT"+"RR"+"VVVV"+"RR"+"TTTT"+"GGGG"+"T".repeat(13),
      "TT"+"GGGGGGGG"+"TT"+"RR"+"VVVV"+"RR"+"T"+"GGGGGGGGG"+"T".repeat(10),
      "T"+"GGf"+"GGGGGGGG"+"T"+"RR"+"GG"+"RR"+"T"+"GGGGGGG"+"f"+"GG"+"T".repeat(10),
      "T" + "G".repeat(32) + "T".repeat(7),
      "T" + "G".repeat(34) + "T".repeat(5),
      "P"+"GGG"+"f"+"G".repeat(27)+"f"+"GGG"+"TTTT",
      "P" + "G".repeat(34) + "T".repeat(5),
      "P"+"GGG"+"f"+"G".repeat(17)+"f"+"G".repeat(12)+"T".repeat(5),
      "T" + "G".repeat(30) + "f" + "GGGGG" + "TTT",
      "TT"+"GGGGGG"+"f"+"GGGGGG"+"WWWWWW"+"G".repeat(17)+"TT",
      "TTT"+"G".repeat(10)+"WWWWWWWW"+"G".repeat(12)+"f"+"GGG"+"TTT",
      /* 池塘（x13-20, y11-14）。旧版这一行中间留了 "GG" 两格草地，
       * 四面被水围死 → 成为永远走不到、也看不出用途的孤岛
       * （BFS 实测：可行走 485 格中 483 可达，孤岛 (16,13)(17,13)）。
       * 填成水面后池塘完整闭合。 */
      "TTTT"+"GGGGGG"+"f"+"GG"+"WWWWWWWW"+"G".repeat(11)+"f"+"GGG"+"TTTT",
      "TTTTT"+"GGGGGGGG"+"WWWWWWWW"+"G".repeat(9)+"f"+"GGGG"+"T".repeat(5),
      "TTTTT"+"f"+"G".repeat(31)+"TTT",
      "TTTTTT"+"G".repeat(26)+"f"+"GGGG"+"TTT",
      "TTTTTTT"+"GGGGG"+"f"+"G".repeat(23)+"TTTT",
      "TTTTTTTT"+"G".repeat(11)+"f"+"G".repeat(13)+"T".repeat(7),
      "T".repeat(40)
    ],
    npcs: [],
    exits: [
      { x:0, y:7, to:"village", toPos:[37, 7] },
      { x:0, y:8, to:"village", toPos:[37, 8] },
      { x:0, y:9, to:"village", toPos:[37, 8] }
    ],
    /* 踏上洞口 V → 进洞 */
    tileEvents: [ { tile:"V", to:"cave", toPos:[28, 3] } ]
  },

  /* ================= 雾隐洞（Boss 洞穴，程序化生成 40×32） ====== */
  cave: {
    name: "雾隐洞",
    music: "cave",
    pad: "#",
    encounterRate: 1.1,
    formations: ["cave1","cave2","cave3","cave4"],
    map: carveCave(),
    npcs: [],
    exits: [ { x:2, y:28, to:"field", toPos:[21, 6] } ],
    tileEvents: [ { tile:"L", to:"field", toPos:[21, 6] } ],
    boss: { x:34, y:7, enemy:"fox" }
  }
};

/* 规格化：所有行补齐到统一宽度（双保险） */
function mapSize(scene) {
  const w = Math.max(...scene.map.map(r => r.length));
  return { w, h: scene.map.length };
}
(function normalizeMaps() {
  for (const key in Maps.scenes) {
    const sc = Maps.scenes[key];
    const w = mapSize(sc).w;
    sc.map = sc.map.map(r => r.length < w ? r + sc.pad.repeat(w - r.length) : r);
  }
  /* 保存一份"未改动"的地图快照。宝箱开启会把地图字符 C 改成 c，
   * 这是对场景数据的原地修改；没有快照就无法在读档/新游戏时还原。 */
  Maps.pristine = {};
  for (const key in Maps.scenes) Maps.pristine[key] = Maps.scenes[key].map.slice();
})();
