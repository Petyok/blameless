// View-side logic that does not need a browser: node --test test/
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeFx } from '../src/view/fx.js';

// Found with real input in software GL at 13 fps: the recoil spring diverged, threw the camera at the floor and
// the weapon out of view. It has to settle at any frame rate.
test('recoil spring settles at 60, 13 and 10 fps', () => {
  const U = { uRip: { value: [] }, uTime: { value: 0 }, uLightPos: { value: [] }, uLightCol: { value: [] }, uAlarm: { value: 0 } };
  const cam = { x: 0, y: 1.6, z: 0, fx: 0, fy: 0, fz: -1, rx: 1, rz: 0 }, sim = { world: null, player: {} };
  for (const fps of [60, 13, 10]) {
    const fx = makeFx({ boxes: null, glow: null, glyphs: null }, { U });
    let peak = 0;
    for (let i = 0; i < fps * 4; i++) {
      // two seconds of held shotgun fire, then two seconds of rest
      if (i < fps * 2 && i % Math.max(1, Math.round(fps / 9.5)) === 0) fx.on({ t: 'fire', weapon: 1 }, sim, cam);
      fx.update(1 / fps, sim);
      peak = Math.max(peak, Math.abs(fx.kick));
    }
    assert.ok(peak < 0.5, `${fps} fps: peak kick ${peak}`);
    assert.ok(Math.abs(fx.kick) < 0.01, `${fps} fps: kick ${fx.kick} two seconds after the last shot`);
  }
});

test('every synthesized sound is audible, finite and does not clip', async () => {
  const { recipes, renderSound } = await import('../src/view/audio.js');
  for (const [name, recipe] of Object.entries(recipes())) {
    const d = renderSound(recipe, 48000);
    let peak = 0, sum = 0;
    for (const v of d) {
      assert.ok(Number.isFinite(v), `${name}: a sample is ${v}`);
      peak = Math.max(peak, Math.abs(v)); sum += v * v;
    }
    assert.ok(peak <= 0.9001 && peak > 0.05, `${name}: peak ${peak.toFixed(2)}`);
    assert.ok(Math.sqrt(sum / d.length) > 0.01, `${name}: rms ${Math.sqrt(sum / d.length).toFixed(3)}`);
  }
});

test('writing: every announcer line has text, the postmortem is written from the stats', async () => {
  const { VOICE, postmortem, killLine, clock } = await import('../src/view/text.js');
  const { WAVES } = await import('../src/sim/config.js');
  for (const w of WAVES) assert.ok(VOICE[w.voice], `no voice line for ${w.voice}`);
  for (const id of ['call', 'ack', 'rate', 'budget50', 'budget25', 'hot', 'rollback', 'sudo', 'sudoReady', 'shield', 'shieldDown', 'phase3',
    'bossDead', 'clear', 'hotfix', 'act2', 'act3', 'breaker', 'combo', 'dead', 'win', 'postmortem', 'night', 'idle']) assert.ok(VOICE[id], id);
  const sim = { sev: 2, score: 1234, perkLog: ['gc'], stats: { time: 600, shots: 100, hits: 40, kills: { zombie: 30 }, killsTotal: 50, byCause: { zombie: 80 },
    bestCombo: 22, rollbacks: 1, hotTime: 5, overheats: 4, revived: 1, collateral: 2, blinks: 20, coffee: 0 } };
  const d = postmortem(sim, 2, { zombie: 2 });
  assert.match(d.well.join(' '), /50 processes terminated.*30 of them were already dead/);
  assert.match(d.poorly.join(' '), /terminated 2 times, mostly by zombie/);
  assert.equal(clock(0), '03:07:12');
  assert.match(killLine({ id: 3, src: 'term', name: 'zombie' }), /^kill -15 \d+ {2}# zombie terminated$/);
});
