#!/usr/bin/env python3
"""Batch asset generation for pal98-remake via local ComfyUI (Qwen-Image 2.1).

Categories: tiles, sprites, enemies, bg
Each job writes to /home/jia/ComfyUI/output/<prefix>_*.png and is copied to
the game's assets/raw/<category>/ folder. Resumable: existing outputs are skipped.
"""
import argparse
import json
import os
import shutil
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from comfy_gen import build_prompt, post, wait_for, OUT_DIR

GAME = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

STYLE_TILE = ("Chinese xianxia fantasy JRPG art style, painterly detailed texture, "
              "soft cinematic lighting, vivid harmonious colors, high quality 2D game art")
NEG_TILE = ("blurry, low quality, watermark, text, letters, words, frame, border, "
            "vignette, grid, 3d render, photo, dark muddy colors, empty flat color")
NEG_SPRITE = ("background, scenery, ground plane, floor shadow, multiple characters, "
              "cropped body, cut off at frame edge, watermark, text, blurry, deformed, "
              "extra limbs, duplicate")

RGBA_WRAP = ("This is an RGBA format image with transparency. {desc} "
             "The image has an alpha channel and a transparent background.")


def sprite_desc(role):
    return {
        "hero": "a young Chinese swordsman with black hair tied in a topknot, "
                "wearing a blue robe with a light blue sash, white trousers and black boots, "
                "a bronze-guarded straight sword sheathed at his waist",
        "yue": "a young Chinese woman with long chestnut-brown hair and a jade hairpin, "
               "wearing a red and pink dress with gold trim and a white waist sash",
        "master": "an elderly white-bearded Taoist master with white hair in a bun, "
                  "wearing a loose purple-grey robe",
        "smith": "a burly middle-aged blacksmith with dark hair tied back, "
                 "wearing a grey work robe, dark apron and cloth wrappings on the forearms",
        "doc": "a gentle herbalist woman with olive-green robe, brown hair bun, "
               "a small cloth pouch of herbs at her belt",
        "kid": "a cheerful village boy about ten years old with black hair tufts, "
               "wearing an orange-yellow tunic and brown shorts",
    }[role]


DIR_PHRASE = {
    0: "facing the viewer (front view)",
    1: "facing left (left side view)",
    2: "facing right (right side view)",
    3: "seen from behind (back view)",
}


def jobs():
    out = []

    # ---------------- tiles (seamless, opaque) ----------------
    tiles = {
        "grass": "a lush green grass field, dense soft emerald and jade blades with "
                 "slightly lighter highlights, a few tiny white daisies and small stones scattered sparsely",
        "flower": "a lush green meadow with scattered colorful small wildflowers, "
                  "pink, yellow and white blossoms among emerald grass blades",
        "path": "an ancient worn dirt road, warm ochre and umber earth, small pebbles, "
                "subtle cart wheel ruts and dried grass at the edges",
        "water0": "a clear still water surface seen from above, deep blue-green water, "
                  "very gentle ripples, soft light reflections, one or two pale glints",
        "water1": "a clear water surface seen from above with lively shimmering ripple rings, "
                  "deep blue-green water, brighter dancing light sparkles",
        "tree": "a single lush broadleaf tree seen from a high angle, thick brown trunk at the "
                "bottom center, dense layered green canopy in slightly different green tones, "
                "grass and small stones visible around the base",
        "rock": "a mossy grey boulder sitting in grass, rugged stone surface with cracks, "
                "patches of green moss, grass tufts at its base",
        "hwall": "a Chinese village house wall, warm whitewashed plaster with wooden beams, "
                 "a lattice wooden window with dark frame, subtle weathering",
        "roof": "a Chinese village roof of dark red-brown glazed round tiles, neat rows, "
                "ridged edges, subtle glaze highlights",
        "door": "a wooden house door with dark timber frame, vertical planks, iron ring handle, "
                "stone step at the bottom",
        "sign": "a weathered wooden signpost on grass, a blank board with faint carved marks "
                "(no readable text), stone base",
        "chest": "a closed wooden treasure chest with brass metal bands and a lock, "
                 "sitting on grass, slight golden glow in the seams",
        "chestopen": "an opened wooden treasure chest with brass bands, lid thrown back, "
                     "warm golden light glowing out of it, on grass",
        "bridge": "an old wooden plank bridge with rope railings over water, warm brown "
                  "timber planks with gaps, seen from directly above",
    }
    for i, (name, desc) in enumerate(sorted(tiles.items())):
        out.append(dict(cat="tiles", name=name, seed=1000 + i,
                        prompt=f"Seamless tileable texture, top-down view: {desc}. {STYLE_TILE}. "
                               f"Completely fills the entire frame edge to edge, no margin, uniform density, "
                               f"no perspective, no horizon",
                        width=512, height=512, steps=25))

    # ---------------- cave textures (重制：结构感与对比度更高) ----------------
    caves = {
        "cfloor": "a cave floor paved with large irregular dark slate flagstones, clearly "
                  "visible joints between the stones, a few lighter grey stones, thin cracks, "
                  "scattered pebbles and faint pale blue crystal dust, cold damp sheen",
        "cwall": "a rugged cave wall of large angular dark grey-brown rock faces, strong "
                 "directional highlights and deep shadowed crevices between the rock planes, "
                 "damp patches with a cold blue sheen, small mossy spots",
    }
    for j, (name, desc) in enumerate(sorted(caves.items())):
        out.append(dict(cat="tiles", name=name, seed=6000 + j,
                        prompt=f"Seamless tileable texture, top-down view: {desc}. {STYLE_TILE}. "
                               f"Completely fills the entire frame edge to edge, no margin, uniform density, "
                               f"no perspective, no horizon",
                        negative=NEG_TILE, width=512, height=512, steps=25))

    # ---------------- object tiles (RGBA，由 build_assets 合成到地面纹理上) ----
    # 这些是"摆在地面上的物体"：背景必须透明，否则自带的草地/地面与
    # grass/cfloor 纹理色调不一致，平铺时会出现明显的方格接缝。
    objects = {
        "tree": "a single lush broadleaf tree with a thick brown trunk and dense layered "
                "green canopy, viewed from a high angle, the whole tree visible and centered, "
                "a soft dark shadow directly under the trunk",
        "rock": "a mossy grey boulder with a rugged cracked surface and patches of green moss, "
                "a few small pebbles at its base, centered, viewed from a high angle",
        "sign": "a weathered wooden signpost with a blank board (no readable text) on a "
                "wooden post with a small stone base, centered, viewed from a high angle",
        "chest": "a closed wooden treasure chest with brass metal bands and a lock, "
                 "a faint golden glow in the seams, centered, three-quarter high angle view",
        "chestopen": "an opened wooden treasure chest with brass bands, the lid thrown back, "
                     "warm golden light glowing out of it, centered, three-quarter high angle view",
        "cavein": "a rocky hillside cave entrance, a dark irregular opening framed by grey "
                  "stone and mossy boulders, the surrounding hillside cut away and transparent, "
                  "centered, front view",
        "stele": "a tall weathered grey stone stele with faint carved abstract runes "
                 "(no readable text) and chipped edges, standing upright, centered",
        "exitup": "a carved stone stairway leading upward, the steps receding into bright "
                  "daylight at the top, flanked by dark rock walls on both sides, centered",
    }
    for j, (name, desc) in enumerate(sorted(objects.items())):
        out.append(dict(cat="objects", name=name, seed=5000 + j,
                        prompt=RGBA_WRAP.format(
                            desc=f"{desc}, a single isolated game object, clean stylized 2D "
                                 f"game art, {STYLE_TILE}, painterly, crisp edges, occupying "
                                 f"about eighty percent of the frame"),
                        negative="grass background, ground plane, scenery, multiple objects, "
                                 "duplicate, cropped, cut off at frame edge, watermark, text, "
                                 "blurry, deformed, low quality",
                        width=512, height=512, steps=25))

    # ---------------- character sprites (RGBA) ----------------
    for r, role in enumerate(["hero", "yue", "master", "smith", "doc", "kid"]):
        for d in range(4):
            out.append(dict(cat="sprites", name=f"{role}_{d}", seed=2000 + r * 4 + d,
                            prompt=RGBA_WRAP.format(
                                desc=f"{sprite_desc(role)}, full body standing pose, {DIR_PHRASE[d]}, "
                                     f"entire character visible from head to feet, centered, "
                                     f"clean stylized 2D game character illustration, "
                                     f"Chinese xianxia fantasy JRPG art style, painterly, vivid colors, soft rim light"),
                            negative=NEG_SPRITE, width=384, height=576, steps=25))

    # ---------------- battle enemies (RGBA) ----------------
    enemies = {
        "wolf": "a fierce grey mountain wolf with matted fur, bared white fangs, glowing red eyes, "
                "alert stance facing the viewer, full body",
        "boar": "a demonic wild boar monster with brown-green bristly hide, large white tusks, "
                "small angry green eyes, stocky full body facing the viewer",
        "bat": "a cave bat monster with dark purple leathery wings spread wide, small body, "
               "red eyes, hanging claws",
        "beetle": "a rock-armored beetle monster with layered grey chitinous shell plates, "
                  "glowing green eyes, six jointed legs, full body facing the viewer",
        "fox": "an ethereal white frost fox spirit with three flowing tails, pale blue glowing eyes, "
               "swirling frost mist and snowflakes, elegant and menacing, sitting facing the viewer",
    }
    for i, (name, desc) in enumerate(sorted(enemies.items())):
        out.append(dict(cat="enemies", name=name, seed=3000 + i,
                        prompt=RGBA_WRAP.format(
                            desc=f"{desc}, occupying about eighty percent of the frame height, "
                                 f"centered, clean stylized 2D game monster illustration, "
                                 f"Chinese xianxia fantasy JRPG art style, painterly, vivid colors"),
                        negative=NEG_SPRITE + ", tiny subject", width=512, height=512, steps=25))

    # ---------------- backgrounds ----------------
    bgs = {
        "field": "a wide view of a grassy wilderness valley in a Chinese fantasy world, "
                 "an ancient stone path winding through emerald meadows, distant misty blue "
                 "mountains and pine ridges, soft golden morning light, no characters, no buildings",
        "cave": "the interior of a mysterious frost cave, jagged dark blue-black rocks, "
                "clusters of glowing pale-blue ice crystals, cold drifting mist, "
                "faint light from a crack above, no characters",
        "title": "a breathtaking sunset over layered misty Chinese mountain ranges, "
                 "golden-red and violet sky, a sea of clouds below, silhouettes of pine trees "
                 "on a rocky ridge, elegant poetic mood, no text, no characters, no buildings",
    }
    for i, (name, desc) in enumerate(sorted(bgs.items())):
        out.append(dict(cat="bg", name=name, seed=4000 + i,
                        prompt=f"Wide panoramic scene: {desc}. {STYLE_TILE}, cinematic composition, "
                               f"game background illustration",
                        negative=NEG_TILE + ", characters, people, text, watermark",
                        width=1024, height=640, steps=30))

    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--category", required=True,
                    choices=["tiles", "objects", "sprites", "enemies", "bg", "all"])
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    todo = [j for j in jobs() if args.category in ("all", j["cat"])]
    raw_root = os.path.join(GAME, "assets", "raw")
    pending = []
    for j in todo:
        dest_dir = os.path.join(raw_root, j["cat"])
        dest = os.path.join(dest_dir, j["name"] + ".png")
        if os.path.exists(dest) and os.path.getsize(dest) > 0:
            continue
        pending.append((j, dest))
    print(f"[gen] {len(pending)} jobs to run ({len(todo) - len(pending)} already done)", flush=True)
    if args.dry_run:
        for j, _ in pending:
            print("  -", j["cat"], j["name"])
        return

    submitted = []
    for j, dest in pending:
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        api = build_prompt(j.get("prompt"), j.get("negative", ""), j["width"], j["height"],
                           j.get("steps", 25), j.get("cfg", 1.0), j["seed"],
                           j.get("sampler", "euler"), j.get("scheduler", "simple"),
                           f"pal_{j['cat']}_{j['name']}")
        res = post("/prompt", {"prompt": api})
        submitted.append((j, dest, res["prompt_id"]))
        print(f"[gen] queued {j['cat']}/{j['name']} -> {res['prompt_id']}", flush=True)

    ok = fail = 0
    for j, dest, pid in submitted:
        try:
            hist = wait_for(pid)
            src = None
            for node_out in hist.get("outputs", {}).values():
                for img in node_out.get("images", []) or []:
                    src = os.path.join(OUT_DIR, img.get("subfolder", ""), img["filename"])
            if not src or not os.path.exists(src):
                raise RuntimeError("no image output")
            shutil.copy(src, dest)
            ok += 1
            print(f"[gen] OK {j['cat']}/{j['name']} -> {dest}", flush=True)
        except Exception as e:
            fail += 1
            print(f"[gen] FAIL {j['cat']}/{j['name']}: {e}", flush=True)
    print(f"[gen] done ok={ok} fail={fail}", flush=True)
    sys.exit(1 if fail else 0)


if __name__ == "__main__":
    main()
