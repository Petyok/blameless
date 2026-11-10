// Draws the sim state into the batches: enemies (a few boxes each), their labels, projectiles, pickups.
// Local frame: -z is forward, +x is the creature's right, y up from the feet.
import { ENEMY, BOSS } from '../sim/config.js';
import { LABEL } from './text.js';

const TAU = Math.PI * 2;
const hash = (x) => { const s = Math.sin(x * 127.1) * 43758.5453; return s - Math.floor(s); };
const RING_TEXT = 'ERROR 500 ';
const BOSS_TEXT = ['java.lang.OutOfMemoryError', 'at Monolith.doEverything()', '// TODO: rewrite (2011)', 'DO NOT TOUCH - it works'];

const DRAW = {
  zombie(B, e, t, c) {
    const ph = t * 7 + e.seed * 20, sw = Math.sin(ph) * 0.55, atk = e.atkT > 0 ? 0.7 : Math.sin(ph * 0.5) * 0.1;
    const r = c[0], g = c[1], b = c[2];
    B.box(-0.14, 0.42, 0, 0.18, 0.84, 0.2, r * 0.6, g * 0.6, b * 0.6, 0, sw);
    B.box(0.14, 0.42, 0, 0.18, 0.84, 0.2, r * 0.6, g * 0.6, b * 0.6, 0, -sw);
    B.box(0, 1.14, -0.06, 0.5, 0.66, 0.28, r, g, b, 0, -0.24);
    B.box(-0.3, 1.34, -0.42, 0.12, 0.12, 0.62, r, g, b, 0, atk);
    B.box(0.3, 1.34, -0.42, 0.12, 0.12, 0.62, r, g, b, 0, atk * 0.8 + 0.08);
    B.box(0, 1.66, -0.14, 0.3, 0.3, 0.3, r, g, b, 0.05, 0, 0, Math.sin(t * 2 + e.seed * 9) * 0.28);
    B.box(0, 1.68, -0.3, 0.2, 0.05, 0.03, 1, 0.25, 0.15, 2);
  },

  fork(B, e, t, c) {
    const hop = Math.abs(Math.sin(t * 6 + e.seed * 9)) * 0.35, spin = t * 1.6 + e.seed * 6, r = c[0], g = c[1], b = c[2];
    B.box(0, 0.62 + hop, 0, 0.8, 0.8, 0.8, r, g, b, 0.08, 0, spin);
    B.box(0, 0.62 + hop, 0, 0.05, 0.86, 0.86, 1, 0.9, 0.6, 1.4, 0, spin);
    B.box(-0.36, 1.28 + hop, 0, 0.16, 0.7, 0.16, r, g, b, 0.3, 0, spin, 0.5);
    B.box(0.36, 1.28 + hop, 0, 0.16, 0.7, 0.16, r, g, b, 0.3, 0, spin, -0.5);
    B.box(-0.25, 0.08, 0, 0.22, 0.16, 0.3, r * 0.5, g * 0.5, b * 0.5);
    B.box(0.25, 0.08, 0, 0.22, 0.16, 0.3, r * 0.5, g * 0.5, b * 0.5);
  },

  // a wall clock: it fires when the long hand reaches twelve
  cron(B, e, t, c) {
    const a = e.t / ENEMY.cron.period * TAU, hot = e.tele || e.vol > 0, k = hot ? 1.3 : 0.12, r = c[0], g = c[1], b = c[2];
    const sh = hot ? Math.sin(t * 70) * 0.04 : 0;
    B.box(sh, 0.6, 0, 1.1, 1.1, 0.16, r * 0.45, g * 0.45, b * 0.45, k * 0.5);
    B.box(0, 1.06, -0.1, 0.08, 0.16, 0.04, 1, 1, 1, 1.5);
    B.box(0, 0.14, -0.1, 0.06, 0.12, 0.04, r, g, b, 0.6);
    B.box(-0.46, 0.6, -0.1, 0.12, 0.06, 0.04, r, g, b, 0.6);
    B.box(0.46, 0.6, -0.1, 0.12, 0.06, 0.04, r, g, b, 0.6);
    B.box(-Math.sin(a) * 0.23 + sh, 0.6 + Math.cos(a) * 0.23, -0.13, 0.07, 0.46, 0.04, 1, 0.95, 0.7, 1.2 + k, 0, 0, a);
    B.box(-Math.sin(t * 0.4) * 0.13, 0.6 + Math.cos(t * 0.4) * 0.13, -0.12, 0.08, 0.26, 0.04, r, g, b, 0.5, 0, 0, t * 0.4);
    B.box(0, -0.12, 0, 0.12, 0.3, 0.12, r * 0.5, g * 0.5, b * 0.5, 0, 0, 0, Math.sin(t * 3 + e.seed * 7) * 0.5);
  },

  packet(B, e, t, c) {
    B.box(0, 0.24, 0, 0.44, 0.26, 0.6, c[0], c[1], c[2], 0.4, 0, 0, Math.sin(t * 9 + e.seed * 30) * 0.5);
    B.box(0, 0.24, 0.55, 0.08, 0.08, 0.55, c[0] * 0.6, c[1] * 0.6, c[2] * 0.6, 0.2);
  },

  race(B, e, t, c0, G) {
    const c = e.variant ? ENEMY.race.colorB : c0, r = c[0], g = c[1], b = c[2];
    if (e.state === 'down') {
      const k = e.t / ENEMY.race.window;
      B.box(0, 0.12, 0, 1.3, 0.2, 0.4, r * 0.4, g * 0.4, b * 0.4, 0.1 + 0.4 * (Math.sin(t * 20) > 0 ? 1 : 0), 0, e.seed * 6);
      G.box(0, 0.3 + k * 0.8, 0, 0.1, k * 1.6, 0.1, 1, 1, 1, 0.9);
      return;
    }
    const ph = t * 15 + e.seed * 20, sw = Math.sin(ph) * 0.9;
    B.box(-0.1, 0.5, 0, 0.14, 1.0, 0.16, r * 0.7, g * 0.7, b * 0.7, 0, sw);
    B.box(0.1, 0.5, 0, 0.14, 1.0, 0.16, r * 0.7, g * 0.7, b * 0.7, 0, -sw);
    B.box(0, 1.3, -0.15, 0.34, 0.8, 0.22, r, g, b, 0.15, -0.45);
    B.box(0, 1.78, -0.36, 0.24, 0.24, 0.24, r, g, b, 0.3, -0.3);
    B.box(0, 1.4, 0.5, 0.06, 0.06, 0.9, r, g, b, 0.8);
    B.box(0, 1.05, 0.42, 0.05, 0.05, 0.7, r, g, b, 0.6);
  },

  leak(B, e, t, c) {
    const s = e.r, fuse = e.state === 'oom', strobe = fuse && Math.sin(t * 44) > 0;
    const p = 1.25 * s * (1 + Math.sin(t * (fuse ? 30 : 3) + e.seed * 7) * (fuse ? 0.1 : 0.05));
    const r = strobe ? 1 : c[0], g = strobe ? 1 : c[1], b = strobe ? 1 : c[2];
    B.box(0, s, 0, p, p, p, r, g, b, fuse ? 1.2 : 0.25, 0.62, t * 0.7, 0.62);
    const n = Math.min(8, 2 + Math.floor((s - 0.5) / 0.25));
    for (let i = 0; i < n; i++) {
      const a = t * 1.3 + i * TAU / n, q = 0.3 * s;
      B.box(Math.cos(a) * s * 1.2, s + Math.sin(a * 1.7 + i) * s * 0.45, Math.sin(a) * s * 1.2, q, q, q, r * 0.8, g * 0.8, b * 0.8, 0.5, t + i, t * 2 + i);
    }
  },

  // unobserved it flickers and jitters; right after a blink it is solid and can be hit
  heisen(B, e, t, c) {
    const solid = e.blinkCd > 0, j = solid ? 0 : 0.11, f = (i) => (hash(Math.floor(t * 30) + i * 17 + e.seed * 99) - 0.5) * 2 * j;
    const r = solid ? 1 : c[0], g = solid ? 0.95 : c[1], b = solid ? 1 : c[2], k = solid ? 0.7 : 0.1;
    B.box(-0.14 + f(1), 0.32, f(2), 0.16, 0.64, 0.18, r * 0.7, g * 0.7, b * 0.7, k);
    B.box(0.14 + f(3), 0.32, f(4), 0.16, 0.64, 0.18, r * 0.7, g * 0.7, b * 0.7, k);
    B.box(f(5), 1.05 + f(6), f(7), 0.5, 0.86, 0.3, r, g, b, k);
    B.box(-0.36 + f(8), 1.1, f(9), 0.12, 0.7, 0.14, r, g, b, k);
    B.box(0.36 + f(10), 1.1, f(11), 0.12, 0.7, 0.14, r, g, b, k);
    B.box(f(12), 1.66 + f(13), f(14), 0.34, 0.34, 0.34, r, g, b, k + 0.3);
    B.box(0, 2.1 + Math.sin(t * 4) * 0.06, 0, 0.14, 0.14, 0.14, 1, 1, 1, 1.5, t * 2, t * 3);
  },

  brute(B, e, t, c) {
    const st = e.state, ph = t * 5 + e.seed * 9, sw = st === 'run' ? Math.sin(ph) * 0.4 : st === 'charge' ? Math.sin(t * 22) * 0.7 : 0;
    const lean = st === 'charge' ? -0.6 : st === 'windup' ? 0.28 : st === 'stun' ? 0.45 : -0.1;
    const q = st === 'windup' ? 0.86 : st === 'stun' ? 0.72 : 1, hot = st === 'windup' || st === 'charge';
    const r = c[0], g = c[1], b = c[2];
    B.box(-0.4, 0.5, 0, 0.5, 1.0, 0.55, r * 0.5, g * 0.5, b * 0.5, 0, sw);
    B.box(0.4, 0.5, 0, 0.5, 1.0, 0.55, r * 0.5, g * 0.5, b * 0.5, 0, -sw);
    B.box(0, 1.65 * q, -0.1, 1.6, 1.15, 0.95, r, g, b, hot ? 0.35 : 0.05, lean);
    B.box(-1.05, 1.3 * q, -0.1, 0.5, 1.4, 0.6, r * 0.8, g * 0.8, b * 0.8, 0, lean - sw);
    B.box(1.05, 1.3 * q, -0.1, 0.5, 1.4, 0.6, r * 0.8, g * 0.8, b * 0.8, 0, lean + sw);
    B.box(0, 2.32 * q, -0.45, 0.5, 0.45, 0.5, r * 0.7, g * 0.7, b * 0.7, 0, lean);
    B.box(-0.13, 2.35 * q, -0.72, 0.1, 0.07, 0.03, 1, 0.9, 0.3, hot ? 3 : 1.5);
    B.box(0.13, 2.35 * q, -0.72, 0.1, 0.07, 0.03, 1, 0.9, 0.3, hot ? 3 : 1.5);
    B.box(0.1, 2.25 * q, 0.55, 2.6, 0.1, 0.1, 0.75, 0.75, 0.8, 0.2, 0, 0, 0.55);
    B.box(-0.95, 2.95 * q, 0.55, 0.14, 0.6, 0.1, 0.9, 0.9, 1, 0.6, 0, 0, -0.5);
  },

  pylon(B, e, t, c, G, sim) {
    const r = c[0], g = c[1], b = c[2];
    for (let i = 0; i < 4; i++) {
      const w = 0.95 - i * 0.13;
      B.box(0, 0.48 + i * 0.95, 0, w, 0.8, w, r * 0.6, g * 0.6, b * 0.6, 0.1, 0, t * (i % 2 ? 0.9 : -0.9) + i);
    }
    B.box(0, 4.25, 0, 0.42, 0.42, 0.42, r, g, b, 1.4, t * 1.1, t * 1.7);
    const boss = sim.enemies.find((a) => a.type === 'boss');
    if (boss) G.beam(e.x, 4.25, e.z, boss.x, 6.6, boss.z, 0.07 + 0.03 * Math.sin(t * 20 + e.seed * 9), r, g, b, 0.7);
  },

  // 1 : 4 : 9
  boss(B, e, t, c, G, sim, T, cam) {
    const dying = e.state === 'dying', k = dying ? e.t / BOSS.deathTime : 0;
    const rise = e.state === 'intro' ? -9.2 * (1 - Math.min(1, e.t / (BOSS.intro - 0.5))) ** 2 : -k * 3;
    const jx = dying ? (hash(t * 40) - 0.5) * 0.25 : 0;
    B.box(jx, 4.5 + rise, 0, 4, 9, 1, 0.3, 0.035, 0.06, 0.0, k * 0.3, 0, k * 0.2);
    // drive bays: thin lit seams across the face
    if (!dying) for (let i = 0; i < 7; i++) B.box(0, 1.0 + i * 1.15 + rise, -0.51, 3.7, 0.05, 0.04, 1, 0.1, 0.13, 0.35 + 0.5 * (Math.sin(t * 2 + i * 1.7) > 0.6 ? 1 : 0));
    B.box(0, 0.16, 0, 5.2, 0.32, 2.2, c[0] * 0.25, c[1] * 0.25, c[2] * 0.25, 0.05);
    if (!dying) B.box(Math.sin(t * 1.3) * 1.2, 6.6 + rise, -0.52, 1.0, 0.2, 0.06, 1, 0.12, 0.14, 2.6);
    if (e.shield && e.state !== 'intro') {
      for (let i = 0; i < 6; i++) {
        const a = t * 0.5 + i * TAU / 6, a2 = a + TAU / 6, R = 3.3;
        G.beam(e.x + Math.cos(a) * R, 0, e.z + Math.sin(a) * R, e.x + Math.cos(a) * R, 9.2, e.z + Math.sin(a) * R, 0.09, 0.2, 0.9, 0.8, 0.45);
        for (const y of [0.2, 9.1]) {
          G.beam(e.x + Math.cos(a) * R, y, e.z + Math.sin(a) * R, e.x + Math.cos(a2) * R, y, e.z + Math.sin(a2) * R, 0.07, 0.2, 0.9, 0.8, 0.45);
        }
      }
    }
    for (let i = 0; i < e.beamN; i++) {
      const a = e.beamA + i * TAU / e.beamN, cx = Math.cos(a), sz = Math.sin(a), len = e.beamLen[i];
      G.beam(e.x + cx * e.r, BOSS.beamY, e.z + sz * e.r, e.x + cx * len, BOSS.beamY, e.z + sz * len, 0.26, 1, 0.1, 0.16, 1.3);
      G.beam(e.x + cx * e.r, BOSS.beamY, e.z + sz * e.r, e.x + cx * len, BOSS.beamY, e.z + sz * len, 0.08, 1, 0.8, 0.8, 2);
    }
    if (e.state === 'fight') {
      // the face reads like a stack trace; offset towards the viewer so it sits on the slab
      const fx = -Math.sin(e.yaw) * 0.62, fz = -Math.cos(e.yaw) * 0.62;
      for (let i = 0; i < 3; i++) {
        T.text(BOSS_TEXT[(i + Math.floor(t * 0.4)) % BOSS_TEXT.length], e.x + fx, 4.9 - i * 0.8, e.z + fz, 0.42, 1, 0.3, 0.25, 1, cam.rx, cam.rz);
      }
    }
  },
};

/** cam: {x, y, z, rx, rz} — position and ground-plane right vector. */
export function drawActors(v, sim, t, cam) {
  const B = v.boxes, G = v.glow, T = v.glyphs, es = sim.enemies;
  for (let i = 0; i < es.length; i++) {
    const e = es[i];
    if (e.dead) continue;
    const c = ENEMY[e.type].color, born = e.spawnT > 0 ? 1 - Math.min(1, e.spawnT / 0.6) : 1;
    const s = (e.type === 'fork' ? e.r / 0.75 : 1) * (0.25 + 0.75 * born);
    B.base(e.x, e.y, e.z, e.yaw, s, e.flash > 0 ? 0.75 : 0, born < 1 || (e.type === 'heisen' && e.blinkCd <= 0) ? 1 + e.seed : 0);
    G.base(e.x, e.y, e.z, e.yaw, 1);
    DRAW[e.type](B, e, t, c, G, sim, T, cam);
    if (born < 1) G.box(0, 5, 0, 0.12 + 0.4 * (1 - born), 10, 0.12 + 0.4 * (1 - born), c[0], c[1], c[2], 0.5 * (1 - born));
    // label
    const d = Math.hypot(e.x - cam.x, e.z - cam.z);
    if (d < 26 && e.type !== 'packet' && e.state !== 'down' && born >= 1) {
      let txt = e.type === 'pylon' ? e.name : LABEL[e.type];
      if (e.type === 'race') txt = e.name;
      else if (e.type === 'leak') txt = e.state === 'oom' ? 'OOM' : `${(e.r / ENEMY.leak.rMax * 8).toFixed(1)}G/8G`;
      else if (e.type === 'heisen' && e.blinkCd <= 0) txt = '???';
      const a = Math.min(1, (26 - d) / 8) * (e.type === 'boss' ? 1 : 0.7), top = e.type === 'cron' ? 1.6 : e.h + 0.35;
      T.text(txt, e.x, e.y + top, e.z, e.type === 'boss' ? 0.5 : 0.2, c[0], c[1], c[2], a, cam.rx, cam.rz);
    }
    if (e.type === 'brute' && e.state === 'stun') {
      for (let k = 0; k < 3; k++) T.add(e.x + Math.cos(t * 5 + k * 2.1) * 0.7, 2.9, e.z + Math.sin(t * 5 + k * 2.1) * 0.7, 0.4, 1, 1, 0.4, 1, 42, t * 3);
    }
    // the tether between twin threads
    if (e.type === 'race' && e.variant === 0) {
      const tw = es.find((a) => a.id === e.twin && !a.dead);
      if (tw) {
        const down = e.state === 'down' || tw.state === 'down', blink = down ? (Math.sin(t * 30) > 0 ? 1 : 0.1) : 0.35;
        G.beam(e.x, e.state === 'down' ? 0.2 : 1.3, e.z, tw.x, tw.state === 'down' ? 0.2 : 1.3, tw.z, 0.04, down ? 1 : 0.6, down ? 1 : 0.5, 1, blink);
      }
    }
  }

  // enemy projectiles are glyphs
  for (const s of sim.shots) {
    if (s.kind === 2) {
      const i = ((Math.round(Math.atan2(s.vz, s.vx) / TAU * BOSS.ringShots) % 10) + 10) % 10;
      T.add(s.x, s.y + 0.15, s.z, 1.0, 1, 0.2, 0.25, 1, RING_TEXT.charCodeAt(i) === 32 ? 35 : RING_TEXT.charCodeAt(i));
      G.base(s.x, s.y, s.z, 0, 1);
      G.box(0, 0, 0, 0.2, 0.2, 0.2, 1, 0.15, 0.2, 0.9, t * 5, t * 7);
    } else {
      const col = s.kind === 0 ? ENEMY.cron.color : s.kind === 1 && s.cause === 'a heisenbug' ? ENEMY.heisen.color : ENEMY.boss.color;
      T.add(s.x, s.y, s.z, 0.75, col[0], col[1], col[2], 1, s.kind === 0 ? 42 : s.cause === 'a heisenbug' ? 63 : 120, t * 9);
      G.base(s.x, s.y, s.z, 0, 1);
      G.box(0, 0, 0, 0.16, 0.16, 0.16, col[0], col[1], col[2], 1, t * 6, t * 8);
    }
  }
  for (const r of sim.rockets) {
    const sp = Math.hypot(r.vx, r.vy, r.vz), dx = r.vx / sp, dy = r.vy / sp, dz = r.vz / sp;
    B.beam(r.x - dx * 0.3, r.y - dy * 0.3, r.z - dz * 0.3, r.x + dx * 0.3, r.y + dy * 0.3, r.z + dz * 0.3, 0.16, 1, 0.3, 0.42, 0.5);
    G.beam(r.x - dx * 0.9, r.y - dy * 0.9, r.z - dz * 0.9, r.x - dx * 0.3, r.y - dy * 0.3, r.z - dz * 0.3, 0.1, 1, 0.6, 0.2, 1.2);
  }
  // coffee
  for (const c of sim.pickups) {
    if (c.t < 5 && Math.sin(t * 16) > 0.2) continue;
    const y = c.y + Math.sin(t * 3 + c.x) * 0.08;
    B.base(c.x, y, c.z, t * 2, 1);
    B.box(0, 0, 0, 0.3, 0.34, 0.3, 0.95, 0.9, 0.8, 0.5);
    B.box(0.21, 0, 0, 0.1, 0.18, 0.07, 0.95, 0.9, 0.8, 0.5);
    B.box(0, 0.16, 0, 0.24, 0.04, 0.24, 0.45, 0.25, 0.1, 0.8);
    for (let k = 0; k < 2; k++) {
      const ph = (t * 0.6 + k * 0.5 + c.x) % 1;
      T.add(c.x + Math.sin(t * 2 + k) * 0.06, y + 0.35 + ph * 0.5, c.z, 0.3, 1, 1, 1, 0.6 * (1 - ph), 126);
    }
  }
}
