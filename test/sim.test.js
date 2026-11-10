// Self-check for the pure simulation: node --test test/
import test from 'node:test';
import assert from 'node:assert/strict';
import { CELL, RACK_H, WAVES, ENEMY, PERKS, HEAT, WEAPONS, PLAYER } from '../src/sim/config.js';
import { MAPS, makeWorld, raycast, moveCircle, groundAt, computeFlow, flowDir, cellOf, los } from '../src/sim/world.js';
import { makeSim, step, makeInput } from '../src/sim/sim.js';
import { spawnEnemy, damageEnemy, rayCylinder, explode } from '../src/sim/enemies.js';
import { choosePerk } from '../src/sim/director.js';
import { makeBot, botInput, botPerk } from '../src/sim/bot.js';
import { makeRng } from '../src/sim/rng.js';

const DT = 1 / 60;
const idle = makeInput();
const run = (sim, seconds, inp = idle) => { for (let i = 0; i < seconds / DT; i++) step(sim, inp, DT); };
/** A sim with the director parked: nothing spawns, nothing ends. */
const arena = (o = {}) => {
  const sim = makeSim({ seed: 3, ...o });
  sim.state = 'hold'; sim.groups = []; sim.events.length = 0;
  return sim;
};

test('maps: rectangular, walled, one start, every floor cell reachable', () => {
  MAPS.forEach((rows, m) => {
    assert.ok(rows.every((r) => r.length === rows[0].length), `map ${m} is ragged`);
    assert.equal(rows.join('').split('P').length - 1, 1, `map ${m} start`);
    assert.ok(/^#+$/.test(rows[0]) && /^#+$/.test(rows.at(-1)) && rows.every((r) => r[0] === '#' && r.at(-1) === '#'));
    const W = makeWorld(m);
    computeFlow(W, W.start.x, W.start.z);
    for (const i of W.free) assert.ok(W.dist[i] < 32767, `map ${m}: cell ${i} unreachable`);
  });
  const boss = makeWorld(3);
  assert.ok(boss.boss && boss.pylons.length === 4 && boss.pylons2.length === 2);
});

test('raycast: walls, rack sides and tops, floor', () => {
  const W = makeWorld(0), o = {};
  // from the start cell looking -z along a clear corridor: hits the north wall
  const t = raycast(W, W.start.x, 1.6, W.start.z, 0, 0, -1, 200, o);
  assert.equal(o.hit, 2);
  assert.ok(Math.abs(W.start.z - t - (W.oz + CELL)) < 1e-6, 'wall distance');
  assert.deepEqual([o.nx, o.nz], [0, 1]);
  assert.ok(Math.abs(raycast(W, W.start.x, 1.6, W.start.z, 0, -1, 0, 50, o) - 1.6) < 1e-9);
  assert.equal(o.hit, 1);
  // straight down onto a rack
  const rack = W.kind.indexOf(1), rx = W.ox + (rack % W.w + 0.5) * CELL, rz = W.oz + (((rack / W.w) | 0) + 0.5) * CELL;
  assert.ok(Math.abs(raycast(W, rx, 10, rz, 0, -1, 0, 50, o) - (10 - RACK_H)) < 1e-9);
  assert.equal(o.hit, 3);
  assert.equal(raycast(W, W.start.x, 1.6, W.start.z, 0, 0, -1, 3, o), 3);
  assert.equal(o.hit, 0);
  assert.ok(!los(W, rx - 3, rz, rx + 3, rz, 1) && los(W, rx - 3, rz, rx + 3, rz, RACK_H + 0.5));
});

test('collision: a circle never ends up inside a block, and can stand on racks', () => {
  const W = makeWorld(1), rng = makeRng(5), o = { x: W.start.x, z: W.start.z };
  for (let i = 0; i < 20000; i++) {
    moveCircle(W, o, rng.range(-1.5, 1.5), rng.range(-1.5, 1.5), 0.4, 0);
    const c = cellOf(W, o.x, o.z);
    assert.ok(c >= 0 && W.kind[c] === 0, `inside a block at step ${i}`);
  }
  const rack = W.kind.indexOf(1), rx = W.ox + (rack % W.w + 0.5) * CELL, rz = W.oz + (((rack / W.w) | 0) + 0.5) * CELL;
  assert.equal(groundAt(W, rx, rz, 0.4, 5), RACK_H);
  assert.equal(groundAt(W, rx, rz, 0.4, 0), 0);
});

test('flow field leads a walker to the player around racks', () => {
  const W = makeWorld(0), d = { x: 0, z: 0 };
  const o = { x: W.ox + 1.5 * CELL, z: W.oz + 1.5 * CELL }, px = W.ox + (W.w - 1.5) * CELL, pz = W.oz + (W.h - 1.5) * CELL;
  computeFlow(W, px, pz);
  for (let i = 0; i < 3000 && Math.hypot(o.x - px, o.z - pz) > 1.5; i++) {
    flowDir(W, o.x, o.z, px, pz, d);
    moveCircle(W, o, d.x * 0.1, d.z * 0.1, 0.45, 0);
  }
  assert.ok(Math.hypot(o.x - px, o.z - pz) <= 1.5);
});

test('rayCylinder', () => {
  assert.ok(Math.abs(rayCylinder(0, 1, 0, 0, 0, -1, 0, 0, -10, 0.5, 2) - 9.5) < 1e-9);
  assert.equal(rayCylinder(0, 3, 0, 0, 0, -1, 0, 0, -10, 0.5, 2), -1); // over the top
  assert.equal(rayCylinder(0, 1, 0, 0, 0, 1, 0, 0, -10, 0.5, 2), -1); // behind
  assert.ok(Math.abs(rayCylinder(0, 10, -10, 0, -1, 0, 0, 0, -10, 0.5, 2) - 8) < 1e-9); // from above
});

test('player: movement fuzz stays inside the arena; dash and jump work', () => {
  const sim = arena(), p = sim.player, rng = makeRng(9), inp = makeInput();
  for (let i = 0; i < 60 * 90; i++) {
    if (i % 20 === 0) {
      inp.mx = rng.range(-1, 1); inp.mz = rng.range(-1, 1); inp.dyaw = rng.range(-0.3, 0.3);
      inp.jump = rng.next() < 0.3; inp.dash = rng.next() < 0.3;
    }
    step(sim, inp, DT);
    const c = cellOf(sim.world, p.x, p.z);
    assert.ok(c >= 0 && sim.world.kind[c] !== 2, 'left the arena');
    assert.ok(p.y >= 0 && p.y < 8);
    if (sim.world.kind[c] === 1) assert.ok(p.y >= RACK_H - 1e-6, 'inside a rack');
  }
  assert.ok(sim.stats.dashes > 5);
  const s2 = arena();
  run(s2, 0.5, { ...idle, mz: 1 });
  assert.ok(Math.abs(Math.hypot(s2.player.vx, s2.player.vz) - PLAYER.speed) < 0.01, 'reaches run speed');
  assert.ok(s2.player.z < s2.world.start.z - 2, 'forward is -z at yaw 0');
});

test('heat: SIGTERM rate-limits, locks until cooled, other weapons cool faster holstered', () => {
  const sim = arena(), p = sim.player;
  let t = 0;
  while (!p.locked[0] && t < 10) { step(sim, { ...idle, fire: true }, DT); t += DT; }
  assert.ok(t > 1.5 && t < 4, `overheats after ${t.toFixed(2)} s`);
  assert.equal(sim.stats.overheats, 1);
  const shots = sim.stats.shots;
  run(sim, 0.5, { ...idle, fire: true });
  assert.equal(sim.stats.shots, shots, 'no fire while locked');
  run(sim, 3);
  assert.ok(!p.locked[0] && p.heat[0] === 0);
  assert.ok(HEAT.idleCool > HEAT.cool);
});

test('weapons: hitscan kills, shotgun falls off, grep pierces, rocket splashes', () => {
  const mk = (weapon, dist, n = 1) => {
    const sim = arena(), p = sim.player;
    p.unlocked.fill(true); p.weapon = weapon; p.pitch = -0.02;
    const es = [];
    for (let i = 0; i < n; i++) { const e = spawnEnemy(sim, 'zombie', p.x, p.z - dist - i * 1.2, { instant: true }); e.speed = 0; e.dmg = 0; es.push(e); }
    return { sim, es };
  };
  let { sim, es } = mk(0, 8);
  run(sim, 1, { ...idle, fire: true });
  assert.equal(sim.stats.kills.zombie, 1);
  const near = mk(1, 4), far = mk(1, 30);
  step(near.sim, { ...idle, fire: true }, DT); step(far.sim, { ...idle, fire: true }, DT);
  assert.ok(near.es[0].dead || near.es[0].hp < far.es[0].hp, 'shotgun is a close-range weapon');
  ({ sim, es } = mk(2, 8, 4));
  step(sim, { ...idle, fire: true }, DT);
  assert.equal(sim.stats.kills.zombie, 4, 'rail goes through the whole line');
  ({ sim, es } = mk(3, 14, 4));
  run(sim, 0.8, { ...idle, fire: true });
  assert.ok(sim.stats.kills.zombie >= 3, 'splash');
  assert.equal(sim.player.hp, sim.player.maxHp, 'no self-damage at 14 m');
});

test('fork bomb: one becomes two becomes four', () => {
  const sim = arena();
  spawnEnemy(sim, 'fork', 0, -10, { instant: true });
  for (let guard = 0; guard < 20 && sim.enemies.some((e) => e.type === 'fork'); guard++) {
    for (const e of [...sim.enemies]) damageEnemy(sim, e, 1e4, { src: 'term' });
    step(sim, idle, DT);
  }
  assert.equal(sim.stats.kills.fork, 7);
});

test('race condition: a lone kill comes back, a paired kill sticks', () => {
  const pair = () => {
    const sim = arena();
    const a = spawnEnemy(sim, 'race', 10, -10, { instant: true }), b = spawnEnemy(sim, 'race', -10, -10, { instant: true });
    a.twin = b.id; b.twin = a.id; a.speed = b.speed = 0;
    return { sim, a, b };
  };
  let { sim, a, b } = pair();
  damageEnemy(sim, a, 1e4, { src: 'term' });
  assert.equal(a.state, 'down');
  run(sim, ENEMY.race.window + 0.6);
  assert.ok(a.state === 'run' && a.hp === a.maxHp && sim.stats.revived === 1 && !sim.stats.kills.race);
  ({ sim, a, b } = pair());
  damageEnemy(sim, a, 1e4, { src: 'term' });
  run(sim, 1);
  damageEnemy(sim, b, 1e4, { src: 'term' });
  step(sim, idle, DT);
  assert.equal(sim.stats.kills.race, 2);
  assert.equal(sim.enemies.length, 0);
});

test('memory leak: grows, goes OOM, hurts everything near; killed early it is harmless', () => {
  const sim = arena(), p = sim.player;
  const e = spawnEnemy(sim, 'leak', p.x, p.z - 5, { instant: true }), z = spawnEnemy(sim, 'zombie', p.x + 3, p.z - 5, { instant: true });
  e.speed = 0; z.speed = 0; z.dmg = 0;
  run(sim, (ENEMY.leak.rMax - ENEMY.leak.r) / ENEMY.leak.grow + ENEMY.leak.fuse + 0.5);
  assert.ok(p.hp < p.maxHp, 'player hurt by the OOM');
  assert.equal(sim.stats.collateral, 1);
  assert.ok(!sim.stats.kills.leak, 'no credit for letting it blow');
  const s2 = arena();
  const e2 = spawnEnemy(s2, 'leak', s2.player.x, s2.player.z - 3, { instant: true });
  damageEnemy(s2, e2, 1e4, { src: 'term' });
  run(s2, 1);
  assert.ok(s2.player.hp === s2.player.maxHp && s2.stats.kills.leak === 1);
});

test('heisenbug: blinks away when observed, then holds still for a moment', () => {
  const sim = arena(), p = sim.player;
  const e = spawnEnemy(sim, 'heisen', p.x, p.z - 9, { instant: true });
  e.speed = 0; e.cd = 1e9;
  run(sim, 0.5);
  assert.equal(sim.stats.blinks, 1);
  assert.ok(e.blinkCd > 0 && Math.hypot(e.x - p.x, e.z - (p.z - 9)) > 1);
});

test('rollback restores position and budget; sudo removes heat', () => {
  const sim = arena(), p = sim.player;
  run(sim, 1);
  const x0 = p.x, z0 = p.z;
  run(sim, 1.5, { ...idle, mz: 1 });
  p.hp = 40;
  step(sim, { ...idle, rollback: true }, DT);
  run(sim, 0.5);
  assert.ok(Math.hypot(p.x - x0, p.z - z0) < 0.5, 'back where it was 3 s ago');
  assert.equal(p.hp, 100);
  p.sudo = 1;
  step(sim, { ...idle, sudo: true }, DT);
  run(sim, 4, { ...idle, fire: true });
  assert.ok(p.heat[0] === 0 && sim.stats.overheats === 0);
});

test('explosion: falloff, self-damage only from own rockets', () => {
  const sim = arena(), p = sim.player;
  const a = spawnEnemy(sim, 'brute', p.x + 1, p.z, { instant: true }), b = spawnEnemy(sim, 'brute', p.x + 6, p.z, { instant: true });
  explode(sim, p.x, 1, p.z, 8, 100, { src: 'rm', kind: 'rm' });
  assert.ok(a.maxHp - a.hp > b.maxHp - b.hp && b.hp < b.maxHp);
  assert.equal(p.hp, p.maxHp);
});

test('perks: every perk applies and changes something', () => {
  for (const k of PERKS) {
    const a = makeSim({ seed: 1 }), b = makeSim({ seed: 1, perks: [k.id] });
    assert.notDeepEqual({ ...a.player, perks: 0 }, { ...b.player, perks: 0 }, k.id);
  }
});

test('config sanity', () => {
  for (const w of WAVES) for (const g of w.groups) assert.ok(ENEMY[g.type], g.type);
  assert.equal(WAVES.filter((w) => w.unlock).map((w) => w.unlock).join(), '1,2,3');
  assert.equal(WEAPONS.length, 4);
});

/** Bot plays from wave 0 until the game is over or the time limit. */
function play(o, limit = 3600) {
  const sim = makeSim(o), bot = makeBot(o.seed + 100, o.skill ?? 1), inp = makeInput();
  const seen = new Set();
  while (!sim.over && sim.stats.time < limit) {
    if (sim.state === 'perk') choosePerk(sim, botPerk(sim));
    botInput(bot, sim, DT, inp);
    step(sim, inp, DT);
    for (const e of sim.events) seen.add(e.t);
    sim.events.length = 0;
  }
  return { sim, seen };
}

test('campaign: an invulnerable bot clears all ten incidents (no soft locks)', () => {
  const { sim, seen } = play({ seed: 11, sev: 2, god: true });
  assert.equal(sim.over, 'won', `stuck in wave ${sim.wave + 1} (${sim.state}), ${sim.enemies.length} enemies left`);
  assert.equal(sim.stats.waves, WAVES.length);
  assert.equal(sim.stats.kills.boss, 1);
  assert.ok(sim.stats.time < 30 * 60, `took ${(sim.stats.time / 60).toFixed(1)} min`);
  for (const t of ['act', 'brief', 'waveStart', 'waveEnd', 'perks', 'perk', 'unlock', 'spawn', 'fire', 'tracer', 'hit', 'kill',
    'split', 'raceDown', 'cronTele', 'enemyShot', 'blink', 'bruteWindup', 'bossFight', 'bossRing', 'shieldDown',
    'bossPhase3', 'bossDying', 'bossDead', 'won', 'explode', 'overheat']) assert.ok(seen.has(t), `event ${t} never fired`);
  for (const type of ['zombie', 'fork', 'cron', 'packet', 'race', 'leak', 'heisen', 'brute', 'pylon']) {
    assert.ok(sim.stats.kills[type] > 0, `no ${type} killed`);
  }
});

test('determinism: same seed, same run', () => {
  const a = play({ seed: 5, sev: 2 }, 240).sim, b = play({ seed: 5, sev: 2 }, 240).sim;
  assert.deepEqual(a.stats, b.stats);
  assert.equal(a.score, b.score);
});

test('night shift: generated incidents keep coming', () => {
  const { sim } = play({ seed: 4, sev: 3, god: true, wave: WAVES.length }, 400);
  assert.ok(sim.wave > WAVES.length, `reached wave ${sim.wave}`);
  assert.equal(sim.over, null);
});
