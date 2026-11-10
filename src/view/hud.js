// DOM HUD and the full-screen terminal screens. The DOM is touched only when a shown value changes.
import { WEAPONS, ENEMY, PERKS, SEV, PLAYER, WAVES } from '../sim/config.js';
import { killLine, clock, duration, VOICE, SUBTITLE, HELP, postmortem, PROMPT, REPO } from './text.js';

const $ = (id) => document.getElementById(id);
const rgb = (c) => `rgb(${c.map((v) => Math.round(v * 255)).join(',')})`;
const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
const num = (n) => Number(n).toLocaleString('en-US');
const LOGO = String.raw`
 ____  _        _    __  __ _____ _     _____ ____ ____
| __ )| |      / \  |  \/  | ____| |   | ____/ ___/ ___|
|  _ \| |     / _ \ | |\/| |  _| | |   |  _| \___ \___ \
| |_) | |___ / ___ \| |  | | |___| |___| |___ ___) |__) |
|____/|_____/_/   \_\_|  |_|_____|_____|_____|____/____/ `;

export function makeHud() {
  const el = {
    hud: $('hud'), feed: $('feed'), incTitle: $('inc-title'), incBar: $('inc-bar').firstElementChild, boss: $('boss'),
    bossName: $('boss-name'), bossBar: $('boss-bar').firstElementChild, clock: $('clock'), score: $('score'), combo: $('combo'),
    radar: /** @type {HTMLCanvasElement} */ ($('radar')), budget: $('budget'), budgetBar: $('budget-bar').firstElementChild,
    budgetVal: $('budget-val'), ab: [$('ab-dash'), $('ab-rollback'), $('ab-sudo')], weapons: $('weapons'), cross: $('cross'),
    hitm: $('hitm'), limit: $('limit'), dmg: $('dmg'), big: $('big'), sub: $('sub'), hint: $('hint'), screen: $('screen'), fps: $('fps'),
  };
  const rows = WEAPONS.map((w, i) => {
    const d = document.createElement('div');
    d.className = 'wp off'; d.style.color = rgb(w.color);
    d.innerHTML = `<span>${i + 1}</span><span>${w.cmd}</span><div class="heat"><i></i></div>`;
    el.weapons.append(d);
    return { d, heat: d.querySelector('i') };
  });
  const arcs = [0, 1, 2, 3].map(() => { const i = document.createElement('i'); el.dmg.append(i); return { i, t: 0 }; });
  const ticks = [...el.cross.querySelectorAll('i')];
  const ctx = el.radar.getContext('2d');
  const cache = {};
  /** Write only on change. kind: t text, c class, s style property. */
  const put = (key, node, kind, value, prop) => {
    if (cache[key] === value) return;
    cache[key] = value;
    if (kind === 't') node.textContent = value; else if (kind === 'c') node.className = value; else node.style[prop] = value;
  };
  let hitT = 0, bigT = 0, subT = 0, hintT = 0, radarT = 0, arcI = 0, fpsT = 0;
  const tips = new Set();
  const SPAWN_TIP = {
    leak: 'Memory leak: kill it while it is small. Full size, it goes OOM and takes the neighbourhood with it',
    heisen: 'Heisenbug: it moves when you look at it. Flick onto it and shoot; it is solid for a second after each jump',
    brute: 'oom_reaper: sidestep the charge. It stuns itself on walls',
    race: 'Race condition: two threads. Kill both within two seconds or the dead one restarts',
    cron: 'Cron job: it fires when the long hand reaches twelve. Keep moving',
    fork: 'Fork bomb: every kill makes two smaller ones. <kbd>2</kbd> SIGKILL is good at this',
  };
  /** The leaderboard handle field of a screen. lb: {name, text}, or null when there is no stats server. */
  const handle = (lb) => (lb ? `<span class="handle"><label for="handle">leaderboard handle</label>
    <input id="handle" type="text" maxlength="16" value="${esc(lb.name)}" placeholder="anonymous" autocomplete="off" spellcheck="false">
    <span id="rank">${esc(lb.text)}</span></span>` : '');
  const wire = () => {
    const inp = /** @type {HTMLInputElement} */ ($('handle'));
    if (!inp) return;
    // typing a handle must not drive the menus (R restarts, Q quits)
    inp.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { hud.onAct('name', inp.value); inp.blur(); } else if (e.key === 'Escape') inp.blur();
    });
    inp.addEventListener('keyup', (e) => e.stopPropagation());
  };

  const hud = {
    el, onAct: null, showFps: false,

    show(on) { el.hud.hidden = !on; },
    accent(c) { document.documentElement.style.setProperty('--a', c.map((v) => Math.round(v * 255)).join(',')); },
    log(text, cls = '') {
      const p = document.createElement('p');
      p.textContent = text; p.className = cls;
      p.addEventListener('animationend', () => p.remove());
      el.feed.append(p);
      while (el.feed.childElementCount > 9) el.feed.firstElementChild.remove();
    },
    big(title, sub = '', seconds = 2.4) {
      el.big.innerHTML = `<h1>${esc(title)}</h1><p>${esc(sub)}</p>`;
      el.big.className = 'on'; bigT = seconds;
    },
    subtitle(id, seconds) {
      el.sub.textContent = SUBTITLE[id] || VOICE[id];
      el.sub.className = 'on'; subT = seconds + 0.6;
    },
    /** A one-time tip (each id shows once per session). */
    hint(id, html, seconds = 6) {
      if (tips.has(id)) return;
      tips.add(id);
      el.hint.innerHTML = html; el.hint.className = 'on'; hintT = seconds;
    },

    /** One sim event. */
    on(e, sim) {
      switch (e.t) {
        case 'kill': if (!e.quiet) { hud.log(killLine(e)); hitT = 1.4; el.hitm.className = 'kill'; } break;
        case 'hit': if (hitT < 1) { hitT = 1; el.hitm.className = ''; } break;
        case 'hurt':
          if (!e.dot) { const a = arcs[arcI++ % 4]; a.t = 1; a.i.style.transform = `rotate(${e.ang}rad)`; }
          if (sim.player.hp < sim.player.maxHp * 0.6) hud.hint('rollback', '<kbd>Q</kbd> rollback: rewind yourself 3 seconds and take that error budget back');
          break;
        case 'waveStart':
          if (e.wave === 0) hud.hint('move', '<kbd>WASD</kbd> move &nbsp; <kbd>MOUSE</kbd> aim &nbsp; hold <kbd>LMB</kbd> fire &nbsp; <kbd>SPACE</kbd> jump &nbsp; <kbd>SHIFT</kbd> dash', 10);
          break;
        case 'spawn': if (SPAWN_TIP[e.type]) hud.hint(e.type, SPAWN_TIP[e.type], 7); break;
        case 'brief': {
          const s = e.sev;
          el.incTitle.innerHTML = `<b class="s${s}">SEV${s}</b>INC-${e.inc} &middot; ${esc(e.title)}`;
          hud.big(`INC-${e.inc}`, e.title, 3.2);
          hud.log(`pager: INC-${e.inc} TRIGGERED: ${e.title}`, 'warn');
          break;
        }
        case 'waveEnd': hud.big('INCIDENT RESOLVED', `INC-${e.inc} closed`, 2); hud.log(`pager: INC-${e.inc} resolved`, 'good'); break;
        case 'unlock':
          hud.log(`new command: ${WEAPONS[e.weapon].cmd}  [${e.weapon + 1}]`, 'good');
          hud.hint(`w${e.weapon}`, `New command <b>${WEAPONS[e.weapon].cmd}</b>: press <kbd>${e.weapon + 1}</kbd> or use the wheel`, 7);
          break;
        case 'perk': hud.log(`deployed hotfix: ${PERKS.find((k) => k.id === e.id).name}`, 'good'); break;
        case 'overheat':
          hud.log(`429 Too Many Requests: ${WEAPONS[e.weapon].cmd}`, 'bad');
          hud.hint('heat', 'Rate limited. Let it cool, or switch weapons <kbd>1</kbd>-<kbd>4</kbd>: holstered ones cool faster');
          break;
        case 'raceDown': hud.log('thread down: kill its twin NOW', 'warn'); break;
        case 'raceRevive': hud.log('thread restarted: its twin was still running', 'bad'); break;
        case 'leakFuse': hud.log('oom-killer: memory cgroup out of memory', 'bad'); break;
        case 'combo': hud.log(`auto-remediation streak x${e.n}`, 'good'); break;
        case 'sudoReady': hud.log('sudo available  [F]', 'good'); hud.hint('sudo', '<kbd>F</kbd> sudo: a few seconds with no rate limits and +50% damage'); break;
        case 'sudo': hud.big('# sudo', 'no rate limits. +50% damage.', 1.8); break;
        case 'rollback': hud.log('git revert HEAD~3s', 'good'); break;
        case 'breaker': hud.big('CIRCUIT BREAKER TRIPPED', 'you get one of those', 2); break;
        case 'coffee': hud.log('+ coffee', 'good'); break;
        case 'act': hud.log(`ssh ${['node-3', 'mq-broker-1', 'pg-primary', 'legacy-01'][e.act]}`); break;
        case 'bossFight':
          hud.big('legacy-billing-monolith.jar', 'shielded by its dependencies', 3);
          hud.hint('rings', 'Shoot its four dependencies first. <kbd>SPACE</kbd> jump over the rings', 8);
          break;
        case 'shieldDown':
          hud.big('DEPENDENCIES REMOVED', 'the monolith is exposed', 2.4);
          hud.hint('beams', '<kbd>SPACE</kbd> jump over the beams and the rings, or <kbd>SHIFT</kbd> dash through them', 8);
          break;
        case 'bossPhase3': hud.big('npm install', 'it is loading more dependencies', 2.4); break;
        case 'bossDying': hud.big('SIGKILL', 'exit code 137', 3.5); break;
        default:
      }
    },

    /** Per frame. */
    update(sim, dt, gfx) {
      const p = sim.player;
      put('clock', el.clock, 't', clock(sim.stats.time));
      if (hintT > 0 && (hintT -= dt) <= 0) el.hint.className = '';
      put('score', el.score, 't', `score ${sim.score}`);
      put('combo', el.combo, 't', sim.combo >= 3 ? `streak x${sim.combo}` : '');
      put('incBar', el.incBar, 's', `scaleX(${sim.state === 'wave' && sim.total ? Math.max(0, Math.min(1, sim.remaining / sim.total)).toFixed(2) : sim.state === 'brief' ? 1 : 0})`, 'transform');
      const boss = sim.enemies.find((e) => e.type === 'boss');
      put('boss', el.boss, 'c', boss && boss.shield ? 'shield' : '');
      if (el.boss.hidden !== !boss) el.boss.hidden = !boss;
      if (boss) {
        put('bossName', el.bossName, 't', boss.shield ? 'monolith.jar  [SHIELDED: kill its dependencies]' : 'legacy-billing-monolith.jar');
        put('bossBar', el.bossBar, 's', `scaleX(${Math.max(0, boss.hp / boss.maxHp).toFixed(3)})`, 'transform');
      }
      const hp = Math.max(0, p.hp);
      put('hpBar', el.budgetBar, 's', `scaleX(${(hp / p.maxHp).toFixed(3)})`, 'transform');
      put('hpVal', el.budgetVal, 't', `${Math.ceil(hp)} / ${p.maxHp}`);
      put('hpLow', el.budget, 'c', hp / p.maxHp < 0.3 ? 'low' : '');
      // abilities: [fill 0..1, state]
      const ab = [
        [1 - Math.max(0, p.dashCd) / (PLAYER.dashCd * p.dashCdMul), p.dashCd <= 0 ? 'ready' : ''],
        [1 - Math.max(0, p.rollbackCd) / (PLAYER.rollbackCd * p.rollbackCdMul), p.rollbackCd <= 0 ? 'ready' : ''],
        p.sudoT > 0 ? [p.sudoT / (PLAYER.sudoTime + p.sudoBonus), 'on'] : [p.sudo, p.sudo >= 1 ? 'ready' : ''],
      ];
      ab.forEach(([fill, cls], i) => {
        put(`abF${i}`, el.ab[i].lastElementChild, 's', `scaleX(${Math.max(0, Math.min(1, fill)).toFixed(2)})`, 'transform');
        put(`abC${i}`, el.ab[i], 'c', `ab ${cls}`);
      });
      rows.forEach((r, i) => {
        put(`wC${i}`, r.d, 'c', `wp${p.unlocked[i] ? '' : ' off'}${i === p.weapon ? ' cur' : ''}${p.locked[i] ? ' lock' : ''}`);
        put(`wH${i}`, r.heat, 's', `scaleX(${p.heat[i].toFixed(2)})`, 'transform');
      });
      put('limit', el.limit, 'c', p.locked[p.weapon] ? 'on' : '');
      const w = WEAPONS[p.weapon], gap = Math.round(4 + (w.spread + p.bloom) * 420 + (p.onGround ? 0 : 3));
      if (cache.gap !== gap) {
        cache.gap = gap;
        ticks[0].style.top = `${-gap - 9}px`; ticks[1].style.top = `${gap}px`; ticks[2].style.left = `${-gap - 9}px`; ticks[3].style.left = `${gap}px`;
      }
      if (hitT > 0) { hitT = Math.max(0, hitT - dt * 5); el.hitm.style.opacity = String(Math.min(1, hitT)); }
      for (const a of arcs) if (a.t > 0) { a.t = Math.max(0, a.t - dt * 1.3); a.i.style.opacity = String(a.t); }
      if (bigT > 0 && (bigT -= dt) <= 0) el.big.className = '';
      if (subT > 0 && (subT -= dt) <= 0) el.sub.className = '';
      if ((radarT -= dt) <= 0) { radarT = 0.08; hud.radar(sim); }
      if (hud.showFps && (fpsT -= dt) <= 0) {
        fpsT = 0.25;
        el.fps.textContent = `${gfx.fps.toFixed(0)} fps  ${gfx.sceneW}x${gfx.sceneH} (${gfx.scale})  ${gfx.calls} calls  ${(gfx.tris / 1000).toFixed(0)}k tris  ${sim.enemies.length} enemies`
          + `  pos ${p.x.toFixed(1)},${p.z.toFixed(1)}  yaw ${(p.yaw * 57.3).toFixed(0)}  pitch ${(p.pitch * 57.3).toFixed(0)}  shots ${sim.stats.shots}`;
      }
    },

    radar(sim) {
      const p = sim.player, S = 132, R = 62, range = 38, sin = Math.sin(p.yaw), cos = Math.cos(p.yaw);
      ctx.clearRect(0, 0, S, S);
      const acc = getComputedStyle(document.documentElement).getPropertyValue('--a');
      ctx.strokeStyle = `rgba(${acc},.5)`; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(S / 2, S / 2, R, 0, 7); ctx.stroke();
      ctx.beginPath(); ctx.arc(S / 2, S / 2, R / 2, 0, 7); ctx.stroke();
      ctx.fillStyle = `rgba(${acc},.1)`;
      ctx.beginPath(); ctx.moveTo(S / 2, S / 2); ctx.arc(S / 2, S / 2, R, -Math.PI / 2 - 0.62, -Math.PI / 2 + 0.62); ctx.fill();
      for (const e of sim.enemies) {
        if (e.dead) continue;
        const dx = e.x - p.x, dz = e.z - p.z;
        let rx = dx * cos - dz * sin, fz = -dx * sin - dz * cos; // right, forward
        const d = Math.hypot(rx, fz), k = d > range ? range / d : 1;
        rx *= k; fz *= k;
        const s = e.type === 'boss' ? 5 : e.type === 'brute' || e.type === 'pylon' ? 3.5 : e.type === 'packet' ? 1.3 : 2.2;
        ctx.fillStyle = e.state === 'down' ? '#666' : rgb(ENEMY[e.type].color);
        ctx.fillRect(S / 2 + rx / range * R - s / 2, S / 2 - fz / range * R - s / 2, s, s);
      }
      ctx.fillStyle = '#fff';
      for (const c of sim.pickups) {
        const dx = c.x - p.x, dz = c.z - p.z, rx = dx * cos - dz * sin, fz = -dx * sin - dz * cos;
        if (Math.hypot(rx, fz) < range) { ctx.beginPath(); ctx.arc(S / 2 + rx / range * R, S / 2 - fz / range * R, 1.6, 0, 7); ctx.fill(); }
      }
      ctx.beginPath(); ctx.moveTo(S / 2, S / 2 - 4); ctx.lineTo(S / 2 + 3, S / 2 + 3); ctx.lineTo(S / 2 - 3, S / 2 + 3); ctx.fill();
    },

    // ---- screens -------------------------------------------------------------------------------
    /** Show a full-screen terminal. mode: 'solid' (black) or 'veil' (game visible behind). */
    screen(html, mode = 'veil') { el.screen.className = `on ${mode}`; el.screen.innerHTML = html; },
    closeScreen() { el.screen.className = ''; el.screen.innerHTML = ''; },

    wake() {
      hud.screen(`<div class="phone"><div class="time">03:07</div><div class="date">Saturday</div>
        <div class="note"><small><span>PAGER</span><span>now</span></small><b>[TRIGGERED]</b> INC-2031<br>prod is down. you are on call.</div>
        <div class="say" id="phone-say"></div><div class="hint" id="phone-hint">press any key to pick up</div></div>`, 'solid');
    },
    /** world: totals from the stats server, or null. touch: no keyboard here, so it can look but not play. */
    title(st, world, touch = false) {
      const sev = SEV[st.sev], others = world ? world.online - 1 : 0;
      const awake = others > 0 ? `${others} other engineer${others > 1 ? 's are' : ' is'} awake right now.` : 'nobody else is awake.';
      hud.screen(`<div class="term bare"><pre class="logo">${esc(LOGO)}</pre><div class="tag">AN ON-CALL SHOOTER</div>
        <ul class="menu">
          ${touch ? '<li class="note">This incident needs a keyboard and a mouse. The autopilot is handling it behind this text. Come back on a computer.</li>' : `
          <li data-act="start"><kbd>ENTER</kbd> respond to the incident</li>
          <li data-act="sev"><kbd>S</kbd> severity: <b>${sev.name}</b> <span>${sev.label}</span></li>
          <li data-act="options"><kbd>O</kbd> options</li>
          <li data-act="help"><kbd>H</kbd> runbook <span>(controls)</span></li>
          ${st.won ? '<li data-act="night"><kbd>N</kbd> night shift <span>(endless)</span></li>' : ''}`}
          <li data-act="board"><kbd>L</kbd> leaderboard <span>(who else got paged)</span></li>
          <li data-act="prompt"><kbd>P</kbd> the prompt <span>(how this got made)</span></li>
        </ul>
        <div class="tip">${st.best ? `best score ${st.best}. ` : ''}${awake}${world && world.played
          ? `<br>${num(world.played)} engineer${world.played > 1 ? 's' : ''} paged so far. ${num(world.won)} resolved it.` : ''}</div></div>`);
    },
    /** The leaderboard and the world totals. d: the api/board answer, null while it loads, false without a server. */
    board(d, lb) {
      const row = (r, i, night) => `<li><i>${i + 1}</i><b>${esc(r.name)}</b><span>${num(r.score)}</span><em>${
        night ? `SEV${r.sev} +${r.wave}` : r.won ? `\u2713 ${duration(r.seconds)}` : `INC-${WAVES[Math.min(r.wave, WAVES.length - 1)].inc}`}</em></li>`;
      const list = (title, rows, night) => `<div><h3>${title}</h3><ol>${rows.map((r, i) => row(r, i, night)).join('') || '<li class="none">nobody yet</li>'}</ol></div>`;
      let body = '<p class="caret">$ kubectl top engineers --all-namespaces </p>';
      if (d === false) body = '<p>This copy runs without the stats server, so there is no leaderboard here.</p>';
      else if (d) {
        const w = d.world, share = (n, of) => (of ? `${Math.round(100 * n / of)}%` : '');
        const span = (s) => (s >= 3600 ? `${Math.floor(s / 3600)} h ${Math.floor(s % 3600 / 60)} min` : `${Math.floor(s / 60)} min`);
        const facts = [['engineers paged', w.played], ['awake right now', w.online], ['campaigns resolved', w.won], ['incidents resolved', w.resolved],
          ['processes terminated', w.kills], ['engineers lost', w.deaths], ['time on call', span(w.seconds)], ['visits', w.visits]];
        body = `<div class="boards">${[1, 2, 3].map((s) => list(`${SEV[s].name} ${SEV[s].label}`, d.top[s])).join('')}${list('NIGHT SHIFT', d.top.night, true)}</div>
          <div class="tip">\u2713 resolved, with the time on call &middot; INC: where the run ended &middot; night shift: points and incidents after the campaign</div>
          <h3>THE WORLD</h3><div class="facts">${facts.map(([k, v]) => `<span>${k} <b>${typeof v === 'number' ? num(v) : v}</b></span>`).join('')}</div>
          ${d.started ? `<h3>SURVIVAL <span>(share of campaigns that resolved each incident)</span></h3><div class="surv">${d.survival.map((n, k) =>
            `<span><i>INC-${WAVES[k].inc}</i><u>${'\u2588'.repeat(Math.round(16 * n / d.started)) || '\u2581'}</u><b>${share(n, d.started)}</b></span>`).join('')}</div>` : ''}
          ${d.causes.length ? `<h3>MOST LETHAL</h3><p>${d.causes.map(([c, n]) => `${esc(c)} ${share(n, w.deaths)}`).join(' &middot; ')}</p>` : ''}`;
      }
      hud.screen(`<div class="term board"><h2>LEADERBOARD</h2>${body}<div class="keys split"><span><kbd>ESC</kbd> back</span>${handle(lb)}</div></div>`);
      wire();
    },
    /** The brief the whole game was built from. */
    prompt() {
      hud.screen(`<div class="term"><h2>$ cat PROMPT.md</h2><p class="quote">${esc(PROMPT)}</p>
        <p>That is the whole brief. The story, the look, the weapons, the soundtrack, the tests and the server behind this page were the model's call.</p>
        <div class="tip">source: <a href="${REPO}" target="_blank" rel="noopener">${REPO.slice(8)}</a></div>
        <div class="keys"><kbd>ESC</kbd> back</div></div>`);
    },
    /** The text beside the handle field: where this run stands on its board. */
    rank(text) { const n = $('rank'); if (n) n.textContent = text; },
    help() {
      hud.screen(`<div class="term"><h2>RUNBOOK</h2><div class="grid2">${HELP.map(([k, v]) => `<b>${k}</b><span>${v}</span>`).join('')}</div>
        <div class="tip">No ammo. Each weapon has a rate limit: fire too long and it answers 429 until it cools.<br>
        Switch weapons instead: a holstered weapon cools faster.</div><div class="keys"><kbd>ESC</kbd> back</div></div>`);
    },
    /** st: settings object; inputs write back through onAct('set', key, value). */
    options(st, back = 'back') {
      const range = (key, label, min, max, step, fmt) => `<label for="o-${key}">${label}</label>
        <input id="o-${key}" data-key="${key}" type="range" min="${min}" max="${max}" step="${step}" value="${st[key]}"><span id="v-${key}">${fmt(st[key])}</span>`;
      const pct = (v) => `${Math.round(v * 100)}%`;
      const select = (key, label, opts) => `<label for="o-${key}">${label}</label><select id="o-${key}" data-key="${key}">${opts.map(([v, n]) =>
        `<option value="${v}"${String(st[key]) === String(v) ? ' selected' : ''}>${n}</option>`).join('')}</select><span></span>`;
      hud.screen(`<div class="term"><h2>OPTIONS</h2><div class="opts">
        ${range('sens', 'mouse sensitivity', 0.2, 3, 0.05, (v) => (+v).toFixed(2))}
        ${range('fov', 'field of view', 60, 100, 1, (v) => `${v}\u00b0`)}
        ${range('master', 'volume', 0, 1, 0.05, pct)}${range('music', 'music', 0, 1, 0.05, pct)}
        ${range('sfx', 'effects', 0, 1, 0.05, pct)}${range('voice', 'pager voice', 0, 1, 0.05, pct)}
        ${select('quality', 'resolution', [['auto', 'auto (measured)'], ['0.36', 'lowest'], ['0.47', 'low'], ['0.62', 'medium'], ['0.85', 'high'], ['1', 'native']])}
        ${select('cap', 'frame rate', [['60', 'display rate'], ['30', '30 fps (cooler laptop)']])}
        ${select('crt', 'CRT effect', [['1', 'on'], ['0.4', 'subtle'], ['0', 'off']])}
        ${select('fps', 'show fps', [['0', 'no'], ['1', 'yes']])}
        </div><div class="keys"><kbd>ESC</kbd> ${back}</div></div>`);
      el.screen.querySelectorAll('[data-key]').forEach((n) => n.addEventListener('input', () => {
        const inp = /** @type {HTMLInputElement} */ (n), key = inp.dataset.key, out = $(`v-${key}`);
        if (out) out.textContent = key === 'sens' ? (+inp.value).toFixed(2) : key === 'fov' ? `${inp.value}\u00b0` : pct(+inp.value);
        hud.onAct('set', key, inp.value);
      }));
    },
    pause(sim) {
      // Resume is the exact centre of the screen (equal-height blocks above and below it): that is where the
      // cursor reappears when the pointer lock ends, so a reflex click resumes.
      hud.screen(`<div class="term pause"><div class="above"><h2>[1]+  Stopped  &nbsp; ./respond --incident ${sim.def.inc}</h2>
        <div class="tip">${esc(sim.def.title)} &middot; ${duration(sim.stats.time)} on call &middot; score ${sim.score}</div>
        <ul class="menu"><li data-act="options"><kbd>O</kbd> options</li><li data-act="help"><kbd>H</kbd> runbook</li></ul></div>
        <ul class="menu"><li data-act="resume" class="big"><kbd>ESC</kbd> fg <span>(resume: click here, or anywhere outside this box)</span></li></ul>
        <div class="below"><ul class="menu"><li data-act="retry" data-confirm="1"><kbd>R</kbd> restart this incident</li>
        <li data-act="quit" data-confirm="1"><kbd>Q</kbd> go back to bed <span>(title)</span></li></ul></div></div>`);
    },
    perks(sim) {
      hud.screen(`<div class="term bare"><h2>HOTFIX AVAILABLE: deploy one straight to production</h2><div class="cards">${sim.perkChoices.map((id, i) => {
        const k = PERKS.find((q) => q.id === id), have = sim.player.perks[id] || 0;
        return `<div class="card" data-act="perk" data-i="${i}"><kbd>${i + 1}</kbd><h3>${k.name}</h3><p>${k.desc}</p><small>${have ? `deployed ${have}/${k.max}` : 'not deployed'}</small></div>`;
      }).join('')}</div></div>`);
    },
    dead(sim, cause, lb) {
      const s = sim.stats;
      hud.screen(`<div class="term panic"><h1>Kernel panic - not syncing: on-call engineer terminated by ${esc(cause)}</h1>
        <pre>INC-${sim.def.inc} "${esc(sim.def.title)}" is still open.
escalation policy: level 1: you. level 2: you. level 3: you.

${s.killsTotal} processes terminated &middot; ${duration(s.time)} on call &middot; score ${sim.score}</pre>
        <div class="keys split"><span><kbd>ENTER</kbd> respawn pod and retry the incident &nbsp; <kbd>Q</kbd> go back to bed</span>${handle(lb)}</div></div>`, 'veil');
      wire();
    },
    won(sim, deaths, causes, endless, lb) {
      const d = postmortem(sim, deaths, causes), li = (a) => a.map((x) => `<li>${esc(x)}</li>`).join('');
      hud.screen(`<div class="term pm"><h1>${d.title}</h1><div class="meta">${d.meta.map(([k, v]) => `<span>${k}: <b>${esc(v)}</b></span>`).join('')}</div>
        <h3>SUMMARY</h3><p>${d.summary}</p><h3>ROOT CAUSE</h3><p>${d.cause}</p>
        <h3>WHAT WENT WELL</h3><ul>${li(d.well)}</ul><h3>WHAT WENT POORLY</h3><ul>${li(d.poorly)}</ul>
        <h3>ACTION ITEMS</h3><ul>${li(d.actions)}</ul><p class="sign">${d.sign}</p>
        <div class="keys split"><span>${endless ? '' : '<kbd>N</kbd> night shift (endless) &nbsp; '}<kbd>ENTER</kbd> go back to sleep</span>${handle(lb)}</div></div>`, 'veil');
      wire();
    },
  };
  el.screen.addEventListener('click', (ev) => {
    const t = /** @type {HTMLElement} */ (ev.target), n = /** @type {HTMLElement} */ (t.closest('[data-act]'));
    if (!hud.onAct) return;
    if (!n) { if (t === el.screen) hud.onAct('veil'); return; }
    // When the pointer lock ends the cursor reappears mid-screen, on top of the menu: a reflex click must not
    // restart the incident, so the destructive entries take two clicks.
    if (n.dataset.confirm && !n.classList.contains('sel')) { n.classList.add('sel'); n.append(' \u2014 click again to confirm'); return; }
    hud.onAct(n.dataset.act, n.dataset.i);
  });
  return hud;
}
