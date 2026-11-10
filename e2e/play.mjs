// E2E: drives the built game in headless Chromium. Three scenarios:
//   flow      real key presses through every screen: phone, call, title, options, runbook, intro, play, pause,
//             hotfix cards, death, retry
//   campaign  the autopilot plays all ten incidents (invulnerable: this checks the build, not the balance),
//             stepping the sim by hand so software GL speed does not matter; one screenshot per incident
//   net       needs BASE (the nginx + stats stack of compose.yaml): audio and scripts under the production
//             content security policy, a run reported and ranked, a forged report refused, the phone view,
//             the rate limit
// Fails on any page error, console error (shader compile errors land there) or missed expectation.
// node /app/e2e/play.mjs   (inside the Playwright image, see compose.yaml); screenshots go to /out.
// BASE=http://localhost/ tests that server; without it the script serves dist/ itself (no stats API).
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { serve } from '../serve.mjs';

const require = createRequire(`${process.cwd()}/`);
const { chromium } = require('playwright');
const OUT = process.env.OUT || '/out', PORT = 4173, BASE = process.env.BASE, URL0 = BASE || `http://127.0.0.1:${PORT}/`;
const scenarios = (process.env.SCENARIOS || 'flow,campaign').split(',');
const W = +process.env.W || 1440, H = +process.env.H || 900;
mkdirSync(OUT, { recursive: true });

const errors = [], notes = [];
const check = (ok, what) => { notes.push(`${ok ? 'ok  ' : 'FAIL'} ${what}`); console.log(notes.at(-1)); if (!ok) errors.push(what); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Mean brightness and the share of non-dark pixels of the canvas, right after a render. */
const LOOK = `(() => { const c = document.createElement('canvas'); c.width = 160; c.height = 100; const x = c.getContext('2d');
  x.drawImage(document.getElementById('gl'), 0, 0, 160, 100); const d = x.getImageData(0, 0, 160, 100).data; let s = 0, lit = 0;
  for (let i = 0; i < d.length; i += 4) { const l = d[i] + d[i + 1] + d[i + 2]; s += l; if (l > 60) lit++; }
  return { mean: s / (d.length / 4) / 3, lit: lit / (d.length / 4) }; })()`;

/**
 * Wait until an expression is truthy in the page. Playwright's own waitForFunction evals inside the page while
 * it polls, which the production content security policy forbids; page.evaluate goes through the debugger.
 */
async function until(p, expr, timeout = 15000) {
  for (const end = Date.now() + timeout; Date.now() < end; await sleep(100)) if (await p.evaluate(expr).catch(() => false)) return true;
  return false;
}
const must = async (p, expr, timeout) => { if (!await until(p, expr, timeout)) throw new Error(`timed out waiting for: ${expr}`); };

async function page(browser, query, device = {}) {
  const p = await browser.newPage({ viewport: { width: W, height: H }, ...device });
  p.on('pageerror', (e) => { errors.push(`pageerror: ${e.message}`); console.log('PAGEERROR', e.message); });
  p.on('console', (m) => {
    if (m.type() === 'error' || (m.type() === 'warning' && /THREE|WebGL|shader/i.test(m.text()))) {
      // missing audio is allowed (the game runs silent); refused API calls are provoked on purpose and checked there
      if (/favicon|\.ogg|ERR_|status of (400|404|429)/i.test(m.text())) return;
      errors.push(`console.${m.type()}: ${m.text().slice(0, 600)}`); console.log('CONSOLE', m.type(), m.text().slice(0, 600));
    }
  });
  // what the content security policy blocked, if anything (the header exists only behind nginx)
  await p.addInitScript(() => {
    // @ts-ignore
    window.__csp = [];
    // @ts-ignore
    document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  await p.goto(URL0 + query);
  await must(p, 'window.__game && window.__game.sim', 60000);
  return p;
}
const facts = {};
/** Screenshot plus the facts needed to judge it later (written to shots.json). */
const shot = async (p, name) => {
  facts[name] = await p.evaluate(`(() => { const g = __game, s = g.sim, q = s.player; return { state: g.G.state, demo: g.G.demo, sim: s.state, wave: s.wave + 1,
    t: +s.stats.time.toFixed(1), enemies: s.enemies.length, hp: Math.round(q.hp), pos: [q.x, q.y, q.z].map((v) => +v.toFixed(1)), yaw: +q.yaw.toFixed(2),
    pitch: +q.pitch.toFixed(2), weapon: q.weapon, dead: q.dead, kick: +g.fx.kick.toFixed(3), boxes: g.view.boxes.n, glow: g.view.glow.n, glyphs: g.view.glyphs.n,
    lock: !!document.pointerLockElement, fps: +g.gfx.fps.toFixed(0) }; })()`);
  await p.screenshot({ path: `${OUT}/${name}.jpg`, type: 'jpeg', quality: 82 });
};
const state = (p) => p.evaluate('__game.G.state');

async function flow(browser) {
  const p = await page(browser, '?mute=1&seed=5&scale=0.5&fps=1');
  check(await state(p) === 'wake', 'boots to the phone screen');
  await shot(p, 'flow-01-wake');
  await p.keyboard.press('KeyA');
  check(await state(p) === 'call', 'any key picks up the call');
  await sleep(2600);
  await shot(p, 'flow-02-call');
  check(/automated call from your pager/.test(await p.textContent('#phone-say')), 'the pager reads the incident during the call');
  await p.keyboard.press('Enter');
  check(await state(p) === 'title', 'enter acknowledges the incident');
  await sleep(2500);
  await shot(p, 'flow-03-title');
  const lookTitle = await p.evaluate(`(() => { __game.step(0); return ${LOOK}; })()`);
  check(lookTitle.mean > 1.5, `the title backdrop renders the demo (mean brightness ${lookTitle.mean.toFixed(1)})`);
  await p.keyboard.press('KeyS');
  check(await p.evaluate('__game.st.sev') === 1, 'S cycles the severity');
  await p.keyboard.press('KeyS'); await p.keyboard.press('KeyS');
  await p.keyboard.press('KeyO');
  await sleep(300);
  await shot(p, 'flow-04-options');
  const slide = (v) => p.$eval('#o-sens', (n, val) => { n.value = val; n.dispatchEvent(new Event('input', { bubbles: true })); }, v);
  await slide('1.5');
  check(await p.evaluate('__game.st.sens') === 1.5, 'options write through to the settings');
  await slide('1');
  await p.keyboard.press('Escape');
  await p.keyboard.press('KeyH');
  await sleep(300);
  await shot(p, 'flow-05-runbook');
  await p.keyboard.press('Escape');
  await p.keyboard.press('Enter');
  check(await state(p) === 'intro', 'enter starts the intro');
  await sleep(2500);
  await shot(p, 'flow-06-intro');
  await p.keyboard.press('Space');
  check(await state(p) === 'play', 'any key skips the intro into the game');
  await sleep(1500);
  // real input: walk forward, fire, switch, jump, dash
  const z0 = await p.evaluate('__game.sim.player.z');
  await p.keyboard.down('KeyW');
  await p.mouse.down();
  await sleep(1500);
  await p.keyboard.press('Space');
  await p.keyboard.press('ShiftLeft');
  await sleep(700);
  await p.mouse.up();
  await p.keyboard.up('KeyW');
  const s = await p.evaluate('({ z: __game.sim.player.z, shots: __game.sim.stats.shots, dashes: __game.sim.stats.dashes })');
  check(s.z < z0 - 3, `W moves the player forward (${(z0 - s.z).toFixed(1)} m)`);
  check(s.shots > 3, `holding the mouse button fires (${s.shots} shots)`);
  check(s.dashes === 1, 'shift dashes');
  await sleep(3000);
  await shot(p, 'flow-07-play');
  const hud = await p.evaluate(`({ inc: document.getElementById('inc-title').textContent, hp: document.getElementById('budget-val').textContent,
    clock: document.getElementById('clock').textContent, weapons: document.querySelectorAll('.wp:not(.off)').length, hidden: document.getElementById('hud').hidden })`);
  check(!hud.hidden && /INC-2031/.test(hud.inc) && /^\d+ \/ 100$/.test(hud.hp) && /^03:/.test(hud.clock) && hud.weapons === 1, `HUD shows the incident: ${JSON.stringify(hud)}`);
  await p.keyboard.press('KeyP');
  check(await state(p) === 'paused', 'P pauses');
  await sleep(600);
  await shot(p, 'flow-08-pause');
  // the cursor reappears mid-screen when the pointer lock ends: a reflex click there must resume, never restart
  const t0 = await p.evaluate('__game.sim.stats.time');
  await p.locator('[data-act=retry]').click();
  check(await state(p) === 'paused' && /click again/.test(await p.textContent('[data-act=retry]')), 'one click on restart only arms it');
  await p.mouse.click(W / 2, H / 2);
  check(await state(p) === 'play' && await p.evaluate('__game.sim.stats.time') >= t0, 'a click in the middle of the pause screen resumes');
  await p.keyboard.press('KeyP');
  await p.keyboard.press('Escape');
  check(await state(p) === 'play', 'escape resumes');
  // clear the incident by hand -> hotfix cards
  await p.evaluate('(() => { const s = __game.sim; s.groups.forEach((g) => { g.left = 0; }); s.enemies.length = 0; s.state = "wave"; })()');
  await must(p, '__game.G.state === "perk"', 20000);
  await sleep(500);
  await shot(p, 'flow-09-hotfix');
  const before = await p.evaluate('__game.sim.perkLog.length');
  await p.keyboard.press('Digit2');
  check(await state(p) === 'play' && await p.evaluate('__game.sim.perkLog.length') === before + 1 && await p.evaluate('__game.sim.wave') === 1, '2 deploys a hotfix and opens the next incident');
  check(await p.evaluate('__game.sim.player.unlocked[1]'), 'the second incident unlocks SIGKILL');
  await sleep(6000);
  await shot(p, 'flow-10-incident2');
  await p.evaluate('__game.hurt(1e6)');
  await must(p, '__game.G.state === "dead"', 10000);
  await sleep(400);
  await shot(p, 'flow-11-dead');
  await sleep(1200);
  await p.keyboard.press('Enter');
  check(await state(p) === 'play' && await p.evaluate('__game.sim.wave') === 1 && await p.evaluate('__game.sim.perkLog.length') === before + 1
    && await p.evaluate('__game.sim.player.hp > 0'), 'enter retries the incident from its checkpoint with the hotfixes kept');
  await sleep(700);
  const roll = await p.evaluate('__game.camera.rotation.z');
  check(Math.abs(roll) < 0.15, `the retry starts upright (camera roll ${roll.toFixed(2)} rad)`);
  await shot(p, 'flow-12-retry');
  const perf = await p.evaluate('__game.perf()');
  console.log('flow perf (software GL, not the target):', JSON.stringify(perf));
  await p.close();
}

async function campaign(browser) {
  const p = await page(browser, '?auto=1&manual=1&mute=1&god=1&seed=11&sev=2&skill=1&scale=0.5');
  check(await state(p) === 'play', 'auto mode starts in the game');
  const t0 = Date.now(), looks = [], taken = new Set(), seenAt = {};
  for (let i = 0; i < 2400; i++) {
    const s = await p.evaluate(`(() => { const t = __game.step(1.5); const s = __game.sim; return { t, wave: s.wave, state: s.state, over: s.over, waveT: s.waveT,
      enemies: s.enemies.length, kills: s.stats.killsTotal, look: ${LOOK}, calls: __game.gfx.calls, tris: __game.gfx.tris, boss: (s.enemies.find((e) => e.type === 'boss') || {}).phase || 0 }; })()`);
    looks.push(s.look.lit);
    // one shot per incident a few seconds into the fight, one per boss phase, one of the first briefing
    const label = s.wave < 9 ? `${String(s.wave + 1).padStart(2, '0')}` : `10-phase${s.boss}`;
    seenAt[label] ??= s.t;
    const due = i === 1 ? 'start' : s.state !== 'wave' || taken.has(label) ? '' : s.wave < 9 ? (s.waveT > 9 && s.enemies > 5 ? label : '') : (s.boss && s.t - seenAt[label] > 6 ? label : '');
    if (due) {
      taken.add(due);
      await sleep(450); // let CSS transitions settle: the sim is stepped faster than real time
      await shot(p, `campaign-${due === 'start' ? '00-briefing' : due}`);
      console.log(`${due.padEnd(9)} at ${s.t.toFixed(0).padStart(4)} s: ${s.enemies} enemies, ${s.kills} kills, ${s.calls} draw calls, ${(s.tris / 1000).toFixed(0)}k tris, lit ${(s.look.lit * 100).toFixed(0)}%`);
    }
    if (s.over) { console.log(`over: ${s.over} after ${(s.t / 60).toFixed(1)} game minutes, ${s.kills} kills, ${((Date.now() - t0) / 1000).toFixed(0)} s wall`); break; }
  }
  check(await p.evaluate('__game.sim.over') === 'won', 'the autopilot resolves all ten incidents in the real build');
  check(Math.min(...looks) > 0.02, `no black frames (darkest frame ${(Math.min(...looks) * 100).toFixed(1)}% lit)`);
  await must(p, '__game.G.state === "won"', 15000);
  await sleep(500);
  await shot(p, 'campaign-11-postmortem');
  const pm = await p.evaluate('document.querySelector(".pm").innerText');
  check(/POSTMORTEM/.test(pm) && /blameless/.test(pm) && /processes terminated/.test(pm), 'the postmortem is written');
  writeFileSync(`${OUT}/postmortem.txt`, pm);
  await p.close();
}

async function net(browser) {
  const p = await page(browser, '?seed=5&scale=0.5');
  const api = (path, body) => p.evaluate(async ([path, body]) => {
    const r = await fetch(`api/${path}`, body ? { method: 'POST', body: JSON.stringify(body) } : undefined);
    return { status: r.status, json: await r.json().catch(() => null) };
  }, [path, body]);
  const text = (sel) => p.evaluate((s) => document.querySelector(s)?.textContent || '', sel);
  await until(p, '__game.net.world', 15000);
  const before = (await api('board')).json?.world;
  check(before && before.visits >= 1 && before.online >= 1, `the visit is counted (${JSON.stringify(before)})`);

  // sound through the production rules: the voice is fetched and decoded, the music streams
  await p.keyboard.press('KeyA');
  await sleep(2600);
  await p.keyboard.press('Enter');
  await until(p, '__game.audio.ready && Object.keys(__game.audio.voices).length >= 34 && __game.audio.music && __game.audio.music.el.currentTime > 0.5', 30000);
  const audio = await p.evaluate(`(() => { const a = __game.audio; return { context: a.ctx && a.ctx.state, voices: Object.keys(a.voices).length,
    music: a.musicName, at: a.music ? +a.music.el.currentTime.toFixed(1) : -1 }; })()`);
  // at is rounded to a tenth; the wait above already saw it pass half a second
  check(audio.voices === 34 && audio.music === 'night' && audio.at >= 0.5, `the voice and the music load and play (${JSON.stringify(audio)})`);

  await p.keyboard.press('KeyP');
  check(/^Hello fable 5\.2!.*Suprise me!$/s.test(await text('.quote')), 'P shows the prompt the game was built from');
  await shot(p, 'net-01-prompt');
  await p.keyboard.press('Escape');
  await p.keyboard.press('KeyL');
  await p.waitForSelector('.boards', { timeout: 10000 }).catch(() => {});
  check(await p.evaluate('document.querySelectorAll(".boards .none").length') === 4, 'L opens the leaderboard: four empty boards');
  await p.keyboard.press('Escape');

  // a real run: start, resolve the first incident, die in the second
  await p.keyboard.press('Enter');
  await sleep(300);
  await p.keyboard.press('Space');
  await until(p, '__game.G.state === "play" && __game.net.run', 10000);
  check(await state(p) === 'play' && /^[0-9a-f]{32}$/.test(await p.evaluate('__game.net.run') || ''), 'starting the campaign opens a ranked run');
  await sleep(7000);
  await p.evaluate('(() => { const s = __game.sim; s.score = 420; s.stats.killsTotal = 14; s.groups.forEach((g) => { g.left = 0; }); s.enemies.length = 0; s.state = "wave"; })()');
  await must(p, '__game.G.state === "perk"', 20000);
  await p.keyboard.press('Digit1');
  await sleep(1500);
  await p.evaluate('__game.hurt(1e6)');
  await must(p, '__game.G.state === "dead"', 10000);
  await sleep(1500);
  check(/type one to get on the board/.test(await text('#rank')), 'the death screen asks for a handle');
  await p.click('#handle');
  await p.keyboard.type('QR e2e');
  check(await state(p) === 'dead', 'typing a handle does not drive the menu (Q quits, R restarts)');
  await p.keyboard.press('Enter');
  await until(p, '/#1 of 1 on SEV2/.test(document.getElementById("rank").textContent)', 10000);
  check(/#1 of 1 on SEV2/.test(await text('#rank')) && await state(p) === 'dead', `enter saves the handle and shows the rank ("${await text('#rank')}")`);
  await shot(p, 'net-02-dead');
  let b = (await api('board')).json, row = b.top['2'][0] || {};
  check(row.name === 'QR e2e' && row.score === 420 && row.wave === 1 && !row.won, `the run is on the SEV2 board (${JSON.stringify(row)})`);
  check(b.world.played === before.played + 1 && b.world.deaths === before.deaths + 1 && b.world.resolved === before.resolved + 1
    && b.causes.some(([c]) => c === 'something else'), `the world totals moved by one run (${JSON.stringify(b.world)})`);

  // what a curl one-liner would try
  const id = await p.evaluate('localStorage.getItem("blameless-id")'), run = await p.evaluate('__game.net.run');
  const forged = await api('report', { id, run, wave: 9, score: 999999, seconds: 20, kills: 50000 });
  const stolen = await api('report', { id: 'someone-else-1', run, wave: 1, score: 500, seconds: 20, kills: 20 });
  b = (await api('board')).json;
  check(forged.status === 400 && stolen.status === 404 && b.top['2'][0].score === 420,
    `a forged report and a report on someone else's run are refused (${forged.status} ${forged.json?.error}, ${stolen.status})`);

  // back at the title the world has changed; the board lists the run
  await p.evaluate('document.activeElement.blur()');
  await p.keyboard.press('KeyQ');
  await until(p, '/paged so far/.test(document.querySelector(".tip")?.textContent || "")', 10000);
  check(await state(p) === 'title' && /engineers? paged so far/.test(await text('.tip')), `the title shows the world ("${(await text('.tip')).trim()}")`);
  await p.keyboard.press('KeyL');
  await p.waitForSelector('.boards b', { timeout: 10000 }).catch(() => {});
  check(/QR e2e/.test(await text('.boards')) && /INC-2031/.test(await text('.surv')), 'the leaderboard lists the run and the survival table');
  await sleep(400);
  await shot(p, 'net-03-board');
  check((await p.evaluate('__csp')).length === 0, `nothing was blocked by the content security policy (${await p.evaluate('__csp.join("; ")')})`);

  // a phone: it can look, not play
  const m = await page(browser, '?seed=5&scale=0.4&mute=1', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  await m.tap('#screen');
  await sleep(2600);
  await m.tap('#screen');
  await sleep(400);
  const phone = await m.evaluate('({ state: __game.G.state, note: !!document.querySelector(".menu .note"), start: !!document.querySelector("[data-act=start]") })');
  check(phone.state === 'title' && phone.note && !phone.start, `a phone gets the notice instead of the start entry (${JSON.stringify(phone)})`);
  await m.tap('[data-act=board]');
  await m.waitForSelector('.boards b', { timeout: 10000 }).catch(() => {});
  await sleep(400);
  await shot(m, 'net-04-phone');
  check(/QR e2e/.test(await m.evaluate('document.querySelector(".boards")?.textContent || ""'))
    && await m.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'the leaderboard fits a phone screen');
  await m.close();

  // last, because it uses up the allowance: a burst from one address is rate limited, not served
  const codes = await p.evaluate(async (id) => Promise.all(Array.from({ length: 40 }, () =>
    fetch('api/hit', { method: 'POST', body: JSON.stringify({ id }) }).then((r) => r.status))), id);
  const n = (c) => codes.filter((x) => x === c).length;
  check(n(429) >= 20 && n(200) >= 1 && n(200) + n(429) === 40, `a burst of 40 calls: ${n(200)} served, ${n(429)} limited`);
  await p.close();
}

const server = BASE ? null : await serve(PORT, '/app/dist');
if (BASE) { // the stack next door may still be starting
  for (let i = 0; i < 60 && !(await fetch(`${BASE}api/board`).then((r) => r.ok, () => false)); i++) await sleep(500);
}
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
try {
  if (scenarios.includes('flow')) await flow(browser);
  if (scenarios.includes('campaign')) await campaign(browser);
  if (scenarios.includes('net')) await net(browser);
  // ad-hoc inspection: e2e/probe.mjs exports default async ({ browser, page, shot, check, sleep, LOOK }) => {}
  if (scenarios.includes('probe')) await (await import('./probe.mjs')).default({ browser, page, shot, check, sleep, LOOK });
} catch (e) {
  errors.push(`exception: ${e.stack || e}`);
  console.log('EXCEPTION', e.stack || e);
} finally {
  await browser.close();
  server?.close();
}
writeFileSync(`${OUT}/shots.json`, JSON.stringify(facts, null, 1));
writeFileSync(`${OUT}/report.txt`, `${notes.join('\n')}\n${errors.length ? `\nERRORS\n${errors.join('\n')}\n` : '\nALL GREEN\n'}`);
console.log(errors.length ? `E2E FAILED (${errors.length})` : 'E2E PASSED');
process.exit(errors.length ? 1 : 0);
