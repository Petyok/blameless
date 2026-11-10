# BLAMELESS — design

An on-call shooter. 03:07, the pager fires, prod is down, nobody else is awake. You `kubectl exec`
into production in person and terminate what is crashing it. Ten incidents, four hosts, one root
cause. It ends at sunrise with a postmortem generated from the run (root cause: a Friday 17:58
deploy by ████).

Target: Intel HD 6000 laptop, 1440x900, 60 fps. Built and tested on gpu-serv.

## Pillars
- **The world is a terminal.** Walls scroll a `tail -f`, enemies burst into the letters of their
  names, kills print log lines, enemy projectiles are glyphs (the boss fires rings that read
  `ERROR 500`).
- **The floor is alive.** Raised-floor tiles rise in rings around kills and explosions, take the
  colour of every muzzle flash, and pulse with the music's bass.
- **Every enemy is a bug you know**, and behaves like it.
- **No ammo, no reload.** Each weapon has a rate limit (heat); overheat is `429`, locked until it
  cools. Holstered weapons cool faster: switching is the skill.
- **One palette per host**: green phosphor (node-3), amber (the queue), blue (the database), red
  alert (the monolith), warm dawn after the win.

## Flow
phone in the dark (any key) → pager call, spoken (ENTER) → title over a live demo → typed shell
intro → incidents 1-10 with a hotfix choice between them → postmortem → night shift (endless).
Death restarts the current incident with the hotfixes kept (score -10%).

## Weapons
| key | cmd | behaviour |
|-|-|-|
| 1 | `kill -15` | full-auto hitscan, accurate in bursts, low heat |
| 2 | `kill -9` | 9 pellets, falloff, knockback (incident 2) |
| 3 | `grep -r` | instant rail, pierces everything on the line (incident 4) |
| 4 | `rm -rf` | rocket, splash, self-damage, rocket-jump (incident 7) |

Also: dash (i-frames), rollback (rewind 3 s of position and error budget, clears heat), sudo
(charged by kills: no heat, +50% damage).

## Enemies
| type | bug | behaviour |
|-|-|-|
| zombie | `<defunct>` | walks at you, bites after a short wind-up |
| fork | fork bomb | splits in two on death, twice (1 → 2 → 4) |
| cron | cron job | hovers; a 3-shot volley every 3 s, exactly when its hand reaches twelve; the volley brackets you (straight, full lead, half lead) |
| packet | SYN flood | fast kamikaze swarm |
| race | race condition | two tethered threads; the dead one restarts unless both die within 2.2 s |
| leak | memory leak | grows; at full size goes OOM and explodes, hurting enemies too; harmless if killed small |
| heisen | heisenbug | teleports when the crosshair rests on it; solid for 1 s after each jump |
| brute | oom_reaper | charges in a line after a wind-up; stuns itself on walls (+50% damage taken) |
| boss | the monolith | 1:4:9 slab; shielded while dependency pylons live; rings (jump), rotating beams (jump or dash), aimed fans, adds; reloads two dependencies at half health |

## Architecture
`src/sim/*` is pure and deterministic (no DOM, no three.js): the same code runs in the browser, in
`node --test`, and in balance runs. `src/view/*` draws and sounds what the sim reports through its
event queue.

```
src/sim/config.js    every tunable: weapons, enemies, boss, waves, perks, difficulty
src/sim/world.js     ASCII maps, grid, circle collision, 3D raycast, line of sight, BFS flow field
src/sim/player.js    movement, dash, rollback, sudo, damage intake
src/sim/weapons.js   heat, hitscan, rockets
src/sim/enemies.js   AI per type, projectiles, death rules, explosions, the boss
src/sim/director.js  incidents, spawns, hotfixes, host changes, night shift
src/sim/sim.js       makeSim(opts), step(sim, input, dt)
src/sim/bot.js       autopilot: sim -> input (demo, E2E, balance)
src/view/gfx.js      renderer, low-res target, bloom, CRT composite, measured resolution scale
src/view/shaders.js  GLSL
src/view/scene.js    floor tiles, racks, walls, ceiling; instanced box and glyph batches
src/view/actors.js   enemies (a few boxes each), labels, projectiles, pickups
src/view/viewmodel.js  weapon in hand
src/view/fx.js       sim events -> glyph particles, debris, tracers, lights, ripples, shake
src/view/audio.js    synthesized effects, music streams, announcer queue
src/view/hud.js      DOM HUD, radar, hints, every menu and screen
src/view/net.js      stats client: heartbeat, run reports, the board; every call optional
src/view/text.js     all writing: wall logs, kill feed, intro, postmortem; voice.json is the announcer
src/main.js          boot, input, screen state machine, frame loop, window.__game hooks
server/stats.py      world stats and the leaderboard (python standard library, SQLite)
```

Input (player or bot): `{mx, mz, dyaw, dpitch, jump, jumpPressed, dash, fire, firePressed,
rollback, sudo, weapon}`. The sim substeps at most 1/30 s; tests use 1/60.

## Rendering
Everything dynamic is one of two instanced batches (unit boxes with a matrix each, and glyph
billboards from a canvas-made atlas), so a frame is about 11 draw calls and 30k triangles. Unlit
shaders: dark fills, pixel-constant bright edges, fog to the host colour, four fake point lights
evaluated per vertex. Post: bright pass at half resolution, separable blur at quarter, one
full-resolution composite (CRT curve, sharp-bilinear upscale, chroma shift, scanlines, hurt
vignette, glitch).

The scene resolution is picked at start-up by timing real frames (`readPixels` blocks until the GPU
is done): the largest scale under 8.5 ms, never above 0.72. It steps down at once after 1.5 s below
83% of the target frame rate, or after a 4 s window that averaged below 93% (a hot laptop drops a
few frames a second, not all of them); the first seconds after a level load are ignored.

Measured on the HD 6000 (headless Chromium, real GPU, the flags of the laptop's everyday browser, autopilot in
incident 9): 60.0 fps, p99 16.8 ms at 0.72 scale with 48 enemies; full resolution costs 8.9 ms a
frame. The composite pass is the largest fixed cost, so it is kept to two scene fetches and one
bloom fetch per pixel.

## World stats and the leaderboard
`server/stats.py` is one file behind nginx at `/api/`:

- `POST /api/hit`: a page says it is open (every 20 s): visits, distinct browsers, who is awake now.
- `POST /api/run`: a campaign or a night shift starts; the answer is a random run token.
- `POST /api/report`: where the run stands, sent after every resolved incident, at every death
  (with what did it) and at the win.
- `GET /api/board`: the totals, the survival table, what kills most, ten best players per board.

A run only grows (a retry costs 10% of the score in the game; the board keeps the best the run
reached) and is final once its campaign is won. A night shift entered from a win is a run of its
own that counts only what is earned after the campaign. Boards list each player once, with their
best run; a run without a handle is counted in the totals and never listed.

Nothing the browser says is trusted, and nothing can be verified either, so the checks are about
plausibility: sim time cannot run ahead of the wall clock since the token was issued; kills per
second and score per kill are bounded by the game's own numbers (360 points for the best kill on a
x3 streak, 6000 for the monolith); a campaign has ten incidents and is won exactly when the tenth
is resolved; a run belongs to the id that opened it; one address opens at most 30 runs an hour;
nginx allows 2 requests a second. Handles are 2-16 characters from a small alphabet, minus a short
blocklist; `stats.py hide NAME` is the moderation tool. The honest fix, if the boards ever matter:
the sim is deterministic, so the page can send its inputs and the server can replay the run.

The client treats every call as optional. Served without the API (the local launcher) the game
plays the same and the leaderboard screen says there is none.

## Balance
`node tools/balance.mjs RUNS SKILL SEVS` plays campaigns with the autopilot (checkpoint retries, as
a player would). skill scales turn rate, aim wobble, reaction time, awareness behind the back and
jump timing. Deaths per campaign, median of 8:

| | skill 1.0 | 0.6 | 0.4 |
|-|-|-|-|
| SEV3 chill | 0 | 0 | 0 |
| SEV2 normal | 0 | 0 | 2 |
| SEV1 hurt me | 0 | 2 | 30 |

The autopilot never panics and always knows where everything is, so read it as a lower bound for
people. A campaign takes it 9-13 minutes.

## Audio
- Effects: 35 recipes rendered to buffers at start-up (`recipes()` in audio.js), normalised.
- Music: MiniMax Music3 through the shared ComfyUI queue on gpu-serv; 16 takes for 6 tracks. Picks
  are in `tools/music_pick.json`. The prompts ask for instrumentals. Four of the six shipped tracks
  sing anyway: measured on the vocal stem that Demucs cuts out of each track, `act1` is sung for 64
  of its 174 seconds, `act2` for 93 of 169, `act3` for 25 of 174 and `boss` for 70 of 123. `night`
  and `dawn` are instrumental.
- How that shipped as "instrumental": nobody had listened. The first check asked CLAP whether
  anyone sings and an English-only Whisper to write down two half-minutes of each take. Over the
  singing Whisper wrote "Thanks for watching!", which is what it writes over silence too, and that
  was taken as "no vocals" against CLAP's score of 0.78 for `act2`. The first person to play heard
  a song in German. The check now goes through the stem (`tools/music_vocals.py`, then
  `tools/music_qa.py`): how loud the stem is says how much is sung. The words are still out of
  reach: the speech model hears English syllables in `act1` and Chinese in `boss`. Records are in
  `tools/qa/`.
- Voice: Piper `en_US-lessac-medium`, a PA-speaker chain in ffmpeg, then Whisper on every processed
  line against its text (`tools/voice.py`). Three lines were reworded until they came back right.
  A public-domain voice (`en_US-ljspeech-high`) was tried for its licence and dropped: it turns
  "fork bomb" into "four bomb" and "cascading failure" into "skating failure".

## What testing found
- `node --test` (22 tests): rules for every enemy, collision fuzz, a full invulnerable-bot campaign
  (no soft locks), determinism, sound recipes, recoil stability.
- E2E in one docker compose on gpu-serv (`e2e/`): nginx with the production rules, the stats
  server and headless Chromium. Real key presses through every screen; the autopilot through all
  ten incidents, one screenshot each; then a run reported, ranked and listed, a forged report and a
  stolen run refused, the phone view, the rate limit. Putting the real content security policy in
  front of the game broke only the test: Playwright's `waitForFunction` evals inside the page.
- Real input through a private Wayland session (glass) found what the others could not: the recoil
  spring diverging below 15 fps (camera thrown at the floor), the announcer silent during the call,
  a machine without audio stuck on the first screen, tracers starting from last frame's camera, and
  the pause menu putting "restart" under the cursor.
- The first person to play found what none of the above had: the camera stayed tilted after a
  retry (the death fall was never reset), and the soundtrack sings (see Audio).
