#!/usr/bin/env python3
"""Post-process generated raw assets into game-ready art.

- tiles: edge-blend pure ground textures for seamlessness, downscale to 192px
- sprites: trim, uniform-box to 384x576 (feet bottom-center) so every frame
  and every character shares one canvas box
- enemies: trim, uniform-box to 512x512
- bg: downscale to 1024 wide max
- writes assets/art_manifest.js (window.ART_MANIFEST, script tag friendly) and
  assets/manifest.json for tooling
"""
import json
import os

from PIL import Image

GAME = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(GAME, "assets", "raw")
OUT = os.path.join(GAME, "assets")

TILE_SIZE = 192
SPR_BOX = (384, 576)
ENEMY_BOX = (512, 512)

# 纯地面纹理需要无缝化；含物体的图块不做边缘融合
SEAMLESS_TILES = {"grass", "flower", "path", "water0", "water1", "cfloor", "cwall"}

# 每个透明物体铺在哪种地面纹理上
OBJECT_GROUND = {
    "tree": "grass", "rock": "grass", "sign": "grass", "chest": "grass",
    "chestopen": "grass", "cavein": "grass", "stele": "cfloor", "exitup": "cfloor",
}


def make_seamless(img, band=48):
    """Cross-fade opposite edges with soft ramps so the texture tiles perfectly."""
    w, h = img.size
    img = img.convert("RGB")
    strip = img.crop((w - band, 0, w, h))
    mask = Image.new("L", (band, h))
    mask.putdata([255 * x // band for x in range(band) for _ in range(h)])
    img.paste(Image.composite(strip, img.crop((0, 0, band, h)), mask), (0, 0))
    bottom = img.crop((0, h - band, w, h))
    mask = Image.new("L", (w, band))
    mask.putdata([255 * y // band for _ in range(w) for y in range(band)])
    img.paste(Image.composite(bottom, img.crop((0, 0, w, band)), mask), (0, h - band))
    return img


def trim_rgba(img):
    bbox = img.getbbox()
    return img.crop(bbox) if bbox else img


def uniform_box(img, box):
    """Scale by the limiting axis, then bottom-center into a fixed box."""
    tw, th = box
    scale = min(tw / img.width, th / img.height)
    nw, nh = max(1, round(img.width * scale)), max(1, round(img.height * scale))
    img = img.resize((nw, nh), Image.LANCZOS)
    canvas = Image.new("RGBA", box, (0, 0, 0, 0))
    canvas.paste(img, ((tw - nw) // 2, th - nh), img)
    return canvas


def process_tile(src, dest, name):
    img = Image.open(src).convert("RGB")
    if name in SEAMLESS_TILES:
        img = make_seamless(img)
    img = img.resize((TILE_SIZE, TILE_SIZE), Image.LANCZOS)
    img.save(dest, "PNG", optimize=True)


def process_object(src, dest, name, grounds):
    """把透明物体合成到对应地面纹理上，消除平铺方格接缝。

    grounds: {"grass": Image, "cfloor": Image} —— 已处理好的地面图块。
    """
    obj = Image.open(src).convert("RGBA")
    # 物体占满画幅约 80%：先按 alpha 裁掉空白，再留出少量边距
    obj = trim_rgba(obj)
    obj = obj.resize((TILE_SIZE, TILE_SIZE), Image.LANCZOS)

    ground = grounds.get(OBJECT_GROUND.get(name, "grass"))
    if ground is None:
        ground = Image.new("RGB", (TILE_SIZE, TILE_SIZE), (60, 110, 60))
    base = ground.convert("RGBA")
    base.alpha_composite(obj)
    base.convert("RGB").save(dest, "PNG", optimize=True)


def process_sprite(src, dest):
    img = uniform_box(trim_rgba(Image.open(src).convert("RGBA")), SPR_BOX)
    img.save(dest, "PNG", optimize=True)


def process_enemy(src, dest):
    img = uniform_box(trim_rgba(Image.open(src).convert("RGBA")), ENEMY_BOX)
    img.save(dest, "PNG", optimize=True)


def process_bg(src, dest):
    img = Image.open(src).convert("RGB")
    if img.width > 1024:
        img = img.resize((1024, round(img.height * 1024 / img.width)), Image.LANCZOS)
    img.save(dest, "PNG", optimize=True)


def main():
    manifest = {"tiles": {}, "sprites": {}, "enemies": {}, "bg": {}}
    counts = {"tiles": 0, "objects": 0, "sprites": 0, "enemies": 0, "bg": 0}

    # ---- 1) 地面纹理：先处理，后面给物体当底 ----
    grounds = {}
    raw_tiles = os.path.join(RAW, "tiles")
    out_tiles = os.path.join(OUT, "tiles")
    os.makedirs(out_tiles, exist_ok=True)
    for name in sorted(os.listdir(raw_tiles)) if os.path.isdir(raw_tiles) else []:
        if not name.endswith(".png"):
            continue
        base = name[:-4]
        dest = os.path.join(out_tiles, name)
        process_tile(os.path.join(raw_tiles, name), dest, base)
        with Image.open(dest) as im:
            manifest["tiles"][base] = {"w": im.width, "h": im.height}
            if base in SEAMLESS_TILES:
                grounds[base] = im.convert("RGB").copy()
        counts["tiles"] += 1
        print(f"[build] tiles/{name} -> {manifest['tiles'][base]}")

    # ---- 2) 透明物体：合成到地面纹理后覆盖同名图块 ----
    raw_objs = os.path.join(RAW, "objects")
    if os.path.isdir(raw_objs):
        for name in sorted(os.listdir(raw_objs)):
            if not name.endswith(".png"):
                continue
            base = name[:-4]
            dest = os.path.join(out_tiles, name)
            process_object(os.path.join(raw_objs, name), dest, base, grounds)
            with Image.open(dest) as im:
                manifest["tiles"][base] = {"w": im.width, "h": im.height}
            counts["objects"] += 1
            print(f"[build] objects/{name} -> {manifest['tiles'][base]}")

    # ---- 3) 精灵 / 敌人 / 背景 ----
    procs = (("sprites", process_sprite), ("enemies", process_enemy), ("bg", process_bg))
    for cat, proc in procs:
        raw_dir = os.path.join(RAW, cat)
        if not os.path.isdir(raw_dir):
            continue
        dest_dir = os.path.join(OUT, cat)
        os.makedirs(dest_dir, exist_ok=True)
        for name in sorted(os.listdir(raw_dir)):
            if not name.endswith(".png"):
                continue
            src = os.path.join(raw_dir, name)
            dest = os.path.join(dest_dir, name)
            proc(src, dest)
            with Image.open(dest) as im:
                manifest[cat][name[:-4]] = {"w": im.width, "h": im.height}
            counts[cat] += 1
            print(f"[build] {cat}/{name} -> {manifest[cat][name[:-4]]}")

    with open(os.path.join(OUT, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=1)
    with open(os.path.join(OUT, "art_manifest.js"), "w", encoding="utf-8") as f:
        f.write("/* 自动生成：build_assets.py —— 高清美术资产清单（file:// 友好） */\n")
        f.write("window.ART_MANIFEST = " + json.dumps(manifest, ensure_ascii=False) + ";\n")
    print(f"[build] manifest + art_manifest.js written; totals={counts}")


if __name__ == "__main__":
    main()
