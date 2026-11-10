#!/usr/bin/env python3
"""BLAMELESS music QA, step one: is anyone singing. Splits every track with Demucs and keeps the vocal stem.

  venv-demucs/bin/python tools/music_vocals.py assets/music audio/vocals
      -> audio/vocals/<track>.wav (16 kHz mono: the singing alone) and audio/vocals/vocals.json

A speech model asked about a full mix writes filler over the music ("Let's get started", "Thanks for watching",
"Субтитры сделал DimaTorzok"); asked about the stem it has a chance at the words. The stem's loudness against the
mix, second by second, says how much of a track is sung, which neither CLAP nor Whisper could. tools/music_qa.py
picks both up when they exist.

Demucs needs torchaudio, which pins its own torch, hence a venv of its own:
  python3 -m venv venv-demucs
  venv-demucs/bin/pip install --index-url https://download.pytorch.org/whl/cpu torch==2.11.1 torchaudio==2.11.1
  venv-demucs/bin/pip install demucs numpy
"""
import glob, json, os, subprocess, sys

import numpy as np
import torch
from demucs.apply import apply_model
from demucs.pretrained import get_model

SRC, OUT = os.path.abspath(sys.argv[1]), os.path.abspath(sys.argv[2])
# A second counts as sung when the stem is this loud, in absolute terms and against the mix. Demucs puts a little
# of every synth lead into the vocal stem, so both floors are needed. Tuned on the six shipped tracks.
LEVEL, SHARE = 0.012, 0.22


def rms(x):
    return float(np.sqrt(np.mean(x ** 2))) if len(x) else 0.0


def main():
    os.makedirs(OUT, exist_ok=True)
    model = get_model("htdemucs").eval()
    rate, report = model.samplerate, {}
    for path in sorted(glob.glob(os.path.join(SRC, "*.flac")) + glob.glob(os.path.join(SRC, "*.ogg"))):
        name = os.path.splitext(os.path.basename(path))[0]
        raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-f", "f32le", "-ac", "2", "-ar", str(rate), "-"],
                             check=True, capture_output=True).stdout
        mix = torch.from_numpy(np.frombuffer(raw, dtype=np.float32).reshape(-1, 2).T.copy())
        ref = mix.mean(0)
        mean, std = ref.mean(), ref.std() + 1e-8
        with torch.no_grad():
            stems = apply_model(model, ((mix - mean) / std)[None], device="cpu", shifts=0, split=True, overlap=0.1, progress=False)[0]
        voc = (stems[model.sources.index("vocals")] * std + mean).mean(0).numpy()
        mono = ref.numpy()
        seconds = range(0, len(mono) - rate + 1, rate)
        level = [rms(voc[i:i + rate]) for i in seconds]
        share = [v / (rms(mono[i:i + rate]) + 1e-9) for v, i in zip(level, seconds)]
        sung = [v > LEVEL and s > SHARE for v, s in zip(level, share)]
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "f32le", "-ar", str(rate), "-ac", "1", "-i", "-", "-ar", "16000",
                        "-c:a", "pcm_s16le", os.path.join(OUT, name + ".wav")], input=voc.astype(np.float32).tobytes(), check=True)
        report[name] = {
            "seconds": len(sung), "sung_seconds": int(sum(sung)), "stem_share": round(float(np.mean(share)), 3),
            "stem_level": round(float(np.mean(level)), 4), "sung": "".join("#" if s else "." for s in sung),
        }
        print(f"{name:14s} sung {sum(sung):3d}/{len(sung):3d} s  stem share {np.mean(share):.2f}  level {np.mean(level):.3f}", flush=True)
        print(f"    {report[name]['sung']}", flush=True)
    json.dump(report, open(os.path.join(OUT, "vocals.json"), "w"), indent=1)
    print("VOCALS END", flush=True)


if __name__ == "__main__":
    sys.exit(main())
