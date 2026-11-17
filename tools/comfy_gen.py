#!/usr/bin/env python3
"""Qwen-Image 2.1 asset generator for pal98-remake.

Builds a minimal API-format prompt (no prompt-enhancer branch) and queues it
against the local ComfyUI server, then collects the output PNG.
"""
import argparse
import json
import os
import sys
import os
import time
import urllib.request
import urllib.error

SERVER = "http://127.0.0.1:8188"
# ComfyUI 的输出目录。旧版写死 /home/jia/ComfyUI/output，换台机器就跑不了；
# 现在优先读环境变量 COMFY_OUTPUT，否则用 ~/ComfyUI/output（ComfyUI 默认布局）。
OUT_DIR = os.environ.get("COMFY_OUTPUT") or os.path.join(
    os.path.expanduser("~"), "ComfyUI", "output")

UNET = "qwen_image_2.1_int8_convrot.safetensors"
CLIP_VL = "qwen3vl_8b_int8_convrot.safetensors"
VAE = "qwen_image_2.1_vae_bf16.safetensors"


def build_prompt(prompt, negative, width, height, steps, cfg, seed, sampler, scheduler, prefix):
    return {
        "1": {"class_type": "UNETLoader",
              "inputs": {"unet_name": UNET, "weight_dtype": "default"}},
        "2": {"class_type": "CLIPLoader",
              "inputs": {"clip_name": CLIP_VL, "type": "qwen_image", "device": "default"}},
        "3": {"class_type": "VAELoader",
              "inputs": {"vae_name": VAE}},
        "4": {"class_type": "TextEncodeQwenImage21",
              "inputs": {"clip": ["2", 0], "prompt": prompt,
                         "negative_prompt": negative, "resolution": 1024}},
        "5": {"class_type": "EmptyLatentImage",
              "inputs": {"width": width, "height": height, "batch_size": 1}},
        "6": {"class_type": "KSampler",
              "inputs": {"model": ["1", 0], "positive": ["4", 0], "negative": ["4", 1],
                         "latent_image": ["5", 0], "seed": seed, "steps": steps, "cfg": cfg,
                         "sampler_name": sampler, "scheduler": scheduler, "denoise": 1.0}},
        "7": {"class_type": "VAEDecode",
              "inputs": {"samples": ["6", 0], "vae": ["3", 0]}},
        "8": {"class_type": "SaveImage",
              "inputs": {"images": ["7", 0], "filename_prefix": prefix}},
    }


def post(path, data=None):
    url = SERVER + path
    if data is None:
        req = urllib.request.Request(url, method="GET")
    else:
        req = urllib.request.Request(url, data=json.dumps(data).encode(),
                                     headers={"Content-Type": "application/json"},
                                     method="POST")
    with urllib.request.urlopen(req, timeout=3600) as r:
        return json.loads(r.read().decode())


def wait_for(prompt_id, timeout=7200):
    t0 = time.time()
    while time.time() - t0 < timeout:
        try:
            h = post("/history/" + prompt_id)
        except urllib.error.URLError:
            time.sleep(2)
            continue
        if prompt_id in h and h[prompt_id]:
            return h[prompt_id]
        time.sleep(2)
    raise TimeoutError("generation timed out for " + prompt_id)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--prompt", required=True)
    ap.add_argument("--negative", default="")
    ap.add_argument("--width", type=int, default=1024)
    ap.add_argument("--height", type=int, default=1024)
    ap.add_argument("--steps", type=int, default=25)
    ap.add_argument("--cfg", type=float, default=1.0)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--sampler", default="euler")
    ap.add_argument("--scheduler", default="simple")
    ap.add_argument("--prefix", required=True, help="output filename prefix")
    ap.add_argument("--outdir", default=None, help="where to copy the png")
    args = ap.parse_args()

    api = build_prompt(args.prompt, args.negative, args.width, args.height,
                       args.steps, args.cfg, args.seed, args.sampler, args.scheduler,
                       args.prefix)
    res = post("/prompt", {"prompt": api})
    pid = res["prompt_id"]
    print("queued", pid, flush=True)
    hist = wait_for(pid)
    # find image output
    dest = None
    for node_out in hist.get("outputs", {}).values():
        for key in ("images",):
            for img in node_out.get(key, []) or []:
                src = os.path.join(OUT_DIR, img.get("subfolder", ""), img["filename"])
                dest = src
                print("generated:", src, flush=True)
    if args.outdir and dest:
        os.makedirs(args.outdir, exist_ok=True)
        import shutil
        target = os.path.join(args.outdir, args.prefix + ".png")
        shutil.copy(dest, target)
        print("copied to", target, flush=True)


if __name__ == "__main__":
    main()
