// The weapon in hand: its own tiny scene, drawn after the world on a cleared depth buffer.
// Gun space: -z is the barrel direction; the camera is placed by inverting the gun's pose.
import { PerspectiveCamera, Scene, Matrix4, Euler, Quaternion, Vector3, Vector4 } from 'three';
import { BoxBatch } from './scene.js';
import { WEAPONS } from '../sim/config.js';

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const S = 0.85; // model scale

const MODEL = [
  // SIGTERM: compact SMG
  (B, c, k, d) => {
    B.box(0, 0.03, -0.1, 0.07, 0.09, 0.42, d[0], d[1], d[2], k);
    B.box(0, 0.05, -0.42, 0.035, 0.035, 0.26, c[0], c[1], c[2], k + 0.1);
    B.box(0, -0.06, 0.04, 0.05, 0.11, 0.07, d[0], d[1], d[2], k, 0.3);
    B.box(0, -0.075, -0.13, 0.04, 0.13, 0.06, d[0], d[1], d[2], k, -0.1);
    B.box(0, 0.095, -0.02, 0.02, 0.03, 0.05, c[0], c[1], c[2], 0.6);
    return [0.05, -0.58];
  },
  // SIGKILL: double barrel
  (B, c, k, d, kick) => {
    B.box(-0.03, 0.04, -0.3, 0.05, 0.05, 0.62, c[0] * 0.7, c[1] * 0.7, c[2] * 0.7, k);
    B.box(0.03, 0.04, -0.3, 0.05, 0.05, 0.62, c[0] * 0.7, c[1] * 0.7, c[2] * 0.7, k);
    B.box(0, 0.02, 0.04, 0.11, 0.1, 0.3, d[0], d[1], d[2], k);
    B.box(0, -0.035, -0.28 + kick * 1.6, 0.1, 0.05, 0.18, c[0], c[1], c[2], k + 0.15);
    B.box(0, -0.06, 0.2, 0.06, 0.12, 0.22, d[0], d[1], d[2], k, 0.35);
    return [0.04, -0.64];
  },
  // grep: rail
  (B, c, k, d, kick, t) => {
    B.box(-0.036, 0.04, -0.4, 0.02, 0.055, 0.86, d[0], d[1], d[2], k);
    B.box(0.036, 0.04, -0.4, 0.02, 0.055, 0.86, d[0], d[1], d[2], k);
    B.box(0, 0.04, -0.4, 0.03, 0.02, 0.82, c[0], c[1], c[2], 0.7 + 0.3 * Math.sin(t * 8));
    for (let i = 0; i < 3; i++) B.box(0, 0.04, -0.15 - i * 0.25, 0.11, 0.09, 0.03, c[0], c[1], c[2], k + 0.2);
    B.box(0, 0.0, 0.08, 0.09, 0.12, 0.26, d[0], d[1], d[2], k);
    B.box(0, -0.09, 0.1, 0.05, 0.13, 0.07, d[0], d[1], d[2], k, 0.3);
    return [0.04, -0.86];
  },
  // rm -rf: launcher
  (B, c, k, d) => {
    B.box(0, 0.06, -0.3, 0.14, 0.14, 0.7, d[0], d[1], d[2], k);
    B.box(0, 0.06, -0.67, 0.17, 0.17, 0.06, c[0], c[1], c[2], k + 0.3);
    B.box(0, 0.06, -0.12, 0.146, 0.146, 0.04, 1, 0.85, 0.1, 0.5);
    B.box(0, 0.06, -0.22, 0.146, 0.146, 0.04, 1, 0.85, 0.1, 0.5);
    B.box(0, 0.06, 0.08, 0.16, 0.16, 0.05, c[0], c[1], c[2], k);
    B.box(0, -0.06, -0.1, 0.05, 0.14, 0.07, d[0], d[1], d[2], k, 0.25);
    return [0.06, -0.74];
  },
];

export function makeViewmodel(gfx) {
  const lightPos = [0, 1, 2, 3].map(() => new Vector4(0, 0, -100, 1)), lightCol = [0, 1, 2, 3].map(() => new Vector3());
  const U = { ...gfx.U, uFogD: { value: 0 }, uLightPos: { value: lightPos }, uLightCol: { value: lightCol } };
  const B = new BoxBatch(48, U, false), G = new BoxBatch(8, U, true);
  const scene = new Scene(), camera = new PerspectiveCamera(58, 1, 0.02, 10);
  scene.add(B.mesh, G.mesh);
  camera.matrixAutoUpdate = false;
  const m = new Matrix4(), eul = new Euler(0, 0, 0, 'YXZ'), quat = new Quaternion(), pos = new Vector3(), one = new Vector3(1, 1, 1);
  const dark = [0, 0, 0];
  let swayX = 0, swayY = 0, bob = 0;
  return {
    scene, camera,
    /** look: this frame's yaw and pitch change; fx: effect state (kick, swap, muzzle, dip, sudo). */
    update(dt, sim, look, fx, t) {
      const p = sim.player, w = WEAPONS[p.weapon], heat = p.heat[p.weapon], locked = p.locked[p.weapon];
      const k = Math.min(1, dt * 10), sp = Math.hypot(p.vx, p.vz), run = Math.min(1, sp / 8) * (p.onGround ? 1 : 0.2);
      swayX += (clamp(look.dyaw / Math.max(dt, 1e-3) * 0.012, -0.09, 0.09) - swayX) * k;
      swayY += (clamp(look.dpitch / Math.max(dt, 1e-3) * 0.012, -0.07, 0.07) - swayY) * k;
      bob += dt * sp * 1.25;
      const rise = (1 - fx.swap) ** 2, shiver = locked ? Math.sin(t * 90) * 0.004 : 0;
      const kick = clamp(fx.kick, -0.2, 0.45);
      pos.set(0.27 + swayX * 0.5 + Math.sin(bob) * 0.012 * run + shiver, -0.27 - rise * 0.4 + Math.abs(Math.cos(bob)) * 0.014 * run - fx.dip * 0.4 - swayY * 0.4 - clamp(p.vy, -12, 12) * 0.004,
        -0.76 + kick * 0.9);
      eul.set(kick * 1.5 - rise * 1.1 + swayY * 0.8, 0.03 + swayX * 1.2, -swayX * 0.9);
      m.compose(pos, quat.setFromEuler(eul), one);
      camera.matrix.copy(m).invert();
      camera.matrixWorldNeedsUpdate = true;

      // colours: weapon colour, hot when rate-limited, gold under sudo
      const hot = locked ? 0.5 + 0.5 * Math.sin(t * 14) : 0, sudo = p.sudoT > 0 ? 1 : 0;
      const c = [w.color[0] + (1 - w.color[0]) * Math.max(hot, sudo), w.color[1] * (1 - hot) + 0.8 * sudo * (1 - w.color[1]), w.color[2] * (1 - hot) * (1 - sudo * 0.7)];
      dark[0] = 0.32 + hot * 0.6 + sudo * 0.5; dark[1] = 0.36 + sudo * 0.35; dark[2] = 0.42;
      B.begin(); G.begin();
      B.base(0, 0, 0, 0, S);
      const [my, mz] = MODEL[p.weapon](B, c, 0.12 + sudo * 0.5 + hot * 0.4, dark, kick, t);
      // rate-limit gauge on top of the weapon
      for (let i = 0; i < 8; i++) {
        const on = heat > i / 8 + 0.01, r = on ? 0.3 + i / 8 : 0.1, g = on ? 1.1 - i / 8 : 0.1;
        B.box(0.0, my + (p.weapon === 3 ? 0.085 : 0.052), -0.05 - i * 0.032, 0.026, 0.01, 0.022, r, g, on ? 0.15 : 0.1, on ? 1.2 : 0);
      }
      if (fx.muzzle > 0 && p.weapon !== 3) {
        const s = fx.muzzle * (p.weapon === 1 ? 0.15 : 0.1);
        G.base(0, my * S, mz * S, 0, S);
        G.box(0, 0, 0, s, s, s * 1.6, c[0], c[1], c[2], 1.5, 0, 0, t * 40);
        G.box(0, 0, 0, s * 1.9, s * 0.25, 0.02, 1, 1, 1, 0.8, 0, 0, t * 31);
        G.box(0, 0, 0, s * 0.25, s * 1.9, 0.02, 1, 1, 1, 0.8, 0, 0, t * 31);
      }
      B.end(); G.end();
      lightPos[0].set(0, my * S, (mz - 0.1) * S, 1.4);
      lightCol[0].set(c[0] * fx.muzzle * 1.2, c[1] * fx.muzzle * 1.2, c[2] * fx.muzzle * 1.2);
    },
    resize(aspect) { camera.aspect = aspect; camera.updateProjectionMatrix(); },
  };
}
