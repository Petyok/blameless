// Frame-rate measurement on the real GPU of this machine (headless Chromium, the autopilot plays).
//   node e2e/fps.mjs [seconds=20] [query=wave=8&sev=1]     PW=/dir/with/node_modules/playwright (default ~/.local/share/pwtest)
//   URL=https://blameless.petruha.ge/ node e2e/fps.mjs     measure a deployed copy instead of dist/
// Prints the resolution calibration, then frame statistics from the game's own counters. Keep runs short: this laptop
// throttles when hot.
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { serve } from '../serve.mjs';

const pw = process.env.PW || `${homedir()}/.local/share/pwtest`;
const req = createRequire(`${existsSync(pw) ? pw : process.cwd()}/`);
const { chromium } = (() => { try { return req('playwright'); } catch { return req('playwright-core'); } })();
const seconds = +process.argv[2] || 20, query = process.argv[3] || 'wave=8&sev=1';
const W = +process.env.W || 1440, H = +process.env.H || 900, PORT = 4179;
const out = new URL('./out/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });

const base = process.env.URL || `http://127.0.0.1:${PORT}/`;
const server = process.env.URL ? null : await serve(PORT, new URL('../dist', import.meta.url).pathname);
// the full Chromium build (new headless) uses the real GPU; take the newest one Playwright has downloaded
const cache = `${homedir()}/.cache/ms-playwright`;
const build = existsSync(cache) ? readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)).sort().at(-1) : null;
const browser = await chromium.launch({
  headless: true, executablePath: process.env.CHROME || (build ? `${cache}/${build}/chrome-linux64/chrome` : undefined),
  // the same GL path and raster settings as the laptop's everyday browser
  args: ['--use-angle=gl', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-gpu-rasterization',
    '--disable-features=CanvasOopRasterization,UseSkiaRenderer', '--autoplay-policy=no-user-gesture-required',
    ...(process.env.ARGS ? process.env.ARGS.split(' ') : [])],
});
const page = await browser.newPage({ viewport: { width: W, height: H } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/\.ogg|404|ERR_/.test(m.text())) errors.push(m.text().slice(0, 300)); });
await page.goto(`${base}?auto=1&god=1&seed=11&fps=1&${query}`);
// polled from this side: Playwright's waitForFunction evals in the page, which a deployed copy's CSP forbids
for (let i = 0; i < 600 && !(await page.evaluate('window.__game && __game.G.state === "play"').catch(() => false)); i++) await page.waitForTimeout(100);
const gpu = await page.evaluate(`(() => { const gl = __game.gfx.renderer.getContext(), e = gl.getExtension('WEBGL_debug_renderer_info');
  return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER); })()`);
console.log(`GPU: ${gpu}`);
console.log(`calibration (scale:ms): ${await page.evaluate('__game.gfx.calibration') || '(fixed scale)'}`);
await page.waitForTimeout(4000); // let the incident fill up
await page.evaluate('__game.resetPerf()');
const samples = [], bass = [];
for (let i = 0; i < seconds * 10; i++) {
  await page.waitForTimeout(100);
  bass.push(await page.evaluate('__game.audio.bass'));
  if (i % 10 === 9) samples.push(await page.evaluate('({ fps: +__game.gfx.fps.toFixed(0), enemies: __game.sim.enemies.length, scale: __game.gfx.scale, wave: __game.sim.wave + 1 })'));
}
const perf = await page.evaluate('__game.perf()');
const audio = await page.evaluate(`(() => { const a = __game.audio; return { ready: a.ready, context: a.ctx && a.ctx.state, voices: Object.keys(a.voices).length,
  sounds: Object.keys(a.buffers).length, music: a.musicName, musicAt: a.music ? +a.music.el.currentTime.toFixed(1) : null }; })()`);
// the floor pulses with the music: the pulse has to move, not sit at 0 or 1
audio.bassMin = +Math.min(...bass).toFixed(2); audio.bassMax = +Math.max(...bass).toFixed(2);
audio.bassMean = +(bass.reduce((s, v) => s + v, 0) / bass.length).toFixed(2);
audio.kicks = bass.filter((v, i) => i && v > 0.5 && bass[i - 1] <= 0.5).length;
await page.screenshot({ path: `${out}fps.jpg`, type: 'jpeg', quality: 85 });
console.log(`per second: ${samples.map((s) => `${s.fps}fps/${s.enemies}e@${s.scale}`).join('  ')}`);
console.log(JSON.stringify(perf));
console.log(`audio: ${JSON.stringify(audio)}`);
writeFileSync(`${out}fps.json`, JSON.stringify({ gpu, query, perf, audio, samples, errors }, null, 1));
if (errors.length) console.log('ERRORS', errors);
await browser.close();
server?.close();
process.exit(errors.length ? 1 : 0);
