"""Public map observations through the existing Telegram event manager."""
import hashlib
import json
import math
import re
import sqlite3
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from alert_bridge import submit_alert, send_important
from alert_manager import load_state, update_state_safely, resolve_event, resolve_with_notification

TRACKER = 'map_observation_tracker'
STALE_KEY = 'map:freshness'


def _update_tracker(callback):
    def change(state):
        return callback(state.setdefault(TRACKER, {}))
    return update_state_safely(change)


def _queue(key):
    def change(tracker):
        keys=tracker.setdefault('pending', [])
        if key not in keys:keys.append(key)
    _update_tracker(change)


def _runtime_state():
    cli=[str(Path.home()/'qubitcoin-source/src/qubitcoin-cli'),
         f'-datadir={Path.home()/"qubitcoin/data"}', f'-conf={Path.home()/"qubitcoin/data/qubitcoin.conf"}',
         'getblockcount']
    # No configuration contents or credentials are read into Python or reports.
    tip=int(subprocess.check_output(cli,text=True,stderr=subprocess.DEVNULL,timeout=20).strip())
    db=Path.home()/'qubitcoin-monitor/data/qubitcoin_monitor.db'
    with sqlite3.connect(db.resolve().as_uri()+'?mode=ro',uri=True,timeout=5) as con:
        scanner=con.execute('SELECT MAX(block_height) FROM chain_index').fetchone()[0]
    return tip,scanner


def _wallet_items(report):
    date=report.get('comparison_date')
    if not isinstance(date,str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}',date):return {}
    result={}
    for change in report.get('whale_balance_changes',[]):
        address=change.get('address')
        amount=change.get('change_qtc')
        if not isinstance(address,str) or not re.fullmatch(r'[A-Za-z0-9]{20,120}',address):continue
        if isinstance(amount,bool) or not isinstance(amount,(int,float)) or not math.isfinite(amount) or abs(amount)<30000:continue
        label=' '.join(str(change.get('label') or 'Unattributed address').split())[:120]
        key=f'map:balance:{address}:{date}'
        signature=hashlib.sha256(json.dumps([address,round(amount,8),date,label],separators=(',',':')).encode()).hexdigest()
        message=(f'🐋 QUBITCOIN — OBSERVED BALANCE CHANGE\n\nAddress: {address}\n'
                 f'Project label: {label}\nChange: {amount:+,.8f} QTC\nCompared with: {date}\n'
                 f'Observed: {report.get("generated_at", "Unknown")}\nMap block: {report["verified_block"]}\n\n'
                 'Balance difference between saved snapshots. This does not establish buying, selling or ownership.\n'
                 f'https://mr-bone-qtc.de/?wallet={address}')
        result[key]=(signature,message)
    return result


def process_observation(map_data, report, node_height, scanner_height, destinations, send_function, now=None):
    now=now or datetime.now(timezone.utc)
    height=map_data.get('verified_block')
    valid_heights=all(isinstance(n,int) and not isinstance(n,bool) and n>=0 for n in (node_height,scanner_height,height))
    if valid_heights and height<=scanner_height<=node_height:
        lag=node_height-height
        existing=load_state().get('events',{}).get(STALE_KEY,{})
        if lag>12:
            if not existing.get('active'):
                resolve_event(STALE_KEY+':recovered')
                submit_alert(STALE_KEY,'map_stale',
                    f'⚠️ QUBITCOIN — MAP BEHIND NODE\n\nNode: {node_height}\nScanner: {scanner_height}\n'
                    f'Published map: {height}\nMap lag: {lag} blocks\nObserved: {now.isoformat(timespec="seconds")}\n\n'
                    'The public map is behind the local node. This does not by itself indicate a network outage.')
            _queue(STALE_KEY)
        elif existing.get('active'):
            if resolve_with_notification(STALE_KEY,
                    f'✅ QUBITCOIN — MAP CAUGHT UP\n\nNode: {node_height}\nScanner: {scanner_height}\n'
                    f'Map: {height}\nLag: {lag} blocks (within the 12-block threshold).\n'
                    f'Observed: {now.isoformat(timespec="seconds")}'):
                _queue(STALE_KEY+':recovered')
        if lag<=12 and load_state().get('events',{}).get(STALE_KEY+':recovered',{}).get('active'):
            # Also resume an acknowledgement created just before a process restart.
            _queue(STALE_KEY+':recovered')

    valid_report=isinstance(report,dict) and isinstance(height,int) and report.get('verified_block')==height
    if valid_report:
        items=_wallet_items(report)
        def baseline(tracker):
            if tracker.get('initialized'):return False
            tracker.update(initialized=True,wallet_signatures={k:v[0] for k,v in items.items()})
            return True
        first=_update_tracker(baseline)
        if first:print(f'MAP OBSERVER: wallet baseline saved at block {height}',flush=True)
        if not first:
            signatures=load_state().get(TRACKER,{}).get('wallet_signatures',{})
            for key,(signature,message) in items.items():
                if signatures.get(key)==signature:continue
                submit_alert(key,'wallet_movement',message)
                def remember(tracker,key=key,signature=signature):
                    tracker.setdefault('wallet_signatures',{})[key]=signature
                    pending=tracker.setdefault('pending',[])
                    if key not in pending:pending.append(key)
                _update_tracker(remember)

    results={}
    keys=list(load_state().get(TRACKER,{}).get('pending',[]))
    for key in keys:
        result=send_important(key,list(dict.fromkeys(str(x) for x in destinations)),send_function)
        results[key]=result
        if not result.get('failed') and not result.get('skipped'):
            def finished(tracker,key=key):
                tracker['pending']=[k for k in tracker.get('pending',[]) if k!=key]
            _update_tracker(finished)
    return results


def poll_map_observations(data_dir,destinations,send_function):
    data_dir=Path(data_dir)
    map_data=json.loads((data_dir/'map.json').read_text(encoding='utf-8-sig'))
    try:
        report=json.loads((data_dir/'observation.json').read_text(encoding='utf-8-sig'))
    except (OSError,ValueError):report=None
    try:
        node_height,scanner_height=_runtime_state()
    except (OSError,ValueError,sqlite3.Error,subprocess.SubprocessError):
        node_height=scanner_height=None
    result=process_observation(map_data,report,node_height,scanner_height,destinations,send_function)
    print(f'MAP OBSERVER: map={map_data.get("verified_block")} node={node_height} scanner={scanner_height}',flush=True)
    return result
