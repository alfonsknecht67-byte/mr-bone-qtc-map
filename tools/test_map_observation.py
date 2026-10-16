import copy
import contextlib
import io
import importlib.util
import json
import sys
import tempfile
import threading
import types
import unittest
from datetime import datetime,timezone
from pathlib import Path

ROOT=Path(__file__).resolve().parent
ADDRESS='bc1q'+'a'*38


def module(name,file):
    spec=importlib.util.spec_from_file_location(name,ROOT/file)
    loaded=importlib.util.module_from_spec(spec);spec.loader.exec_module(loaded)
    return loaded


class MapObservation(unittest.TestCase):
    def setUp(self):
        self.previous={k:sys.modules.get(k) for k in ('alert_manager','alert_bridge','map_observation_bridge')}
        self.state={'events':{}}
        self.lock=threading.Lock()
        self.messages=[]
        self.registrations=[]
        self.fail=set()
        manager=types.ModuleType('alert_manager')
        manager.load_state=lambda:copy.deepcopy(self.state)
        def update(callback):
            with self.lock:return callback(self.state)
        manager.update_state_safely=update
        def resolve(key):
            if key in self.state['events']:self.state['events'][key]['active']=False
        manager.resolve_event=resolve
        def recover(key,message):
            event=self.state['events'].get(key)
            if not event or not event['active']:return False
            event['active']=False
            submit(key+':recovered','map_stale',message)
            return True
        manager.resolve_with_notification=recover
        bridge=types.ModuleType('alert_bridge')
        def submit(key,category,message):
            self.registrations.append((key,category,message))
            previous=self.state['events'].get(key,{})
            self.state['events'][key]=dict(active=True,message=message,delivered=set(),version=previous.get('version',0)+1)
        bridge.submit_alert=submit
        def send(key,destinations,sender):
            result=dict(sent=[],failed=[],skipped=[])
            event=self.state['events'].get(key)
            if not event or not event['active']:return result
            for chat in destinations:
                if chat in event['delivered']:continue
                if sender(event['message'],chat_id=chat):
                    event['delivered'].add(chat);result['sent'].append(chat)
                else:result['failed'].append(chat)
            return result
        bridge.send_important=send
        sys.modules['alert_manager']=manager;sys.modules['alert_bridge']=bridge
        self.observer=module('observer_under_test','monitor_map_observation_bridge.py')
        self.map={'verified_block':100}
        self.now=datetime(2026,10,16,20,tzinfo=timezone.utc)

    def tearDown(self):
        for key,value in self.previous.items():
            if value is None:sys.modules.pop(key,None)
            else:sys.modules[key]=value

    def sender(self,text,chat_id):
        if chat_id in self.fail:return False
        self.messages.append((chat_id,text));return True

    def report(self,amount=40000,block=100):
        return dict(verified_block=block,generated_at='2026-10-16T20:00:00Z',comparison_date='2026-10-15',
                    whale_balance_changes=[dict(address=ADDRESS,change_qtc=amount,label=None)])

    def poll(self,report,node=100,scanner=100):
        return self.observer.process_observation(self.map,report,node,scanner,['1','2'],self.sender,self.now)

    def test_first_report_is_baseline_and_restart_does_not_repeat(self):
        self.poll(self.report())
        self.assertFalse(self.messages)
        self.poll(self.report())
        self.assertFalse(self.messages)
        self.assertTrue(self.state['map_observation_tracker']['initialized'])

    def test_new_balance_change_pushes_with_limits_and_no_height_spam(self):
        self.poll(self.report())
        self.poll(self.report(50000))
        self.assertEqual(len(self.messages),2)
        self.assertIn('does not establish buying, selling or ownership',self.messages[0][1])
        self.assertIn('?wallet='+ADDRESS,self.messages[0][1])
        self.map={'verified_block':101}
        self.poll(self.report(50000,101),node=101,scanner=101)
        self.assertEqual(len(self.messages),2)

    def test_failed_destination_retries_even_when_change_disappears(self):
        self.poll(self.report())
        self.fail={'2'}
        self.poll(self.report(50000))
        self.assertEqual([chat for chat,_ in self.messages],['1'])
        self.fail.clear()
        empty=self.report();empty['whale_balance_changes']=[]
        self.poll(empty)
        self.assertEqual([chat for chat,_ in self.messages],['1','2'])
        self.assertFalse(self.state['map_observation_tracker']['pending'])

    def test_mismatched_report_does_not_initialize_or_alert(self):
        self.poll(self.report(block=99))
        self.assertFalse(self.messages)
        self.assertFalse(self.state.get('map_observation_tracker',{}).get('initialized'))

    def test_lag_push_once_unknown_does_not_recover_then_recovery(self):
        self.poll(self.report(),node=120,scanner=115)
        self.assertEqual(len(self.messages),2)
        self.poll(self.report(),node=125,scanner=120)
        self.assertEqual(len(self.messages),2)
        self.poll(self.report(),node=None,scanner=None)
        self.assertEqual(len(self.messages),2)
        self.poll(self.report(),node=105,scanner=103)
        self.assertEqual(len(self.messages),4)
        self.assertIn('MAP CAUGHT UP',self.messages[-1][1])
        self.poll(self.report(),node=105,scanner=103)
        self.assertEqual(len(self.messages),4)

    def test_threshold_and_inconsistent_heights(self):
        self.poll(self.report(),node=112,scanner=110)
        self.assertFalse(self.messages)
        self.poll(self.report(),node=100,scanner=120)
        self.assertFalse(self.messages)
        self.assertFalse(self.observer._wallet_items(self.report(float('nan'))))
        self.assertFalse(self.observer._wallet_items(self.report(29999)))

    def test_recovery_created_before_restart_is_retried(self):
        self.state['events']['map:freshness']=dict(active=False)
        self.state['events']['map:freshness:recovered']=dict(active=True,message='recovered',delivered=set(),version=1)
        self.poll(self.report())
        self.assertEqual([chat for chat,_ in self.messages],['1','2'])
        self.poll(self.report())
        self.assertEqual(len(self.messages),2)

    def test_poll_reads_only_named_public_data_and_uses_runtime(self):
        self.observer._runtime_state=lambda:(100,100)
        with tempfile.TemporaryDirectory(dir=ROOT) as folder:
            data=Path(folder)
            (data/'map.json').write_text(json.dumps(self.map),encoding='utf-8')
            (data/'observation.json').write_text(json.dumps(self.report()),encoding='utf-8')
            self.observer.poll_map_observations(data,['1'],self.sender)
            self.assertFalse(self.messages)
            self.assertTrue(self.state['map_observation_tracker']['initialized'])

    def test_installer_backups_and_hook_errors_do_not_break_website(self):
        installer=module('map_installer','install-map-observation.py')
        source='def main():\n    result = check_website()\n    return result\n'
        policy='def classify_event(category):\n    rules = {\n        "wallet_movement": "important",\n    }\n    return rules.get(category,"normal")\n'
        with tempfile.TemporaryDirectory(dir=ROOT) as folder:
            target=Path(folder);data=target/'public';data.mkdir()
            for name in ('map.json','observation.json'):(data/name).write_text('{}')
            (target/'node_watch.py').write_text(source)
            (target/'alert_policy.py').write_text(policy)
            backup=installer.install(target,ROOT,data,apply=True)
            self.assertEqual((backup/'node_watch.py').read_text(),source)
            self.assertIsNone(installer.install(target,ROOT,data,apply=True))
            namespace=dict(check_website=lambda:{'ok':True},TELEGRAM_CHAT_ID='1',TELEGRAM_ALERT_CHAT_ID='2',COMMUNITY_CHAT_ID='3',telegram_send=self.sender)
            broken=types.ModuleType('map_observation_bridge')
            def explode(**kwargs):raise ValueError('malformed report')
            broken.poll_map_observations=explode
            sys.modules['map_observation_bridge']=broken
            exec((target/'node_watch.py').read_text(encoding='utf-8'),namespace)
            with contextlib.redirect_stdout(io.StringIO()) as output:
                self.assertEqual(namespace['main'](),{'ok':True})
            self.assertIn('MAP OBSERVER: check failed',output.getvalue())
            rules={};exec((target/'alert_policy.py').read_text(),rules)
            self.assertEqual(rules['classify_event']('map_stale'),'important')


if __name__=='__main__':unittest.main()
