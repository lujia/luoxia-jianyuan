/* =========================================================================
 * battle.js —— 回合制战斗系统（≈ 经典引擎的战斗模块）
 *
 * 机制致敬经典：指令菜单（攻击/法术/物品/逃跑）、速度决定行动顺序、
 * 元素相克（雷→冰→火→雷，克制 ×1.6 / 被克 ×0.6）、战后经验与升级。
 * 数值与实现全部原创。
 * ========================================================================= */
"use strict";

const Battle = {
  enemies: [], turnOrder: [], round: 0,
  phase: "menu",                     // menu/magic/item/act/anim/end
  actorIdx: 0, pending: [], isBoss: false,
  msg: "", msgT: 0, fx: [],
  shake: 0, resultT: 0, finished: false,

  /* ---- 进入战斗 ---- */
  start(enemyList, isBoss) {
    this.enemies = enemyList.map(e => ({
      ...e, maxHp: e.hp, alive: true, flash: 0
    }));
    this.isBoss = isBoss;
    this.round = 0; this.finished = false; this.resultT = 0;
    /* 结果旗标必须逐场清零：否则上一场的 defeat/victory/fled 会残留，
     * 使下一场胜利被 finishBattle 当成全灭处理（金币减半 + 强制回村）。 */
    this.defeat = false; this.victory = false; this.fled = false;
    this.sel = 0;
    this.msg = (isBoss ? "妖气弥漫——" : "遇敌了！") + " ";
    this.msgT = 1200;
    this.buildTurnOrder();
    this.actorIdx = 0; this.phase = "menu";
    GS.mode = "battle";
    Audio.play(isBoss ? "boss" : "battle");
  },

  buildTurnOrder() {
    /* 速度 + 随机浮动，决定本回合行动序 */
    const all = [];
    GS.party.forEach(a => { if (a.hp > 0) all.push({ side:"ally", a }); });
    this.enemies.forEach(e => { if (e.alive) all.push({ side:"enemy", a: e }); });
    all.forEach(x => x.roll = x.a.spd + Math.random() * 4);
    all.sort((p, q) => q.roll - p.roll);
    this.turnOrder = all;
  },

  currentActor() {
    /* 依序取未行动者 */
    while (this.actorIdx < this.turnOrder.length) {
      const t = this.turnOrder[this.actorIdx];
      const alive = t.side === "ally" ? t.a.hp > 0 : t.a.alive;
      if (alive) return t;
      this.actorIdx++;
    }
    return null;
  },

  advance() {
    this.actorIdx++;
    const t = this.currentActor();
    if (!t) {                          // 回合结束
      this.round++;
      this.buildTurnOrder();
      this.actorIdx = 0;
    }
    this.phase = "menu";
    this.sel = 0;
  },

  /* ---- 输入 ---- */
  key(k) {
    if (this.finished) {
      if (k === " " || k === "Enter") this.finishBattle();
      return;
    }
    if (this.msgT > 0) return;
    const t = this.currentActor();
    if (!t) return;
    if (t.side === "enemy") return;    // 敌方回合自动演算（update 中处理）

    if (this.phase === "menu") {
      if (k === "ArrowUp" || k === "w") this.sel = (this.sel + 3) % 4;
      if (k === "ArrowDown" || k === "s") this.sel = (this.sel + 1) % 4;
      if (k === " " || k === "Enter") this.pickMenu(this.sel);
    } else if (this.phase === "magic") {
      const mg = t.a.magic;
      if (k === "ArrowUp" || k === "w") this.sel = (this.sel + mg.length - 1) % mg.length;
      if (k === "ArrowDown" || k === "s") this.sel = (this.sel + 1) % mg.length;
      if (k === "Escape") { this.phase = "menu"; this.sel = 0; }
      if (k === " " || k === "Enter") {
        const spell = Data.MAGIC[mg[this.sel]];
        if (t.a.mp >= spell.mp) { t.a.mp -= spell.mp; this.execMagic(t, spell); }
        else this.hintMsg(t.a.name + " 真气不足！");
      }
    } else if (this.phase === "item") {
      const inv = this.battleItems();
      if (k === "ArrowUp" || k === "w") this.sel = (this.sel + inv.length - 1) % Math.max(1, inv.length);
      if (k === "ArrowDown" || k === "s") this.sel = (this.sel + 1) % Math.max(1, inv.length);
      if (k === "Escape") { this.phase = "menu"; this.sel = 0; }
      if ((k === " " || k === "Enter") && inv.length) {
        const id = inv[this.sel % inv.length];
        this.execItem(t, id);
      }
    }
  },

  /* 战斗可用的道具（排除任务道具，避免误吃雪莲卡住剧情） */
  battleItems() {
    return Object.keys(GS.items).filter(id =>
      GS.items[id] > 0 && Data.ITEMS[id] && Data.ITEMS[id].type !== "quest");
  },

  pickMenu(i) {
    const t = this.currentActor();
    if (i === 0) this.execAttack(t);
    else if (i === 1) { this.phase = "magic"; this.sel = 0; }
    else if (i === 2) {
      const inv = this.battleItems();
      if (!inv.length) { this.hintMsg("没有可用的物品！"); return; }
      this.phase = "item"; this.sel = 0;
    }
    else this.execFlee(t);
  },

  /* ---- 行动结算 ---- */
  execAttack(t) {
    const target = this.pickEnemy();
    if (!target) return;
    const dmg = this.hitDamage(t.a.atk, target.def, 1);
    target.hp -= dmg; target.flash = 200;
    this.showMsg(t.a.name + " 挥剑攻击，" + target.name + " 受到 " + dmg + " 点伤害！");
    this.fx.push({ kind:"slash", target, t: 300 });
    this.shake = 150;
    this.afterHit();
  },

  execMagic(t, spell) {
    if (spell.heal) {
      const hurt = GS.party.filter(a => a.hp < a.maxHp).sort((a, b) => (a.hp / a.maxHp) - (b.hp / b.maxHp))[0];
      const amt = Math.round(spell.power + t.a.level * 4);
      if (hurt) { hurt.hp = Math.min(hurt.maxHp, hurt.hp + amt);
        this.showMsg(t.a.name + " 施展" + spell.name + "，" + hurt.name + " 恢复 " + amt + " 点生命！"); }
      else this.showMsg(t.a.name + " 施展" + spell.name + "，但没人需要治疗。");
    } else if (spell.all) {
      let total = 0;
      for (const e of this.enemies) {
        if (!e.alive) continue;
        const dmg = this.hitDamage(this.magicPower(t.a, spell), e.def, this.elemMult(spell.elem, e.elem));
        e.hp -= dmg; e.flash = 200; total += dmg;
      }
      this.showMsg(t.a.name + " 施展" + spell.name + "，全体敌人共受 " + total + " 点伤害！");
    } else {
      const target = this.pickEnemy();
      if (!target) return;
      const dmg = this.hitDamage(this.magicPower(t.a, spell), target.def, this.elemMult(spell.elem, target.elem));
      target.hp -= dmg; target.flash = 200;
      const mark = this.elemMult(spell.elem, target.elem) > 1 ? "（克制！）" : "";
      this.showMsg(t.a.name + " 施展" + spell.name + "，" + target.name + " 受到 " + dmg + " 点伤害！" + mark);
    }
    this.afterHit();
  },

  execItem(t, id) {
    const it = Data.ITEMS[id];
    if (!it) return;
    /* 任务道具不可消耗：旧实现在这里照样扣数量且无任何效果，
     * 玩家可能把雪莲吃没导致剧情无法推进 */
    if (it.type === "quest") {
      this.hintMsg(it.name + "是任务道具，不能使用。");
      return;
    }
    GS.items[id]--;
    if (GS.items[id] <= 0) delete GS.items[id];
    if (it.type === "heal") {
      const hurt = t.a;
      hurt.hp = Math.min(hurt.maxHp, hurt.hp + it.hp);
      this.showMsg(t.a.name + " 服下" + it.name + "，恢复 " + it.hp + " 点生命。");
    } else if (it.type === "mp") {
      t.a.mp = Math.min(t.a.maxMp, t.a.mp + it.mp);
      this.showMsg(t.a.name + " 服下" + it.name + "，恢复 " + it.mp + " 点真气。");
    } else if (it.type === "dmg") {
      const target = this.pickEnemy();
      if (!target) return;
      const dmg = this.hitDamage(it.power, target.def, this.elemMult(it.elem, target.elem));
      target.hp -= dmg; target.flash = 200;
      this.showMsg(t.a.name + " 投出" + it.name + "，" + target.name + " 受到 " + dmg + " 点伤害！");
    } else {
      this.hintMsg(it.name + "现在用不上。");
      return;
    }
    this.afterHit();
  },

  execFlee(t) {
    const spd = GS.party.reduce((s, a) => s + a.spd, 0);
    const espd = this.enemies.filter(e => e.alive).reduce((s, e) => s + e.spd, 0);
    /* Boss 战不可逃：旧版 chance 恒为 0 却仍让玩家选，选了只白费一回合，
     * 且没有任何提示说明"这场逃不掉"。现在直接拒绝并给出理由，不消耗回合。 */
    if (this.isBoss) {
      this.hintMsg("妖气封锁了退路——无法逃跑！");
      return;
    }
    const chance = Math.min(0.9, 0.45 + (spd - espd) * 0.04);
    if (Math.random() < chance) {
      this.finished = true; this.fled = true;
      this.msg = "成功脱离了战斗！"; this.resultT = 800;
    } else {
      this.showMsg("没能逃走！");
      this.advance();
    }
  },

  enemyAct(t) {
    const e = t.a;
    const alive = GS.party.filter(a => a.hp > 0);
    if (!alive.length) {                 // 队伍已空：直接判负，避免 target.def 崩溃
      this.finished = true; this.defeat = true;
      this.msg = "全队倒下了……"; this.resultT = 1000;
      return;
    }
    if (e.magic && Math.random() < 0.35) {
      const spell = Data.MAGIC[e.magic];
      let total = 0;
      for (const a of alive) {
        const dmg = this.hitDamage(e.atk * 0.8 + spell.power, a.def * 0.6, 1);
        a.hp -= dmg; total += dmg;
      }
      this.showMsg(e.name + " 吐出" + spell.name + "！全员共受 " + total + " 点伤害！");
      this.shake = 220;
    } else {
      const target = alive[Math.floor(Math.random() * alive.length)];
      const dmg = this.hitDamage(e.atk, target.def, 1);
      target.hp -= dmg;
      this.showMsg(e.name + " 扑向 " + target.name + "，造成 " + dmg + " 点伤害！");
      this.shake = 180;
    }
    /* 玩家全灭判定 */
    if (GS.party.every(a => a.hp <= 0)) {
      this.finished = true; this.defeat = true;
      this.msg = "全队倒下了……"; this.resultT = 1000;
      return;
    }
    this.advance();
  },

  /* ---- 伤害公式（原创）：atk×(0.85~1.15) − def×0.55，下限 1 ---- */
  hitDamage(atk, def, mult) {
    const v = atk * (0.85 + Math.random() * 0.3) - def * 0.55;
    return Math.max(1, Math.round(Math.max(1, v) * mult));
  },
  magicPower(actor, spell) { return spell.power + actor.level * 3; },
  elemMult(elem, targetElem) {
    if (!elem || !targetElem) return 1;
    if (Data.BEATS[elem] === targetElem) return 1.6;
    if (Data.BEATS[targetElem] === elem) return 0.6;
    return 1;
  },
  pickEnemy() {
    const alive = this.enemies.filter(e => e.alive);
    if (!alive.length) return null;
    return alive[Math.floor(Math.random() * alive.length)];
  },

  afterHit() {
    /* 敌人倒下判定 */
    for (const e of this.enemies) {
      if (e.alive && e.hp <= 0) {
        e.alive = false;
        this.msg += "  " + e.name + " 化作灵光消散了！";
      }
    }
    if (this.enemies.every(e => !e.alive)) {
      this.finished = true; this.victory = true;
      this.grantRewards();
      this.resultT = 600;
      return;
    }
    this.advance();
  },

  grantRewards() {
    let xp = 0, gold = 0;
    for (const e of this.enemies) { xp += e.xp; gold += e.gold; }
    GS.gold += gold;
    this.msg = "战斗胜利！获得 " + xp + " 点经验、" + gold + " 文钱。";
    /* 升级判定（≈ DATA.MKF 升级表机制） */
    for (const a of GS.party) {
      a.xp += xp;
      while (a.xp >= Data.LEVELS.xpCurve(a.level)) {
        a.xp -= Data.LEVELS.xpCurve(a.level);
        a.level++;
        const g = Data.LEVELS.growth[a.id];
        a.maxHp += g.hp; a.maxMp += g.mp; a.atk += g.atk; a.def += g.def; a.spd += g.spd;
        a.hp = a.maxHp; a.mp = a.maxMp;      // 升级全恢复（经典设定）
        const learn = Data.LEVELS.learn[a.id] && Data.LEVELS.learn[a.id][a.level];
        if (learn && !a.magic.includes(learn)) {
          a.magic.push(learn);
          this.msg += "  " + a.name + " 升到 " + a.level + " 级，习得『" + Data.MAGIC[learn].name + "』！";
        } else {
          this.msg += "  " + a.name + " 升到 " + a.level + " 级！";
        }
      }
    }
    if (this.isBoss) GS.flags.bossDefeated = true;
  },

  finishBattle() {
    Audio.play(GS.scene && GS.scene.music);        // 恢复场景音乐
    if (this.defeat) {
      /* 全灭：半价复活回村（经典惩罚） */
      GS.party.forEach(a => { a.hp = Math.max(1, Math.floor(a.maxHp / 2)); a.mp = Math.floor(a.maxMp / 2); });
      GS.gold = Math.floor(GS.gold / 2);
      GS.mode = "walk";
      enterScene("village", Maps.scenes.village.start);
      startDialog([{ name:"", text:"药铺掌柜把你从鬼门关拉了回来……（金钱减半）" }]);
      return;
    }
    if (this.isBoss) {
      GS.flags.bossDefeated = true;
      GS.items.snowLotus = (GS.items.snowLotus || 0) + 1;
      GS.mode = "walk";
      startDialog([
        { name:"白霜妖狐", text:"罢了……雪莲本非我物，拿去吧。" },
        { name:"", text:"妖雾散尽，一朵洁白的雪莲静静悬浮在洞窟中央。" },
        { name:"", text:"得到了『雪莲』！快回去救师父！" }
      ]);
      return;
    }
    GS.mode = "walk";
  },

  showMsg(s) { this.msg = s; this.msgT = 1300; },
  /* 纯提示（未消耗回合）：不重置消息计时。
   * 旧版复用 showMsg，玩家在空背包/真气不足时连按空格会不断续时，
   * 战斗看起来像卡住了 —— 实际是每次都被新提示挡住。 */
  hintMsg(s) {
    this.msg = s;
    if (this.msgT <= 0) this.msgT = 900;
  },

  /* ---- 每帧 ---- */
  update(dt) {
    if (this.msgT > 0) { this.msgT -= dt; return; }
    if (this.finished) { this.resultT -= dt; return; }   /* 收尾确认由 Battle.key 事件驱动 */
    /* 敌方回合自动执行 */
    const t = this.currentActor();
    if (t && t.side === "enemy" && this.msgT <= 0) this.enemyAct(t);
  },

  /* ---- 渲染 ---- */
  /* 战斗布局（虚拟 320×200）：左区=敌人立绘+我方队员，右区=状态板+指令菜单，
   * 底部=限宽消息条。AI 高清资产就绪时敌人/队员按放大尺寸绘制，否则原尺寸。 */
  enemyBox(e) {
    const boss = !!this.isBoss;
    const w = Art.ready ? (boss ? ENEMY_W_BOSS : ENEMY_W) : (boss ? 32 : 24);
    return { ex: 18 + this.enemies.indexOf(e) * (w + 8), ey: boss ? 20 : 26, w, h: w };
  },
  partyBox(i) {
    const hd = Art.party.hero || Art.party.yue;
    const w = hd ? PARTY_W : 16, h = hd ? PARTY_H : 24;
    return { x: 14 + i * (w + 12), y: 96, w, h };
  },
  partySprite(id) {
    const set = Art.party[id];
    if (set && set[0]) return set[0];
    return Mgo.sprites[id][0][0];
  },

  render() {
    /* 背景：高清场景图优先，回退程序化色带 */
    const isCave = GS.sceneId === "cave";
    const bg = isCave ? Art.bg.cave : Art.bg.field;
    if (bg) { ctx.imageSmoothingEnabled = true; ctx.drawImage(bg, 0, 0, VW, VH); }
    else {
      ctx.fillStyle = isCave ? "#181428" : "#2a3a58";
      ctx.fillRect(0, 0, VW, VH);
      if (!isCave) {
        ctx.fillStyle = "#4a6a4a"; ctx.fillRect(0, 130, VW, 70);
        ctx.fillStyle = "#5a8a5a"; ctx.fillRect(0, 120, VW, 12);
      } else {
        ctx.fillStyle = "#241e3c"; ctx.fillRect(0, 120, VW, 80);
        for (let i = 0; i < 8; i++) {
          ctx.fillStyle = "#3a3258";
          ctx.fillRect(20 + i * 38, 96, 24, 26);
          ctx.fillStyle = "#2e2848";
          ctx.fillRect(26 + i * 38, 104, 12, 14);
        }
      }
    }
    /* 屏震 */
    const sx = this.shake > 0 ? (Math.random() - 0.5) * 6 : 0;
    const sy = this.shake > 0 ? (Math.random() - 0.5) * 4 : 0;
    if (this.shake > 0) this.shake -= 16;
    ctx.save();
    ctx.translate(sx, sy);

    /* 敌人立绘（左上区） */
    this.enemies.forEach(e => {
      if (!e.alive) return;
      const { ex, ey, w, h } = this.enemyBox(e);
      const img = Art.enemies[e.art];
      if (img) { ctx.imageSmoothingEnabled = true; ctx.drawImage(img, ex, ey, w, h); }
      else {
        const p = Mgo.battle[e.art];
        if (p) { ctx.imageSmoothingEnabled = false; ctx.drawImage(p, ex, ey); }
      }
      if (e.flash > 0) {
        e.flash -= 16;
        ctx.globalAlpha = 0.6;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(ex, ey, w, h);
        ctx.globalAlpha = 1;
      }
      /* 敌人血条与名笺 */
      ctx.fillStyle = "#301818"; ctx.fillRect(ex, ey - 8, w, 4);
      ctx.fillStyle = "#c04040"; ctx.fillRect(ex, ey - 8, w * Math.max(0, e.hp) / e.maxHp, 4);
      text(e.name, ex, ey - 18, "#e8d8b0", "7px sans-serif");
    });

    /* 我方队员（左下，依存活） */
    let pi = 0;
    GS.party.forEach(a => {
      if (a.hp <= 0) return;
      const { x, y, w, h } = this.partyBox(pi++);
      const img = this.partySprite(a.id === "hero" ? "hero" : "yue");
      ctx.imageSmoothingEnabled = !!img._hd;
      ctx.drawImage(img, x, y, w, h);
    });
    ctx.restore();

    /* 状态板（右上） */
    const n = GS.party.length;
    const statusH = n * 26 + 22;
    uiBox(170, 16, 142, statusH);
    GS.party.forEach((a, i) => {
      text(a.name + " Lv" + a.level, 176, 22 + i * 26, a.hp <= 0 ? "#805050" : "#f0ead0");
      text(a.hp + "/" + a.maxHp, 176, 34 + i * 26, "#e8a8a8");
      text("气 " + a.mp, 246, 34 + i * 26, "#a8c8f0");
    });

    /* 消息条（左下）。旧版 (8,136,152,36) 内高只有 30px，装不下 2 行以上，
     * 而升级播报实测 4 行 —— 文字直接溢出到画布外。现在放宽到 4 行。 */
    if (this.msg) {
      uiBox(8, 136, 152, 56);
      wrapText(this.msg, 14, 142, 140, 4);
    }

    /* 指令菜单：状态板正下方。
     * 旧版 top = 20+n*26，与状态板底边 38+26n 恒差 18px，任何队伍都重叠；
     * 现在留 4px 间隙，且整个右列从 top 起算，子菜单原地覆盖而不另起一块。 */
    const t = this.currentActor();
    if (!this.finished && t && t.side === "ally" && this.msgT <= 0) {
      const top = 16 + statusH + 4;          // 状态板底 + 4px 间隙
      const availH = VH - top - 4;           // 右列可用高度
      if (this.phase === "magic" || this.phase === "item") {
        /* 法术 / 物品子菜单：占用整条右列，行数超出可视区时滚动跟随光标。
         * 旧版固定在 top+82 处向下排，5 种道具时面板底 244（画布只有 200），
         * 最后几种道具永远看不见。 */
        const rows = this.phase === "magic"
          ? t.a.magic.map(id => ({ id, label: (() => {
              const sp = Data.MAGIC[id];
              return sp.name + " 气" + sp.mp;
            })() }))
          : this.battleItems().map(id => ({
              id, label: Data.ITEMS[id].name + " ×" + GS.items[id]
            }));
        const maxRows = Math.max(1, Math.floor((availH - 18 - 12) / 14));
        const shown = Math.min(rows.length, maxRows);
        const scrolling = rows.length > maxRows;
        /* 滚动窗口：保证光标始终可见 */
        let first = 0;
        if (scrolling) {
          first = Math.min(Math.max(0, this.sel - maxRows + 1), rows.length - maxRows);
        }
        /* 面板高度：标题 18 + 行数*14 + 底部附注 12（滚动提示或法术说明） */
        const needBottom = scrolling || this.phase === "magic";
        const panelH = Math.min(availH, 18 + shown * 14 + (needBottom ? 12 : 0));
        uiBox(170, top, 142, panelH);
        text(this.phase === "magic" ? "· 法术 ·" : "· 物品 ·", 176, top + 4, "#ffe89a");
        for (let i = 0; i < shown; i++) {
          const idx = first + i;
          const r = rows[idx];
          if (!r) break;
          const on = this.sel === idx;
          text((on ? "▶" : "  ") + r.label, 178, top + 18 + i * 14,
               on ? "#ffe89a" : (this.phase === "magic" ? "#c8b8e8" : "#f0ead0"));
        }
        const footY = top + 18 + shown * 14;
        if (scrolling) {
          text("（" + (first + 1) + "-" + (first + shown) + "/" + rows.length + "）",
               210, footY, "#8a8aa0");
        } else if (this.phase === "magic" && rows[this.sel]) {
          const sp = Data.MAGIC[rows[this.sel].id];
          text(sp.desc.slice(0, 14), 178, footY, "#8a8aa0");
        }
      } else {
        uiBox(170, top, 142, 74);
        text("▸" + t.a.name, 176, top + 4, "#ffe89a");
        const menus = ["攻击", "法术", "物品", "逃跑"];
        menus.forEach((m, i) => {
          text((this.phase === "menu" && this.sel === i ? "▶" : "  ") + m,
               178, top + 18 + i * 12,
               this.phase === "menu" && this.sel === i ? "#ffe89a" : "#d0d0d8");
        });
      }
    }
    /* 结束提示 */
    if (this.finished) {
      const blink = Math.floor(GS.tick / 300) % 2;
      if (!blink) text("▼ 按空格继续", 122, 178, "#d8c890");
    }
  }
};
