// Effects: glyph particles, debris, tracers, lights, floor ripples, camera shake. Fed by sim events.
import { ENEMY, WEAPONS } from '../sim/config.js';
import { raycast } from '../sim/world.js';

const TAU = Math.PI * 2;
const rnd = (a = 1, b) => (b === undefined ? Math.random() * a : a + Math.random() * (b - a));
const HEX = '0123456789ABCDEF';
const KIND_COL = { rm: [1, 0.45, 0.2], oom: [0.8, 0.3, 1], breaker: [0.3, 0.9, 1], boss: [1, 0.2, 0.25] };

export function makeFx(view, gfx) {
  const parts = [], debris = [], tracers = [], lights = [];
  const U = gfx.U;
  let rip = 0;
  const fx = {
    trauma: 0, kick: 0, kickV: 0, fov: 0, dip: 0, hurt: 0, glitch: 0, flash: 0, rewind: 0, alarm: 0, sudo: 0, tint: 0,
    muzzle: 0, swap: 1,

    ripple(x, z, strength) {
      U.uRip.value[rip].set(x, z, U.uTime.value, strength);
      rip = (rip + 1) % 8;
    },
    light(x, y, z, radius, c, life = 0.25, k = 1) {
      if (lights.length < 24) lights.push({ x, y, z, radius, r: c[0] * k, g: c[1] * k, b: c[2] * k, life, max: life });
    },
    /** A glyph particle. o: {vx, vy, vz, life, size, grav, drag, rot, vr} */
    glyph(x, y, z, code, c, o) {
      if (parts.length >= 1500) return;
      parts.push({
        x, y, z, code, r: c[0], g: c[1], b: c[2], vx: o.vx || 0, vy: o.vy || 0, vz: o.vz || 0, life: o.life || 0.8, max: o.life || 0.8,
        size: o.size || 0.3, grav: o.grav ?? 12, drag: o.drag ?? 1.2, rot: o.rot || 0, vr: o.vr || 0, floor: o.floor ?? true,
      });
    },
    /** n glyphs flying out of a point; text: letters to use in order, or a set to pick from. */
    burst(x, y, z, n, text, c, speed, o = {}) {
      for (let i = 0; i < n; i++) {
        const a = rnd(TAU), u = rnd(-0.3, 1), s = speed * rnd(0.35, 1), h = Math.sqrt(1 - Math.min(1, u * u));
        fx.glyph(x + rnd(-0.2, 0.2), y + rnd(-0.2, 0.2), z + rnd(-0.2, 0.2), text.charCodeAt(o.pick ? (Math.random() * text.length) | 0 : i % text.length), c, {
          vx: Math.cos(a) * h * s, vy: u * s + (o.up || 0), vz: Math.sin(a) * h * s, life: rnd(0.5, 1) * (o.life || 1), size: (o.size || 0.34) * rnd(0.8, 1.3),
          vr: rnd(-6, 6), grav: o.grav, drag: o.drag,
        });
      }
    },
    chunks(x, y, z, n, c, speed, size) {
      for (let i = 0; i < n && debris.length < 260; i++) {
        const a = rnd(TAU), s = speed * rnd(0.3, 1);
        debris.push({
          x: x + rnd(-0.3, 0.3), y: y + rnd(-0.4, 0.4), z: z + rnd(-0.3, 0.3), vx: Math.cos(a) * s, vy: rnd(1, 6) + speed * 0.3, vz: Math.sin(a) * s,
          rx: rnd(TAU), ry: rnd(TAU), wx: rnd(-9, 9), wy: rnd(-9, 9), s: size * rnd(0.5, 1.2), r: c[0], g: c[1], b: c[2], life: rnd(0.9, 1.8), max: 1.8,
        });
      }
    },
    shake(amount) { fx.trauma = Math.min(1, fx.trauma + amount); },

    /** React to one sim event. cam: {x, y, z, fx, fy, fz, rx, rz}; returns nothing, mutates effect state. */
    on(e, sim, cam) {
      const p = sim.player, near = (x, z, range) => Math.max(0, 1 - Math.hypot(x - cam.x, z - cam.z) / range);
      switch (e.t) {
        case 'fire': {
          const w = WEAPONS[e.weapon];
          fx.kickV += w.kick * 2.4; fx.muzzle = 1;
          fx.shake(w.kick * 0.045);
          fx.light(cam.x + cam.fx * 1.2, cam.y + cam.fy * 1.2, cam.z + cam.fz * 1.2, 5 + w.kick * 2, w.color, 0.08, 0.5);
          break;
        }
        case 'tracer': {
          const w = WEAPONS[e.weapon], c = w.color;
          // from the muzzle (right and below the eye) to the hit
          const mx = cam.x + cam.rx * 0.22 + cam.fx * 0.7, my = cam.y - 0.16 + cam.fy * 0.7, mz = cam.z + cam.rz * 0.22 + cam.fz * 0.7;
          const rail = e.weapon === 2;
          if (tracers.length < 70) tracers.push({ ax: mx, ay: my, az: mz, bx: e.x, by: e.y, bz: e.z, w: rail ? 0.11 : 0.028, r: c[0], g: c[1], b: c[2], life: rail ? 0.4 : 0.07, max: rail ? 0.4 : 0.07 });
          if (rail) {
            const n = Math.min(40, Math.floor(e.len / 1.6)), s = "grep -r 'ERROR' /proc ";
            for (let i = 1; i <= n; i++) {
              const k = i * 1.6;
              fx.glyph(cam.x + e.dx * k, cam.y - 0.1 + e.dy * k, cam.z + e.dz * k, s.charCodeAt(i % s.length), c, { vy: rnd(0.2, 0.9), life: rnd(0.5, 0.9), size: 0.3, grav: 0, drag: 2 });
            }
            fx.light(e.x, e.y, e.z, 8, c, 0.3);
          }
          if (e.wall) {
            for (let i = 0; i < (rail ? 6 : 2); i++) {
              fx.glyph(e.x, e.y, e.z, 39 + ((Math.random() * 8) | 0), c, { vx: e.nx * rnd(1, 5) + rnd(-2, 2), vy: e.ny * rnd(1, 5) + rnd(0, 3), vz: e.nz * rnd(1, 5) + rnd(-2, 2), life: rnd(0.2, 0.45), size: 0.2 });
            }
          }
          break;
        }
        case 'hit': {
          const c = ENEMY[e.type].color;
          fx.burst(e.x, e.y, e.z, e.src === 'kill' ? 1 : 2, HEX, c, 5, { pick: true, size: 0.22, life: 0.55 });
          break;
        }
        case 'kill': {
          const c = ENEMY[e.type].color, big = e.r * e.h, k = near(e.x, e.z, 30);
          if (e.src === 'purge') { fx.burst(e.x, e.y + e.h * 0.5, e.z, 6, '01', c, 4, { pick: true, grav: -3 }); break; }
          if (e.type === 'packet') { fx.burst(e.x, e.y + 0.3, e.z, 3, 'SYN', c, 5, { size: 0.26 }); fx.chunks(e.x, e.y + 0.3, e.z, 2, c, 5, 0.16); break; }
          // it bursts into the letters of its own name
          fx.burst(e.x, e.y + e.h * 0.6, e.z, Math.min(26, e.name.length * 2), e.name, c, 7 + big * 2, { size: 0.36 + big * 0.12, up: 3, life: 1.3 });
          fx.chunks(e.x, e.y + e.h * 0.5, e.z, Math.min(16, 4 + Math.round(big * 5)), c, 5 + big * 2, 0.22 + e.r * 0.25);
          fx.ripple(e.x, e.z, 0.35 + big * 0.5);
          fx.light(e.x, e.y + e.h * 0.5, e.z, 6 + e.r * 5, c, 0.3);
          fx.shake((0.05 + big * 0.1) * k);
          break;
        }
        case 'explode': {
          const c = KIND_COL[e.kind] || KIND_COL.rm, k = near(e.x, e.z, 34);
          fx.burst(e.x, e.y, e.z, 26, '#*%!@&', c, e.radius * 3.2, { pick: true, size: 0.5, up: 2, life: 1.1 });
          fx.burst(e.x, e.y, e.z, 14, '.:', [1, 0.9, 0.7], e.radius * 4.5, { pick: true, size: 0.4, life: 0.6, drag: 3 });
          fx.chunks(e.x, e.y, e.z, 10, c, e.radius * 2, 0.3);
          fx.ripple(e.x, e.z, 0.6 + e.radius * 0.22);
          fx.light(e.x, e.y + 0.5, e.z, e.radius * 3.2, c, 0.45, 1.6);
          fx.shake(0.75 * k * k + 0.1 * k);
          fx.flash = Math.max(fx.flash, 0.22 * k * k);
          break;
        }
        case 'split': fx.burst(e.x, e.y, e.z, 9, ':|:&', ENEMY.fork.color, 6, { size: 0.4 }); break;
        case 'spawn': {
          const c = ENEMY[e.type].color;
          if (e.type !== 'packet') { fx.ripple(e.x, e.z, 0.25); fx.burst(e.x, 0.3, e.z, 4, 'fork()', c, 2, { up: 5, grav: 2, size: 0.26, life: 0.8 }); }
          break;
        }
        case 'blink':
          fx.burst(e.x0, 1, e.z0, 10, '?', ENEMY.heisen.color, 4, { grav: -2, size: 0.4 });
          fx.burst(e.x, 1, e.z, 6, '!', [1, 1, 1], 3, { grav: -2, size: 0.36 });
          fx.light(e.x, 1.2, e.z, 7, ENEMY.heisen.color, 0.3);
          break;
        case 'raceDown': fx.burst(e.x, 1, e.z, 8, 'await', ENEMY.race.color, 4, { size: 0.3 }); break;
        case 'raceRevive': fx.burst(e.x, 1, e.z, 12, 'retry', [1, 1, 1], 5, { size: 0.34, up: 3 }); fx.ripple(e.x, e.z, 0.5); break;
        case 'cronTele': fx.glyph(e.x, e.y + 1.9, e.z, 33, [1, 1, 0.6], { life: 0.45, size: 0.9, grav: 0, vy: 1 }); fx.light(e.x, e.y, e.z, 6, ENEMY.cron.color, 0.4); break;
        case 'enemyShot': fx.light(e.x, e.y, e.z, 5, e.kind === 0 ? ENEMY.cron.color : ENEMY.boss.color, 0.12); break;
        case 'shotHit': fx.burst(e.x, e.y, e.z, 3, '.,', [1, 0.8, 0.6], 3, { pick: true, size: 0.22, life: 0.4 }); break;
        case 'leakFuse': fx.burst(e.x, 2, e.z, 10, 'OOM', [1, 1, 1], 5, { size: 0.5, up: 3 }); break;
        case 'bruteWindup': fx.glyph(e.x, 3.6, e.z, 33, [1, 0.3, 0.2], { life: 0.7, size: 1.3, grav: 0, vy: 0.6 }); break;
        case 'bruteCharge': fx.shake(0.2 * near(e.x, e.z, 25)); break;
        case 'bruteCrash':
          fx.shake(0.6 * near(e.x, e.z, 30)); fx.ripple(e.x, e.z, 1.3);
          fx.chunks(e.x, 1.2, e.z, 10, [0.5, 0.5, 0.55], 7, 0.3);
          fx.burst(e.x, 2.6, e.z, 6, '*', [1, 1, 0.4], 3, { size: 0.5 });
          break;
        case 'hurt':
          fx.hurt = Math.min(1, fx.hurt + 0.35 + e.dmg * 0.03);
          if (!e.dot) { fx.glitch = Math.min(1, fx.glitch + 0.25 + e.dmg * 0.02); fx.shake(0.25 + e.dmg * 0.012); fx.kickV -= 4; }
          break;
        case 'heal': case 'coffee': fx.tint = Math.max(fx.tint, 0.5); break;
        case 'dash': fx.fov += 9; break;
        case 'land': fx.dip = Math.min(0.22, e.v * 0.012); fx.ripple(p.x, p.z, Math.min(0.6, e.v * 0.03)); break;
        case 'rollback': fx.rewind = 1; break;
        case 'rollbackEnd': fx.rewind = 0; fx.flash = 0.35; fx.ripple(p.x, p.z, 0.9); break;
        case 'sudo': fx.sudo = 1; fx.flash = 0.5; fx.ripple(p.x, p.z, 1.6); fx.shake(0.4); fx.fov += 6; break;
        case 'sudoEnd': fx.sudo = 0; break;
        case 'switch': fx.swap = 0; break;
        case 'breaker': fx.flash = 0.8; fx.shake(0.8); break;
        case 'unlock': fx.flash = 0.3; break;
        case 'perk': fx.flash = 0.25; fx.ripple(p.x, p.z, 1); break;
        case 'act': fx.glitch = 1; fx.flash = 0.4; parts.length = debris.length = tracers.length = lights.length = 0; break;
        case 'waveStart': fx.alarm = 1; fx.ripple(p.x, p.z, 0.8); break;
        case 'waveEnd': fx.ripple(p.x, p.z, 1.4); fx.flash = 0.18; break;
        case 'bossFight': fx.shake(0.7); fx.ripple(e.x ?? 0, e.z ?? 0, 2); fx.alarm = 1; break;
        case 'bossRing': fx.ripple(e.x, e.z, 1.2); fx.shake(0.12); fx.light(e.x, 1, e.z, 16, ENEMY.boss.color, 0.4); break;
        case 'bossAdds': fx.ripple(e.x, e.z, 0.6); break;
        case 'shieldDown': fx.flash = 0.4; fx.shake(0.5); fx.ripple(e.x, e.z, 2); fx.burst(e.x, 5, e.z, 30, '404', [0.2, 0.9, 0.8], 14, { size: 0.6 }); break;
        case 'bossPhase3': fx.glitch = 1; fx.shake(0.6); fx.alarm = 1; break;
        case 'bossDying': fx.glitch = 1; fx.shake(1); fx.flash = 0.6; break;
        case 'bossDead':
          fx.flash = 1; fx.shake(1); fx.ripple(e.x, e.z, 3);
          fx.burst(e.x, 5, e.z, 60, 'legacy-billing-monolith.jar', ENEMY.boss.color, 22, { size: 0.8, up: 6, life: 2.2 });
          fx.chunks(e.x, 4, e.z, 40, [0.1, 0.05, 0.06], 14, 0.9);
          break;
        case 'deflect': fx.burst(e.x, e.y, e.z, 2, '0', [0.2, 0.9, 0.8], 4, { size: 0.3, life: 0.4 }); break;
        case 'dead': fx.glitch = 1; fx.shake(1); break;
        default:
      }
    },

    update(dt, sim) {
      const W = sim.world;
      // recoil spring: fixed small steps, or it blows up below ~15 fps (explicit Euler is unstable there)
      for (let left = dt; left > 1e-6; left -= 1 / 240) {
        const h = Math.min(left, 1 / 240);
        fx.kickV += (-fx.kick * 190 - fx.kickV * 22) * h; fx.kick += fx.kickV * h;
      }
      fx.kick = Math.max(-0.25, Math.min(0.5, fx.kick));
      fx.trauma = Math.max(0, fx.trauma - dt * 1.5);
      fx.fov *= Math.exp(-dt * 7); fx.dip *= Math.exp(-dt * 9);
      fx.hurt = Math.max(0, fx.hurt - dt * 1.4); fx.glitch = Math.max(0, fx.glitch - dt * 2.2);
      fx.flash = Math.max(0, fx.flash - dt * 2.8); fx.alarm = Math.max(0, fx.alarm - dt * 0.45);
      fx.muzzle = Math.max(0, fx.muzzle - dt * 16); fx.tint = Math.max(0, fx.tint - dt * 1.5);
      fx.swap = Math.min(1, fx.swap + dt * 5);
      let n = 0;
      for (let i = 0; i < parts.length; i++) {
        const q = parts[i];
        if ((q.life -= dt) <= 0) continue;
        const k = Math.exp(-q.drag * dt);
        q.vx *= k; q.vz *= k; q.vy = q.vy * k - q.grav * dt;
        q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt; q.rot += q.vr * dt;
        if (q.floor && q.y < 0.12 && q.vy < 0) { q.y = 0.12; q.vy *= -0.35; q.vx *= 0.6; q.vz *= 0.6; q.vr *= 0.4; }
        parts[n++] = q;
      }
      parts.length = n;
      n = 0;
      for (let i = 0; i < debris.length; i++) {
        const d = debris[i];
        if ((d.life -= dt) <= 0) continue;
        d.vy -= 22 * dt;
        const ox = d.x, oz = d.z;
        d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt; d.rx += d.wx * dt; d.ry += d.wy * dt;
        if (d.y < d.s * 0.5) { d.y = d.s * 0.5; d.vy *= -0.4; d.vx *= 0.7; d.vz *= 0.7; d.wx *= 0.6; d.wy *= 0.6; }
        // bounce off walls and racks (cheap: one short ray along the motion)
        if (W) {
          const l = Math.hypot(d.x - ox, d.z - oz);
          if (l > 1e-4 && raycast(W, ox, d.y, oz, (d.x - ox) / l, 0, (d.z - oz) / l, l, null) < l) { d.x = ox; d.z = oz; d.vx *= -0.5; d.vz *= -0.5; }
        }
        debris[n++] = d;
      }
      debris.length = n;
      n = 0;
      for (let i = 0; i < tracers.length; i++) if ((tracers[i].life -= dt) > 0) tracers[n++] = tracers[i];
      tracers.length = n;
      n = 0;
      for (let i = 0; i < lights.length; i++) if ((lights[i].life -= dt) > 0) lights[n++] = lights[i];
      lights.length = n;
    },

    /** Fill the batches and the light uniforms. */
    draw() {
      const B = view.boxes, G = view.glow, T = view.glyphs;
      for (const q of parts) {
        const a = Math.min(1, q.life / q.max * 2.2);
        T.add(q.x, q.y, q.z, q.size, q.r, q.g, q.b, a, q.code, q.rot);
      }
      B.base(0, 0, 0, 0, 1);
      for (const d of debris) {
        const s = d.s * Math.min(1, d.life * 2.5);
        B.box(d.x, d.y, d.z, s, s, s, d.r, d.g, d.b, 0.25, d.rx, d.ry);
      }
      for (const q of tracers) {
        const a = q.life / q.max;
        G.beam(q.ax, q.ay, q.az, q.bx, q.by, q.bz, q.w * (0.4 + 0.6 * a), q.r, q.g, q.b, 0.4 + 1.6 * a);
      }
      // the four strongest lights reach the shaders
      lights.sort((a, b) => b.life / b.max * b.radius - a.life / a.max * a.radius);
      for (let i = 0; i < 4; i++) {
        const l = lights[i];
        if (l) {
          const a = l.life / l.max;
          U.uLightPos.value[i].set(l.x, l.y, l.z, l.radius);
          U.uLightCol.value[i].set(l.r * a, l.g * a, l.b * a);
        } else U.uLightCol.value[i].set(0, 0, 0);
      }
      U.uAlarm.value = fx.alarm * (0.5 + 0.5 * Math.sin(U.uTime.value * 9));
    },
    counts: () => ({ parts: parts.length, debris: debris.length, tracers: tracers.length, lights: lights.length }),
  };
  return fx;
}
