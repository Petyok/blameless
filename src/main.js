// BLAMELESS: boot, input, the screen state machine and the frame loop.
import { PerspectiveCamera, Vector3 } from 'three';
import { ACTS, WEAPONS, PLAYER, WAVES } from './sim/config.js';
import { makeSim, step, makeInput } from './sim/sim.js';
import { choosePerk } from './sim/director.js';
import { hurtPlayer } from './sim/player.js';
import { spawnEnemy } from './sim/enemies.js';
import { makeBot, botInput, botPerk } from './sim/bot.js';
import { makeGfx } from './view/gfx.js';
import { makeWorldView } from './view/scene.js';
import { drawActors } from './view/actors.js';
import { makeFx } from './view/fx.js';
import { makeViewmodel } from './view/viewmodel.js';
import { makeAudio } from './view/audio.js';
import { makeHud } from './view/hud.js';
import { makeNet, HANDLE } from './view/net.js';
import { INTRO, TIPS, VOICE } from './view/text.js';

const Q = new URLSearchParams(location.search);
const num = (k, d) => (Q.has(k) ? +Q.get(k) : d);
const st = {
  sens: 1, fov: 78, master: 0.8, music: 0.7, sfx: 0.8, voice: 0.9, quality: 'auto', cap: '60', crt: '1', fps: '0', sev: 2,
  best: 0, won: false, name: '', ...JSON.parse(localStorage.getItem('blameless') || '{}'),
};
const save = () => localStorage.setItem('blameless', JSON.stringify(st));

const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('gl'));
const gfx = makeGfx(canvas), view = makeWorldView(gfx), fx = makeFx(view, gfx), vm = makeViewmodel(gfx);
const hud = makeHud(), audio = makeAudio(st), net = makeNet();
// runs played by the autopilot or with a debug switch stay off the boards
const RANKED = !Q.has('auto') && !Q.has('bot') && !Q.has('god');
// a phone or a tablet can watch the autopilot and read the boards, nothing else
const TOUCH = matchMedia('(hover: none) and (pointer: coarse)').matches;
const camera = new PerspectiveCamera(st.fov, 1, 0.06, 170);
camera.rotation.order = 'YXZ';

// state: wake -> call -> title -> intro -> play <-> paused / perk / dead / won
const G = {
  state: 'boot', sim: null, demo: true, bot: null, cp: { wave: 0, perks: [], score: 0 }, deaths: 0, causes: {}, endless: false,
  t: 0, idle: 0, manual: Q.has('manual'), stopBuzz: null, endT: 0, sub: 'main', tilt: 0, bob: 0, deadT: 0, frames: [], capAcc: 0,
  stepT: 0, world: '',
};
const DAWN = { accent: new Vector3(1, 0.72, 0.42), fog: new Vector3(0.16, 0.085, 0.06), css: [1, 0.72, 0.42] };
const inp = makeInput(), look = { dyaw: 0, dpitch: 0 }, seen = { dyaw: 0, dpitch: 0 };
// keys: held now. tapped: went down since the last frame, so a press shorter than a frame still counts.
const keys = new Set(), tapped = new Set(), down = (k) => keys.has(k) || tapped.has(k);
const pressed = { jump: false, dash: false, fire: false, rollback: false, sudo: false, weapon: -1 };
let fireHeld = false;

// ---- game flow --------------------------------------------------------------------------------

function newSim(o) {
  G.sim = makeSim({ seed: num('seed', (Math.random() * 2 ** 31) | 0), sev: num('sev', st.sev), god: Q.has('god'), ...o });
  fx.swap = 1;
  G.deadT = 0; G.tilt = 0; G.bob = 0; // a retry starts upright: the death fall belongs to the run that died
}

function startGame(o = {}) {
  G.demo = false; G.endless = !!o.endless;
  G.bot = Q.has('auto') || Q.has('bot') ? makeBot(num('seed', 7) + 100, num('skill', 1)) : null;
  newSim(o);
  G.cp = { wave: G.sim.wave, perks: [...G.sim.perkLog], score: G.sim.score };
  setState('play');
}

function startDemo() {
  G.demo = true; G.bot = makeBot(3, 0.7);
  newSim({ god: true, sev: 3, wave: 1 + ((Math.random() * 6) | 0) });
}

function setState(s) {
  if (Q.has('keys')) console.log(`state ${G.state} -> ${s}`);
  G.state = s; G.sub = 'main';
  hud.show(s === 'play' || s === 'paused' || s === 'perk' || s === 'dead');
  hud.el.hud.style.opacity = s === 'play' ? '1' : '0.35';
  if (s === 'play') {
    hud.closeScreen();
    if (!G.bot && !G.manual) canvas.requestPointerLock()?.catch?.(() => {});
    audio.pauseMusic(false);
    gfx.settle(); // a fresh world stutters once while buffers and shaders warm up
    keys.clear(); tapped.clear(); fireHeld = false;
  } else if (document.pointerLockElement) document.exitPointerLock();
  if (s === 'wake') hud.wake();
  else if (s === 'title') { if (!G.demo) startDemo(); hud.accent(ACTS[0].accent); title(); beat(); audio.setMusic('night'); }
  else if (s === 'paused') { hud.pause(G.sim); audio.pauseMusic(true); }
  else if (s === 'perk') { hud.perks(G.sim); audio.say('hotfix', 45); }
  else if (s === 'dead') hud.dead(G.sim, G.sim.player.lastCause || 'unknown causes', lb());
  else if (s === 'won') { hud.won(G.sim, G.deaths, G.causes, G.endless, lb()); audio.say('postmortem', 0); }
}

const title = () => hud.title(st, net.world, TOUCH);
/** Ask the stats server for the world totals (which also keeps this page counted as awake); the title shows them. */
function beat(visit = false) {
  net.hit(visit).then((w) => {
    const now = w ? `${w.online} ${w.played} ${w.won}` : '';
    if (now !== G.world && G.state === 'title' && G.sub === 'main') { G.world = now; title(); }
  });
}
/** What a screen's handle field shows; null when there is no stats server or the run is not ranked. */
function lb() {
  if (net.off || !RANKED) return null;
  const r = net.rank;
  return {
    name: st.name,
    text: !st.name ? 'type one to get on the board' : !r ? '' : r.name !== st.name ? 'that handle is not allowed'
      : r.rank ? `#${r.rank} of ${r.of} on ${r.board}` : '',
  };
}
const showRank = () => { const l = lb(); if (l) hud.rank(l.text); };
/** Tell the stats server where the run stands: incidents resolved so far, plus what just happened. */
const report = (sim, resolved, extra) => { if (RANKED) net.report(sim, st.name, resolved, extra).then(showRank); };

// the announcer's subtitle: on the phone during the call, in the HUD afterwards
audio.onSay = (id, dur) => {
  const say = document.getElementById('phone-say');
  if (G.state === 'call' && say) {
    say.textContent = `"${VOICE[id]}"`;
    document.getElementById('phone-hint').innerHTML = TOUCH ? 'tap to acknowledge' : '<kbd>ENTER</kbd> acknowledge';
  } else hud.subtitle(id, dur);
};

/** The pager call: buzzing phone, the announcer reads the incident. */
function pickUp() {
  audio.init();
  G.state = 'call';
  G.stopBuzz = audio.loop('phone', 0.6);
  document.getElementById('phone-hint').textContent = '...';
  setTimeout(() => { if (G.state === 'call') audio.say('call', 0); }, 1300);
}

function acknowledge() {
  G.stopBuzz?.();
  audio.hush(); audio.play('enter'); audio.say('ack', 0);
  setState('title');
}

async function intro() {
  setState('intro');
  hud.screen('<div class="term bare"><pre id="tty" class="caret"></pre><div class="tip">any key to skip</div></div>', 'solid');
  const tty = document.getElementById('tty'), wait = (ms) => new Promise((r) => setTimeout(r, ms));
  let text = '';
  for (const [line, pause, typed] of INTRO) {
    if (typed) {
      text += text ? '\n' : '';
      const prompt = line.includes('$ ') ? line.slice(0, line.indexOf('$ ') + 2) : '$ ';
      const cmd = line.includes('$ ') ? line.slice(line.indexOf('$ ') + 2) : line;
      text += prompt;
      for (const ch of cmd) {
        if (G.state !== 'intro') return;
        text += ch; tty.textContent = text; audio.play('ui');
        await wait(16 + Math.random() * 30);
      }
      audio.play('enter');
    } else { text += `\n${line}`; tty.textContent = text; }
    await wait(pause);
    if (G.state !== 'intro') return;
  }
  await wait(500);
  if (G.state === 'intro') startGame();
}

function retry() {
  const s = G.sim.stats;
  startGame({ wave: G.cp.wave, perks: G.cp.perks, score: Math.floor(G.cp.score * 0.9), stats: s, endless: G.endless });
}

/** Menu actions: from keys and from clicks on [data-act]. */
function act(a, x, y) {
  audio.play('enter');
  switch (a) {
    case 'start':
      G.deaths = 0; G.causes = {};
      document.documentElement.requestFullscreen?.().catch(() => {});
      if (RANKED) net.begin(num('sev', st.sev), 'campaign');
      if (Q.has('skip')) startGame(); else intro();
      break;
    case 'night': // after a win the hotfixes and the score carry over; from the title it is a fresh start
      if (RANKED) net.begin(num('sev', st.sev), 'night', G.state === 'won' ? G.sim : null);
      if (G.state === 'won') startGame({ wave: WAVES.length, perks: [...G.sim.perkLog], score: G.sim.score, stats: G.sim.stats, endless: true });
      else { G.deaths = 0; G.causes = {}; startGame({ wave: WAVES.length, endless: true }); }
      break;
    case 'sev': st.sev = st.sev === 1 ? 3 : st.sev - 1; save(); title(); break;
    case 'board':
      G.sub = 'board';
      hud.board(net.off ? false : null, lb());
      if (!net.off) net.board().then((d) => { if (G.state === 'title' && G.sub === 'board') hud.board(d || false, lb()); });
      break;
    case 'prompt': G.sub = 'prompt'; hud.prompt(); break;
    case 'name': {
      const name = String(x).trim().replace(/\s+/g, ' ');
      if (name && !HANDLE.test(name)) { hud.rank('2 to 16 letters, digits, spaces or _ . -'); break; }
      st.name = name; save();
      net.rank = null; // it described the run under the old handle
      hud.rank(name ? 'saved' : '');
      if (name) net.send(name).then((r) => { if (r) showRank(); });
      break;
    }
    case 'options': G.sub = 'options'; hud.options(st); break;
    case 'help': G.sub = 'help'; hud.help(); break;
    case 'back': G.sub = 'main'; if (G.state === 'paused') hud.pause(G.sim); else title(); break;
    case 'resume': setState('play'); break;
    case 'veil': if (G.state === 'paused' && G.sub === 'main') setState('play'); break; // a click beside the menu
    case 'retry': retry(); break;
    case 'quit': setState('title'); break;
    case 'perk': pickPerk(+x); break;
    case 'set':
      st[x] = ['quality', 'cap', 'crt', 'fps'].includes(x) ? y : +y;
      save(); applySettings();
      break;
    default:
  }
}
hud.onAct = act;

function pickPerk(i) {
  if (G.sim.state !== 'perk') return;
  choosePerk(G.sim, i);
  setState('play');
}

function applySettings() {
  audio.applyVolume();
  gfx.fx.uCrt.value = +st.crt;
  hud.showFps = st.fps === '1' || Q.has('fps');
  hud.el.fps.hidden = !hud.showFps;
  gfx.auto = st.quality === 'auto' && !Q.has('scale');
  if (Q.has('scale')) gfx.setScale(num('scale', 0.54));
  else if (st.quality !== 'auto') gfx.setScale(+st.quality);
}

// ---- input ------------------------------------------------------------------------------------

const MENU = { Enter: 'start', KeyS: 'sev', KeyO: 'options', KeyH: 'help', KeyN: 'night', KeyL: 'board', KeyP: 'prompt' };
const PAUSE = { Escape: 'resume', Enter: 'resume', KeyO: 'options', KeyH: 'help', KeyR: 'retry', KeyQ: 'quit' };

// Physical key codes, so WASD works on any layout. Virtual keyboards (remote desktops, test drivers) can send a
// missing or wrong code: ?bykey=1 reads the key's meaning instead.
const KEY_CODE = { Enter: 'Enter', ' ': 'Space', Escape: 'Escape', Shift: 'ShiftLeft', '`': 'Backquote', Tab: 'Tab' };
const BYKEY = Q.has('bykey');
const codeOf = (e) => {
  if (!BYKEY && e.code && e.code !== 'Unidentified') return e.code;
  const k = e.key;
  return KEY_CODE[k] || (/^[a-z]$/i.test(k) ? `Key${k.toUpperCase()}` : /^\d$/.test(k) ? `Digit${k}` : k);
};
addEventListener('keydown', (e) => {
  if (Q.has('keys')) console.log(`keydown code=${e.code} key=${e.key}`);
  if (e.repeat) return;
  const c = codeOf(e), s = G.state;
  keys.add(c); tapped.add(c);
  G.idle = 0;
  if (c === 'Backquote') { st.fps = st.fps === '1' ? '0' : '1'; save(); applySettings(); }
  if (s === 'wake') pickUp();
  else if (s === 'call') { if (c === 'Enter' || c === 'Space') acknowledge(); }
  else if (s === 'intro') startGame();
  else if ((s === 'title' || s === 'paused') && G.sub !== 'main') { if (c === 'Escape' || c === 'Enter') act('back'); }
  else if (s === 'title') { if (MENU[c] && (c !== 'KeyN' || st.won)) act(MENU[c]); }
  else if (s === 'paused') { if (PAUSE[c]) act(PAUSE[c]); }
  else if (s === 'perk') { if (c >= 'Digit1' && c <= 'Digit3') pickPerk(+c[5] - 1); }
  else if (s === 'dead') { if (performance.now() > G.endT) { if (c === 'Enter' || c === 'KeyR') retry(); else if (c === 'KeyQ') setState('title'); } }
  else if (s === 'won') { if (c === 'Enter') setState('title'); else if (c === 'KeyN' && !G.endless) act('night'); }
  else if (s === 'play') {
    if (c >= 'Digit1' && c <= 'Digit4') pressed.weapon = +c[5] - 1;
    else if (c === 'Space') pressed.jump = true;
    else if (c === 'ShiftLeft' || c === 'ShiftRight') pressed.dash = true;
    else if (c === 'KeyQ') pressed.rollback = true;
    else if (c === 'KeyF') pressed.sudo = true;
    else if (c === 'KeyP' || c === 'Escape') setState('paused');
    if (c === 'Space' || c === 'Tab') e.preventDefault();
  }
});
addEventListener('keyup', (e) => keys.delete(codeOf(e)));
addEventListener('blur', () => { keys.clear(); fireHeld = false; });
addEventListener('mousedown', (e) => {
  G.idle = 0;
  if (G.state === 'wake') pickUp();
  else if (G.state === 'call' && TOUCH) acknowledge();
  else if (G.state === 'intro') startGame();
  else if (G.state === 'play') {
    if (document.pointerLockElement !== canvas && !G.bot && !G.manual) canvas.requestPointerLock()?.catch?.(() => {});
    if (e.button === 0) { fireHeld = true; pressed.fire = true; } else if (e.button === 2) pressed.rollback = true;
  }
});
addEventListener('mouseup', (e) => { if (e.button === 0) fireHeld = false; });
addEventListener('contextmenu', (e) => e.preventDefault());
addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== canvas || G.state !== 'play' || performance.now() < lockT) return;
  // some setups report the pointer's jump to the centre as one huge move when the lock engages; one event of a
  // real flick stays well under 160 px
  const mx = Math.max(-160, Math.min(160, e.movementX)), my = Math.max(-160, Math.min(160, e.movementY));
  look.dyaw -= mx * 0.0022 * st.sens; look.dpitch -= my * 0.0022 * st.sens;
});
addEventListener('wheel', (e) => {
  if (G.state !== 'play') return;
  const p = G.sim.player, d = e.deltaY > 0 ? 1 : -1;
  for (let i = 1; i <= 4; i++) { const w = (p.weapon + d * i + 8) % 4; if (p.unlocked[w]) { pressed.weapon = w; break; } }
}, { passive: true });
let lockT = 0;
document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement) lockT = performance.now() + 200;
  else if (G.state === 'play' && !G.bot && !G.manual) setState('paused');
});
document.addEventListener('visibilitychange', () => { if (document.hidden && G.state === 'play' && !G.bot) setState('paused'); });

function readInput() {
  inp.mx = (down('KeyD') || down('ArrowRight') ? 1 : 0) - (down('KeyA') || down('ArrowLeft') ? 1 : 0);
  inp.mz = (down('KeyW') || down('ArrowUp') ? 1 : 0) - (down('KeyS') || down('ArrowDown') ? 1 : 0);
  inp.dyaw = look.dyaw; inp.dpitch = look.dpitch;
  // a click shorter than a frame still fires once
  inp.jump = keys.has('Space'); inp.jumpPressed = pressed.jump; inp.dash = pressed.dash; inp.fire = fireHeld || pressed.fire; inp.firePressed = pressed.fire;
  inp.rollback = pressed.rollback; inp.sudo = pressed.sudo; inp.weapon = pressed.weapon;
  look.dyaw = look.dpitch = 0;
  pressed.jump = pressed.dash = pressed.fire = pressed.rollback = pressed.sudo = false; pressed.weapon = -1;
  tapped.clear();
}

// ---- sim events -> sound and game flow ------------------------------------------------------------

function onEvent(e, sim) {
  const A = audio, at = { x: e.x, z: e.z };
  switch (e.t) {
    case 'act': {
      const a = ACTS[e.act];
      view.setWorld(sim.world);
      gfx.U.uAccent.value.set(a.accent[0], a.accent[1], a.accent[2]);
      gfx.U.uFog.value.set(a.fog[0], a.fog[1], a.fog[2]);
      if (!G.demo) { hud.accent(a.accent); A.setMusic(a.music); if (e.act === 1) A.say('act2'); else if (e.act === 2) A.say('act3'); }
      return;
    }
    default:
  }
  if (G.demo) return;
  switch (e.t) {
    case 'brief': G.cp = { wave: e.wave, perks: [...sim.perkLog], score: sim.score }; A.play('alarm', { vol: 0.7 }); A.say(e.voice, 0); break;
    case 'fire': A.play(WEAPONS[e.weapon].id, { vol: e.weapon === 0 ? 0.55 : 0.9 }); if (e.canary) A.play('ding', { vol: 0.6 }); break;
    case 'hit': A.play('hit', { vol: 0.5, rate: e.kill ? 1.4 : 1 }); break;
    case 'kill': if (!e.quiet) A.play('confirm', { vol: 0.55 }); break;
    case 'explode': A.play('boom', { ...at, vol: 1.1 }); break;
    case 'overheat': A.play('overheat'); A.say('rate', 14); break;
    case 'cooled': A.play('cool', { vol: 0.6 }); break;
    case 'dry': A.play('dry'); break;
    case 'switch': A.play('tick', { rate: 0.7 }); break;
    case 'dash': A.play('dash'); break;
    case 'jump': A.play('jump'); break;
    case 'land': A.play('land', { vol: Math.min(1, e.v / 14) }); break;
    case 'hurt': A.play('hurt', { vol: e.dot ? 0.4 : 0.9 }); break;
    case 'coffee': A.play('coffee'); break;
    case 'rollback': A.play('rollback'); break;
    case 'rollbackEnd': A.say('rollback', 25); break;
    case 'sudoReady': A.say('sudoReady', 40); break;
    case 'sudo': A.play('sudo'); A.say('sudo', 90); break;
    case 'spawn': if (e.type !== 'packet') A.play('spawn', { ...at, vol: 0.5 }); break;
    case 'cronTele': A.play('ding', { ...at, vol: 0.8 }); break;
    case 'enemyShot': A.play('eshot', { ...at, vol: 0.8 }); break;
    case 'blink': A.play('blink', at); break;
    case 'raceDown': A.play('tick', { ...at, vol: 1 }); break;
    case 'raceRevive': A.play('blink', { ...at, rate: 0.6 }); break;
    case 'bruteWindup': A.play('roar', at); break;
    case 'bruteCrash': A.play('crash', at); break;
    case 'leakFuse': A.play('fuse', at); break;
    case 'split': A.play('split', at); break;
    case 'bossRing': A.play('ring', at); break;
    case 'deflect': A.play('shield', at); break;
    case 'shieldDown': A.play('crash'); A.say('shieldDown', 0, true); break;
    case 'bossFight': A.play('roar'); A.say('shield', 0); break;
    case 'bossPhase3': A.play('alarm'); A.say('phase3', 0, true); break;
    case 'bossDying': A.play('boom'); A.setMusic('', 3); break;
    case 'bossDead': A.play('boom'); A.say('bossDead', 0, true); break;
    case 'waveEnd': A.play('clear'); if (!e.boss) { A.say('clear', 0); report(sim, e.wave + 1); } break; // the boss ends in 'won'
    case 'perk': case 'unlock': A.play('perk'); break;
    case 'voice': A.say(e.id, 30); break;
    case 'breaker': A.play('boom'); A.say('breaker', 0, true); break;
    case 'combo': if (e.n === 25) A.say('combo', 120); break;
    case 'dead':
      G.deaths++; sim.stats.deaths++; G.causes[e.cause] = (G.causes[e.cause] || 0) + 1;
      if (sim.score > st.best) { st.best = sim.score; save(); }
      A.play('dead'); A.hush(); A.say('dead', 0, true);
      G.deadT = 0; G.endT = performance.now() + 1400;
      report(sim, sim.wave, { cause: e.cause });
      setTimeout(() => { if (G.sim === sim && G.state === 'play') setState('dead'); }, 1400);
      break;
    case 'won':
      st.won = true; st.best = Math.max(st.best, sim.score); save();
      hud.accent(DAWN.css);
      A.setMusic('dawn', 3); A.say('win', 0, true);
      report(sim, WAVES.length, { won: true });
      setTimeout(() => { if (G.sim === sim) setState('won'); }, 2600);
      break;
    default:
  }
}

// ---- frame --------------------------------------------------------------------------------------

const cam = { x: 0, y: 0, z: 0, fx: 0, fy: 0, fz: -1, rx: 1, rz: 0 };
const noise = (t, k) => Math.sin(t * 37.1 * k + k * 11) * 0.6 + Math.sin(t * 71.7 * k + k * 3) * 0.4;

/** Advance the game by dt seconds. */
function update(dt) {
  const sim = G.sim, p = sim.player, playing = G.state === 'play';
  G.t += dt;
  if (G.demo && sim.over) { startDemo(); return; }
  const live = playing || G.demo;
  if (live) {
    if (G.bot) botInput(G.bot, sim, dt, inp); else readInput();
    seen.dyaw = inp.dyaw; seen.dpitch = inp.dpitch;
    step(sim, inp, dt);
    if (sim.state === 'perk') {
      if (G.bot) choosePerk(sim, botPerk(sim));
      else if (playing) setState('perk');
    }
  }

  // camera first: this frame's effects (tracers, muzzle light) start from where the player is looking now
  const sh = fx.trauma * fx.trauma, t = G.t;
  if (G.demo) {
    const a = t * 0.07, r = 15;
    camera.position.set(p.x + Math.sin(a) * r, 8.5, p.z + Math.cos(a) * r);
    camera.lookAt(p.x, 1.2, p.z);
  } else {
    const sp = Math.hypot(p.vx, p.vz), side = p.vx * Math.cos(p.yaw) - p.vz * Math.sin(p.yaw);
    G.bob += dt * sp * 1.25 * (p.onGround ? 1 : 0);
    if (playing && p.onGround && sp > 3 && !p.dead && (G.stepT -= dt * sp / 8.6) <= 0) { G.stepT = 0.33; audio.play('land', { vol: 0.14, rate: 1.8 }); }
    G.tilt += (-side * 0.0035 - G.tilt) * Math.min(1, dt * 8);
    if (p.dead) G.deadT = Math.min(1, G.deadT + dt * 1.3);
    const d = G.deadT * G.deadT;
    camera.position.set(p.x, p.y + PLAYER.eye - fx.dip + Math.abs(Math.sin(G.bob)) * 0.035 * Math.min(1, sp / 8) - d * 1.25, p.z);
    camera.rotation.set(p.pitch + fx.kick * 0.16 + sh * 0.045 * noise(t, 1) + d * 0.3, p.yaw + sh * 0.045 * noise(t, 1.3), G.tilt + sh * 0.06 * noise(t, 1.7) + d * 0.9);
  }
  const fov = +st.fov + fx.fov + (p.sudoT > 0 ? 5 : 0);
  if (Math.abs(camera.fov - fov) > 0.05) { camera.fov = fov; camera.updateProjectionMatrix(); }
  camera.updateMatrixWorld();
  const m = camera.matrixWorld.elements;
  cam.x = camera.position.x; cam.y = camera.position.y; cam.z = camera.position.z;
  cam.rx = m[0]; cam.rz = m[2]; cam.fx = -m[8]; cam.fy = -m[9]; cam.fz = -m[10];
  const rl = Math.hypot(cam.rx, cam.rz) || 1;
  cam.rx /= rl; cam.rz /= rl;
  audio.listener(p.x, p.z, p.yaw);

  if (live) {
    for (const e of sim.events) {
      fx.on(e, sim, cam);
      if (!G.demo) hud.on(e, sim);
      onEvent(e, sim);
    }
    sim.events.length = 0;
    if (playing && (G.idle += dt) > 50) { G.idle = 0; audio.say('idle', 120); }
  }
  fx.update(dt, sim);
  audio.update(dt);

  // uniforms
  const U = gfx.U, F = gfx.fx, low = p.hp / p.maxHp < 0.3 && !p.dead ? 0.25 + 0.15 * Math.sin(t * 7) : 0;
  U.uTime.value = t;
  if (sim.over === 'won') { U.uAccent.value.lerp(DAWN.accent, Math.min(1, dt * 0.4)); U.uFog.value.lerp(DAWN.fog, Math.min(1, dt * 0.4)); } // sunrise
  U.uBass.value = audio.music ? audio.bass : 0.12 + 0.1 * Math.sin(t * 2.1);
  F.uGlitch.value = Math.max(fx.glitch, p.dead ? 0.35 : 0); F.uHurt.value = Math.max(fx.hurt, low); F.uFlash.value = fx.flash;
  F.uAberr.value = sh * 0.006 + (p.dashT > 0 ? 0.004 : 0); F.uRewind.value = p.rewind > 0 ? 1 : 0;
  if (p.rewind > 0) { F.uTint.value.set(0.3, 0.7, 1); F.uTintAmt.value = 0.7; }
  else if (p.sudoT > 0) { F.uTint.value.set(1, 0.8, 0.25); F.uTintAmt.value = 0.3; }
  else { F.uTint.value.set(0.4, 1, 0.6); F.uTintAmt.value = fx.tint * 0.25; }
  const fade = G.state === 'play' ? 1 : G.state === 'title' ? 0.6 : G.state === 'paused' ? 0.3 : 0.45;
  F.uFade.value += (fade - F.uFade.value) * Math.min(1, dt * 6);

  // batches
  view.boxes.begin(); view.glow.begin(); view.glyphs.begin();
  drawActors(view, sim, t, cam);
  if (G.demo) {
    // the on-call engineer, seen from outside
    const B = view.boxes;
    B.base(p.x, p.y, p.z, p.yaw, 1);
    B.box(0, 0.45, 0, 0.36, 0.9, 0.24, 0.8, 0.85, 0.9, 0.2); B.box(0, 1.2, 0, 0.5, 0.62, 0.28, 0.9, 0.95, 1, 0.3);
    B.box(0, 1.68, 0, 0.26, 0.26, 0.26, 1, 1, 1, 0.5); B.box(0.22, 1.25, -0.4, 0.08, 0.1, 0.55, 0.3, 1, 0.6, 0.8);
  }
  fx.draw();
  view.boxes.end(); view.glow.end(); view.glyphs.end();
  if (!G.demo) vm.update(dt, sim, seen, fx, t);
  if (!G.demo) hud.update(sim, dt, gfx);
}

const draw = () => gfx.render(view.scene, camera, G.demo || G.sim.player.dead ? null : vm.scene, vm.camera);

let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const raw = Math.min(0.1, (now - last) / 1000);
  last = now;
  // the phone, the call and the intro are DOM only: nothing to render, but the announcer still has to speak
  if (G.state === 'call' || G.state === 'intro') audio.update(raw);
  if (G.manual || G.state === 'boot' || G.state === 'wake' || G.state === 'call' || G.state === 'intro') return;
  // frame cap: 30 on request, 30 behind menus, 12 while paused
  const limit = G.state === 'paused' ? 12 : G.state !== 'play' || st.cap === '30' ? 30 : 0;
  G.capAcc += raw;
  if (limit && G.capAcc < 1 / (limit + 1.5)) return;
  const dt = Math.min(0.1, G.capAcc);
  G.capAcc = 0;
  update(dt);
  draw();
  if (G.state === 'play') {
    gfx.tick(dt, limit || 60);
    G.frames.push(dt * 1000);
    if (G.frames.length > 3600) G.frames.shift();
  }
}

function resize() {
  const w = innerWidth, h = innerHeight;
  gfx.resize(w, h);
  camera.aspect = w / h; camera.updateProjectionMatrix();
  vm.resize(w / h);
}
addEventListener('resize', resize);

// ---- boot ---------------------------------------------------------------------------------------

resize();
applySettings();
startDemo();
update(1 / 60);
// auto resolution stops at 0.72: above that the chunky pixels, which are the look, start to disappear
if (gfx.auto) gfx.calibrate(draw, st.cap === '30' ? 20 : 8.5, 0.72);
if (Q.has('auto')) {
  // unattended run: straight into the game with the autopilot
  if (!Q.has('mute')) audio.init();
  startGame({ wave: num('wave', 0) });
} else setState('wake');
requestAnimationFrame(frame);

// world stats: one visit, then a heartbeat while the page is in front
beat(true);
setInterval(() => { if (!document.hidden) beat(); }, 20000);
addEventListener('pagehide', () => net.leave());

/** Test and debugging hooks. */
// @ts-ignore
window.__game = {
  G, gfx, fx, st, hud, audio, net, view, vm, camera, tips: TIPS,
  get sim() { return G.sim; },
  /** Advance the sim by seconds in fixed steps and render once (deterministic screenshots). */
  step(seconds, dt = 1 / 60) {
    for (let t = 0; t < seconds - 1e-9; t += dt) update(dt);
    draw();
    return G.sim.stats.time;
  },
  perf() {
    const f = [...G.frames].sort((a, b) => a - b), n = f.length || 1, avg = f.reduce((s, v) => s + v, 0) / n;
    return {
      frames: f.length, fpsAvg: +(1000 / avg).toFixed(1), msP50: +(f[n >> 1] || 0).toFixed(1), msP95: +(f[Math.floor(n * 0.95)] || 0).toFixed(1),
      msP99: +(f[Math.floor(n * 0.99)] || 0).toFixed(1), msMax: +(f[n - 1] || 0).toFixed(1), scale: gfx.scale, scene: `${gfx.sceneW}x${gfx.sceneH}`,
      out: `${gfx.outW}x${gfx.outH}`, calls: gfx.calls, tris: gfx.tris, enemies: G.sim.enemies.length, calibration: gfx.calibration, ...fx.counts(),
    };
  },
  resetPerf() { G.frames.length = 0; },
  /** Burn error budget (tests). */
  hurt: (n) => hurtPlayer(G.sim, n, G.sim.player.x, G.sim.player.z - 1, 'the test suite'),
  /** Put an enemy in the world (tests, screenshots). */
  spawn: (type, x, z, o) => spawnEnemy(G.sim, type, x, z, o),
};
