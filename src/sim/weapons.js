// Weapons: rate limits (heat), hitscan, rockets. Pure.
import { WEAPONS, HEAT, PLAYER } from './config.js';
import { raycast } from './world.js';
import { live, rayCylinder, damageEnemy, explode } from './enemies.js';
import { clamp, lerp } from './rng.js';

const TAU = Math.PI * 2;
const hit = { hit: 0, nx: 0, ny: 0, nz: 0 };
const cand = [];

export function updateWeapons(sim, inp, dt) {
  const p = sim.player;
  for (let i = 0; i < 4; i++) {
    p.sinceShot[i] += dt;
    if (p.sinceShot[i] > HEAT.coolDelay && p.heat[i] > 0) {
      p.heat[i] = Math.max(0, p.heat[i] - (i === p.weapon ? HEAT.cool : HEAT.idleCool) * dt);
      if (p.locked[i] && p.heat[i] <= HEAT.unlock) {
        p.locked[i] = false;
        sim.events.push({ t: 'cooled', weapon: i });
      }
    }
  }
  p.fireCd -= dt; p.switchT -= dt; p.idleFire += dt;
  p.bloom = Math.max(0, p.bloom - 0.15 * dt);
  if (p.dead || p.rewind > 0) return;
  if (inp.weapon >= 0 && inp.weapon !== p.weapon && p.unlocked[inp.weapon]) {
    p.weapon = inp.weapon; p.switchT = 0.2;
    sim.events.push({ t: 'switch', weapon: p.weapon });
  }
  if (!inp.fire || p.switchT > 0 || p.fireCd > 0) return;
  if (p.locked[p.weapon]) {
    if (inp.firePressed) sim.events.push({ t: 'dry', weapon: p.weapon });
    return;
  }
  fire(sim);
}

function fire(sim) {
  const p = sim.player, i = p.weapon, w = WEAPONS[i], rng = sim.rng, sudo = p.sudoT > 0;
  const canary = p.canary && p.idleFire >= 1.5;
  let mul = p.dmgMul * (sudo ? 1.5 : 1) * (canary ? 3 : 1);
  if (w.id === 'grep') mul *= p.grepMul;
  p.fireCd = (p.fireCd < -dtSlack ? 0 : p.fireCd) + 1 / w.rate;
  p.idleFire = 0; p.sinceShot[i] = 0;
  if (!sudo && !(p.retry > 0 && rng.next() < p.retry)) {
    p.heat[i] += w.heat * p.heatMul;
    if (p.heat[i] >= 1) {
      p.heat[i] = 1; p.locked[i] = true; sim.stats.overheats++;
      sim.events.push({ t: 'overheat', weapon: i });
    }
  }
  sim.stats.shots++;
  const cp = Math.cos(p.pitch), sy = Math.sin(p.yaw), cy = Math.cos(p.yaw);
  const fx = -sy * cp, fy = Math.sin(p.pitch), fz = -cy * cp;
  const ex = p.x, ey = p.y + PLAYER.eye, ez = p.z;
  sim.events.push({ t: 'fire', weapon: i, canary, sudo });
  if (w.rocket) {
    const r = w.rocket;
    sim.rockets.push({
      x: ex + fx * 0.5, y: ey - 0.12 + fy * 0.5, z: ez + fz * 0.5, vx: fx * r.speed, vy: fy * r.speed, vz: fz * r.speed,
      life: r.life, dmg: w.dmg * mul, radius: r.radius * p.blastMul,
    });
    return;
  }
  // spread basis: right = (cos yaw, 0, -sin yaw), up = right x forward
  const ux = sy * fy, uy = cp, uz = cy * fy, spread = w.spread + p.bloom;
  const n = w.pellets + (w.id === 'kill' ? p.pellets : 0);
  let any = false;
  for (let k = 0; k < n; k++) {
    const a = rng.next() * TAU, rad = spread * Math.sqrt(rng.next());
    const sx = Math.cos(a) * rad, su = Math.sin(a) * rad;
    let dx = fx + cy * sx + ux * su, dy = fy + uy * su, dz = fz - sy * sx + uz * su;
    const l = Math.hypot(dx, dy, dz);
    dx /= l; dy /= l; dz /= l;
    if (hitscan(sim, w, i, ex, ey, ez, dx, dy, dz, mul)) any = true;
  }
  p.bloom = Math.min(0.035, p.bloom + w.bloom);
  if (any) sim.stats.hits++;
}
const dtSlack = 0.05; // a late trigger pull does not bank fire-rate credit

function hitscan(sim, w, wi, ox, oy, oz, dx, dy, dz, mul) {
  const es = sim.enemies;
  const wallT = raycast(sim.world, ox, oy, oz, dx, dy, dz, w.range, hit);
  cand.length = 0;
  for (let i = 0, n = es.length; i < n; i++) {
    const e = es[i];
    if (!live(e)) continue;
    const t = rayCylinder(ox, oy, oz, dx, dy, dz, e.x, e.y, e.z, e.r + (e.type === 'packet' ? 0.22 : 0.08), e.h);
    if (t >= 0 && t < wallT) cand.push({ e, t });
  }
  cand.sort((a, b) => a.t - b.t);
  if (!w.pierce && cand.length > 1) cand.length = 1;
  const end = w.pierce || !cand.length ? wallT : cand[0].t;
  sim.events.push({
    t: 'tracer', weapon: wi, x: ox + dx * end, y: oy + dy * end, z: oz + dz * end, dx, dy, dz, len: end,
    wall: w.pierce || !cand.length ? hit.hit : 0, nx: hit.nx, ny: hit.ny, nz: hit.nz,
  });
  let any = false;
  for (const c of cand) {
    const f = w.falloff ? lerp(1, w.falloff[2], clamp((c.t - w.falloff[0]) / (w.falloff[1] - w.falloff[0]), 0, 1)) : 1;
    if (damageEnemy(sim, c.e, w.dmg * mul * f, {
      src: w.id, hx: ox + dx * c.t, hy: oy + dy * c.t, hz: oz + dz * c.t, kx: dx * w.knock, kz: dz * w.knock,
    })) any = true;
  }
  return any;
}

export function updateRockets(sim, dt) {
  const rs = sim.rockets, es = sim.enemies, W = WEAPONS[3];
  let n = 0;
  for (let i = 0; i < rs.length; i++) {
    const r = rs[i], sp = Math.hypot(r.vx, r.vy, r.vz), dx = r.vx / sp, dy = r.vy / sp, dz = r.vz / sp;
    let t = raycast(sim.world, r.x, r.y, r.z, dx, dy, dz, sp * dt, hit), boom = hit.hit !== 0;
    for (let j = 0; j < es.length; j++) {
      const e = es[j];
      if (!live(e)) continue;
      const te = rayCylinder(r.x, r.y, r.z, dx, dy, dz, e.x, e.y, e.z, e.r + 0.15, e.h);
      if (te >= 0 && te <= t) { t = te; boom = true; }
    }
    r.life -= dt;
    if (!boom && r.life > 0) {
      r.x += r.vx * dt; r.y += r.vy * dt; r.z += r.vz * dt;
      rs[n++] = r;
      continue;
    }
    // back off a little so the blast is not centred inside a wall
    const b = Math.max(0, t - 0.15);
    if (explode(sim, r.x + dx * b, r.y + dy * b, r.z + dz * b, r.radius, r.dmg, {
      src: 'rm', kind: 'rm', self: W.rocket.selfMul, impulse: W.rocket.impulse,
    })) sim.stats.hits++;
  }
  rs.length = n;
}
