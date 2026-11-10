// Renderer: low-res scene target, bloom, CRT composite, resolution scale picked by measurement.
import {
  WebGLRenderer, WebGLRenderTarget, Scene, OrthographicCamera, Mesh, PlaneGeometry, ShaderMaterial, Vector2, Vector3,
  Vector4, LinearFilter, Color,
} from 'three';
import { BRIGHT, BLUR, COMPOSITE } from './shaders.js';

export const SCALES = [1, 0.85, 0.72, 0.62, 0.54, 0.47, 0.41, 0.36];

export function makeGfx(canvas) {
  const renderer = new WebGLRenderer({ canvas, antialias: false, alpha: false, stencil: false, powerPreference: 'high-performance' });
  renderer.autoClear = false;
  renderer.info.autoReset = false;
  renderer.setPixelRatio(1);
  const gl = renderer.getContext();

  // uniforms shared by every world material
  const U = {
    uTime: { value: 0 }, uFog: { value: new Vector3(0.008, 0.026, 0.018) }, uFogD: { value: 0.024 },
    uAccent: { value: new Vector3(0.22, 1, 0.53) }, uBass: { value: 0 }, uAlarm: { value: 0 },
    uLightPos: { value: [0, 1, 2, 3].map(() => new Vector4(0, -100, 0, 1)) },
    uLightCol: { value: [0, 1, 2, 3].map(() => new Vector3()) },
    uRip: { value: Array.from({ length: 8 }, () => new Vector4(0, 0, -100, 0)) },
  };

  const target = (depth) => new WebGLRenderTarget(4, 4, { depthBuffer: depth, minFilter: LinearFilter, magFilter: LinearFilter });
  const rtScene = target(true), rtBright = target(false), rtBlurA = target(false), rtBlurB = target(false);
  const post = (sh, uniforms) => new ShaderMaterial({ ...sh, uniforms, depthTest: false, depthWrite: false });
  const mBright = post(BRIGHT, { tSrc: { value: rtScene.texture }, uTexel: { value: new Vector2() } });
  const mBlur = post(BLUR, { tSrc: { value: null }, uDir: { value: new Vector2() } });
  // the knobs the game drives every frame live on fx
  const fx = {
    uGlitch: { value: 0 }, uHurt: { value: 0 }, uFade: { value: 1 }, uAberr: { value: 0 }, uBloom: { value: 1.15 },
    uCrt: { value: 1 }, uTint: { value: new Vector3(1, 0.8, 0.2) }, uTintAmt: { value: 0 }, uFlash: { value: 0 },
    uRewind: { value: 0 },
  };
  const mComp = post(COMPOSITE, {
    tScene: { value: rtScene.texture }, tBloom: { value: rtBlurB.texture }, uSceneRes: { value: new Vector2() },
    uOutRes: { value: new Vector2() }, uTime: U.uTime, ...fx,
  });
  const quad = new Mesh(new PlaneGeometry(2, 2), mComp);
  quad.frustumCulled = false;
  const qScene = new Scene(), qCam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  qScene.add(quad);
  const pass = (mat, rt) => { quad.material = mat; renderer.setRenderTarget(rt); renderer.render(qScene, qCam); };

  const g = {
    renderer, U, fx, scale: 0.54, outW: 4, outH: 4, sceneW: 4, sceneH: 4, fps: 60, ms: 16.7, lowT: 0, auto: true,
    calls: 0, tris: 0, clear: new Color(0, 0, 0), calibration: '', winT: 0, winN: 0, grace: 0,

    resize(w, h) {
      g.outW = w; g.outH = h;
      renderer.setSize(w, h, false);
      g.setScale(g.scale);
    },
    setScale(s) {
      g.scale = s;
      const w = Math.max(64, Math.round(g.outW * s / 4) * 4), h = Math.max(36, Math.round(g.outH * s / 4) * 4);
      g.sceneW = w; g.sceneH = h;
      rtScene.setSize(w, h); rtBright.setSize(w >> 1, h >> 1); rtBlurA.setSize(w >> 2, h >> 2); rtBlurB.setSize(w >> 2, h >> 2);
      mBright.uniforms.uTexel.value.set(1 / w, 1 / h);
      mComp.uniforms.uSceneRes.value.set(w, h);
      mComp.uniforms.uOutRes.value.set(g.outW, g.outH);
    },

    /** scene + camera, then the viewmodel on a cleared depth buffer, then post. */
    render(scene, camera, vmScene, vmCamera) {
      renderer.info.reset();
      renderer.setRenderTarget(rtScene);
      g.clear.setRGB(U.uFog.value.x * 0.6, U.uFog.value.y * 0.6, U.uFog.value.z * 0.6);
      renderer.setClearColor(g.clear, 1);
      renderer.clear(true, true, false);
      renderer.render(scene, camera);
      if (vmScene) { renderer.clearDepth(); renderer.render(vmScene, vmCamera); }
      pass(mBright, rtBright);
      mBlur.uniforms.tSrc.value = rtBright.texture; mBlur.uniforms.uDir.value.set(1 / (g.sceneW >> 2), 0);
      pass(mBlur, rtBlurA);
      mBlur.uniforms.tSrc.value = rtBlurA.texture; mBlur.uniforms.uDir.value.set(0, 1 / (g.sceneH >> 2));
      pass(mBlur, rtBlurB);
      pass(mComp, null);
      g.calls = renderer.info.render.calls; g.tris = renderer.info.render.triangles;
    },

    /**
     * Pick the largest resolution scale whose measured frame cost fits the budget (ms). readPixels blocks until
     * the GPU is done, so the time is real. frame() must render one frame.
     */
    calibrate(frame, budget, maxScale = 1) {
      const px = new Uint8Array(4), time = (n) => {
        const t = performance.now();
        for (let i = 0; i < n; i++) frame();
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        return (performance.now() - t) / n;
      };
      time(2); // compile shaders, upload buffers
      const log = [];
      let best = SCALES.at(-1);
      for (let i = SCALES.length - 1; i >= 0 && SCALES[i] <= maxScale; i--) {
        g.setScale(SCALES[i]);
        time(1);
        const ms = time(3);
        log.push(`${SCALES[i]}:${ms.toFixed(1)}`);
        if (ms > budget) break;
        best = SCALES[i];
      }
      g.setScale(best);
      g.calibration = log.join(' ');
      return best;
    },

    /**
     * Call once per presented frame with its duration. Sheds resolution when the game cannot hold the target:
     * at once after 1.5 s below 83% of it, or after a 4 s window that averaged below 93% (a hot, throttled laptop
     * drops a few frames every second rather than all of them).
     */
    tick(dt, target) {
      g.ms += (dt * 1000 - g.ms) * 0.08;
      g.fps = 1000 / g.ms;
      if (!g.auto) return;
      if (g.grace > 0) { g.grace -= dt; return; }
      g.lowT = g.fps < target * 0.83 ? g.lowT + dt : Math.max(0, g.lowT - dt * 0.5);
      g.winT += dt; g.winN++;
      const slow = g.winT >= 4 && g.winN / g.winT < target * 0.93, i = SCALES.indexOf(g.scale);
      if (g.winT >= 4) { g.winT = 0; g.winN = 0; }
      if ((g.lowT > 1.5 || slow) && i >= 0 && i < SCALES.length - 1) { g.setScale(SCALES[i + 1]); g.settle(3); }
    },
    /** Ignore the next seconds: a level load or a resolution change stutters once and says nothing about speed. */
    settle(seconds = 5) { g.grace = seconds; g.lowT = 0; g.winT = 0; g.winN = 0; },
  };
  return g;
}
