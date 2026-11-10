// Director: incidents (waves), spawns, hotfixes (perks), act changes, endless mode. Pure.
import { WAVES, PERKS, SEV, PLAYER, ALIVE_CAP } from './config.js';
import { makeWorld, randomFreeCell, cellOf, computeFlow } from './world.js';
import { spawnEnemy, spawnBoss } from './enemies.js';
import { healPlayer } from './player.js';

const D = { x: 0, z: 0 };

const PERK_FX = {
  autoscale: (p) => { p.maxHp += 25; p.hp = Math.min(p.maxHp, p.hp + 25); },
  cache: (p) => { p.heatMul *= 0.78; },
  gc: (p) => { p.gcHeal += 0.5; },
  canary: (p) => { p.canary = true; },
  lb: (p) => { p.pellets += 3; },
  retry: (p) => { p.retry += 0.2; },
  bluegreen: (p) => { p.rollbackCdMul *= 0.65; },
  breaker: (p) => { p.breakerReady = true; },
  cdn: (p) => { p.speedMul *= 1.12; p.dashCdMul *= 0.75; },
  tracing: (p) => { p.grepMul *= 1.4; },
  chaos: (p) => { p.blastMul *= 1.3; p.noSelf = true; },
  overprov: (p) => { p.dmgMul *= 1.15; },
  espresso: (p) => { p.coffeeRate *= 2; p.coffeeMul *= 1.5; },
  policy: (p) => { p.sudoGain *= 1.4; p.sudoBonus += 2; },
};
const PERK_MIN = { tracing: 3, chaos: 6 }; // not offered before the weapon they boost exists

export function applyPerk(sim, id) {
  const p = sim.player;
  p.perks[id] = (p.perks[id] || 0) + 1;
  sim.perkLog.push(id);
  PERK_FX[id](p);
}

export function choosePerk(sim, k) {
  if (sim.state !== 'perk') return;
  const id = sim.perkChoices[k] ?? sim.perkChoices[0];
  applyPerk(sim, id);
  sim.events.push({ t: 'perk', id });
  sim.perkChoices = null;
  enterWave(sim, sim.wave + 1);
}

const COST = { zombie: 1, fork: 4.5, cron: 4, packet: 0.35, race: 9, leak: 5, heisen: 6, brute: 15 };

/** Incident definition for wave i; past the campaign it is generated (night shift). */
export function waveDef(sim, i) {
  if (i < WAVES.length) return WAVES[i];
  const k = i - WAVES.length, rng = sim.rng, types = Object.keys(COST), groups = [];
  let budget = 48 + k * 9, t = 0;
  while (budget > 0.5) {
    const type = rng.pick(types), c = COST[type];
    const n = type === 'packet' ? 16 + rng.int(12) : type === 'zombie' ? 5 + rng.int(6) : type === 'brute' ? 1 : 1 + rng.int(3);
    groups.push({ t, type, n, gap: type === 'packet' ? 0.12 : undefined });
    budget -= n * c; t += rng.range(3, 7);
  }
  return { inc: 2041 + k, sev: 1, act: k % 3, title: rng.pick(NIGHT), voice: 'night', groups, hpMul: 1 + k * 0.07 };
}
const NIGHT = ['it was DNS', 'expired certificate', 'disk full on /var/log', 'someone ran it in prod', 'works on my machine',
  'clock skew', 'a quick fix from 2019', 'the intern has root', 'kernel upgrade went fine', 'leap second'];

export function enterWave(sim, i) {
  const p = sim.player, w = waveDef(sim, i);
  sim.wave = i; sim.def = w; sim.hpMul = w.hpMul || 1;
  if (!sim.world || sim.world.map !== w.act) {
    sim.world = makeWorld(w.act);
    p.x = sim.world.start.x; p.z = sim.world.start.z; p.y = 0; p.vx = p.vy = p.vz = 0; p.yaw = 0; p.pitch = 0;
    p.hist.length = 0;
    sim.enemies.length = 0; sim.shots.length = 0; sim.rockets.length = 0; sim.pickups.length = 0;
    computeFlow(sim.world, p.x, p.z);
    sim.events.push({ t: 'act', act: w.act });
  }
  for (let k = 0; k <= Math.min(i, WAVES.length - 1); k++) {
    const u = WAVES[k].unlock;
    if (u != null && !p.unlocked[u]) {
      p.unlocked[u] = true;
      if (k === i) { p.weapon = u; sim.events.push({ t: 'unlock', weapon: u }); }
    }
  }
  p.breakerReady = !!p.perks.breaker;
  sim.groups = w.groups.map((g) => ({
    type: g.type, gap: g.gap ?? 0.35, next: g.t, ax: 0, az: 0, placed: false, per: g.type === 'race' ? 2 : 1,
    left: g.type === 'brute' || g.type === 'race' ? g.n : Math.max(1, Math.round(g.n * SEV[sim.sev].count)),
  }));
  sim.state = 'brief'; sim.stateT = i === 0 ? 5 : 4; sim.waveT = 0; sim.remaining = 0;
  sim.total = sim.groups.reduce((s, g) => s + g.left * g.per, 0);
  sim.events.push({ t: 'brief', wave: i, inc: w.inc, sev: w.sev, title: w.title, voice: w.voice, boss: !!w.boss, act: w.act });
}

function spawnFrom(sim, g) {
  const p = sim.player, W = sim.world, rng = sim.rng;
  // a pack arrives together; it picks a new place when the player is standing on the old one
  if (!g.placed || Math.hypot(g.ax - p.x, g.az - p.z) < 9) {
    randomFreeCell(W, rng, p.x, p.z, 13, 34, D);
    g.ax = D.x; g.az = D.z; g.placed = true;
  }
  const at = () => {
    const x = g.ax + rng.range(-2.6, 2.6), z = g.az + rng.range(-2.6, 2.6), c = cellOf(W, x, z);
    return c >= 0 && W.kind[c] === 0 ? { x, z } : { x: g.ax, z: g.az };
  };
  const a = at(), e = spawnEnemy(sim, g.type, a.x, a.z);
  if (g.type === 'race') {
    const b = at(), tw = spawnEnemy(sim, 'race', b.x, b.z);
    e.twin = tw.id; tw.twin = e.id; tw.variant = 1; tw.name = 'thread-B'; e.name = 'thread-A';
  }
}

export function updateDirector(sim, dt) {
  const p = sim.player;
  if (sim.state === 'brief') {
    if ((sim.stateT -= dt) > 0) return;
    sim.state = 'wave';
    if (sim.def.boss) spawnBoss(sim);
    sim.events.push({ t: 'waveStart', wave: sim.wave });
  } else if (sim.state === 'wave') {
    sim.waveT += dt;
    let pending = 0, nextT = Infinity;
    for (const g of sim.groups) if (g.left > 0) { pending += g.left * g.per; if (g.next < nextT) nextT = g.next; }
    // nothing left to fight: bring the next group forward
    if (!sim.enemies.length && pending && nextT > sim.waveT) sim.waveT = nextT;
    for (const g of sim.groups) {
      while (g.left > 0 && g.next <= sim.waveT && sim.enemies.length < ALIVE_CAP) {
        spawnFrom(sim, g);
        g.left--; g.next = Math.max(g.next, sim.waveT - 0.02) + g.gap;
        pending -= g.per;
      }
    }
    let alive = 0;
    for (const e of sim.enemies) if (!e.dead) alive++;
    sim.remaining = alive + pending;
    if (alive + pending > 0) return;
    sim.stats.waves = Math.max(sim.stats.waves, sim.wave + 1);
    sim.shots.length = 0;
    healPlayer(sim, PLAYER.waveHeal, 'wave');
    sim.state = 'cleared'; sim.stateT = sim.def.boss ? 3.5 : 2.2;
    sim.events.push({ t: 'waveEnd', wave: sim.wave, inc: sim.def.inc, boss: !!sim.def.boss });
  } else if (sim.state === 'cleared') {
    if ((sim.stateT -= dt) > 0) return;
    if (sim.def.boss) {
      sim.over = 'won';
      sim.events.push({ t: 'won' });
      return;
    }
    const pool = PERKS.filter((k) => (p.perks[k.id] || 0) < k.max && sim.wave + 1 >= (PERK_MIN[k.id] || 0));
    sim.perkChoices = [];
    while (sim.perkChoices.length < 3 && pool.length) sim.perkChoices.push(pool.splice(sim.rng.int(pool.length), 1)[0].id);
    if (!sim.perkChoices.length) { enterWave(sim, sim.wave + 1); return; } // every hotfix already deployed
    sim.state = 'perk';
    sim.events.push({ t: 'perks', choices: sim.perkChoices });
  }
}
