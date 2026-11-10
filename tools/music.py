#!/usr/bin/env python3
"""BLAMELESS soundtrack via MiniMax Music3 on the shared ComfyUI queue (gpu-serv).

  music.py NAME:SEED [NAME:SEED ...]   -> audio/raw/NAME_sSEED.flac, one after another
Skips items whose output already exists, unloads the models when the batch ends.
"""
import json, os, shutil, sys, time, urllib.request

API = "http://127.0.0.1:8188"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JOBS = json.load(open(os.path.join(ROOT, "tools", "music_jobs.json")))
OUT = os.path.join(ROOT, "audio", "raw")
LYRICS = "\n".join(f"[{s}]\n[Instrumental]" for s in (
    "Intro", "Verse", "Pre-Chorus", "Chorus", "Interlude", "Verse", "Chorus", "Bridge", "Chorus", "Outro"))


def call(path, body=None):
    req = urllib.request.Request(API + path, json.dumps(body).encode() if body is not None else None,
                                 {"Content-Type": "application/json"})
    return urllib.request.urlopen(req, timeout=30).read()


def graph(name, seed):
    j = JOBS[name]
    return {
        "6": {"class_type": "UNETLoader", "inputs": {"unet_name": "minimax_music3_dit_int8_convrot.safetensors", "weight_dtype": "default"}},
        "3": {"class_type": "CLIPLoader", "inputs": {"clip_name": "minimax_music3_text_encoder_pruned_int8_convrot.safetensors", "type": "minimax", "device": "default"}},
        "7": {"class_type": "VAELoader", "inputs": {"vae_name": "minimax_music3_dav.safetensors"}},
        "13": {"class_type": "MiniMaxMusic3TextEncode", "inputs": {
            "clip": ["3", 0], "caption": j["caption"], "lyrics": j.get("lyrics", LYRICS), "seed": seed,
            "max_duration": float(j["seconds"]), "cfg_scale": 1.5, "top_k": 50}},
        "10": {"class_type": "ConditioningZeroOut", "inputs": {"conditioning": ["13", 0]}},
        "15": {"class_type": "EmptyMiniMaxMusic3LatentAudio", "inputs": {"seconds": ["13", 1], "batch_size": 1}},
        "9": {"class_type": "KSampler", "inputs": {
            "seed": seed, "steps": 30, "cfg": 1.7, "sampler_name": "euler", "scheduler": "simple", "denoise": 1.0,
            "model": ["6", 0], "positive": ["13", 0], "negative": ["10", 0], "latent_image": ["15", 0]}},
        "42": {"class_type": "VAEDecodeAudioTiled", "inputs": {"tile_size": 1536, "overlap": 64, "samples": ["9", 0], "vae": ["7", 0]}},
        "35": {"class_type": "SaveAudio", "inputs": {"audio": ["42", 0], "filename_prefix": f"blameless/{name}_s{seed}"}},
    }


def one(name, seed):
    dst = os.path.join(OUT, f"{name}_s{seed}.flac")
    if os.path.exists(dst):
        print(f"skip {name}:{seed} (exists)", flush=True)
        return True
    t0 = time.time()
    try:
        pid = json.loads(call("/prompt", {"prompt": graph(name, seed)}))["prompt_id"]
    except urllib.error.HTTPError as e:
        print(f"REJECTED {name}:{seed}: {e.read().decode()[:1500]}", flush=True)
        return False
    print(f"queued {name}:{seed} {pid}", flush=True)
    while True:
        time.sleep(5)
        try:
            h = json.loads(call(f"/history/{pid}"))
        except OSError as e:  # ComfyUI busy or restarting: keep waiting
            print(f"  history unavailable: {e}", flush=True)
            continue
        if pid not in h:
            continue
        st = h[pid]["status"]
        if st.get("status_str") != "success":
            print(f"FAILED {name}:{seed}: {json.dumps(st.get('messages'))[-1500:]}", flush=True)
            return False
        outs = [i for o in h[pid]["outputs"].values() for i in o.get("audio", [])]
        if not outs:
            print(f"FAILED {name}:{seed}: no audio output", flush=True)
            return False
        src = os.path.join("/opt/ComfyUI/output", outs[0].get("subfolder", ""), outs[0]["filename"])
        shutil.copyfile(src, dst)
        print(f"done {name}:{seed} in {time.time() - t0:.0f}s -> {dst} ({os.path.getsize(dst) >> 10} KiB)", flush=True)
        return True


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    ok = [one(n, int(s)) for n, s in (a.split(":") for a in sys.argv[1:])]
    try:
        call("/free", {"unload_models": True, "free_memory": True})
    except OSError as e:
        print(f"free failed: {e}", flush=True)
    print(f"BATCH END ok={sum(ok)}/{len(ok)}", flush=True)
    sys.exit(0 if all(ok) else 1)
