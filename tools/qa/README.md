# Audio QA records

Written on the build host on 2026-11-10. Nobody listened to the audio before it shipped; these are what the
local models said about it.

- `music_vocals.json` (`tools/music_vocals.py`): for each shipped track, the seconds in which the vocal stem that
  Demucs cuts out is loud, as a timeline (`#` sung, `.` not). This is the measure to trust: `night` and `dawn`
  are instrumental; `act1` is sung for 64 of 174 s, `act2` for 93 of 169, `act3` for 25 of 174, `boss` for 70 of 123.
- `music_shipped.json` (`tools/music_qa.py` on `assets/music`): the six shipped tracks: duration, loudness,
  CLAP fit to the brief, CLAP vocal score, sung seconds from the stem, and what Whisper made of the stem. The
  words are not reliable: the speech model hears English syllables in `act1` and Chinese in `boss`.
- `music_qa.json`: the first pass over all 16 takes, kept as the record of a wrong call. Its `heard` lines come
  from an English-only Whisper on the full mix and are that model's filler ("Thanks for watching!"), not lyrics.
  They were read as "instrumental", against CLAP vocal scores as high as 0.78 in the same file. The raw takes
  are gone with the build host's work directory.
- `voice_qa.json` (`tools/voice.py`): every pager line: its text, what Whisper heard in the processed file, and
  how close the two are.

Shipped takes (`tools/music_pick.json`): night 404, act1 404, act2 137, act3 909, boss 137, dawn 137.
`tools/music_jobs.json` holds the captions they were made with (act2 137 used the first act2 caption; the
reworded one made 707 and 909).
