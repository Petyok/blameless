// Ad-hoc probe (SCENARIOS=probe): a bestiary. Every enemy posed in front of the camera, for a look at the models.
export default async ({ browser, page, shot, sleep }) => {
  const p = await page(browser, '?auto=1&manual=1&mute=1&god=1&seed=3&scale=0.72');
  const pose = async (name, wave, list, yaw = 0, pitch = -0.05, t = 1.2) => {
    await p.evaluate(`(() => { const g = __game, s = g.sim; g.G.bot = null; s.state = 'hold'; s.groups = []; s.enemies.length = 0; s.shots.length = 0;
      const q = s.player; q.yaw = ${yaw}; q.pitch = ${pitch}; q.x = s.world.start.x; q.z = s.world.start.z; q.vx = q.vz = 0;
      for (const [type, dx, dz, o] of ${JSON.stringify(list)}) { const e = g.spawn(type, q.x + dx, q.z + dz, { instant: true, ...(o || {}) });
        e.speed = 0; e.dmg = 0; e.cd = 1e9; e.cd2 = 1e9; e.yaw = Math.atan2(dx, dz); if (o && o.set) Object.assign(e, o.set); }
      g.step(${t}); })()`);
    await sleep(500);
    await shot(p, `bestiary-${name}`);
  };
  await p.evaluate('__game.step(6)');
  await pose('1-walkers', 0, [['zombie', -3.2, -6], ['fork', -1, -6], ['fork', 0.8, -5.5, { gen: 1 }], ['fork', 2, -5, { gen: 2 }], ['race', 3.4, -6],
    ['race', 4.8, -6.5, { set: { variant: 1, name: 'thread-B' } }]]);
  await pose('2-flyers', 0, [['cron', -2.5, -7, { set: { t: 2.7, tele: true } }], ['cron', 0.5, -8], ['packet', 2.5, -5], ['packet', 3.2, -5.6], ['packet', 3.9, -5.2]], 0, 0.22);
  await pose('3-heavies', 0, [['leak', -5, -8, { set: { r: 1.2, h: 2.4 } }], ['leak', 5.5, -9, { set: { r: 2.0, h: 4, state: 'oom', t: 1 } }], ['heisen', -2.4, -6],
    ['heisen', 2.4, -6, { set: { blinkCd: 5 } }], ['brute', 0, -11]], 0, 0);
  await pose('4-brute', 0, [['brute', -2.5, -6.5, { set: { state: 'windup', t: 5 } }], ['brute', 2.5, -6.5, { set: { state: 'stun', t: 5 } }]], 0, 0);
  await p.close();
};
