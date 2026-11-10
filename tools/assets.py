#!/usr/bin/env python3
"""BLAMELESS music: encode the chosen takes (tools/music_pick.json: track -> seed) into assets/music/<track>.ogg.
Trims silence at both ends, levels the loudness, and fades the tail so the loop point is a breath, not a click.

  python3 tools/assets.py          (on gpu-serv, in /root/blameless; the voice lines are written by tools/voice.py)
"""
import json, os, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PICK = json.load(open(os.path.join(ROOT, "tools", "music_pick.json")))
OUT = os.path.join(ROOT, "assets", "music")
LUFS = {"night": -20, "dawn": -19}  # the calm tracks sit lower; the rest at -16.5
TRIM = "silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.05,areverse,silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.3,areverse"


def run(*args):
    return subprocess.run(args, check=True, capture_output=True, text=True)


def main():
    os.makedirs(OUT, exist_ok=True)
    total = 0
    for track, seed in PICK.items():
        src = os.path.join(ROOT, "audio", "raw", f"{track}_s{seed}.flac")
        tmp = os.path.join(ROOT, "audio", f".{track}.wav")
        dst = os.path.join(OUT, f"{track}.ogg")
        run("ffmpeg", "-v", "error", "-y", "-i", src, "-af", TRIM, tmp)
        dur = float(run("ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", tmp).stdout)
        af = f"loudnorm=I={LUFS.get(track, -16.5)}:TP=-1.5:LRA=11,afade=t=in:d=0.04,afade=t=out:st={dur - 1.6:.2f}:d=1.6"
        run("ffmpeg", "-v", "error", "-y", "-i", tmp, "-af", af, "-ar", "48000", "-c:a", "libopus", "-b:a", "112k", dst)
        os.remove(tmp)
        total += os.path.getsize(dst)
        print(f"{track:6s} seed {seed}: {dur:6.1f} s -> {os.path.getsize(dst) >> 10} KiB", flush=True)
    voice = os.path.join(ROOT, "assets", "voice")
    vsize = sum(os.path.getsize(os.path.join(voice, f)) for f in os.listdir(voice)) if os.path.isdir(voice) else 0
    print(f"ASSETS END music {total >> 10} KiB, voice {vsize >> 10} KiB", flush=True)


if __name__ == "__main__":
    sys.exit(main())
