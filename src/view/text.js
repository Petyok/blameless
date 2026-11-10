// Every piece of writing in the game: wall logs, kill feed, announcer subtitles, intro, postmortem.
import { ENEMY, WAVES, PERKS, SEV } from '../sim/config.js';
import VOICE from './voice.json' with { type: 'json' };

/** The whole brief this game was built from, as it was typed. */
export const PROMPT = 'Hello fable 5.2! You are 1 day old. I am curious what can you do, so let\'s do a simple test: using gpu-serv for builds/test -> '
  + 'build a three.js shooter game. You have only 1 try. This laptop should handle your game at least 30 fps, 60 fps ideally. What to include '
  + 'to your game decide only you (story, style, weapons, feel, music, etc.). There is no time limit. You can use other models only if you RUN '
  + 'THEM LOCALLY on gpu-serv - for instance minimax h3, or etc. Suprise me!';
export const REPO = 'https://github.com/Petyok/blameless';

/** Scrolls up the walls. */
export const LOG_LINES = [
  '[03:07:12.412] WARN  kubelet: PLEG is not healthy: pleg was last seen active 3m12s ago',
  '[03:07:12.901] ERROR nginx: upstream timed out (110: Connection timed out)',
  '[03:07:13.007] FATAL java.lang.OutOfMemoryError: Java heap space',
  '[03:07:13.007]   at com.legacy.billing.Monolith.doEverything(Monolith.java:14892)',
  '[03:07:13.118] INFO  systemd[1]: Started Session 4821 of user root.',
  '[03:07:13.552] WARN  etcd: apply request took too long (2.31s)',
  '[03:07:14.019] ERROR postgres: FATAL: sorry, too many clients already',
  '[03:07:14.230] kernel: Out of memory: Killed process 4821 (java)',
  '[03:07:14.777] INFO  cron[212]: (root) CMD (/opt/cleanup.sh >/dev/null 2>&1)',
  '[03:07:15.003] WARN  haproxy: backend api has no server available!',
  '[03:07:15.418] ERROR redis: MISCONF Redis is configured to save RDB snapshots',
  '[03:07:15.902] INFO  sshd[991]: Accepted publickey for oncall from 10.0.3.7',
  '[03:07:16.144] WARN  disk /var/log is 97% full',
  '[03:07:16.650] ERROR rabbitmq: connection_closed_abruptly (queue depth 1482004)',
  '[03:07:17.201] FATAL panic: runtime error: invalid memory address or nil pointer',
  '[03:07:17.333] INFO  deploy: release v2.31.7-friday-hotfix-final-2 is live',
  '[03:07:17.900] WARN  certmanager: certificate expires in 0 days',
  '[03:07:18.276] ERROR dns: SERVFAIL resolving api.internal (it is always DNS)',
  '[03:07:18.811] INFO  autoscaler: scaling replicas 3 -> 48',
  '[03:07:19.090] WARN  jvm: GC overhead limit exceeded (98% of time in GC)',
  '[03:07:19.634] ERROR segfault at 0 ip 00007f3a error 4 in libc.so.6',
  '[03:07:20.002] INFO  pager: escalation policy level 1: you',
  '[03:07:20.460] WARN  ntp: clock skew detected: 37.2 s',
  '[03:07:20.999] ERROR fork: retry: Resource temporarily unavailable',
  '[03:07:21.512] INFO  grafana: alert "Everything" changed state to alerting',
  '[03:07:22.070] WARN  TODO: remove this before prod (2017)',
  '[03:07:22.648] ERROR 502 Bad Gateway  GET /healthz  upstream=legacy-billing',
  '[03:07:23.127] INFO  backup: last successful backup: never',
  '[03:07:23.700] WARN  thread pool exhausted, 4096 tasks queued',
  '[03:07:24.215] ERROR race detected: write at 0x00c0001a2f10 by goroutine 7',
  '[03:07:24.888] FATAL too many open files',
  '[03:07:25.301] INFO  slack: #incidents: "is it just me or is prod down?"',
  '[03:07:25.960] WARN  kernel: TCP: request_sock_TCP: Possible SYN flooding on port 443',
  '[03:07:26.400] ERROR works on my machine',
];

const SIG = { term: 'kill -15', kill: 'kill -9', grep: 'grep -r', rm: 'rm -rf', oom: 'oom-killer', breaker: 'breaker', boss: 'kill -9' };
const DEATH_NOTE = { term: 'terminated', kill: 'killed', grep: 'matched', rm: 'removed', oom: 'collateral', breaker: 'tripped', boss: 'decommissioned' };
export const LABEL = {
  zombie: '<defunct>', fork: ':(){:|:&};:', cron: '*/3 * * * *', packet: 'SYN', race: 'thread', leak: 'leak',
  heisen: 'heisenbug', brute: 'oom_reaper', pylon: 'dependency', boss: 'legacy-billing-monolith.jar',
};

/** One kill-feed line. */
export function killLine(e) {
  const pid = 1000 + (e.id * 7919) % 9000;
  return `${SIG[e.src] || 'kill'} ${pid}  # ${e.name} ${DEATH_NOTE[e.src] || 'gone'}`;
}

/** Announcer lines (voice.json): the text doubles as the subtitle; tools/voice.py speaks exactly these. */
export { VOICE };
/** What the subtitle shows where the spoken form is spelled out for the voice. */
export const SUBTITLE = {
  w2: 'Incident 2032. Fork bomb in the CI runner. SIGKILL unlocked.',
  w4: 'Incident 2034. Denial of service on the ingress. grep unlocked.',
  w7: 'Incident 2037. Heisenbug. It moves when observed. rm -rf unlocked.',
  bossDead: 'Monolith terminated. Exit code 137.',
};

/**
 * The shell session typed out before the game starts: [text, delay ms after the line, typed by the player].
 * @type {[string, number, boolean?][]}
 */
export const INTRO = [
  ['ssh oncall@bastion.prod', 500, true],
  ['Last login: Fri 17:58 from 10.0.3.7 (dave)', 250],
  ['oncall@bastion:~$ kubectl get pods -A | grep -v Running | wc -l', 450, true],
  ['1482', 500],
  ['oncall@bastion:~$ kubectl exec -it self -n prod -- /bin/sh', 600, true],
  ['warning: you are about to enter production in person.', 350],
  ['warning: there is no ammo here. only rate limits.', 350],
  ['warning: what dies here is logged.', 700],
  ['/ # _', 0],
];

export const HELP = [
  ['WASD', 'move'], ['MOUSE', 'aim'], ['LMB', 'fire (hold)'], ['1-4 / WHEEL', 'weapons'], ['SPACE', 'jump'],
  ['SHIFT', 'dash (brief invulnerability)'], ['Q / RMB', 'rollback: rewind yourself 3 s'], ['F', 'sudo, when charged'],
  ['ESC', 'pause'],
];

export const TIPS = [
  'No ammo. Every weapon has a rate limit: switch before you hit 429.',
  'Holstered weapons cool down faster.',
  'Rollback (Q) restores the error budget you had 3 seconds ago.',
  'Rack tops are the hot aisle. Do not stand there.',
  'A cron job fires when its hand reaches twelve.',
  'Kill both threads of a race condition within two seconds.',
  'A heisenbug moves when you look at it. Flick, do not track.',
  'Memory leaks are harmless when small.',
  'Jump over the monolith\'s beams. Or dash through them.',
  'Coffee restores error budget.',
];

const pad = (n) => String(n).padStart(2, '0');
/** In-game wall clock: the night starts at 03:07:12 and runs 8x. */
export function clock(t) {
  const s = Math.floor(3 * 3600 + 7 * 60 + 12 + t * 8);
  return `${pad(Math.floor(s / 3600) % 24)}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
}
export const duration = (t) => `${pad(Math.floor(t / 60))}:${pad(Math.floor(t % 60))}`;

/** The postmortem document, generated from what actually happened. */
export function postmortem(sim, deaths, causes) {
  const s = sim.stats, k = s.kills, acc = s.shots ? Math.round(100 * s.hits / s.shots) : 0;
  const worst = Object.entries(s.byCause).sort((a, b) => b[1] - a[1])[0];
  const killer = Object.entries(causes).sort((a, b) => b[1] - a[1])[0];
  const well = [
    `${s.killsTotal} processes terminated. ${k.zombie || 0} of them were already dead.`,
    `Detection time: 0 s. The pager works. Unfortunately.`,
    acc >= 60 ? `Accuracy ${acc}%. Suspiciously good. Was this a bot?` : acc >= 35 ? `Accuracy ${acc}%. Within the SLO.` : `Accuracy ${acc}%. The racks will need replacing.`,
    s.bestCombo >= 20 ? `Longest auto-remediation streak: ${s.bestCombo}.` : null,
    s.rollbacks ? `${s.rollbacks} rollback${s.rollbacks > 1 ? 's' : ''}. All of them worked, which has never happened before.` : null,
    sim.perkLog.length ? `${sim.perkLog.length} hotfixes shipped straight to production, untested.` : null,
  ];
  const poorly = [
    deaths ? `The on-call engineer was terminated ${deaths} time${deaths > 1 ? 's' : ''}${killer ? `, mostly by ${killer[0]}` : ''}.` : 'Nothing. Nobody will believe this.',
    worst ? `Most of the error budget (${Math.round(worst[1])}%) was burned by ${worst[0]}.` : null,
    s.hotTime > 3 ? `${s.hotTime.toFixed(0)} s were spent standing in the hot aisle.` : null,
    s.overheats > 2 ? `Rate limits were hit ${s.overheats} times. Read the 429.` : null,
    s.revived ? `${s.revived} thread${s.revived > 1 ? 's' : ''} came back because its twin was still running.` : null,
    s.collateral ? `${s.collateral} process${s.collateral > 1 ? 'es were' : ' was'} killed by a memory leak. We are counting that as a feature.` : null,
    s.blinks > 12 ? `The heisenbug was observed ${s.blinks} times and reproduced 0 times.` : null,
    s.coffee ? `${s.coffee} coffee${s.coffee > 1 ? 's' : ''} consumed.` : 'No coffee was consumed. Concerning.',
  ];
  return {
    title: `POSTMORTEM  INC-${WAVES[0].inc}..${WAVES.at(-1).inc}`,
    meta: [
      ['status', 'resolved'], ['severity', SEV[sim.sev].name], ['duration', duration(s.time)], ['resolved at', clock(s.time)],
      ['score', String(sim.score)], ['on-call', 'you (alone)'],
    ],
    summary: 'At 03:07 production went down. One engineer was paged. The engineer entered production in person and removed the problem by hand.',
    cause: 'A change to legacy-billing-monolith.jar was deployed on Friday at 17:58 by \u2588\u2588\u2588\u2588. The change was reviewed by \u2588\u2588\u2588\u2588. The tests were skipped by \u2588\u2588\u2588\u2588.',
    well: well.filter(Boolean), poorly: poorly.filter(Boolean),
    actions: ['Stop deploying on Fridays.', 'Delete the monolith (estimate: Q3 2031).', 'Add a second person to the on-call rotation.', 'Buy the on-call engineer a coffee.'],
    sign: 'This postmortem is blameless.  (It was Dave.)',
  };
}

export const perkName = (id) => PERKS.find((p) => p.id === id);
export const enemyColor = (type) => ENEMY[type].color;
