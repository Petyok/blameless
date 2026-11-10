#!/usr/bin/env python3
"""World stats and the leaderboard of BLAMELESS.

Standard library only. No IP addresses or cookies are stored: a player is a random id the page keeps in
localStorage. The caller's address is used in memory only, to cap how many runs one address may open.

  POST /api/hit     {"id", "visit"?: bool, "leave"?: bool}                    -> world totals
  POST /api/run     {"id", "sev": 1|2|3, "mode": "campaign"|"night"}          -> {"run": token}
  POST /api/report  {"id", "run", "name"?, "wave", "score", "seconds", "kills", "deaths", "won"?, "cause"?}
                                                                              -> {"name", "board", "rank", "of"}
  GET  /api/board                                                             -> world totals, survival, boards

  stats.py hide NAME    take a handle off the boards (run as root with STATE_DIRECTORY set)

ponytail: scores come from the browser, so the checks below are plausibility, not anti-cheat: they stop a
curl one-liner, not someone who reads the game's source. The sim is deterministic, so the upgrade is to have
the page send its inputs and replay the run here.
"""
import json
import os
import re
import secrets
import sqlite3
import sys
import threading
import time
from collections import defaultdict, deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HOST = os.environ.get('HOST', '127.0.0.1')
PORT = int(os.environ.get('PORT', '8789'))
DB_PATH = os.path.join(os.environ.get('STATE_DIRECTORY', '.'), 'stats.db')

ONLINE_WINDOW = 60     # seconds since a page's last heartbeat (it beats every 20 s)
RUN_TTL = 12 * 3600    # a run accepts reports for this long
RUNS_PER_HOUR = 30     # new runs per address
NEW_PER_HOUR = 60      # browsers never seen before, per address: what bounds the players table
VISITS_PER_HOUR = 120  # visits counted per address; more are served, not counted
CAMPAIGN = 10          # incidents in the campaign
KILL_SCORE = 360       # the most one kill can score: an oom_reaper on a x3 streak
BOSS_SCORE = 6000      # the monolith on a x3 streak, once per campaign
ID_RE = re.compile(r'^[A-Za-z0-9-]{8,64}$')
RUN_RE = re.compile(r'^[0-9a-f]{32}$')
NAME_RE = re.compile(r'^[A-Za-z0-9][A-Za-z0-9 _.-]{0,14}[A-Za-z0-9_.-]$')  # 2 to 16 characters
# What can end an on-call engineer (hurtPlayer causes in src/sim), as the boards name it.
CAUSES = {
    'zombie': 'a zombie process', 'forkbomb': 'a fork bomb', 'thread-A': 'a race condition', 'thread-B': 'a race condition',
    'oom_reaper': 'the oom_reaper', 'a SYN flood': 'a SYN flood', 'a cron job': 'a cron job', 'a heisenbug': 'a heisenbug',
    'a memory leak': 'a memory leak', 'the monolith': 'the monolith', 'the hot aisle': 'the hot aisle',
    'your own rm -rf': 'their own rm -rf',
}
LEET = str.maketrans('013457', 'oieast')
# Handles containing these never reach a board. Deliberately short: `stats.py hide` is the real moderation.
BLOCK = ('nigger', 'nigga', 'faggot', 'fag', 'kike', 'retard', 'hitler', 'nazi', 'rape', 'cunt', 'pidor', 'pidar', 'hohol')

SCHEMA = """
CREATE TABLE IF NOT EXISTS counters (key TEXT PRIMARY KEY, value INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS players (id TEXT PRIMARY KEY, first_seen INTEGER NOT NULL, played INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS causes (cause TEXT PRIMARY KEY, n INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS runs (
  run TEXT PRIMARY KEY, player TEXT NOT NULL, started INTEGER NOT NULL, updated INTEGER NOT NULL,
  sev INTEGER NOT NULL, mode TEXT NOT NULL, name TEXT,
  wave INTEGER NOT NULL DEFAULT 0, score INTEGER NOT NULL DEFAULT 0, seconds INTEGER NOT NULL DEFAULT 0,
  kills INTEGER NOT NULL DEFAULT 0, deaths INTEGER NOT NULL DEFAULT 0, won INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS runs_board ON runs (mode, sev, score) WHERE name IS NOT NULL;
"""


class Bad(ValueError):
    """A request the game itself would never send."""

    def __init__(self, message, code=400):
        super().__init__(message)
        self.code = code


def player_id(body):
    pid = body.get('id')
    if not isinstance(pid, str) or not ID_RE.match(pid):
        raise Bad('bad id')
    return pid


def count(body, key, top):
    """A whole number from 0 to top; anything else (floats, bools, strings) is refused."""
    v = body.get(key, 0)
    if isinstance(v, bool) or not isinstance(v, int) or not 0 <= v <= top:
        raise Bad(f'bad {key}')
    return v


def clean_name(raw):
    """The handle as the boards will show it, or None when it is missing or not acceptable."""
    if not isinstance(raw, str):
        return None
    name = ' '.join(raw.split())
    if not NAME_RE.match(name):
        return None
    flat = re.sub(r'[^a-z]', '', name.lower().translate(LEET))
    return None if any(word in flat for word in BLOCK) else name


def plausible(run, f, won, now):
    """Refuse what no browser playing the real game could report (see the module docstring for the limits)."""
    if f['seconds'] > now - run['started'] + 15:
        raise Bad('faster than the clock')
    if f['kills'] > 6 * f['seconds'] + 40:
        raise Bad('too many kills')
    if f['score'] > KILL_SCORE * f['kills'] + BOSS_SCORE:
        raise Bad('too much score')
    if f['wave'] > f['seconds'] // 10 + 1:
        raise Bad('too many incidents')
    if run['mode'] == 'campaign' and (f['wave'] > CAMPAIGN or won != (f['wave'] == CAMPAIGN)):
        raise Bad('not a campaign')
    if run['mode'] == 'night' and won:
        raise Bad('the night shift does not end')


class Stats:
    def __init__(self, path, clock=time.time):
        self.clock = clock
        self.lock = threading.Lock()
        self.db = sqlite3.connect(path, check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.execute('PRAGMA journal_mode=WAL')
        self.db.executescript(SCHEMA)
        self.seen = {}                    # player id -> time of the last heartbeat
        self.opened = defaultdict(deque)  # (address, what) -> times of its recent runs, new players, visits
        self.cached = (0, None)           # (time, board)
        self.prune()

    def add(self, key, n=1):
        self.db.execute('INSERT INTO counters (key, value) VALUES (?, ?) '
                        'ON CONFLICT(key) DO UPDATE SET value = value + excluded.value', (key, n))

    def prune(self):
        """Forget runs that never got anywhere (they stay counted as started) and idle address windows."""
        now = self.clock()
        with self.lock:
            self.db.execute('DELETE FROM runs WHERE wave = 0 AND kills = 0 AND updated < ?', (int(now) - 86400,))
            self.db.commit()
            for key in [k for k, q in self.opened.items() if not q or now - q[-1] > 3600]:
                del self.opened[key]

    def allow(self, addr, what, limit):
        """True, and counted, while the address has done `what` fewer than `limit` times in the last hour."""
        now, recent = self.clock(), self.opened[(addr, what)]
        while recent and now - recent[0] > 3600:
            recent.popleft()
        if len(recent) >= limit:
            return False
        recent.append(now)
        return True

    def world(self, now):
        c = dict(self.db.execute('SELECT key, value FROM counters'))
        s = self.db.execute('SELECT COALESCE(SUM(wave), 0), COALESCE(SUM(won), 0), COALESCE(SUM(kills), 0), '
                            'COALESCE(SUM(deaths), 0), COALESCE(SUM(seconds), 0) FROM runs').fetchone()
        return {
            'online': sum(1 for t in self.seen.values() if now - t < ONLINE_WINDOW),
            'visits': c.get('visits', 0), 'visitors': c.get('visitors', 0), 'played': c.get('played', 0),
            'runs': c.get('runs', 0), 'resolved': s[0], 'won': s[1], 'kills': s[2], 'deaths': s[3], 'seconds': s[4],
        }

    def hit(self, body, addr=''):
        pid = player_id(body)
        now = self.clock()
        with self.lock:
            if body.get('visit') is True:
                if not self.db.execute('SELECT 1 FROM players WHERE id = ?', (pid,)).fetchone():
                    if not self.allow(addr, 'new', NEW_PER_HOUR):
                        raise Bad('too many new players from this address', 429)
                    self.db.execute('INSERT INTO players (id, first_seen) VALUES (?, ?)', (pid, int(now)))
                    self.add('visitors')
                if self.allow(addr, 'visit', VISITS_PER_HOUR):
                    self.add('visits')
                self.db.commit()
            if body.get('leave') is True:
                self.seen.pop(pid, None)
            else:
                self.seen[pid] = now
            for k in [k for k, t in self.seen.items() if now - t > ONLINE_WINDOW * 4]:
                del self.seen[k]
            return self.world(now)

    def run(self, body, addr):
        pid = player_id(body)
        sev, mode = body.get('sev'), body.get('mode')
        if isinstance(sev, bool) or sev not in (1, 2, 3) or mode not in ('campaign', 'night'):
            raise Bad('bad run')
        now = self.clock()
        with self.lock:
            if not self.allow(addr, 'run', RUNS_PER_HOUR):
                raise Bad('too many runs from this address', 429)
            token = secrets.token_hex(16)
            self.db.execute('INSERT INTO runs (run, player, started, updated, sev, mode) VALUES (?, ?, ?, ?, ?, ?)',
                            (token, pid, int(now), int(now), sev, mode))
            self.add('runs')
            self.add(f'runs_{mode}')
            self.db.execute('INSERT OR IGNORE INTO players (id, first_seen) VALUES (?, ?)', (pid, int(now)))
            if self.db.execute('UPDATE players SET played = 1 WHERE id = ? AND played = 0', (pid,)).rowcount:
                self.add('played')
            self.db.commit()
            return {'run': token}

    def report(self, body):
        pid = player_id(body)
        token = body.get('run')
        if not isinstance(token, str) or not RUN_RE.match(token):
            raise Bad('bad run')
        f = {k: count(body, k, top) for k, top in
             (('wave', 500), ('score', 5_000_000), ('seconds', RUN_TTL), ('kills', 200_000), ('deaths', 1000))}
        won = body.get('won') is True
        name = clean_name(body.get('name'))
        now = self.clock()
        with self.lock:
            run = self.db.execute('SELECT * FROM runs WHERE run = ? AND player = ?', (token, pid)).fetchone()
            if not run:
                raise Bad('no such run', 404)
            if now - run['started'] > RUN_TTL:
                raise Bad('this run is over', 410)
            if not run['won']:  # a resolved campaign is final: only its handle can still change
                plausible(run, f, won, now)
                if f['deaths'] > run['deaths'] and body.get('cause') is not None:
                    self.db.execute('INSERT INTO causes (cause, n) VALUES (?, 1) ON CONFLICT(cause) DO UPDATE SET n = n + 1',
                                    (CAUSES.get(body.get('cause'), 'something else'),))
                self.db.execute(
                    'UPDATE runs SET updated = ?, wave = MAX(wave, ?), score = MAX(score, ?), seconds = MAX(seconds, ?), '
                    'kills = MAX(kills, ?), deaths = MAX(deaths, ?), won = ? WHERE run = ?',
                    (int(now), f['wave'], f['score'], f['seconds'], f['kills'], f['deaths'], int(won), token))
            if name:
                self.db.execute('UPDATE runs SET name = ? WHERE run = ?', (name, token))
            self.db.commit()
            self.cached = (0, None)
            run = self.db.execute('SELECT * FROM runs WHERE run = ?', (token,)).fetchone()
            out = {'name': run['name'], 'board': 'the night shift' if run['mode'] == 'night' else f"SEV{run['sev']}",
                   'rank': None, 'of': 0}
            if run['name'] and run['score'] > 0:
                # campaigns are ranked per severity, the night shift on one board (where: one of two constants)
                where, args = ("mode = 'night'", ()) if run['mode'] == 'night' else ("mode = 'campaign' AND sev = ?", (run['sev'],))
                best = self.db.execute(f'SELECT player, MAX(score) AS s FROM runs WHERE {where} AND name IS NOT NULL '  # nosec B608
                                       'AND score > 0 GROUP BY player', args).fetchall()
                out['rank'] = 1 + sum(1 for b in best if b['player'] != pid and b['s'] > run['score'])
                out['of'] = len(best)
            return out

    def top(self, where, args):
        """The ten best players of a board, each with their best run."""
        rows = self.db.execute(  # nosec B608: where is a constant of this file
            'SELECT name, sev, score, wave, won, seconds, deaths FROM ('
            '  SELECT *, ROW_NUMBER() OVER (PARTITION BY player ORDER BY score DESC, updated) AS n FROM runs'
            f'  WHERE {where} AND name IS NOT NULL AND score > 0) WHERE n = 1 ORDER BY score DESC, updated LIMIT 10', args)
        return [dict(r) for r in rows]

    def board(self):
        now = self.clock()
        with self.lock:
            if self.cached[1] and now - self.cached[0] < 2:
                return {**self.cached[1], 'world': self.world(now)}
            top = {str(sev): self.top("mode = 'campaign' AND sev = ?", (sev,)) for sev in (1, 2, 3)}
            top['night'] = self.top("mode = 'night'", ())
            at = dict(self.db.execute("SELECT wave, COUNT(*) FROM runs WHERE mode = 'campaign' GROUP BY wave"))
            started = self.db.execute("SELECT value FROM counters WHERE key = 'runs_campaign'").fetchone()
            out = {
                'started': started[0] if started else 0,
                # survival[k]: campaign runs that resolved incident k + 1
                'survival': [sum(n for wave, n in at.items() if wave > k) for k in range(CAMPAIGN)],
                'causes': [list(r) for r in self.db.execute('SELECT cause, n FROM causes ORDER BY n DESC, cause LIMIT 6')],
                'top': top,
            }
            self.cached = (now, out)
            return {**out, 'world': self.world(now)}

    def hide(self, name):
        with self.lock:
            n = self.db.execute('UPDATE runs SET name = NULL WHERE name = ? COLLATE NOCASE', (name,)).rowcount
            self.db.commit()
            return n


class Handler(BaseHTTPRequestHandler):
    server_version = 'blameless-stats'
    timeout = 15  # a client that stops talking does not hold a thread
    stats = None

    def reply(self, code, payload):
        data = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path.split('?')[0] != '/api/board':
            return self.reply(404, {'error': 'not found'})
        return self.reply(200, self.stats.board())

    def do_POST(self):
        path = self.path.split('?')[0]
        try:
            if path not in ('/api/hit', '/api/run', '/api/report'):
                raise Bad('not found', 404)
            # another site's page may not count visits or open runs through its visitors' browsers
            if self.headers.get('Sec-Fetch-Site', 'same-origin') not in ('same-origin', 'none'):
                raise Bad('cross-site', 403)
            length = int(self.headers.get('Content-Length') or 0)
            if not 0 < length <= 2048:
                raise Bad('bad length')
            # sendBeacon posts text/plain, so the content type is not checked
            body = json.loads(self.rfile.read(length))
            if not isinstance(body, dict):
                raise Bad('bad body')
            # nginx passes the caller's address; without it (tests) every caller shares one window
            addr = self.headers.get('X-Real-IP') or self.client_address[0]
            if path == '/api/hit':
                return self.reply(200, self.stats.hit(body, addr))
            if path == '/api/run':
                return self.reply(200, self.stats.run(body, addr))
            return self.reply(200, self.stats.report(body))
        except Bad as err:
            return self.reply(err.code, {'error': str(err)})
        except (ValueError, UnicodeDecodeError) as err:  # not JSON, or not a number in Content-Length
            return self.reply(400, {'error': type(err).__name__})

    def log_message(self, fmt, *args):  # nginx already logs requests
        pass


def serve(stats, host=HOST, port=PORT):
    Handler.stats = stats
    return ThreadingHTTPServer((host, port), Handler)


def prune_hourly(stats):
    while True:
        time.sleep(3600)
        stats.prune()


if __name__ == '__main__':
    app = Stats(DB_PATH)
    if sys.argv[1:2] == ['hide'] and len(sys.argv) == 3:
        print(f'{app.hide(sys.argv[2])} runs lost their handle')
    elif len(sys.argv) > 1:
        sys.exit(__doc__)
    else:
        threading.Thread(target=prune_hourly, args=(app,), daemon=True).start()
        serve(app).serve_forever()
