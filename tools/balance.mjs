// Balance run: the autopilot plays the campaign with wave checkpoints, like a player would.
//   node tools/balance.mjs [runs=6] [skill=1] [sev=3,2,1]
import { WAVES } from '../src/sim/config.js';
import { makeSim, step, makeInput } from '../src/sim/sim.js';
import { choosePerk } from '../src/sim/director.js';
import { makeBot, botInput, botPerk } from '../src/sim/bot.js';

const runs = +process.argv[2] || 6, skill = +process.argv[3] || 1;
const sevs = (process.argv[4] || '3,2,1').split(',').map(Number);
const DT = 1 / 60;

function campaign(seed, sev) {
  const deaths = new Array(WAVES.length).fill(0), inp = makeInput(), bot = makeBot(seed + 100, skill);
  let sim = makeSim({ seed, sev }), cp = { wave: 0, perks: [], score: 0 }, time = 0, tries = 0;
  for (;;) {
    if (sim.state === 'perk') choosePerk(sim, botPerk(sim));
    if (sim.state === 'brief' && sim.wave !== cp.wave) cp = { wave: sim.wave, perks: [...sim.perkLog], score: sim.score };
    botInput(bot, sim, DT, inp);
    step(sim, inp, DT);
    sim.events.length = 0;
    if (sim.over === 'won') return { won: true, deaths, time: time + sim.stats.time, sim };
    if (sim.over === 'dead' || sim.stats.time > 1500) {
      deaths[sim.wave]++;
      time += sim.stats.time;
      if (++tries > 60) return { won: false, deaths, time, sim };
      sim = makeSim({ seed: seed + tries * 1000, sev, ...cp });
    }
  }
}

for (const sev of sevs) {
  const rs = [];
  for (let i = 0; i < runs; i++) rs.push(campaign(i + 1, sev));
  const per = WAVES.map((_, w) => rs.reduce((s, r) => s + r.deaths[w], 0));
  const tot = rs.map((r) => r.deaths.reduce((a, b) => a + b, 0)).sort((a, b) => a - b);
  const mins = rs.map((r) => r.time / 60).sort((a, b) => a - b);
  const acc = rs.reduce((s, r) => s + r.sim.stats.hits / Math.max(1, r.sim.stats.shots), 0) / runs;
  console.log(`SEV${sev} skill ${skill}: won ${rs.filter((r) => r.won).length}/${runs}`
    + `  deaths/run median ${tot[runs >> 1]} (min ${tot[0]}, max ${tot.at(-1)})`
    + `  minutes median ${mins[runs >> 1].toFixed(1)}  accuracy ${(acc * 100).toFixed(0)}%`);
  console.log(`  deaths by incident: ${per.map((n, w) => `${w + 1}:${n}`).join(' ')}`);
}
