// Player: movement, dash, rollback, sudo, damage intake. Pure.
import { PLAYER as C, SEV } from './config.js';
import { groundAt, moveCircle } from './world.js';
import { clamp } from './rng.js';

export function makePlayer() {
  return {
    x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0,
    hp: C.maxHp, maxHp: C.maxHp, dead: false, invuln: 0, onGround: true,
    coyote: 0, jumpBuf: 0, dashT: 0, dashCd: 0, dashDx: 0, dashDz: 0,
    hist: [], histT: 0, rewind: 0, rollbackCd: 0,
    sudo: 0, sudoT: 0, hotT: 0, hotTick: 0, idleT: 0, lastCause: '',
    // weapons
    weapon: 0, unlocked: [true, false, false, false], heat: [0, 0, 0, 0], locked: [false, false, false, false],
    sinceShot: [9, 9, 9, 9], fireCd: 0, switchT: 0, bloom: 0, idleFire: 9,
    // perks and what they add up to
    perks: {}, speedMul: 1, heatMul: 1, dmgMul: 1, dashCdMul: 1, rollbackCdMul: 1, sudoGain: 1, sudoBonus: 0,
    pellets: 0, grepMul: 1, blastMul: 1, noSelf: false, gcHeal: 0, coffeeMul: 1, coffeeRate: 1,
    breakerReady: false, canary: false, retry: 0,
  };
}

export function updatePlayer(sim, inp, dt) {
  const p = sim.player, W = sim.world;
  p.yaw += inp.dyaw;
  p.pitch = clamp(p.pitch + inp.dpitch, -1.5, 1.5);
  if (p.dead) return;
  p.invuln -= dt; p.dashCd -= dt; p.rollbackCd -= dt; p.jumpBuf -= dt; p.coyote -= dt;
  if (p.sudoT > 0) {
    p.sudoT -= dt;
    if (p.sudoT <= 0) sim.events.push({ t: 'sudoEnd' });
  }

  // rollback in progress: ride the recorded path backwards (newest sample -> oldest)
  if (p.rewind > 0) {
    p.rewind -= dt;
    const n = p.hist.length - 1, k = clamp(p.rewind / C.rollbackTime, 0, 1) * n;
    const i = Math.floor(k), f = k - i, a = p.hist[i], b = p.hist[Math.min(n, i + 1)];
    p.x = a.x + (b.x - a.x) * f; p.y = a.y + (b.y - a.y) * f; p.z = a.z + (b.z - a.z) * f;
    if (p.rewind <= 0) {
      const o = p.hist[0];
      p.x = o.x; p.y = o.y; p.z = o.z; p.vx = p.vy = p.vz = 0;
      p.hp = Math.max(p.hp, o.hp);
      p.heat.fill(0); p.locked.fill(false);
      p.hist.length = 0; p.histT = 0; p.invuln = 0.4;
      sim.events.push({ t: 'rollbackEnd' });
    }
    return;
  }
  if (inp.rollback && p.rollbackCd <= 0 && p.hist.length >= 8) {
    p.hist.push({ x: p.x, y: p.y, z: p.z, hp: p.hp });
    p.rewind = C.rollbackTime; p.rollbackCd = C.rollbackCd * p.rollbackCdMul;
    p.invuln = C.rollbackTime + 0.4; p.dashT = 0;
    sim.stats.rollbacks++;
    sim.events.push({ t: 'rollback', gain: Math.max(0, p.hist[0].hp - p.hp) });
    return;
  }
  if (inp.sudo && p.sudo >= 1 && p.sudoT <= 0) {
    p.sudoT = C.sudoTime + p.sudoBonus; p.sudo = 0;
    p.heat.fill(0); p.locked.fill(false);
    sim.stats.sudos++;
    sim.events.push({ t: 'sudo' });
  }

  // wish direction: forward = (-sin yaw, -cos yaw), right = (cos yaw, -sin yaw)
  const sin = Math.sin(p.yaw), cos = Math.cos(p.yaw);
  let wx = inp.mx * cos - inp.mz * sin, wz = -inp.mx * sin - inp.mz * cos;
  const wl = Math.hypot(wx, wz);
  if (wl > 1) { wx /= wl; wz /= wl; }
  p.idleT = wl > 0.05 || inp.fire ? 0 : p.idleT + dt;

  if (inp.dash && p.dashCd <= 0 && p.dashT <= 0) {
    if (wl > 0.1) { p.dashDx = wx / Math.min(wl, 1); p.dashDz = wz / Math.min(wl, 1); }
    else { p.dashDx = -sin; p.dashDz = -cos; }
    const dl = Math.hypot(p.dashDx, p.dashDz);
    p.dashDx /= dl; p.dashDz /= dl;
    p.dashT = C.dashTime; p.dashCd = C.dashCd * p.dashCdMul;
    p.invuln = Math.max(p.invuln, C.dashTime + 0.05);
    sim.stats.dashes++;
    sim.events.push({ t: 'dash' });
  }

  if (p.dashT > 0) {
    p.vx = p.dashDx * C.dashSpeed; p.vz = p.dashDz * C.dashSpeed;
    if (p.vy < 0) p.vy = 0;
    p.dashT -= dt;
    if (p.dashT <= 0) { p.vx *= 0.42; p.vz *= 0.42; }
  } else {
    const spd = C.speed * p.speedMul;
    const acc = p.onGround ? (wl > 0.05 ? C.accel : C.decel) : (wl > 0.05 ? C.airAccel : 1.5);
    const dvx = wx * spd - p.vx, dvz = wz * spd - p.vz, dl = Math.hypot(dvx, dvz);
    if (dl > 1e-6) {
      const k = Math.min(1, acc * dt / dl);
      p.vx += dvx * k; p.vz += dvz * k;
    }
    p.vy -= C.gravity * dt;
  }

  if (inp.jumpPressed || (inp.jump && p.onGround)) p.jumpBuf = 0.12;
  if (p.onGround) p.coyote = 0.1;
  if (p.jumpBuf > 0 && p.coyote > 0) {
    p.vy = C.jump; p.onGround = false; p.coyote = 0; p.jumpBuf = 0;
    sim.events.push({ t: 'jump' });
  }

  const ox = p.x, oz = p.z, oy = p.y;
  if (moveCircle(W, p, p.vx * dt, p.vz * dt, C.r, p.y) && dt > 0) {
    p.vx = (p.x - ox) / dt; p.vz = (p.z - oz) / dt;
  }
  p.y += p.vy * dt;
  // ground under the feet as they were before this step, so fast falls still land on rack tops
  const g = groundAt(W, p.x, p.z, C.r, Math.max(oy, p.y));
  if (p.y <= g && p.vy <= 0) {
    if (!p.onGround && p.vy < -7) sim.events.push({ t: 'land', v: -p.vy });
    p.y = g; p.vy = 0; p.onGround = true;
  } else p.onGround = false;

  // rack tops are the hot aisle
  if (p.onGround && p.y > 1) {
    p.hotT += dt; sim.stats.hotTime += dt;
    if (p.hotT > C.hotGrace) {
      p.hotTick -= dt;
      if (p.hotTick <= 0) {
        p.hotTick = C.hotTick;
        if (p.hotT - dt <= C.hotGrace + C.hotTick) sim.events.push({ t: 'voice', id: 'hot' });
        hurtPlayer(sim, C.hotDmg, p.x, p.z, 'the hot aisle', true);
      }
    }
  } else { p.hotT = 0; p.hotTick = 0; }

  p.histT -= dt;
  if (p.histT <= 0) {
    p.histT = 0.1;
    p.hist.push({ x: p.x, y: p.y, z: p.z, hp: p.hp });
    if (p.hist.length > C.rollbackSpan * 10) p.hist.shift();
  }
}

/**
 * Burn error budget. dot: damage over time (ignores and grants no i-frames);
 * self: own explosion (no difficulty scaling). Returns true when damage landed.
 */
export function hurtPlayer(sim, dmg, sx, sz, cause, dot = false, self = false) {
  const p = sim.player;
  if (p.dead || sim.god || sim.over) return false;
  if (!dot && p.invuln > 0) return false;
  if (!self) dmg *= SEV[sim.sev].dmg;
  const before = p.hp / p.maxHp;
  p.hp -= dmg;
  if (!dot) p.invuln = C.iframes;
  const st = sim.stats;
  st.damageTaken += dmg;
  st.byCause[cause] = (st.byCause[cause] || 0) + dmg;
  p.lastCause = cause;
  // where it came from, relative to the view: 0 front, +pi/2 right
  const dx = sx - p.x, dz = sz - p.z, sin = Math.sin(p.yaw), cos = Math.cos(p.yaw);
  const ang = Math.atan2(dx * cos - dz * sin, -dx * sin - dz * cos);
  sim.events.push({ t: 'hurt', dmg, ang, cause, dot });
  const after = p.hp / p.maxHp;
  if (before > 0.5 && after <= 0.5 && after > 0.25) sim.events.push({ t: 'voice', id: 'budget50' });
  if (before > 0.25 && after <= 0.25 && p.hp > 0) sim.events.push({ t: 'voice', id: 'budget25' });
  if (p.hp <= 0) {
    if (p.breakerReady) {
      p.breakerReady = false; p.hp = 20; p.invuln = 1.5;
      sim.pendingBlast = { x: p.x, y: p.y + 0.9, z: p.z };
      sim.events.push({ t: 'breaker' });
    } else {
      p.hp = 0; p.dead = true; sim.over = 'dead';
      sim.events.push({ t: 'dead', cause });
    }
  }
  return true;
}

export function healPlayer(sim, amount, why) {
  const p = sim.player, before = p.hp;
  p.hp = Math.min(p.maxHp, p.hp + amount);
  if (p.hp > before) sim.events.push({ t: 'heal', amount: p.hp - before, why });
}
