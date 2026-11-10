// Autopilot: reads the sim, fills an input. Drives the E2E playthrough and the balance runs.
// skill 1 is a sharp player, 0.5 an average one: it scales turn rate, aim wobble, reaction lag,
// how well threats outside the view are noticed and how often a jump is timed right.
import { PLAYER, BOSS } from './config.js';
import { raycast } from './world.js';
import { live } from './enemies.js';
import { makeRng, clamp, angDiff } from './rng.js';

export function makeBot(seed = 7, skill = 1) {
  return {
    rng: makeRng(seed), skill, target: null, retarget: 0, react: 0, strafe: 1, strafeT: 0, stuck: 0, wpnT: 0, t: 0,
    moveT: 0, mx: 0, mz: 0, danger: false, jumpCd: 0,
  };
}

const PRIO = { pylon: 0.5, leak: 0.6, heisen: 0.7, cron: 0.8, race: 0.8, packet: 0.9, fork: 1, zombie: 1, brute: 1.1, boss: 1.2 };
const HEAVY = { heisen: 1, brute: 1, boss: 1, pylon: 1, cron: 1, leak: 1, race: 1 };
const PERK_ORDER = ['autoscale', 'overprov', 'gc', 'cache', 'breaker', 'espresso', 'retry', 'cdn', 'policy', 'tracing',
  'lb', 'bluegreen', 'canary', 'chaos'];

/** Index of the hotfix the bot takes. */
export function botPerk(sim) {
  let best = 0, bi = 99;
  sim.perkChoices.forEach((id, k) => { const i = PERK_ORDER.indexOf(id); if (i < bi) { bi = i; best = k; } });
  return best;
}

export function botInput(bot, sim, dt, inp) {
  const p = sim.player, W = sim.world, es = sim.enemies, rng = bot.rng, skill = bot.skill;
  inp.mx = inp.mz = inp.dyaw = inp.dpitch = 0; inp.weapon = -1;
  inp.jump = inp.jumpPressed = inp.dash = inp.fire = inp.firePressed = inp.rollback = inp.sudo = false;
  if (p.dead) return inp;
  bot.t += dt; bot.jumpCd -= dt;
  const ex = p.x, ey = p.y + PLAYER.eye, ez = p.z;
  /** How well the bot knows about something at (x, z): 1 in view or close, less behind its back. */
  const aware = (x, z) => {
    const dx = x - p.x, dz = z - p.z;
    return Math.hypot(dx, dz) < 3 || Math.abs(angDiff(Math.atan2(-dx, -dz), p.yaw)) < 1.1 ? 1 : 0.3 * skill;
  };
  const jump = () => {
    if (bot.jumpCd > 0 || !p.onGround) return;
    bot.jumpCd = 0.45;
    if (rng.next() < 0.92 * Math.sqrt(skill)) inp.jump = inp.jumpPressed = true;
  };

  // target: nearest by weighted distance, visible ones first
  bot.retarget -= dt; bot.react -= dt;
  let tg = bot.target;
  if (bot.retarget <= 0 || !tg || !live(tg) || (tg.type === 'boss' && tg.shield)) {
    bot.retarget = 0.25;
    let best = null, bs = Infinity;
    for (const e of es) {
      if (!live(e) || (e.type === 'boss' && (e.shield || e.state !== 'fight'))) continue;
      const cx = e.x - ex, cy = e.y + e.h * 0.55 - ey, cz = e.z - ez, d = Math.hypot(cx, cy, cz) || 1;
      const vis = raycast(W, ex, ey, ez, cx / d, cy / d, cz / d, d, null) >= d - 1e-3;
      let s = d * PRIO[e.type] + (vis ? 0 : 40);
      if (e.type === 'race' && es.some((a) => a.id === e.twin && a.state === 'down')) s *= 0.3;
      if (e.type === 'leak') s *= e.state === 'oom' ? 0.3 : 1 - e.r * 0.2;
      if (e === tg) s *= 0.8;
      if (s < bs) { bs = s; best = e; }
    }
    if (best !== tg) bot.react = 0.2 / skill;
    tg = bot.target = best;
  }

  let td = 0, crowd = 0;
  if (tg) {
    const A = 0.028 / skill;
    const dx = tg.x - ex, dy = tg.y + tg.h * 0.55 - ey, dz = tg.z - ez, dh = Math.hypot(dx, dz) || 1;
    td = Math.hypot(dh, dy);
    const wy = Math.atan2(-dx, -dz) + A * Math.sin(bot.t * 2.3) + A * 0.6 * Math.sin(bot.t * 7.1);
    const wp = Math.atan2(dy, dh) + A * 0.7 * Math.cos(bot.t * 1.7);
    const turn = 5 * skill * dt, ey0 = angDiff(wy, p.yaw), ep0 = wp - p.pitch;
    inp.dyaw = clamp(ey0, -turn, turn); inp.dpitch = clamp(ep0, -turn, turn);
    const vis = raycast(W, ex, ey, ez, dx / td, dy / td, dz / td, td, null) >= td - 1e-3;
    const onTarget = Math.abs(ey0 - inp.dyaw) < Math.atan(tg.r * 1.1 / td) + A * 0.5
      && Math.abs(ep0 - inp.dpitch) < Math.atan(tg.h * 0.45 / td) + A * 0.5;
    for (const e of es) if (live(e) && Math.hypot(e.x - tg.x, e.z - tg.z) < 5) crowd++;
    inp.fire = vis && onTarget && bot.react <= 0 && !(p.weapon === 3 && td < 7);
  } else {
    inp.dyaw = 0.6 * dt;
    inp.dpitch = clamp(-p.pitch, -dt, dt);
  }

  // weapon: by situation, never a rate-limited one
  bot.wpnT -= dt;
  if (bot.wpnT <= 0 || p.locked[p.weapon]) {
    bot.wpnT = 0.4 / skill;
    const ok = (i) => p.unlocked[i] && !p.locked[i];
    let w = p.weapon;
    if (tg && ok(3) && crowd >= 4 && td > 8 && p.heat[3] < 0.5) w = 3;
    else if (tg && ok(2) && HEAVY[tg.type] && p.heat[2] < 0.6) w = 2;
    else if (tg && ok(1) && td < 10 && p.heat[1] < 0.7) w = 1;
    else if (ok(0)) w = 0;
    else w = [1, 2, 3, 0].find(ok) ?? p.weapon;
    if (w !== p.weapon) inp.weapon = w;
  }

  // movement: a sum of pushes in world space, re-decided a few times per second
  if ((bot.moveT -= dt) <= 0) {
    bot.moveT = 0.12 / skill;
    let mx = 0, mz = 0;
    bot.danger = false;
    for (const e of es) {
      if (e.dead || e.state === 'down' || e.type === 'cron' || e.type === 'pylon') continue;
      const dx = p.x - e.x, dz = p.z - e.z, d = Math.hypot(dx, dz) || 1, a = aware(e.x, e.z);
      const reach = e.type === 'leak' ? (e.state === 'oom' ? 9.5 : 4) : e.type === 'brute' ? 9 : e.type === 'boss' ? 9 : 7;
      if (d < reach) { const k = (reach - d) / reach / d * 2.2 * a; mx += dx * k; mz += dz * k; }
      if (a === 1 && (d < e.r + 1.9 || (e.state === 'charge' && d < 7) || (e.state === 'oom' && d < 7.5))) bot.danger = true;
    }
    if (tg) {
      const dx = tg.x - p.x, dz = tg.z - p.z, d = Math.hypot(dx, dz) || 1;
      const k = clamp((d - (tg.type === 'boss' ? 14 : 11)) / 6, -1, 1) * 0.6;
      mx += (-dz * bot.strafe * 0.8 + dx * k) / d; mz += (dx * bot.strafe * 0.8 + dz * k) / d;
    } else {
      const dx = W.start.x - p.x, dz = W.start.z - p.z, d = Math.hypot(dx, dz);
      if (d > 4) { mx += dx / d; mz += dz / d; }
    }
    for (let k = 0; k < 8; k++) {
      const a = k * Math.PI / 4, c = Math.cos(a), s = Math.sin(a), t = raycast(W, p.x, 0.5, p.z, c, 0, s, 3.5, null);
      if (t < 3.5) { const f = (3.5 - t) / 3.5 * 1.3; mx -= c * f; mz -= s * f; }
    }
    for (const s of sim.shots) {
      if (s.kind === 2 || aware(s.x, s.z) < 1) continue;
      const rx = p.x - s.x, rz = p.z - s.z, v2 = s.vx * s.vx + s.vz * s.vz || 1, tca = (rx * s.vx + rz * s.vz) / v2;
      if (tca <= 0 || tca > 0.8) continue;
      const qx = rx - s.vx * tca, qz = rz - s.vz * tca, q = Math.hypot(qx, qz);
      if (q < 1.4) {
        const v = Math.sqrt(v2), sx = q > 0.05 ? qx / q : -s.vz / v, sz = q > 0.05 ? qz / q : s.vx / v;
        mx += sx * 1.6 * skill; mz += sz * 1.6 * skill;
      }
    }
    if (p.hp < p.maxHp * 0.7) {
      let c = null, cd = 14;
      for (const q of sim.pickups) { const d = Math.hypot(q.x - p.x, q.z - p.z); if (d < cd) { cd = d; c = q; } }
      if (c) { mx += (c.x - p.x) / cd * 1.3; mz += (c.z - p.z) / cd * 1.3; }
    }
    bot.mx = mx; bot.mz = mz;
  }
  for (const s of sim.shots) {
    if (s.kind !== 2) continue;
    const rx = p.x - s.x, rz = p.z - s.z, v2 = s.vx * s.vx + s.vz * s.vz || 1, tca = (rx * s.vx + rz * s.vz) / v2;
    if (tca > 0 && tca < 0.3 && Math.hypot(rx - s.vx * tca, rz - s.vz * tca) < 1) jump();
  }
  const boss = es.find((e) => e.type === 'boss');
  if (boss && boss.beamN) {
    const pa = Math.atan2(p.z - boss.z, p.x - boss.x), sp = BOSS.beamSpeed[boss.phase - 1];
    for (let k = 0; k < boss.beamN; k++) {
      const lead = angDiff(pa, boss.beamA + k * Math.PI * 2 / boss.beamN);
      if (lead > 0 && lead / sp < 0.34) jump();
    }
  }
  bot.strafeT -= dt;
  bot.stuck = Math.hypot(p.vx, p.vz) < 2 ? bot.stuck + dt : 0;
  if (bot.strafeT <= 0 || bot.stuck > 0.4) { bot.strafe = -bot.strafe; bot.strafeT = rng.range(1.2, 3); bot.stuck = 0; }
  const l = Math.hypot(bot.mx, bot.mz);
  if (l > 0.05) {
    const sin = Math.sin(p.yaw + inp.dyaw), cos = Math.cos(p.yaw + inp.dyaw);
    inp.mx = (bot.mx * cos - bot.mz * sin) / l; inp.mz = (-bot.mx * sin - bot.mz * cos) / l;
  }
  if (p.y > 1 && p.onGround) inp.jump = inp.jumpPressed = true; // off the hot aisle
  inp.dash = bot.danger && p.dashCd <= 0;
  inp.rollback = p.rollbackCd <= 0 && p.hist.length >= 8 && p.hist[0].hp - p.hp >= 30 && p.hp < p.maxHp * 0.5;
  inp.sudo = p.sudo >= 1 && p.sudoT <= 0 && (es.length >= 8 || (!!tg && tg.type === 'boss'));
  return inp;
}
