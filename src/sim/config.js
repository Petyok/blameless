// Tunables. Units: metres, seconds. Colours are display-referred RGB 0..1.

export const CELL = 2;
export const RACK_H = 2.8;
export const WALL_H = 1000; // "unclimbable"
export const STEP = 0.3; // obstacles this much above the feet block movement

export const PLAYER = {
  r: 0.4, h: 1.8, eye: 1.62,
  speed: 8.6, accel: 75, airAccel: 24, decel: 55, gravity: 28, jump: 8.6,
  dashSpeed: 26, dashTime: 0.15, dashCd: 1.2,
  rollbackSpan: 3, rollbackCd: 14, rollbackTime: 0.28,
  sudoTime: 6, sudoPerKill: 0.04,
  maxHp: 100, iframes: 0.45, waveHeal: 20,
  hotGrace: 0.6, hotTick: 0.33, hotDmg: 3,
};

export const HEAT = { coolDelay: 0.35, cool: 0.5, idleCool: 0.75, unlock: 0.25 };

export const WEAPONS = [
  { id: 'term', name: 'SIGTERM', cmd: 'kill -15', sig: 15, color: [0.22, 1.0, 0.53],
    rate: 9.5, dmg: 11, pellets: 1, spread: 0.005, bloom: 0.022, heat: 0.043, range: 90, kick: 0.45, knock: 1.2 },
  { id: 'kill', name: 'SIGKILL', cmd: 'kill -9', sig: 9, color: [1.0, 0.69, 0.0],
    rate: 1.3, dmg: 9, pellets: 9, spread: 0.07, bloom: 0, heat: 0.36, range: 45, kick: 2.4, knock: 1.1,
    falloff: [8, 26, 0.35] },
  { id: 'grep', name: 'grep', cmd: 'grep -r', sig: 0, color: [0.3, 0.91, 1.0],
    rate: 1.05, dmg: 95, pellets: 1, spread: 0, bloom: 0, heat: 0.5, range: 120, kick: 1.6, knock: 4, pierce: true },
  { id: 'rm', name: 'rm -rf', cmd: 'rm -rf', sig: 0, color: [1.0, 0.3, 0.42],
    rate: 1.1, dmg: 120, pellets: 0, spread: 0, bloom: 0, heat: 0.6, range: 0, kick: 2.0, knock: 9,
    rocket: { speed: 34, radius: 4.6, selfMul: 0.3, life: 4, impulse: 13 } },
];

// r: radius, h: height (hit volume is a vertical capsule from y to y+h)
export const ENEMY = {
  zombie: { hp: 32, speed: 4.1, r: 0.45, h: 1.8, dmg: 9, reach: 0.9, atkCd: 0.9, mass: 1, score: 10, coffee: 0.07,
    name: 'zombie', color: [0.72, 0.86, 0.68] },
  fork: { hp: [56, 24, 10], speed: [3.6, 5.0, 6.4], r: [0.75, 0.5, 0.32], h: [1.5, 1.0, 0.64], dmg: [12, 8, 5],
    reach: 0.6, atkCd: 0.8, mass: 1.2, score: 12, coffee: 0.05, name: 'forkbomb', color: [1.0, 0.45, 0.1] },
  cron: { hp: 48, speed: 4, r: 0.6, h: 1.2, hover: 3.5, period: 3.0, tele: 0.45, volley: 3, volleyGap: 0.13,
    shotSpeed: 15, dmg: 10, mass: 1, score: 25, coffee: 0.15, name: 'crond', color: [1.0, 0.9, 0.2] },
  packet: { hp: 5, speed: 8.5, r: 0.24, h: 0.48, dmg: 4, mass: 0.2, score: 2, coffee: 0, name: 'syn',
    color: [0.7, 0.95, 1.0] },
  race: { hp: 52, speed: 7.4, r: 0.4, h: 1.9, dmg: 11, reach: 0.9, atkCd: 0.7, window: 2.2, mass: 0.8, score: 30,
    coffee: 0.12, name: 'thread', color: [0.35, 0.55, 1.0], colorB: [1.0, 0.3, 0.6] },
  leak: { hp: 45, hpGrow: 12, speed: 2.4, r: 0.5, h: 1.0, grow: 0.11, rMax: 2.1, fuse: 1.3, dmg: 38, radius: 7.5,
    enemyDmg: 150, mass: 2, score: 35, coffee: 0.35, name: 'leak', color: [0.8, 0.25, 1.0] },
  heisen: { hp: 72, speed: 4.6, r: 0.5, h: 1.8, aimTime: 0.22, blinkCd: 1.0, shotCd: 2.4, shotSpeed: 22, dmg: 14,
    mass: 1, score: 40, coffee: 0.2, name: 'heisenbug', color: [0.75, 0.6, 1.0] },
  brute: { hp: 420, speed: 2.7, r: 1.0, h: 2.6, dmg: 18, reach: 1.0, atkCd: 1.2, windup: 0.7, chargeSpeed: 15,
    chargeTime: 1.6, chargeDmg: 28, recover: 1.1, chargeCd: 4, mass: 8, score: 120, coffee: 2, name: 'oom_reaper',
    color: [0.9, 0.12, 0.15] },
  pylon: { hp: 160, speed: 0, r: 0.8, h: 4, mass: 1e9, score: 50, coffee: 0, name: 'dependency',
    color: [0.2, 0.9, 0.8] },
  boss: { hp: 2600, speed: 0, r: 2.0, h: 9, mass: 1e9, score: 2000, coffee: 0, name: 'monolith',
    color: [1.0, 0.16, 0.24] },
};
export const ENEMY_TYPES = Object.keys(ENEMY);

export const BOSS = {
  intro: 3.5,
  ringEvery: [4.2, 0, 3.0], ringShots: 24, ringSpeed: 9, ringDmg: 12, ringY: 0.45,
  addEvery: 9, addCap: 10,
  beams: [0, 2, 3], beamSpeed: [0, 0.5, 0.7], beamLen: 30, beamY: 0.45, beamDmg: 18, beamHitCd: 0.6,
  fanEvery: 2.6, fanShots: 5, fanSpeed: 17, fanDmg: 11,
  phase3At: 0.5, deathTime: 4.5,
  deps: ['libssl.so.0.9.8', 'log4j-1.2.jar', 'left-pad', 'jquery-1.4.min.js', 'python2.6', 'flash-player'],
};

// count: group sizes, dmg: damage to the player, hp/speed: enemies
export const SEV = {
  3: { name: 'SEV3', label: 'chill', count: 0.85, dmg: 0.7, hp: 0.9, speed: 0.95 },
  2: { name: 'SEV2', label: 'normal', count: 1.1, dmg: 1.25, hp: 1, speed: 1.04 },
  1: { name: 'SEV1', label: 'hurt me', count: 1.3, dmg: 1.75, hp: 1.15, speed: 1.1 },
};

export const ACTS = [
  { host: 'node-3', name: 'userspace', music: 'act1', accent: [0.22, 1.0, 0.53], fog: [0.008, 0.026, 0.018] },
  { host: 'mq-broker-1', name: 'the queue', music: 'act2', accent: [1.0, 0.69, 0.0], fog: [0.032, 0.02, 0.006] },
  { host: 'pg-primary', name: 'the database', music: 'act3', accent: [0.3, 0.72, 1.0], fog: [0.008, 0.018, 0.04] },
  { host: 'legacy-01', name: 'the monolith', music: 'boss', accent: [1.0, 0.2, 0.3], fog: [0.04, 0.007, 0.012] },
];

// groups: at wave-time t spawn n of type (race: n pairs), one every gap seconds
const g = (t, type, n, gap) => ({ t, type, n, gap });
export const WAVES = [
  { inc: 2031, sev: 3, act: 0, title: 'zombie processes on node-3', voice: 'w1',
    groups: [g(0, 'zombie', 6), g(8, 'zombie', 8), g(18, 'zombie', 10), g(28, 'zombie', 12)] },
  { inc: 2032, sev: 3, act: 0, title: 'fork bomb in ci-runner-7', voice: 'w2', unlock: 1,
    groups: [g(0, 'fork', 2), g(3, 'zombie', 8), g(12, 'fork', 3), g(20, 'zombie', 10), g(28, 'fork', 2),
      g(30, 'zombie', 8)] },
  { inc: 2033, sev: 2, act: 0, title: 'cron storm at 03:15', voice: 'w3',
    groups: [g(0, 'cron', 3), g(3, 'zombie', 10), g(12, 'fork', 2), g(18, 'cron', 4), g(22, 'zombie', 10),
      g(30, 'brute', 1), g(34, 'cron', 3)] },
  { inc: 2034, sev: 2, act: 1, title: 'DDoS on the ingress', voice: 'w4', unlock: 2,
    groups: [g(0, 'packet', 20, 0.12), g(5, 'zombie', 8), g(10, 'packet', 24, 0.12), g(16, 'cron', 3),
      g(22, 'packet', 28, 0.1), g(24, 'fork', 3), g(32, 'packet', 30, 0.1), g(34, 'zombie', 10)] },
  { inc: 2035, sev: 2, act: 1, title: 'race condition in order-worker', voice: 'w5',
    groups: [g(0, 'race', 1), g(3, 'zombie', 10), g(12, 'race', 2), g(18, 'packet', 20, 0.12), g(24, 'race', 2),
      g(26, 'fork', 2), g(34, 'race', 2), g(35, 'zombie', 8)] },
  { inc: 2036, sev: 2, act: 1, title: 'memory leak in session-cache', voice: 'w6',
    groups: [g(0, 'leak', 2), g(2, 'zombie', 10), g(10, 'leak', 3), g(14, 'fork', 3), g(20, 'race', 1),
      g(24, 'leak', 3), g(26, 'cron', 3), g(32, 'brute', 1), g(36, 'leak', 2), g(37, 'zombie', 10)] },
  { inc: 2037, sev: 2, act: 2, title: 'heisenbug in replica-2', voice: 'w7', unlock: 3,
    groups: [g(0, 'heisen', 2), g(3, 'zombie', 12), g(10, 'cron', 3), g(16, 'heisen', 3), g(20, 'packet', 24, 0.12),
      g(26, 'fork', 3), g(32, 'heisen', 2), g(34, 'zombie', 12)] },
  { inc: 2038, sev: 1, act: 2, title: 'cascading failure', voice: 'w8',
    groups: [g(0, 'fork', 3), g(2, 'leak', 3), g(8, 'race', 2), g(12, 'cron', 4), g(16, 'zombie', 14),
      g(22, 'packet', 30, 0.1), g(28, 'heisen', 3), g(32, 'brute', 1), g(36, 'zombie', 12), g(40, 'leak', 2)] },
  { inc: 2039, sev: 1, act: 2, title: 'everything is on fire', voice: 'w9',
    groups: [g(0, 'brute', 1), g(1, 'zombie', 14), g(7, 'leak', 3), g(10, 'cron', 4), g(15, 'race', 3),
      g(19, 'fork', 4), g(24, 'heisen', 3), g(28, 'packet', 36, 0.1), g(33, 'brute', 1), g(36, 'zombie', 16),
      g(40, 'cron', 4), g(44, 'race', 2)] },
  { inc: 2040, sev: 1, act: 3, title: 'legacy-billing-monolith.jar', voice: 'boss', boss: true, groups: [] },
];
export const ALIVE_CAP = 48; // ponytail: hard cap on live enemies, spawns wait above it

// max: stacks. Effects live in director.applyPerk.
export const PERKS = [
  { id: 'autoscale', name: 'autoscaling', desc: '+25 max error budget, refill 25', max: 3 },
  { id: 'cache', name: 'caching layer', desc: '-22% heat on every shot', max: 3 },
  { id: 'gc', name: 'garbage collector', desc: 'every kill restores 0.5 budget', max: 2 },
  { id: 'canary', name: 'canary release', desc: 'first shot after 1.5 s of silence hits x3', max: 1 },
  { id: 'lb', name: 'load balancer', desc: 'SIGKILL fires +3 pellets', max: 2 },
  { id: 'retry', name: 'retry with backoff', desc: '20% of shots cost no heat', max: 2 },
  { id: 'bluegreen', name: 'blue/green deploy', desc: 'rollback cooldown -35%', max: 2 },
  { id: 'breaker', name: 'circuit breaker', desc: 'once per incident: survive a lethal hit, emit a shockwave', max: 1 },
  { id: 'cdn', name: 'CDN', desc: '+12% move speed, dash recharges 25% faster', max: 2 },
  { id: 'tracing', name: 'distributed tracing', desc: 'grep hits 40% harder', max: 2 },
  { id: 'chaos', name: 'chaos engineering', desc: 'explosions +30% radius, no self-damage', max: 1 },
  { id: 'overprov', name: 'over-provisioning', desc: '+15% damage, all weapons', max: 3 },
  { id: 'espresso', name: 'espresso machine', desc: 'coffee drops twice as often, heals +50%', max: 1 },
  { id: 'policy', name: 'error budget policy', desc: 'sudo charges 40% faster, lasts +2 s', max: 2 },
];

export const COFFEE = { heal: 12, life: 25, magnet: 2.6, r: 0.9 };
export const COMBO_TIME = 3.5;
