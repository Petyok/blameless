// World stats and the leaderboard (server/stats.py behind api/). Best effort: any call may fail, or the API may
// not exist at all (the local launcher serves files only), and the game plays the same.
import { WAVES } from '../sim/config.js';

/** What a leaderboard handle may look like: the server's NAME_RE. */
export const HANDLE = /^[A-Za-z0-9][A-Za-z0-9 _.-]{0,14}[A-Za-z0-9_.-]$/;

export function makeNet() {
  let off = false, run = null, base = null, last = null, seq = 0;
  let id = localStorage.getItem('blameless-id');
  if (!id) {
    // not a secret and not tied to anything: it only tells one browser from another
    id = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
    localStorage.setItem('blameless-id', id);
  }
  const call = async (path, body) => {
    if (off) return null;
    try {
      const r = await fetch(`api/${path}`, body ? { method: 'POST', body: JSON.stringify({ id, ...body }), keepalive: true } : undefined);
      if (r.status === 404 || r.status === 405 || r.status === 501) off = true; // files only, no API: stop asking
      return r.ok ? await r.json() : null;
    } catch {
      return null;
    }
  };

  const net = {
    /** Latest world totals from the server, or null. */
    world: null,
    /** The server's answer to the last report: {name, board, rank, of}, or null. */
    rank: null,
    /** True once it is clear this server has no API. */
    get off() { return off; },
    /** The open run's token, or null. */
    get run() { return run; },
    async hit(visit = false) {
      const w = await call('hit', { visit });
      if (w) net.world = w;
      return w;
    },
    leave() { if (!off) navigator.sendBeacon?.('api/hit', JSON.stringify({ id, leave: true })); },

    /**
     * A ranked run begins. from: the sim it continues (the night shift after a win carries score and stats
     * over, and only what is earned from here on counts), or null for a fresh start.
     */
    async begin(sev, mode, from = null) {
      const n = ++seq;
      run = null; last = null; net.rank = null;
      base = from ? { wave: WAVES.length, score: from.score, time: from.stats.time, kills: from.stats.killsTotal, deaths: from.stats.deaths }
        : { wave: mode === 'night' ? WAVES.length : 0, score: 0, time: 0, kills: 0, deaths: 0 };
      const r = await call('run', { sev, mode });
      if (n === seq) run = r ? r.run : null;
    },

    /** Report where the run stands. resolved: incidents resolved so far in this sim. */
    async report(sim, name, resolved, extra = {}) {
      if (!run) return null;
      const s = sim.stats;
      last = {
        run, wave: Math.max(0, resolved - base.wave), score: Math.max(0, sim.score - base.score),
        seconds: Math.max(0, Math.floor(s.time - base.time)), kills: Math.max(0, s.killsTotal - base.kills),
        deaths: Math.max(0, s.deaths - base.deaths), ...extra,
      };
      return net.send(name);
    },
    /** Send the last report again under a (new) handle. */
    async send(name) {
      if (!last) return null;
      const r = await call('report', { ...last, name: name || null });
      if (r) net.rank = r;
      return r;
    },

    board: () => call('board'),
  };
  return net;
}
