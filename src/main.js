/* =========================================================================
 * main.js —— 装配与启动
 *
 * 新游戏流程：标题 → 落霞村 → 接任务 → 沈月入队 → 青枫岭 → 雾隐洞
 * → 击败 Boss 取雪莲 → 回村交任务 → 结局。剧情旗标驱动（原创内容）。
 * ========================================================================= */
"use strict";

function mainStart(continueSave) {
  GS.flags = {}; GS.items = {}; GS.gold = 40;
  GS.party = [makeActor("hero")];
  if (continueSave && loadGame()) { GS.mode = "walk"; return; }
  enterScene("village", Maps.scenes.village.start);
  GS.mode = "walk";
  startDialog([
    { name:"", text:"落霞村，黄昏。药师说，师父的病只有雾隐洞深处的雪莲能治。" },
    { name:"", text:"（方向键移动，空格对话/调查，Tab 状态。先去见师父吧。）" }
  ]);
}

/* 交付雪莲的剧情触发：拿到雪莲后回到村庄，自动播报交付剧情并进入结局。
 * 通过事件队列串接（对话结束 → 扣道具/立旗标 → 结局），不依赖 setTimeout。 */
function updateMain() {
  if (GS.mode === "walk" && GS.flags.bossDefeated &&
      GS.items.snowLotus && !GS.flags.delivered &&
      GS.sceneId === "village" && !GS.flags._deliverShown) {
    GS.flags._deliverShown = true;
    runEventSteps([
      { type:"talk", lines: [
        { name:"云松道长", text:"咳咳……你回来了！雪莲……当真取到了？" },
        { name:"沈月", text:"哥哥把它插进药炉里，快！好香……" },
        { name:"", text:"雪莲入药，云松道长的脸色渐渐红润起来。" },
        { name:"云松道长", text:"好孩子……为师这劫，总算渡过去了。" }
      ]},
      { type:"run", fn: gs => { gs.items.snowLotus = 0; gs.flags.delivered = true; } },
      { type:"ending" }
    ]);
  }
  /* 结局画面：事件驱动的"任意键回标题"（onKeyDown 置 _endReq） */
  if (GS.mode === "ending" && GS._endReq) {
    GS._endReq = false;
    GS.mode = "title";
  }
}

/* 挂接主循环：包一层原 update */
const _updateBase = update;
let _lastSave = 0;
update = function (dt) {
  updateMain();
  _updateBase(dt);
  /* 自动存档：行走中每 5 秒或切场景时 */
  if (GS.mode === "walk" && GS.tick - _lastSave > 5000) {
    saveGame(); _lastSave = GS.tick;
  }
};

/* 启动 */
window.addEventListener("DOMContentLoaded", boot);
