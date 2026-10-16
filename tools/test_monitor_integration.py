import ast
import copy
import importlib.util
import sys
import tempfile
import threading
import types
import unittest
from datetime import datetime, timezone, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def module(name, file):
    spec = importlib.util.spec_from_file_location(name,ROOT/file)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


class MonitorIntegration(unittest.TestCase):
    def setUp(self):
        self.previous = {k:sys.modules.get(k) for k in ('alert_manager','alert_bridge','qubitcoin_observation_details')}
        self.state = {'events':{'a':dict(active=True,priority='normal',version=1,message='first')}}
        self.lock = threading.Lock()
        manager = types.ModuleType('alert_manager')
        def update(callback):
            with self.lock:
                return callback(self.state)
        manager.update_state_safely = update
        sys.modules['alert_manager'] = manager
        bridge = types.ModuleType('alert_bridge')
        self.submitted = []
        bridge.submit_alert = lambda *args: self.submitted.append(args)
        bridge.send_important = lambda *args: None
        sys.modules['alert_bridge'] = bridge
        sys.modules['qubitcoin_observation_details'] = module('details', 'monitor_intelligence.py')
        self.digest = module('digest','monitor_alert_digest_delivery.py')
        self.clock = datetime(2026,10,16,10,tzinfo=timezone.utc)  # noon Berlin
        self.digest._now = lambda:self.clock
        self.github = module('github','monitor_alert_github.py')

    def tearDown(self):
        for key,value in self.previous.items():
            if value is None: sys.modules.pop(key,None)
            else: sys.modules[key]=value

    def test_no_send_before_noon_berlin(self):
        self.clock -= timedelta(seconds=1)
        self.assertEqual(self.digest.deliver_digest('1',lambda *a,**k:self.fail('sent before noon')),'skipped')

    def test_one_day_per_chat_even_after_new_events(self):
        sends=[]
        sender=lambda text,**kw:sends.append(kw['chat_id']) or True
        self.assertEqual(self.digest.deliver_digest('1',sender),'sent')
        self.state['events']['b']=dict(active=True,priority='normal',version=1,message='new')
        self.assertEqual(self.digest.deliver_digest('1',sender),'skipped')
        self.assertEqual(self.digest.deliver_digest('2',sender),'sent')
        self.clock+=timedelta(days=1)
        self.assertEqual(self.digest.deliver_digest('1',sender),'sent')
        self.assertEqual(sends,['1','2','1'])

    def test_failed_destination_retry_preserves_successful_day(self):
        self.assertEqual(self.digest.deliver_digest('1',lambda *a,**k:True),'sent')
        self.assertEqual(self.digest.deliver_digest('2',lambda *a,**k:False),'failed')
        self.state['events']['b']=dict(active=True,priority='normal',version=1,message='new')
        self.assertEqual(self.digest.deliver_digest('1',lambda *a,**k:self.fail('duplicate')),'skipped')
        self.assertEqual(self.digest.deliver_digest('2',lambda *a,**k:True),'sent')

    def test_concurrent_reservation_is_busy(self):
        reservation=self.digest.reserve_digest('1')
        self.assertEqual(self.digest.deliver_digest('1',lambda *a,**k:self.fail('parallel send')),'busy')
        self.assertTrue(self.digest.finish_digest('1',reservation['token'],reservation['items'],True))

    def test_wrong_token_and_changed_version(self):
        reservation=self.digest.reserve_digest('1')
        self.assertFalse(self.digest.finish_digest('1','wrong',reservation['items'],True))
        self.state['events']['a']['version']=2
        self.assertTrue(self.digest.finish_digest('1',reservation['token'],reservation['items'],True))
        self.assertNotIn('digest_delivered_to',self.state['events']['a'])
        self.assertEqual(self.state['digest_daily_delivered']['1'],'2026-10-16')

    def test_bounded_message_only_acknowledges_selected_items(self):
        self.state['events']={str(i):dict(active=True,priority='normal',message='🧠'*2000,version=1) for i in range(8)}
        messages=[]
        self.assertEqual(self.digest.deliver_digest('1',lambda text,**kw:messages.append(text) or True),'sent')
        self.assertLessEqual(len(messages[0].encode('utf-16-le'))//2,3900)
        marked=sum('1' in e.get('digest_delivered_to',{}) for e in self.state['events'].values())
        self.assertGreater(marked,0)
        self.assertLess(marked,8)

    def test_winter_noon_uses_berlin_zone(self):
        self.clock=datetime(2026,12,1,10,59,tzinfo=timezone.utc)
        self.assertIsNone(self.digest.reserve_digest('1'))
        self.clock+=timedelta(minutes=1)
        self.assertIn('token',self.digest.reserve_digest('1'))

    def test_event_ids_are_distinct_with_same_repository_url(self):
        a=dict(type='EVENT',repo='super-quantum/qubitcoin-coinbin',url='https://github.com/super-quantum/qubitcoin-coinbin',github_event={'id':'one'})
        b=dict(a,github_event={'id':'two'})
        self.assertNotEqual(self.github.event_key(a),self.github.event_key(b))
        legacy=self.github.event_key(dict(type='COMMIT',repo='super-quantum/qubitcoin-coinbin',sha='abc'))
        import hashlib
        self.assertEqual(legacy,'github:commit:'+hashlib.sha256(b'COMMIT|super-quantum/qubitcoin-coinbin|abc').hexdigest()[:20])

    def test_comment_uses_title_direct_link_and_absolute_time(self):
        event=dict(id='one',type='IssueCommentEvent',repo={'name':'super-quantum/super-quantum/qubitcoin-coinbin'},actor={'login':'Fenrir-15'},created_at='2026-10-16T00:24:00Z',payload=dict(issue=dict(number=5,title='Wallet fix'),comment=dict(body='Review details',html_url='https://github.com/super-quantum/qubitcoin-coinbin/issues/5#issuecomment-9')))
        self.github.register_github_alert(dict(type='EVENT',repo='super-quantum/qubitcoin-coinbin',github_event=event),'old (2 hours ago)')
        key,category,text=self.submitted[0]
        self.assertEqual(category,'github_commit')
        self.assertIn('Wallet fix',text)
        self.assertIn('#issuecomment-9',text)
        self.assertIn('2026-10-16T00:24:00Z',text)
        self.assertNotIn('hours ago',text)
        self.assertNotIn('super-quantum/super-quantum',text)

    def test_installer_preserves_node_and_refuses_unseen_module(self):
        installer=module('installer','install-monitor-observation.py')
        with tempfile.TemporaryDirectory(dir=ROOT) as folder:
            target=Path(folder)
            for name in ('alert_github.py','alert_digest_delivery.py'):
                fixtures = ROOT/'monitor-integration-fixtures'
                fixture = fixtures/('old_'+name) if fixtures.exists() else ROOT/('old_'+name)
                (target/name).write_text(fixture.read_text(encoding='utf-8'),encoding='utf-8')
            old='def scan(event):\n    alerts=[]\n    alerts.append({\n        "type": "EVENT",\n        "repo": "test",\n    })\n    return alerts\n'
            (target/'node_watch.py').write_text(old)
            backup=installer.install(target,ROOT,apply=True)
            self.assertEqual((backup/'node_watch.py').read_text(),old)
            changed=(target/'node_watch.py').read_text()
            self.assertIn('"github_event": event,',changed)
            ast.parse(changed)
            self.assertIsNone(installer.install(target,ROOT,apply=True))
            (target/'alert_github.py').write_text('unknown=1\n')
            with self.assertRaises(ValueError):installer.prepare(target,ROOT)


if __name__=='__main__':unittest.main()
