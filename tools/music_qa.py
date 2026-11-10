#!/usr/bin/env python3
"""BLAMELESS music QA, step two: I cannot listen, so local audio models do. For every track in a folder:
signal facts (duration, loudness, silences) from ffmpeg; CLAP zero-shot scores (does it sound like the brief, is
anyone singing); how many seconds are sung, from the vocal stem that tools/music_vocals.py (step one) cut out;
and a multilingual Whisper pass over that stem for the words and their language. Ranks the takes of each track
and writes a JSON report.

  venv/bin/python tools/music_qa.py                          audio/raw/<track>_s<seed>.flac -> audio/music_qa.json
  venv/bin/python tools/music_qa.py assets/music tools/qa/music_shipped.json [audio/vocals]    the tracks as shipped

How the first version let a soundtrack that sings through as instrumental: it asked the English-only Whisper
about two half-minutes of the full mix. Over music with singing in another language that model writes "Thanks
for watching!", which is also what it writes over silence, and I read it as "nobody sings" although CLAP had
scored the same take 0.78 for vocals. A multilingual model on the full mix is no better: it writes "Let's get
started" and "Субтитры сделал DimaTorzok". Hence the stem: its loudness says whether anyone sings, and it is the
only thing worth transcribing.
"""
import glob, json, os, re, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault("HF_HOME", os.path.join(ROOT, "hf"))
SRC = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else os.path.join(ROOT, "audio", "raw")
OUT = os.path.abspath(sys.argv[2]) if len(sys.argv) > 2 else os.path.join(ROOT, "audio", "music_qa.json")
STEMS = os.path.abspath(sys.argv[3]) if len(sys.argv) > 3 else os.path.join(ROOT, "audio", "vocals")
JOBS = json.load(open(os.path.join(ROOT, "tools", "music_jobs.json")))
# What each track should be, in a few words CLAP knows; the rest are distractors.
BRIEF = {
    "night": "quiet dark ambient drone with sparse piano",
    "act1": "dark synthwave with a driving bass arpeggio and electronic drums",
    "act2": "fast drum and bass with a growling bass line",
    "act3": "heavy industrial techno with a pounding distorted kick",
    "boss": "epic industrial metal with distorted guitars and orchestra",
    "dawn": "warm peaceful ambient music with soft piano",
}
VOCAL = ["a person singing", "a choir singing", "rap vocals", "someone speaking"]
INSTR = ["instrumental music with no vocals"]
ENERGY = ["calm quiet slow music", "loud fast intense music"]
# What Whisper writes when nobody is singing: not lyrics.
NOISE = re.compile(r"thanks? (you )?for watching|see you (guys )?(in the )?next|subtitles? by|amara\.org|let'?s get started|we'?ll be right back"
                   r"|^\W*(all right,? )?let'?s go\W*$|субтитр|продолжение следует|untertitel|^\W*(you|bye|thank you|music|oh)?\W*$", re.I)


def ff(args):
    return subprocess.run(["ffmpeg", "-hide_banner", "-nostats", *args], capture_output=True, text=True).stderr


def pcm(path, rate):
    import numpy as np
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-f", "f32le", "-ac", "1", "-ar", str(rate), "-"], check=True, capture_output=True).stdout
    return np.frombuffer(raw, dtype=np.float32)


def facts(path):
    out = ff(["-i", path, "-af", "silencedetect=noise=-45dB:d=1.5,ebur128=peak=true", "-f", "null", "-"])
    dur = re.search(r"Duration: (\d+):(\d+):([\d.]+)", out)
    dur = int(dur[1]) * 3600 + int(dur[2]) * 60 + float(dur[3])
    lufs = float(re.findall(r"I:\s+(-?[\d.]+) LUFS", out)[-1])
    lra = float(re.findall(r"LRA:\s+(-?[\d.]+) LU", out)[-1])
    starts = [float(x) for x in re.findall(r"silence_start: (-?[\d.]+)", out)]
    ends = [float(x) for x in re.findall(r"silence_end: (-?[\d.]+)", out)]
    tail = dur - starts[-1] if len(starts) > len(ends) else 0.0  # silence that runs to the end of the file
    inner = sum(b - a for a, b in zip(starts, ends) if a > 1 and b < dur - 1)
    return {"seconds": round(dur, 1), "lufs": lufs, "lra": lra, "silence_inside": round(inner, 1), "silence_tail": round(tail, 1)}


def lyrics(asr, audio, sung=None):
    """
    The words and their language, from 30 s windows: {"languages": {name: seconds}, "lyrics": [lines]}.
    sung: one character per second of the track, '#' where the vocal stem is loud; windows without singing are
    not transcribed (a speech model always finds something to say).
    """
    langs, lines = {}, []
    for start in range(0, len(audio), 30 * 16000):
        piece, at = audio[start:start + 30 * 16000], start // 16000
        if len(piece) < 3 * 16000 or (sung is not None and sung[at:at + 30].count("#") < 4):
            continue
        out = asr({"raw": piece, "sampling_rate": 16000}, return_timestamps=True, return_language=True, generate_kwargs={"task": "transcribe"})
        for c in out.get("chunks") or []:
            text = (c.get("text") or "").strip()
            if len(text) < 4 or NOISE.search(text):
                continue
            a, b = c.get("timestamp") or (0, 0)
            seconds = max(0.0, (b if b is not None else 30.0) - (a or 0.0))
            lang = c.get("language") or "?"
            langs[lang] = round(langs.get(lang, 0) + seconds, 1)
            lines.append(f"[{at + int(a or 0)}s {lang}] {text}")
    return {"languages": dict(sorted(langs.items(), key=lambda kv: -kv[1])), "lyrics": lines}


def main():
    import torch
    from transformers import ClapModel, ClapProcessor, pipeline
    asr = pipeline("automatic-speech-recognition", model="openai/whisper-large-v3-turbo", device="cpu")
    model = ClapModel.from_pretrained("laion/clap-htsat-unfused").eval()
    proc = ClapProcessor.from_pretrained("laion/clap-htsat-unfused")
    texts = list(BRIEF.values()) + VOCAL + INSTR + ENERGY
    with torch.no_grad():
        t = model.get_text_features(**proc(text=texts, return_tensors="pt", padding=True))
        t = getattr(t, "pooler_output", t)
        t = t / t.norm(dim=-1, keepdim=True)
    stems = json.load(open(os.path.join(STEMS, "vocals.json"))) if os.path.exists(os.path.join(STEMS, "vocals.json")) else {}
    report = {}
    for path in sorted(glob.glob(os.path.join(SRC, "*.flac")) + glob.glob(os.path.join(SRC, "*.ogg"))):
        name = os.path.splitext(os.path.basename(path))[0]
        track = name.split("_s")[0]
        f = facts(path)
        audio = pcm(path, 48000)
        # 10 s windows across the track
        n = 48000 * 10
        wins = [audio[i:i + n] for i in range(0, max(1, len(audio) - n), n * 2)][:12]
        with torch.no_grad():
            a = model.get_audio_features(**proc(audio=wins, sampling_rate=48000, return_tensors="pt"))
            a = getattr(a, "pooler_output", a)
            a = a / a.norm(dim=-1, keepdim=True)
            sim = (a @ t.T)  # windows x texts
        keys = list(BRIEF)
        genre = torch.softmax(sim[:, :len(keys)] * 20, dim=-1).mean(0)
        voc = torch.softmax(sim[:, len(keys):len(keys) + 5] * 20, dim=-1)
        vocal = 1 - voc[:, 4]  # probability mass on the vocal prompts, per window
        en = torch.softmax(sim[:, -2:] * 20, dim=-1).mean(0)
        f.update({
            "fit": round(float(genre[keys.index(track)]), 3), "heard_as": keys[int(genre.argmax())],
            "raw_fit": round(float(sim[:, keys.index(track)].mean()), 3),
            "vocal_mean": round(float(vocal.mean()), 3), "vocal_max": round(float(vocal.max()), 3),
            "intense": round(float(en[1]), 3), "wanted": JOBS[track]["seconds"],
        })
        # the vocal stem, when step one made it: how much is sung, and the only audio worth transcribing
        stem = stems.get(name)
        if stem:
            f.update(lyrics(asr, pcm(os.path.join(STEMS, name + ".wav"), 16000), stem["sung"]))
            f["sung_seconds"] = stem["sung_seconds"]
        else:
            f.update(lyrics(asr, pcm(path, 16000)))
            f["sung_seconds"] = round(sum(f["languages"].values()), 1)
        sung = f["sung_seconds"] / max(1.0, f["seconds"])
        # one number to rank takes: sounds like the brief, nobody sings (by either measure), runs long enough, no dead air
        f["score"] = round(f["fit"] - 0.6 * max(f["vocal_mean"], sung) - 0.3 * max(0, 1 - f["seconds"] / (0.75 * f["wanted"])) - 0.02 * f["silence_inside"], 3)
        report[name] = f
        print(f"{name:14s} {f['seconds']:6.1f}s/{f['wanted']:3d}  {f['lufs']:6.1f} LUFS  fit {f['fit']:.2f} (heard as {f['heard_as']:5s})  "
              f"vocal {f['vocal_mean']:.2f}/{f['vocal_max']:.2f}  sung {f['sung_seconds']:.0f}s {f['languages']}  score {f['score']:.2f}", flush=True)
        for line in f["lyrics"][:6]:
            print(f"    {line[:170]}", flush=True)
    pick = {}
    for track in BRIEF:
        cands = {k: v for k, v in report.items() if k.split("_s")[0] == track}
        if cands:
            pick[track] = max(cands, key=lambda k: cands[k]["score"])
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump({"tracks": report, "pick": pick}, open(OUT, "w"), indent=1, ensure_ascii=False)
    print("PICK " + " ".join(f"{k}={v}" for k, v in pick.items()), flush=True)
    print("MUSICQA END", flush=True)


if __name__ == "__main__":
    sys.exit(main())
