// Enemies: spawning, AI per type, projectiles, damage, death rules, explosions, the boss. Pure.
import { ENEMY, BOSS, SEV, PLAYER, COFFEE, COMBO_TIME } from './config.js';
import { raycast, los, flowDir, moveCircle, clampInside, randomFreeCell, cellOf } from './world.js';
import { hurtPlayer, healPlayer } from './player.js';
import { clamp, angDiff } from './rng.js';

const TAU = Math.PI * 2;
const D = { x: 0, z: 0 };
const pick = (v, g) => (Array.isArray(v) ? v[g] : v);

/** Can be shot, exploded and targeted. */
export const live = (e) => !e.dead && e.state !== 'down' && e.spawnT <= 0;

/** Ray vs vertical cylinder (base cx,cy,cz; radius r; height h). Entry distance, or -1. */
export function rayCylinder(ox, oy, oz, dx, dy, dz, cx, cy, cz, r, h) {
  const fx = ox - cx, fz = oz - cz, a = dx * dx + dz * dz;
  let t0 = -Infinity, t1 = Infinity;
  if (a > 1e-12) {
    const b = fx * dx + fz * dz, disc = b * b - a * (fx * fx + fz * fz - r * r);
    if (disc < 0) return -1;
    const s = Math.sqrt(disc);
    t0 = (-b - s) / a; t1 = (-b + s) / a;
  } else if (fx * fx + fz * fz > r * r) return -1;
  if (Math.abs(dy) > 1e-12) {
    let s0 = (cy - oy) / dy, s1 = (cy + h - oy) / dy;
    if (s0 > s1) { const tmp = s0; s0 = s1; s1 = tmp; }
    if (s0 > t0) t0 = s0;
    if (s1 < t1) t1 = s1;
  } else if (oy < cy || oy > cy + h) return -1;
  if (t1 < t0 || t1 < 0) return -1;
  return t0 > 0 ? t0 : 0;
}

export function spawnEnemy(sim, type, x, z, o = {}) {
  const d = ENEMY[type], g = o.gen || 0, rng = sim.rng;
  const hp = pick(d.hp, g) * SEV[sim.sev].hp * sim.hpMul;
  const speed = pick(d.speed, g) * SEV[sim.sev].speed * rng.range(0.88, 1.12);
  const e = {
    id: ++sim.nextId, type, x, y: 0, z, vx: 0, vz: 0, kx: 0, kz: 0, yaw: rng.range(0, TAU),
    hp, maxHp: hp, r: pick(d.r, g), h: pick(d.h, g), speed, dmg: pick(d.dmg, g) || 0,
    mass: d.mass, gen: g, state: 'run', t: 0, cd: 0, cd2: 0, atkT: 0, flash: 0, dead: false,
    spawnT: o.instant ? 0 : 0.6, seed: rng.next(), twin: 0, variant: 0, name: d.name,
    // per-type extras, all present so the object shape never changes
    orbit: rng.sign(), tele: false, vol: 0, volT: 0, aimT: 0, blinkCd: 0, dirx: 0, dirz: 0,
    shield: false, phase: 0, ringT: 0, ringN: 0, addT: 0, fanT: 0, beamA: 0, beamN: 0, beamLen: [0, 0, 0],
    beamHitCd: 0, boomT: 0,
  };
  if (type === 'cron') { e.y = d.hover; e.t = rng.range(0, d.period * 0.5); }
  else if (type === 'packet') e.y = 0.9;
  else if (type === 'heisen') e.cd = rng.range(1.2, d.shotCd);
  else if (type === 'brute') e.cd2 = 2.5;
  else if (type === 'pylon') { e.spawnT = 1; e.name = o.name || d.name; }
  else if (type === 'boss') {
    e.state = 'intro'; e.shield = true; e.phase = 1; e.spawnT = 0; e.ringT = 2.5; e.addT = 4; e.fanT = 2; e.yaw = 0;
  }
  sim.enemies.push(e);
  sim.events.push({ t: 'spawn', id: e.id, type, x, y: e.y, z });
  return e;
}

export function spawnShot(sim, x, y, z, vx, vy, vz, dmg, cause, kind) {
  sim.shots.push({ x, y, z, vx, vy, vz, dmg, cause, kind, r: kind === 2 ? 0.25 : 0.22, life: 7 });
}

/** Fire at the player's chest. lead 0..1: how much of the player's motion is anticipated. */
function shootAt(sim, x, y, z, speed, dmg, cause, kind, spread = 0, lead = 0) {
  const p = sim.player, tof = lead * Math.hypot(p.x - x, p.z - z) / speed;
  let dx = p.x + p.vx * tof - x, dy = p.y + 1.0 - y, dz = p.z + p.vz * tof - z;
  if (spread) {
    const c = Math.cos(spread), s = Math.sin(spread), nx = dx * c - dz * s;
    dz = dx * s + dz * c; dx = nx;
  }
  const d = Math.hypot(dx, dy, dz) || 1;
  spawnShot(sim, x, y, z, dx / d * speed, dy / d * speed, dz / d * speed, dmg, cause, kind);
}

export function updateShots(sim, dt) {
  const p = sim.player, W = sim.world, ss = sim.shots;
  let n = 0;
  for (let i = 0; i < ss.length; i++) {
    const s = ss[i];
    s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt; s.life -= dt;
    const c = cellOf(W, s.x, s.z);
    if (s.life <= 0 || c < 0 || s.y < 0 || s.y < W.top[c]) {
      if (s.life > 0) sim.events.push({ t: 'shotHit', x: s.x, y: s.y, z: s.z, kind: s.kind });
      continue;
    }
    const cy = clamp(s.y, p.y + 0.25, p.y + PLAYER.h - 0.2);
    if (Math.hypot(s.x - p.x, s.y - cy, s.z - p.z) < s.r + PLAYER.r
      && hurtPlayer(sim, s.dmg, s.x - s.vx, s.z - s.vz, s.cause)) {
      sim.events.push({ t: 'shotHit', x: s.x, y: s.y, z: s.z, kind: s.kind });
      continue;
    }
    ss[n++] = s;
  }
  ss.length = n;
}

// --- damage and death ---------------------------------------------------------------------------

/** o: {src, hx, hy, hz, kx, kz}. Returns true when damage landed. */
export function damageEnemy(sim, e, dmg, o) {
  if (!live(e)) return false;
  if (e.type === 'boss' && (e.shield || e.state !== 'fight')) {
    sim.events.push({ t: 'deflect', x: o.hx ?? e.x, y: o.hy ?? 4, z: o.hz ?? e.z });
    return false;
  }
  if (e.state === 'stun') dmg *= 1.5;
  e.hp -= dmg; e.flash = 0.12;
  if (o.kx || o.kz) { e.kx += o.kx / e.mass; e.kz += o.kz / e.mass; }
  sim.stats.damage += dmg;
  sim.events.push({
    t: 'hit', id: e.id, type: e.type, x: o.hx ?? e.x, y: o.hy ?? e.y + e.h * 0.6, z: o.hz ?? e.z, dmg,
    kill: e.hp <= 0, src: o.src,
  });
  if (e.hp <= 0) killEnemy(sim, e, o);
  return true;
}

function finish(sim, e, o) {
  const p = sim.player, def = ENEMY[e.type], st = sim.stats;
  e.dead = true;
  const quiet = o.src === 'purge' || o.src === 'detonate' || o.src === 'pop';
  if (!quiet) {
    st.kills[e.type] = (st.kills[e.type] || 0) + 1; st.killsTotal++;
    if (o.src === 'oom') st.collateral++;
    sim.combo++; sim.comboT = COMBO_TIME;
    if (sim.combo > st.bestCombo) st.bestCombo = sim.combo;
    if (sim.combo === 10 || sim.combo === 25 || sim.combo === 50) sim.events.push({ t: 'combo', n: sim.combo });
    sim.score += Math.round(def.score * (1 + Math.min(sim.combo, 50) * 0.04));
    if (p.sudoT <= 0 && p.sudo < 1) {
      p.sudo = Math.min(1, p.sudo + 0.035 * Math.sqrt(def.score / 10) * p.sudoGain);
      if (p.sudo >= 1) sim.events.push({ t: 'sudoReady' });
    }
    if (p.gcHeal) healPlayer(sim, p.gcHeal, 'gc');
    if (sim.rng.next() < def.coffee * p.coffeeRate) sim.pickups.push({ x: e.x, y: e.y + 0.6, z: e.z, vy: 4.5, t: COFFEE.life });
  }
  sim.events.push({
    t: 'kill', id: e.id, type: e.type, name: e.name, x: e.x, y: e.y, z: e.z, r: e.r, h: e.h, src: o.src,
    combo: sim.combo, gen: e.gen, variant: e.variant, quiet,
  });
}

export function killEnemy(sim, e, o) {
  if (e.dead) return;
  const es = sim.enemies;
  if (e.type === 'boss') {
    if (e.state === 'dying') return;
    e.state = 'dying'; e.t = 0; e.hp = 0; e.shield = false;
    for (const a of es) if (a !== e && !a.dead) finish(sim, a, { src: 'purge' });
    sim.shots.length = 0;
    sim.events.push({ t: 'bossDying', x: e.x, z: e.z });
    return;
  }
  if (e.type === 'race' && o.src !== 'purge') {
    const tw = es.find((a) => a.id === e.twin && !a.dead);
    if (tw && tw.state !== 'down') {
      e.state = 'down'; e.hp = 0; e.t = ENEMY.race.window; e.vx = e.vz = e.kx = e.kz = 0;
      sim.events.push({ t: 'raceDown', id: e.id, twin: tw.id, x: e.x, y: e.y, z: e.z });
      return;
    }
    if (tw) finish(sim, tw, o);
  }
  finish(sim, e, o);
  if (e.type === 'fork' && e.gen < 2 && o.src !== 'purge') {
    for (const s of [-1, 1]) {
      const a = sim.rng.range(0, TAU);
      const c = spawnEnemy(sim, 'fork', e.x + Math.cos(a) * 0.3 * s, e.z + Math.sin(a) * 0.3 * s, { gen: e.gen + 1, instant: true });
      c.kx = Math.cos(a) * 7 * s; c.kz = Math.sin(a) * 7 * s; c.cd = 0.6;
    }
    sim.events.push({ t: 'split', x: e.x, y: e.y + e.h * 0.5, z: e.z, gen: e.gen });
  } else if (e.type === 'pylon') {
    const boss = es.find((a) => a.type === 'boss' && !a.dead);
    if (boss && !es.some((a) => a.type === 'pylon' && !a.dead)) {
      boss.shield = false;
      if (boss.phase === 1) { boss.phase = 2; boss.fanT = 1.5; }
      sim.events.push({ t: 'shieldDown', x: boss.x, z: boss.z, phase: boss.phase });
    }
  }
}

/**
 * Radial damage. o: {src, kind, self, enemyDmg, playerDmg, cause, impulse}. dmg hits enemies unless
 * enemyDmg is given. Ignores cover. Returns the number of enemies hit.
 */
export function explode(sim, x, y, z, radius, dmg, o) {
  const p = sim.player, es = sim.enemies;
  sim.events.push({ t: 'explode', x, y, z, radius, kind: o.kind });
  const ed = o.enemyDmg ?? dmg, imp = o.impulse ?? 9;
  let hits = 0;
  for (let i = 0, n = es.length; i < n; i++) {
    const e = es[i];
    if (!live(e)) continue;
    const dx = e.x - x, dz = e.z - z, dh = Math.hypot(dx, dz);
    const d = Math.hypot(Math.max(0, dh - e.r), y - clamp(y, e.y, e.y + e.h));
    if (d > radius) continue;
    const f = 1 - 0.65 * d / radius, k = dh > 1e-6 ? imp * f / dh : 0;
    if (damageEnemy(sim, e, ed * f, { src: o.src, kx: dx * k, kz: dz * k })) hits++;
  }
  const dx = p.x - x, dy = p.y + 0.9 - y, dz = p.z - z, dl = Math.hypot(dx, dy, dz);
  const d = Math.max(0, dl - PLAYER.r);
  if (d < radius && (o.self || o.playerDmg)) {
    const f = 1 - 0.65 * d / radius;
    if (o.self) {
      if (!p.noSelf) hurtPlayer(sim, dmg * o.self * f, x, z, 'your own rm -rf', false, true);
      const k = dl > 1e-6 ? imp * f / dl : 0; // rocket jump: at least 35% of the push goes up
      p.vx += dx * k; p.vz += dz * k; p.vy = Math.max(p.vy, 0) + Math.max(0.35 * imp * f, dy * k);
      p.onGround = false;
    } else hurtPlayer(sim, o.playerDmg * f, x, z, o.cause);
  }
  return hits;
}

// --- shared movement ----------------------------------------------------------------------------

/** Direction to the player in D (straight when visible, else along the flow field); returns distance. */
function chase(sim, e) {
  const p = sim.player, dx = p.x - e.x, dz = p.z - e.z, d = Math.hypot(dx, dz);
  if (d < 1e-6) { D.x = 0; D.z = 0; return 0; }
  if (d < 2.5 || los(sim.world, e.x, e.z, p.x, p.z, 0.5)) { D.x = dx / d; D.z = dz / d; }
  else flowDir(sim.world, e.x, e.z, p.x, p.z, D);
  return d;
}

function steer(e, dx, dz, speed, dt, acc = 12) {
  const k = Math.min(1, acc * dt);
  e.vx += (dx * speed - e.vx) * k; e.vz += (dz * speed - e.vz) * k;
  if (dx || dz) e.yaw += clamp(angDiff(Math.atan2(-dx, -dz), e.yaw), -9 * dt, 9 * dt);
}

function move(sim, e, dt, fly = false) {
  const k = Math.exp(-5 * dt);
  e.kx *= k; e.kz *= k;
  const mx = (e.vx + e.kx) * dt, mz = (e.vz + e.kz) * dt;
  if (!fly) return moveCircle(sim.world, e, mx, mz, e.r, 0);
  e.x += mx; e.z += mz;
  clampInside(sim.world, e, e.r);
  return false;
}

function melee(sim, e, d, dt) {
  const p = sim.player, def = ENEMY[e.type];
  const reach = e.r + PLAYER.r + def.reach, level = Math.abs(p.y - e.y) < 1.6;
  if (e.atkT > 0) {
    e.atkT -= dt;
    if (e.atkT <= 0) {
      e.cd = def.atkCd;
      if (d < reach + 0.35 && level) hurtPlayer(sim, e.dmg, e.x, e.z, e.name);
    }
  } else if (d < reach && level && e.cd <= 0) {
    e.atkT = 0.26;
    sim.events.push({ t: 'windup', id: e.id });
  }
}

function walker(sim, e, dt) {
  const d = chase(sim, e);
  steer(e, D.x, D.z, e.atkT > 0 ? 0 : e.speed, dt);
  move(sim, e, dt);
  melee(sim, e, d, dt);
}

// --- behaviours ---------------------------------------------------------------------------------

const AI = {
  zombie: walker,
  fork: walker,

  packet(sim, e, dt) {
    const p = sim.player, d = chase(sim, e);
    const s = Math.sin(sim.t * 6 + e.seed * 40) * 0.55;
    const dx = D.x - D.z * s, dz = D.z + D.x * s, l = Math.hypot(dx, dz) || 1;
    steer(e, dx / l, dz / l, e.speed, dt, 6);
    move(sim, e, dt);
    e.y = 0.9 + Math.sin(sim.t * 5 + e.seed * 30) * 0.25;
    if (d < e.r + PLAYER.r + 0.2 && p.y < e.y + e.h + 0.3 && p.y + PLAYER.h > e.y) {
      hurtPlayer(sim, e.dmg, e.x, e.z, 'a SYN flood');
      killEnemy(sim, e, { src: 'pop' });
    }
  },

  cron(sim, e, dt) {
    const p = sim.player, def = ENEMY.cron;
    const dx = p.x - e.x, dz = p.z - e.z, d = Math.hypot(dx, dz) || 1;
    const rad = clamp((d - 11) / 4, -1, 1);
    const tx = dx / d * rad - dz / d * e.orbit * 0.7, tz = dz / d * rad + dx / d * e.orbit * 0.7, l = Math.hypot(tx, tz) || 1;
    steer(e, tx / l, tz / l, e.speed, dt, 3);
    e.yaw = Math.atan2(-dx, -dz);
    move(sim, e, dt, true);
    e.y = def.hover + Math.sin(sim.t * 1.7 + e.seed * 9) * 0.3;
    e.t += dt;
    if (!e.tele && e.t >= def.period - def.tele) {
      e.tele = true;
      sim.events.push({ t: 'cronTele', id: e.id, x: e.x, y: e.y, z: e.z });
    }
    if (e.t >= def.period) { e.t -= def.period; e.tele = false; e.vol = def.volley; e.volT = 0; }
    if (e.vol > 0 && (e.volT -= dt) <= 0) {
      e.volT = def.volleyGap; e.vol--;
      // the volley brackets the target: straight, full lead, half lead
      shootAt(sim, e.x, e.y + 0.3, e.z, def.shotSpeed, e.dmg, 'a cron job', 0, 0, [0.5, 1, 0][e.vol]);
      sim.events.push({ t: 'enemyShot', kind: 0, x: e.x, y: e.y, z: e.z });
    }
  },

  race(sim, e, dt) {
    if (e.state === 'down') {
      if ((e.t -= dt) <= 0) {
        e.state = 'run'; e.hp = e.maxHp; e.spawnT = 0.35; sim.stats.revived++;
        sim.events.push({ t: 'raceRevive', id: e.id, x: e.x, y: e.y, z: e.z });
      }
      return;
    }
    const d = chase(sim, e);
    const s = Math.sin(sim.t * 3.1 + e.seed * 20) * 0.9 * clamp((d - 3) / 6, 0, 1);
    const dx = D.x - D.z * s, dz = D.z + D.x * s, l = Math.hypot(dx, dz) || 1;
    steer(e, dx / l, dz / l, e.atkT > 0 ? 0 : e.speed, dt, 9);
    move(sim, e, dt);
    melee(sim, e, d, dt);
  },

  leak(sim, e, dt) {
    const def = ENEMY.leak;
    if (e.state === 'oom') {
      steer(e, 0, 0, 0, dt);
      move(sim, e, dt);
      if ((e.t -= dt) <= 0) {
        killEnemy(sim, e, { src: 'detonate' });
        explode(sim, e.x, e.h * 0.5, e.z, def.radius, 0, { src: 'oom', kind: 'oom', enemyDmg: def.enemyDmg, playerDmg: e.dmg, cause: 'a memory leak' });
      }
      return;
    }
    chase(sim, e);
    e.r = Math.min(def.rMax, e.r + def.grow * dt); e.h = e.r * 2;
    e.hp += def.hpGrow * dt; e.maxHp += def.hpGrow * dt;
    steer(e, D.x, D.z, e.speed, dt);
    move(sim, e, dt);
    if (e.r >= def.rMax) {
      e.state = 'oom'; e.t = def.fuse;
      sim.events.push({ t: 'leakFuse', id: e.id, x: e.x, y: e.y, z: e.z });
    }
  },

  heisen(sim, e, dt) {
    const p = sim.player, def = ENEMY.heisen, W = sim.world;
    e.blinkCd -= dt;
    const dx = p.x - e.x, dz = p.z - e.z, d = Math.hypot(dx, dz) || 1;
    const see = los(W, e.x, e.z, p.x, p.z, 1.4);
    const cp = Math.cos(p.pitch);
    const observed = see && rayCylinder(p.x, p.y + PLAYER.eye, p.z, -Math.sin(p.yaw) * cp, Math.sin(p.pitch), -Math.cos(p.yaw) * cp,
      e.x, e.y, e.z, e.r + 0.5, e.h) >= 0;
    e.aimT = observed ? e.aimT + dt : Math.max(0, e.aimT - dt * 2);
    if (e.aimT >= def.aimTime && e.blinkCd <= 0) {
      const x0 = e.x, z0 = e.z;
      randomFreeCell(W, sim.rng, p.x, p.z, 7, 18, D);
      e.x = D.x; e.z = D.z; e.aimT = 0; e.blinkCd = def.blinkCd; e.vx = e.vz = e.kx = e.kz = 0;
      sim.stats.blinks++;
      sim.events.push({ t: 'blink', id: e.id, x0, z0, x: e.x, y: e.y, z: e.z });
      return;
    }
    const rad = clamp((d - 11) / 3, -1, 1), o = e.seed < 0.5 ? 0.8 : -0.8;
    const tx = dx / d * rad - dz / d * o, tz = dz / d * rad + dx / d * o, l = Math.hypot(tx, tz) || 1;
    steer(e, tx / l, tz / l, e.speed, dt, 6);
    e.yaw = Math.atan2(-dx, -dz);
    move(sim, e, dt);
    if (e.cd <= 0 && see) {
      e.cd = def.shotCd;
      shootAt(sim, e.x, e.y + 1.3, e.z, def.shotSpeed, e.dmg, 'a heisenbug', 1);
      sim.events.push({ t: 'enemyShot', kind: 1, x: e.x, y: e.y + 1.3, z: e.z });
    }
  },

  brute(sim, e, dt) {
    const p = sim.player, def = ENEMY.brute;
    if (e.state === 'windup') {
      const dx = p.x - e.x, dz = p.z - e.z, d = Math.hypot(dx, dz) || 1;
      e.dirx = dx / d; e.dirz = dz / d;
      steer(e, 0, 0, 0, dt, 20);
      e.yaw = Math.atan2(-dx, -dz);
      move(sim, e, dt);
      if ((e.t -= dt) <= 0) {
        e.state = 'charge'; e.t = def.chargeTime;
        sim.events.push({ t: 'bruteCharge', id: e.id, x: e.x, y: 1, z: e.z });
      }
    } else if (e.state === 'charge') {
      e.vx = e.dirx * def.chargeSpeed; e.vz = e.dirz * def.chargeSpeed;
      const ox = e.x, oz = e.z, wall = move(sim, e, dt);
      const moved = Math.hypot(e.x - ox, e.z - oz), d = Math.hypot(p.x - e.x, p.z - e.z);
      e.t -= dt;
      if (d < e.r + PLAYER.r + 0.25 && p.y < e.h) {
        if (hurtPlayer(sim, def.chargeDmg, e.x, e.z, e.name)) {
          p.vx += e.dirx * 14; p.vz += e.dirz * 14; p.vy = Math.max(p.vy, 5.5); p.onGround = false;
        }
        e.state = 'recover'; e.t = def.recover;
      } else if (wall && moved < def.chargeSpeed * dt * 0.5) {
        e.state = 'stun'; e.t = def.recover * 2;
        sim.events.push({ t: 'bruteCrash', id: e.id, x: e.x, y: 1, z: e.z });
      } else if (e.t <= 0) { e.state = 'recover'; e.t = def.recover * 0.5; }
      if (e.state !== 'charge') { e.vx = e.vz = 0; e.cd2 = def.chargeCd; }
    } else if (e.state === 'recover' || e.state === 'stun') {
      steer(e, 0, 0, 0, dt, 10);
      move(sim, e, dt);
      if ((e.t -= dt) <= 0) e.state = 'run';
    } else {
      const d = chase(sim, e);
      steer(e, D.x, D.z, e.atkT > 0 ? 0 : e.speed, dt);
      move(sim, e, dt);
      melee(sim, e, d, dt);
      if ((e.cd2 -= dt) <= 0 && e.atkT <= 0 && d > 4 && d < 17 && los(sim.world, e.x, e.z, p.x, p.z, 0.5)) {
        e.state = 'windup'; e.t = def.windup;
        sim.events.push({ t: 'bruteWindup', id: e.id, x: e.x, y: 1, z: e.z });
      }
    }
  },

  pylon() {},

  boss(sim, e, dt) {
    const p = sim.player, W = sim.world, rng = sim.rng, es = sim.enemies;
    e.t += dt;
    e.yaw += clamp(angDiff(Math.atan2(e.x - p.x, e.z - p.z), e.yaw), -0.6 * dt, 0.6 * dt);
    if (e.state === 'intro') {
      if (e.t >= BOSS.intro) { e.state = 'fight'; e.t = 0; sim.events.push({ t: 'bossFight' }); }
      return;
    }
    if (e.state === 'dying') {
      if ((e.boomT -= dt) <= 0) {
        e.boomT = 0.2;
        sim.events.push({ t: 'explode', x: e.x + rng.range(-2.5, 2.5), y: rng.range(0.5, e.h), z: e.z + rng.range(-1.5, 1.5), radius: 3, kind: 'boss' });
      }
      if (e.t >= BOSS.deathTime) {
        finish(sim, e, { src: 'boss' });
        sim.events.push({ t: 'bossDead', x: e.x, z: e.z });
      }
      return;
    }
    const ph = e.phase - 1;
    if (e.phase === 2 && e.hp <= e.maxHp * BOSS.phase3At) {
      e.phase = 3; e.shield = true; e.ringT = 1.5;
      W.pylons2.forEach((q, i) => spawnEnemy(sim, 'pylon', q.x, q.z, { name: BOSS.deps[4 + i] }));
      sim.events.push({ t: 'bossPhase3', x: e.x, z: e.z });
    }
    if (BOSS.ringEvery[ph] > 0 && (e.ringT -= dt) <= 0) {
      e.ringT = BOSS.ringEvery[ph];
      const off = (e.ringN++ % 2) * Math.PI / BOSS.ringShots;
      for (let i = 0; i < BOSS.ringShots; i++) {
        const a = off + i * TAU / BOSS.ringShots, c = Math.cos(a), s = Math.sin(a);
        spawnShot(sim, e.x + c * (e.r + 0.3), BOSS.ringY, e.z + s * (e.r + 0.3), c * BOSS.ringSpeed, 0, s * BOSS.ringSpeed, BOSS.ringDmg, 'the monolith', 2);
      }
      sim.events.push({ t: 'bossRing', x: e.x, z: e.z });
    }
    if ((e.addT -= dt) <= 0) {
      e.addT = BOSS.addEvery;
      let adds = 0;
      for (const a of es) if (a.type !== 'boss' && a.type !== 'pylon' && !a.dead) adds++;
      if (adds < BOSS.addCap) {
        const type = rng.pick(e.phase === 1 ? ['zombie', 'zombie', 'packet'] : ['zombie', 'packet', 'fork', 'cron']);
        const n = type === 'packet' ? 8 : type === 'zombie' ? 4 : type === 'fork' ? 1 : 2;
        for (let i = 0; i < n; i++) {
          const a = rng.range(0, TAU), q = { x: e.x + Math.cos(a) * (e.r + 1.5), z: e.z + Math.sin(a) * (e.r + 1.5) };
          spawnEnemy(sim, type, q.x, q.z);
        }
        sim.events.push({ t: 'bossAdds', x: e.x, z: e.z });
      }
    }
    e.beamN = BOSS.beams[ph];
    e.beamHitCd -= dt;
    if (e.beamN) {
      e.beamA += BOSS.beamSpeed[ph] * dt;
      for (let k = 0; k < e.beamN; k++) {
        const a = e.beamA + k * TAU / e.beamN, c = Math.cos(a), s = Math.sin(a);
        const len = raycast(W, e.x, BOSS.beamY, e.z, c, 0, s, BOSS.beamLen, null);
        e.beamLen[k] = len;
        const rx = p.x - e.x, rz = p.z - e.z, along = rx * c + rz * s;
        if (along > e.r && along < len && Math.abs(rz * c - rx * s) < PLAYER.r + 0.3 && p.y < BOSS.beamY + 0.3
          && e.beamHitCd <= 0 && hurtPlayer(sim, BOSS.beamDmg, e.x, e.z, 'the monolith')) e.beamHitCd = BOSS.beamHitCd;
      }
    }
    if (e.phase >= 2 && (e.fanT -= dt) <= 0) {
      e.fanT = BOSS.fanEvery;
      for (let i = 0; i < BOSS.fanShots; i++) {
        shootAt(sim, e.x, 5.5, e.z, BOSS.fanSpeed, BOSS.fanDmg, 'the monolith', 1, (i - (BOSS.fanShots - 1) / 2) * 0.14);
      }
      sim.events.push({ t: 'enemyShot', kind: 3, x: e.x, y: 5.5, z: e.z });
    }
  },
};

export function spawnBoss(sim) {
  const W = sim.world;
  spawnEnemy(sim, 'boss', W.boss.x, W.boss.z);
  W.pylons.forEach((q, i) => spawnEnemy(sim, 'pylon', q.x, q.z, { name: BOSS.deps[i] }));
}

export function updateEnemies(sim, dt) {
  const es = sim.enemies, p = sim.player;
  for (let i = 0; i < es.length; i++) {
    const e = es[i];
    if (e.dead) continue;
    e.flash -= dt;
    if (e.spawnT > 0) { e.spawnT -= dt; continue; }
    e.cd -= dt;
    AI[e.type](sim, e, dt);
  }
  // keep bodies apart; lighter ones give way. ponytail: O(n^2) pairs, fine below ~150 enemies
  for (let i = 0; i < es.length; i++) {
    const a = es[i];
    if (a.dead || a.state === 'down') continue;
    const still = a.mass > 1e6, pm = a.r + PLAYER.r;
    const px = p.x - a.x, pz = p.z - a.z, pd = Math.hypot(px, pz);
    if (pd < pm && pd > 1e-6 && p.y < a.y + a.h && p.y + PLAYER.h > a.y && a.type !== 'packet') {
      const k = (pm - pd) / pd;
      if (still) { p.x += px * k; p.z += pz * k; } else { a.x -= px * k; a.z -= pz * k; }
    }
    const fa = a.type === 'cron';
    for (let j = i + 1; j < es.length; j++) {
      const b = es[j];
      if (b.dead || b.state === 'down' || (b.type === 'cron') !== fa) continue;
      const dx = b.x - a.x, dz = b.z - a.z, m = a.r + b.r, d2 = dx * dx + dz * dz;
      if (d2 >= m * m || d2 < 1e-8) continue;
      const d = Math.sqrt(d2), k = (m - d) / d * 0.6, wa = b.mass / (a.mass + b.mass);
      a.x -= dx * k * wa; a.z -= dz * k * wa; b.x += dx * k * (1 - wa); b.z += dz * k * (1 - wa);
    }
  }
  let n = 0;
  for (let i = 0; i < es.length; i++) if (!es[i].dead) es[n++] = es[i];
  es.length = n;
}
