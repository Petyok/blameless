// The whole game state and its step function. Pure and deterministic for a given seed and inputs.
import { COFFEE } from './config.js';
import { makeRng } from './rng.js';
import { computeFlow } from './world.js';
import { makePlayer, updatePlayer, healPlayer } from './player.js';
import { updateWeapons, updateRockets } from './weapons.js';
import { updateEnemies, updateShots, explode } from './enemies.js';
import { applyPerk, enterWave, updateDirector } from './director.js';

export const makeInput = () => ({
  mx: 0, mz: 0, dyaw: 0, dpitch: 0, jump: false, jumpPressed: false, dash: false, fire: false, firePressed: false,
  rollback: false, sudo: false, weapon: -1,
});

const newStats = () => ({
  time: 0, shots: 0, hits: 0, damage: 0, damageTaken: 0, byCause: {}, kills: {}, killsTotal: 0, collateral: 0,
  revived: 0, blinks: 0, overheats: 0, rollbacks: 0, dashes: 0, sudos: 0, coffee: 0, hotTime: 0, bestCombo: 0,
  waves: 0, deaths: 0,
});

/** o: {seed, sev, wave, perks, score, stats, god} */
export function makeSim(o = {}) {
  const seed = o.seed ?? 1;
  const sim = {
    seed, rng: makeRng(seed), sev: o.sev || 2, god: !!o.god, t: 0, nextId: 0,
    world: null, player: makePlayer(), enemies: [], shots: [], rockets: [], pickups: [], events: [],
    state: 'brief', stateT: 0, wave: 0, waveT: 0, def: null, groups: [], remaining: 0, total: 0, hpMul: 1,
    over: null, score: o.score || 0, combo: 0, comboT: 0, perkChoices: null, perkLog: [], pendingBlast: null, flowT: 0,
    stats: o.stats || newStats(),
  };
  for (const id of o.perks || []) applyPerk(sim, id);
  enterWave(sim, o.wave || 0);
  return sim;
}

const sub = makeInput();

/** Advance by dt seconds (clamped to 0.1), in substeps of at most 1/30 s. */
export function step(sim, inp, dt) {
  if (sim.over || sim.state === 'perk') return;
  let left = Math.min(dt, 0.1), first = true;
  while (left > 1e-7 && !sim.over && sim.state !== 'perk') {
    const h = Math.min(left, 1 / 30);
    left -= h;
    if (first) tick(sim, inp, h);
    else {
      // one-shot inputs belong to the first substep only
      Object.assign(sub, inp);
      sub.dyaw = sub.dpitch = 0; sub.jumpPressed = sub.dash = sub.firePressed = sub.rollback = sub.sudo = false; sub.weapon = -1;
      tick(sim, sub, h);
    }
    first = false;
  }
}

function tick(sim, inp, dt) {
  const p = sim.player;
  sim.t += dt; sim.stats.time += dt;
  updatePlayer(sim, inp, dt);
  updateWeapons(sim, inp, dt);
  if ((sim.flowT -= dt) <= 0) { sim.flowT = 0.2; computeFlow(sim.world, p.x, p.z); }
  updateEnemies(sim, dt);
  updateShots(sim, dt);
  updateRockets(sim, dt);
  if (sim.pendingBlast) {
    const b = sim.pendingBlast;
    sim.pendingBlast = null;
    explode(sim, b.x, b.y, b.z, 10, 140, { src: 'breaker', kind: 'breaker', impulse: 16 });
  }
  // coffee
  const cs = sim.pickups;
  let n = 0;
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i];
    c.t -= dt; c.vy -= 20 * dt; c.y += c.vy * dt;
    if (c.y < 0.5) { c.y = 0.5; c.vy = 0; }
    const dx = p.x - c.x, dz = p.z - c.z, d = Math.hypot(dx, dz), want = p.hp < p.maxHp && !p.dead;
    if (want && d < COFFEE.magnet && d > 1e-6) { c.x += dx / d * 9 * dt; c.z += dz / d * 9 * dt; }
    if (want && d < COFFEE.r && p.y < 2) {
      healPlayer(sim, COFFEE.heal * p.coffeeMul, 'coffee');
      sim.stats.coffee++;
      sim.events.push({ t: 'coffee', x: c.x, y: c.y, z: c.z });
      continue;
    }
    if (c.t > 0) cs[n++] = c;
  }
  cs.length = n;
  if (sim.comboT > 0 && (sim.comboT -= dt) <= 0) {
    if (sim.combo >= 5) sim.events.push({ t: 'comboEnd', n: sim.combo });
    sim.combo = 0;
  }
  updateDirector(sim, dt);
}
