import importlib.util
import json
import sqlite3
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

import observation as obs
import monitor_intelligence as monitor


NOW = datetime(2026, 10, 16, 12, tzinfo=timezone.utc)


def tx(txid, inputs, outputs, resolved=True):
    return dict(txid=txid, timestamp=int(NOW.timestamp()), block=10,
                inputs=[dict(address=a, amount=v) for a, v in inputs],
                outputs=[dict(address=a, amount=v) for a, v in outputs],
                inputs_resolved=resolved, outputs_resolved=True)


class Observations(unittest.TestCase):
    def test_net_flows_exclude_internal_and_change(self):
        rows = [tx('deposit', [('outside', 20)], [('hot', 19.9)]),
                tx('withdraw', [('hot', 10)], [('outside', 3), ('hot', 6.9)]),
                tx('internal', [('hot', 50)], [('cold', 49.9)])]
        result = obs.summarize_transactions(rows, {'CEX': {'hot','cold'}}, 0)['CEX']
        self.assertEqual(result['net_positive_qtc'], 19.9)
        self.assertEqual(result['net_negative_qtc'], 3.1)
        self.assertEqual(result['net_qtc'], 16.8)
        self.assertEqual(result['internal_transactions'], 1)

    def test_candidate_is_not_probability(self):
        raw = {'edges': [{'from':'a', 'to':'hot','value':40}, {'from':'a','to':'b','value':60}]}
        result = obs.candidate_evidence(raw, {'hot':'CEX'})[0]
        self.assertEqual(result['share_of_observed_allocated_flow'], .4)
        self.assertIn('unconfirmed', result['assessment'])

    def test_db_readonly_and_coverage(self):
        with tempfile.TemporaryDirectory(dir=Path.cwd()) as folder:
            db = Path(folder)/'source.db'
            con = sqlite3.connect(db)
            con.executescript('CREATE TABLE chain_index(block_height INTEGER,block_timestamp INTEGER);CREATE TABLE chain_utxos(txid TEXT,address TEXT,amount REAL,block_height INTEGER);CREATE TABLE chain_inputs(txid TEXT,address TEXT,amount REAL);')
            con.execute('INSERT INTO chain_index VALUES(10,?)', (int(NOW.timestamp()),))
            con.executemany('INSERT INTO chain_utxos VALUES(?,?,?,10)', [('a','hot',3), ('b','other',4)])
            con.execute("INSERT INTO chain_inputs VALUES('a','outside',3.1)")
            con.commit(); con.close()
            before = db.read_bytes()
            records, complete = obs.read_transactions(db, 10, NOW, limit=1)
            self.assertFalse(complete)
            self.assertEqual(len(records), 1)
            self.assertEqual(db.read_bytes(), before)
            with self.assertRaises(ValueError): obs.read_transactions(db, 9, NOW)

    def test_github_merged_and_direct_comment_url(self):
        event = dict(id='1', type='PullRequestEvent', repo={'name':'super-quantum/super-quantum/qubitcoin-coinbin'},
                     actor={'login':'Fenrir-15'}, created_at='2026-10-15T12:00:00Z',
                     payload=dict(action='closed', pull_request=dict(number=1, merged=True, title='Fix wallet', html_url='https://github.com/super-quantum/qubitcoin-coinbin/pull/1')))
        result = monitor.github_observation(event)
        self.assertEqual(result['repository'], 'super-quantum/qubitcoin-coinbin')
        self.assertEqual(result['action'], 'merged')
        self.assertEqual(result['delivery'], 'push')
        text = monitor.github_text(result, NOW)
        self.assertIn('Delayed report', text)
        self.assertNotIn('hours ago', text)
        event.update(id='2', type='IssueCommentEvent')
        event['payload'] = dict(issue=dict(number=1, title='Fix wallet'), comment=dict(html_url='https://github.com/super-quantum/qubitcoin-coinbin/pull/1#issuecomment-1', body='Review'))
        comment = monitor.github_observation(event)
        self.assertEqual(comment['key'], result['key'])
        self.assertIn('#issuecomment', comment['url'])
        self.assertEqual(comment['delivery'], 'digest')
        state, changed = monitor.fold_github({}, result)
        self.assertTrue(changed)
        self.assertFalse(monitor.fold_github(state, result)[1])
        comment['occurred_at'] = '2026-10-14T12:00:00Z'
        combined, _ = monitor.fold_github(state, comment)
        self.assertEqual(combined['action'], 'merged')

    def test_website_baseline_then_evidence_diff(self):
        with tempfile.TemporaryDirectory(dir=Path.cwd()) as folder:
            url = 'https://example.org/'
            old = b'<h1>Wallet</h1><a href="/old.zip">Download</a>'
            new = b'<h1>New Wallet</h1><a href="/new.zip">Download</a>'
            first = monitor.archive_website({url:old}, folder, NOW)
            self.assertTrue(first['baseline'])
            self.assertFalse(first['changes'])
            result = monitor.archive_website({url:new}, folder, NOW)
            change = result['changes'][0]
            self.assertIn('https://example.org/new.zip', change['links_added'])
            self.assertIn('+New Wallet', change['text_diff'])
            self.assertTrue((Path(folder)/'blobs'/change['before_sha256']).is_file())
            self.assertTrue((Path(folder)/'blobs'/change['after_sha256']).is_file())
            self.assertFalse(monitor.archive_website({url:new}, folder, NOW)['changes'])

    def test_freshness_stale_is_unknown_not_false_recovery(self):
        stamp = NOW.isoformat()
        self.assertEqual(monitor.freshness_observation(100,90,80,stamp,NOW)['status'], 'lagging')
        self.assertEqual(monitor.freshness_observation(100,100,100,stamp,NOW)['status'], 'healthy')
        self.assertEqual(monitor.freshness_observation(100,100,100,'2026-10-15T00:00:00Z',NOW)['status'], 'unknown')
        self.assertEqual(monitor.freshness_observation(100,110,100,stamp,NOW)['status'], 'unknown')

    def test_snapshots_keep_empty_wallets_and_daily_history(self):
        with tempfile.TemporaryDirectory(dir=Path.cwd()) as folder:
            base = Path(folder)
            raw_path, map_path = base/'raw.json', base/'map.json'
            raw = dict(verified_block=1, generated_at='2026-10-15T10:00:00Z',
                       nodes=[dict(id='wallet',balance=40000)],edges=[])
            raw_path.write_text(json.dumps(raw)); map_path.write_text(json.dumps(raw))
            obs.build(raw_path,map_path,now=NOW)
            raw.update(verified_block=2, generated_at='2026-10-16T10:00:00Z',nodes=[dict(id='wallet',balance=0)])
            raw_path.write_text(json.dumps(raw))
            current = dict(raw, nodes=[])
            map_path.write_text(json.dumps(current))
            report = obs.build(raw_path,map_path,now=NOW)
            self.assertEqual(report['whale_balance_changes'][0]['change_qtc'], -40000)
            self.assertEqual(len(json.loads((base/'history/index.json').read_text())['snapshots']),2)
            obs.build(raw_path,map_path,now=NOW)
            self.assertEqual(len(json.loads((base/'history/index.json').read_text())['snapshots']),2)
            self.assertEqual(json.loads((base/'history/2026-10-16.json').read_text())['balances']['wallet'],0)
            raw['verified_block'] = 3
            raw_path.write_text(json.dumps(raw))
            with self.assertRaises(ValueError): obs.build(raw_path,map_path,now=NOW)


if __name__ == '__main__':
    unittest.main()
