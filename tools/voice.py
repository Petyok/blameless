#!/usr/bin/env python3
"""BLAMELESS announcer: speak src/view/voice.json with Piper (CPU), give it a PA-speaker sound with
ffmpeg, then transcribe every line with Whisper to prove it says what the subtitle says.

  venv/bin/python tools/voice.py            -> audio/voice/<id>.wav, assets/voice/<id>.ogg, audio/voice/qa.json
  VOICE=en_US-ljspeech-high VOICE_OUT=/some/dir venv/bin/python tools/voice.py --force     another voice, elsewhere
Runs on gpu-serv inside /root/blameless (venv with piper-tts, torch CPU and transformers).

Licences differ by voice. en_US-lessac-medium was trained on the Blizzard 2013 data, which is under a research
licence. en_US-ljspeech-high and en_US-kristin-medium were trained from scratch on public-domain recordings.
"""
import json, os, re, subprocess, sys, wave

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault("HF_HOME", os.path.join(ROOT, "hf"))
LINES = json.load(open(os.path.join(ROOT, "src", "view", "voice.json")))
VOICE = os.environ.get("VOICE", "en_US-lessac-medium")
VDIR, RAW = os.path.join(ROOT, "voices"), os.path.join(ROOT, "audio", "voice")
OUT = os.environ.get("VOICE_OUT") or os.path.join(ROOT, "assets", "voice")
# PA speaker: band-limited, compressed, short slapback. The phone call is narrower and dirtier.
PA = "highpass=f=220,lowpass=f=4200,acompressor=threshold=-20dB:ratio=4:attack=5:release=80,aecho=0.8:0.6:38|83:0.22|0.12,loudnorm=I=-15:TP=-1.5:LRA=7"
PHONE = "highpass=f=380,lowpass=f=3100,acrusher=bits=9:mode=log:aa=1,acompressor=threshold=-22dB:ratio=6,loudnorm=I=-15:TP=-1.5:LRA=7"


def norm(s):
    s = s.lower().replace("-", " ").replace("%", " percent")
    s = re.sub(r"[^a-z0-9 ]", "", s)
    # spellings Whisper prefers for the same sounds
    s = s.replace("post mortem", "postmortem").replace("pseudo", "sudo")
    words = {"1": "one", "3": "three", "7": "seven", "50": "fifty", "ci": "c i", "rm": "r m", "rf": "r f", "sigkill": "sig kill",
             "2031": "twenty thirty one", "2032": "twenty thirty two", "2033": "twenty thirty three", "2034": "twenty thirty four",
             "2035": "twenty thirty five", "2036": "twenty thirty six", "2037": "twenty thirty seven", "2038": "twenty thirty eight",
             "2039": "twenty thirty nine", "137": "one three seven"}
    return " ".join(words.get(w, w) for w in s.split()).split()


def similarity(a, b):
    """Word-level similarity 0..1 (1 - normalised edit distance)."""
    a, b = norm(a), norm(b)
    d = list(range(len(b) + 1))
    for i, x in enumerate(a, 1):
        prev, d[0] = d[0], i
        for j, y in enumerate(b, 1):
            prev, d[j] = d[j], min(d[j] + 1, d[j - 1] + 1, prev + (x != y))
    return 1 - d[-1] / max(len(a), len(b), 1)


def main():
    for d in (VDIR, RAW, OUT):
        os.makedirs(d, exist_ok=True)
    if not os.path.exists(os.path.join(VDIR, VOICE + ".onnx")):
        subprocess.run([sys.executable, "-m", "piper.download_voices", "--download-dir", VDIR, VOICE], check=True)
    from piper import PiperVoice, SynthesisConfig
    voice = PiperVoice.load(os.path.join(VDIR, VOICE + ".onnx"))
    cfg = SynthesisConfig(length_scale=1.08, noise_scale=0.5, noise_w_scale=0.7)
    for k, text in LINES.items():
        wav = os.path.join(RAW, k + ".wav")
        if os.path.exists(os.path.join(OUT, k + ".ogg")) and "--force" not in sys.argv:
            continue
        with wave.open(wav, "wb") as f:
            voice.synthesize_wav(text, f, syn_config=cfg)
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", wav, "-af", PHONE if k == "call" else PA, "-ar", "48000", "-ac", "1",
                        "-c:a", "libopus", "-b:a", "40k", os.path.join(OUT, k + ".ogg")], check=True)
        print(f"spoke {k}", flush=True)

    # QA: Whisper hears the processed files, not the clean ones
    from transformers import pipeline
    asr = pipeline("automatic-speech-recognition", model="openai/whisper-small.en", device="cpu")
    report, bad = {}, 0
    for k, text in LINES.items():
        ogg = os.path.join(OUT, k + ".ogg")
        pcm = subprocess.run(["ffmpeg", "-v", "error", "-i", ogg, "-f", "f32le", "-ac", "1", "-ar", "16000", "-"], check=True, capture_output=True).stdout
        import numpy as np
        audio = np.frombuffer(pcm, dtype=np.float32)
        heard = asr({"raw": audio, "sampling_rate": 16000}, return_timestamps=True)["text"].strip()
        sim = similarity(text, heard)
        report[k] = {"text": text, "heard": heard, "similarity": round(sim, 3), "seconds": round(len(audio) / 16000, 2),
                     "bytes": os.path.getsize(ogg)}
        bad += sim < 0.8
        print(f"{'ok ' if sim >= 0.8 else 'BAD'} {sim:.2f} {k:11s} {len(audio) / 16000:5.1f}s  heard: {heard}", flush=True)
    json.dump(report, open(os.path.join(RAW, "qa.json"), "w"), indent=1)
    print(f"VOICE END lines={len(LINES)} bad={bad} total={sum(r['bytes'] for r in report.values()) >> 10} KiB", flush=True)
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
