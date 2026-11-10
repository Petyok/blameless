"""Rules of the stats server: what it counts, what it refuses, how the boards rank.   python3 -m unittest discover -s server"""
import json
import os
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import stats  # noqa: E402

ALICE, BOB, CAROL = 'alice-0001', 'bob-00002', 'carol-003'


class Clock:
    def __init__(self):
        self.t = 1_800_000_000.0

    def __call__(self):
        return self.t


class Case(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.clock = Clock()
        self.s = stats.Stats(os.path.join(self.dir.name, 'stats.db'), self.clock)

    def tearDown(self):
        self.s.db.close()
        self.dir.cleanup()

    def play(self, pid, seconds, sev=2, mode='campaign', addr='10.0.0.1', **report):
        """Open a run, let `seconds` pass, report it. Returns (token, answer)."""
        token = self.s.run({'id': pid, 'sev': sev, 'mode': mode}, addr)['run']
        self.clock.t += seconds
        body = {'id': pid, 'run': token, 'seconds': int(seconds), **report}
        return token, self.s.report(body)


class Counting(Case):
    def test_visits_visitors_and_who_is_online(self):
        self.s.hit({'id': ALICE, 'visit': True})
        self.s.hit({'id': ALICE, 'visit': True})
        w = self.s.hit({'id': BOB, 'visit': True})
        self.assertEqual((w['visits'], w['visitors'], w['online'], w['played']), (3, 2, 2, 0))
        self.clock.t += stats.ONLINE_WINDOW + 1
        self.assertEqual(self.s.hit({'id': BOB})['online'], 1, 'alice stopped beating')
        self.assertEqual(self.s.hit({'id': BOB, 'leave': True})['online'], 0)

    def test_a_player_counts_as_played_once_and_totals_add_up(self):
        self.play(ALICE, 120, wave=2, score=900, kills=40, deaths=1, cause='zombie')
        self.play(ALICE, 60, wave=1, score=300, kills=15, deaths=1, cause='thread-B')
        self.play(BOB, 30, kills=3, deaths=1, cause='<script>')
        b = self.s.board()
        w = b['world']
        self.assertEqual((w['played'], w['runs'], w['resolved'], w['kills'], w['deaths'], w['seconds']), (2, 3, 3, 58, 3, 210))
        self.assertEqual(b['started'], 3)
        self.assertEqual(b['survival'][:3], [2, 1, 0], 'two runs got past the first incident, one past the second')
        self.assertEqual(sorted(b['causes']), [['a race condition', 1], ['a zombie process', 1], ['something else', 1]],
                         'causes are named by the server, never by the request')

    def test_runs_that_went_nowhere_are_forgotten_but_stay_counted(self):
        self.play(ALICE, 5)
        kept, _ = self.play(BOB, 40, kills=4)
        self.clock.t += 2 * 86400
        self.s.prune()
        self.assertEqual([r['run'] for r in self.s.db.execute('SELECT run FROM runs')], [kept])
        self.assertEqual(self.s.board()['world']['runs'], 2)


class Refusing(Case):
    def refused(self, message, seconds=100, **report):
        with self.assertRaises(stats.Bad) as c:
            self.play(ALICE, seconds, **report)
        self.assertEqual(str(c.exception), message)

    def test_reports_no_real_game_could_send(self):
        token = self.s.run({'id': ALICE, 'sev': 2, 'mode': 'campaign'}, 'a')['run']
        with self.assertRaises(stats.Bad) as c:  # ten minutes of play reported five seconds after the start
            self.clock.t += 5
            self.s.report({'id': ALICE, 'run': token, 'seconds': 600, 'kills': 100, 'score': 3000})
        self.assertEqual(str(c.exception), 'faster than the clock')
        self.refused('too many kills', kills=700)
        self.refused('too much score', kills=10, score=stats.KILL_SCORE * 10 + stats.BOSS_SCORE + 1)
        self.refused('too many incidents', seconds=20, wave=4)
        self.refused('not a campaign', seconds=900, wave=11)
        self.refused('not a campaign', seconds=900, wave=4, won=True)
        self.refused('not a campaign', seconds=900, wave=10)  # all ten resolved is a win, by definition
        self.refused('the night shift does not end', seconds=900, mode='night', wave=3, won=True)
        self.refused('bad score', score=1.5)
        self.refused('bad kills', kills=-1)
        self.refused('bad wave', wave=True)

    def test_a_run_belongs_to_the_player_who_opened_it_and_expires(self):
        token = self.s.run({'id': ALICE, 'sev': 2, 'mode': 'campaign'}, 'a')['run']
        with self.assertRaises(stats.Bad) as c:
            self.s.report({'id': BOB, 'run': token})
        self.assertEqual(c.exception.code, 404)
        self.clock.t += stats.RUN_TTL + 1
        with self.assertRaises(stats.Bad) as c:
            self.s.report({'id': ALICE, 'run': token})
        self.assertEqual(c.exception.code, 410)

    def test_one_address_opens_a_limited_number_of_runs_an_hour(self):
        for _ in range(stats.RUNS_PER_HOUR):
            self.s.run({'id': ALICE, 'sev': 1, 'mode': 'night'}, '10.0.0.9')
        with self.assertRaises(stats.Bad) as c:
            self.s.run({'id': BOB, 'sev': 1, 'mode': 'night'}, '10.0.0.9')
        self.assertEqual(c.exception.code, 429)
        self.s.run({'id': BOB, 'sev': 1, 'mode': 'night'}, '10.0.0.10')  # someone else is not affected
        self.clock.t += 3601
        self.s.run({'id': BOB, 'sev': 1, 'mode': 'night'}, '10.0.0.9')

    def test_one_address_brings_a_limited_number_of_new_browsers_and_visits_an_hour(self):
        for i in range(stats.NEW_PER_HOUR):
            self.s.hit({'id': f'browser-{i:04d}', 'visit': True}, '10.0.0.9')
        with self.assertRaises(stats.Bad) as c:
            self.s.hit({'id': 'browser-9999', 'visit': True}, '10.0.0.9')
        self.assertEqual(c.exception.code, 429)
        for _ in range(stats.VISITS_PER_HOUR):  # a browser already known reloads all day
            w = self.s.hit({'id': 'browser-0000', 'visit': True}, '10.0.0.9')
        self.assertEqual((w['visitors'], w['visits']), (stats.NEW_PER_HOUR, stats.VISITS_PER_HOUR), 'served, but no longer counted')
        w = self.s.hit({'id': 'elsewhere-01', 'visit': True}, '10.0.0.10')
        self.assertEqual((w['visitors'], w['visits']), (stats.NEW_PER_HOUR + 1, stats.VISITS_PER_HOUR + 1), 'another address is not affected')

    def test_handles(self):
        ok = {'dave': 'dave', '  on   call  ': 'on call', 'x_X.9-': 'x_X.9-', 'ab': 'ab'}
        for raw, shown in ok.items():
            self.assertEqual(stats.clean_name(raw), shown, raw)
        for raw in ('a', 'seventeen chars!!', 'x' * 17, '<b>dave</b>', 'дейв', ' -dave', 'da\x00ve', '', None, 7,
                    'N1gg3r', 'xx_h1tl3r_xx', 'f.a.g.g.o.t'):
            self.assertIsNone(stats.clean_name(raw), raw)


class Ranking(Case):
    def test_boards_rank_each_player_once_by_their_best_run(self):
        self.play(ALICE, 300, wave=4, score=5000, kills=200, name='alice')
        _, bob = self.play(BOB, 300, wave=5, score=7000, kills=250, name='bob')
        _, second = self.play(ALICE, 300, wave=3, score=4000, kills=150, name='alice')
        self.play(CAROL, 300, wave=6, score=9000, kills=300)  # no handle: counted, never listed
        self.play(CAROL, 300, sev=1, wave=2, score=800, kills=30, name='carol')
        top = self.s.board()['top']
        self.assertEqual([(r['name'], r['score']) for r in top['2']], [('bob', 7000), ('alice', 5000)])
        self.assertEqual([r['name'] for r in top['1']], ['carol'])
        self.assertEqual(top['3'] + top['night'], [])
        self.assertEqual((bob['rank'], bob['of']), (1, 2))
        self.assertEqual((second['rank'], second['of']), (2, 2), 'her weaker run ranks below bob, not below herself')

    def test_a_run_only_grows_and_a_win_is_final(self):
        token, _ = self.play(ALICE, 700, wave=9, score=20000, kills=700, deaths=2, name='alice')
        self.s.report({'id': ALICE, 'run': token, 'seconds': 700, 'wave': 9, 'score': 18000, 'kills': 700, 'deaths': 3})
        row = self.s.board()['top']['2'][0]
        self.assertEqual((row['score'], row['deaths'], row['won']), (20000, 3, 0), 'the retry penalty does not lower the best score')
        self.clock.t += 60
        self.s.report({'id': ALICE, 'run': token, 'seconds': 760, 'wave': 10, 'score': 21000, 'kills': 760, 'deaths': 3, 'won': True})
        self.clock.t += 600
        out = self.s.report({'id': ALICE, 'run': token, 'seconds': 1300, 'wave': 10, 'score': 90000, 'kills': 2000,
                             'won': True, 'name': 'alice2'})
        row = self.s.board()['top']['2'][0]
        self.assertEqual((row['name'], row['score'], row['won'], out['rank']), ('alice2', 21000, 1, 1), 'only the handle changed')
        self.assertEqual(self.s.board()['world']['won'], 1)

    def test_a_refused_handle_keeps_the_run_off_the_board_and_hide_removes_one(self):
        token, out = self.play(ALICE, 100, wave=1, score=500, kills=20, name='hitler')
        self.assertEqual((out['name'], out['rank']), (None, None))
        self.assertEqual(self.s.report({'id': ALICE, 'run': token, 'name': 'Dave'})['rank'], 1)
        self.assertEqual(self.s.hide('dave'), 1)
        self.assertEqual(self.s.board()['top']['2'], [])


class Http(Case):
    def setUp(self):
        super().setUp()
        self.server = stats.serve(self.s, '127.0.0.1', 0)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.base = f'http://127.0.0.1:{self.server.server_address[1]}'

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        super().tearDown()

    def call(self, path, body=None, raw=None, headers=None):
        data = raw if raw is not None else json.dumps(body).encode() if body is not None else None
        try:
            with urllib.request.urlopen(urllib.request.Request(self.base + path, data=data, headers=headers or {}), timeout=5) as r:
                return r.status, json.loads(r.read())
        except urllib.error.HTTPError as e:
            with e:
                return e.code, json.loads(e.read())

    def test_a_run_over_http(self):
        self.assertEqual(self.call('/api/hit', {'id': ALICE, 'visit': True})[1]['visitors'], 1)
        code, run = self.call('/api/run', {'id': ALICE, 'sev': 3, 'mode': 'campaign'})
        self.assertEqual(code, 200)
        self.clock.t += 90
        code, out = self.call('/api/report', {'id': ALICE, 'run': run['run'], 'name': 'alice', 'seconds': 90, 'wave': 1,
                                              'score': 400, 'kills': 20, 'deaths': 1, 'cause': 'forkbomb'})
        self.assertEqual((code, out), (200, {'name': 'alice', 'board': 'SEV3', 'rank': 1, 'of': 1}))
        code, board = self.call('/api/board')
        self.assertEqual((code, board['top']['3'][0]['name'], board['causes']), (200, 'alice', [['a fork bomb', 1]]))

    def test_what_is_not_a_request_of_the_game_gets_a_4xx_not_a_crash(self):
        self.assertEqual(self.call('/api/board', {'id': ALICE})[0], 404)
        self.assertEqual(self.call('/api/nope')[0], 404)
        self.assertEqual(self.call('/api/hit', raw=b'{"id": ')[0], 400)
        self.assertEqual(self.call('/api/hit', raw=b'[1, 2]')[0], 400)
        self.assertEqual(self.call('/api/hit', raw=b'\xff\xfe')[0], 400)
        self.assertEqual(self.call('/api/hit', {'id': 'x' * 3000})[0], 400, 'bodies over 2 KiB are not read')
        self.assertEqual(self.call('/api/hit', {'id': '../../etc/passwd'})[0], 400)
        self.assertEqual(self.call('/api/run', {'id': ALICE, 'sev': 4, 'mode': 'campaign'})[0], 400)
        self.assertEqual(self.call('/api/report', {'id': ALICE, 'run': "' OR 1=1 --"})[0], 400)
        self.assertEqual(self.call('/api/hit', {'id': ALICE, 'visit': True}, headers={'Sec-Fetch-Site': 'cross-site'})[0], 403,
                         "another site's page cannot post through its visitors")
        self.assertEqual(self.call('/api/hit', {'id': ALICE}, headers={'Sec-Fetch-Site': 'same-origin'})[0], 200, 'and the server is still up')


if __name__ == '__main__':
    unittest.main()
