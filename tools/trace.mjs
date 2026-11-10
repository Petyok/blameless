// One bot campaign with a per-incident timeline: node tools/trace.mjs [seed=1] [sev=2] [skill=1] [god=0]
import { makeSim, step, makeInput } from '../src/sim/sim.js';
import { choosePerk } from '../src/sim/director.js';
import { makeBot, botInput, botPerk } from '../src/sim/bot.js';

const [seed = 1, sev = 2, skill = 1, god = 0] = process.argv.slice(2).map(Number);
const sim = makeSim({ seed, sev, god: !!god }), bot = makeBot(seed + 100, skill), inp = makeInput(), DT = 1 / 60;
let t0 = 0, hp0 = sim.player.hp, peak = 0, k0 = 0, d0 = 0;
const t = performance.now();
while (!sim.over && sim.stats.time < 3600) {
  if (sim.state === 'perk') choosePerk(sim, botPerk(sim));
  botInput(bot, sim, DT, inp);
  step(sim, inp, DT);
  peak = Math.max(peak, sim.enemies.length);
  for (const e of sim.events) {
    if (e.t === 'waveEnd' || e.t === 'dead') {
      const s = sim.stats;
      console.log(`incident ${String(sim.wave + 1).padStart(2)} ${e.t === 'dead' ? 'DEAD   ' : 'cleared'} ${(s.time - t0).toFixed(0).padStart(4)} s`
        + `  kills ${String(s.killsTotal - k0).padStart(3)}  peak ${String(peak).padStart(2)}  took ${(s.damageTaken - d0).toFixed(0).padStart(3)}`
        + `  hp ${hp0.toFixed(0)}->${sim.player.hp.toFixed(0)}/${sim.player.maxHp}  ${sim.def.title}${e.cause ? ` (by ${e.cause})` : ''}`);
      t0 = s.time; hp0 = sim.player.hp; peak = 0; k0 = s.killsTotal; d0 = s.damageTaken;
    }
  }
  sim.events.length = 0;
}
const s = sim.stats;
console.log(`${sim.over} after ${(s.time / 60).toFixed(1)} min, score ${sim.score}, accuracy ${(100 * s.hits / s.shots).toFixed(0)}%,`
  + ` overheats ${s.overheats}, dashes ${s.dashes}, rollbacks ${s.rollbacks}, sudos ${s.sudos}, coffee ${s.coffee}, best combo ${s.bestCombo},`
  + ` revived ${s.revived}, blinks ${s.blinks}, collateral ${s.collateral}`);
console.log('kills', JSON.stringify(s.kills), 'damage by', JSON.stringify(Object.fromEntries(Object.entries(s.byCause).map(([k, v]) => [k, Math.round(v)]))));
console.log('perks', sim.perkLog.join(' '), `| ${(performance.now() - t).toFixed(0)} ms wall`);
