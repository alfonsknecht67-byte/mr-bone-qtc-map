#!/usr/bin/env python3
"""Back up and hook map observation into the existing five-minute poll."""
import argparse
import ast
import shutil
from datetime import datetime
from pathlib import Path

MARKER='MAP OBSERVER: check failed; will retry'


def patch_node(source,map_data):
    if MARKER in source:return source
    tree=ast.parse(source)
    main=[n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='main']
    if len(main)!=1:raise ValueError('Expected main function not found; no files changed.')
    targets=[n for n in ast.walk(main[0]) if isinstance(n,ast.Assign) and isinstance(n.value,ast.Call)
             and isinstance(n.value.func,ast.Name) and n.value.func.id=='check_website' and not n.value.args and not n.value.keywords]
    if len(targets)!=1:raise ValueError('Expected one website poll; no files changed.')
    target=targets[0]
    lines=source.splitlines(keepends=True)
    line=lines[target.lineno-1]
    indent=line[:len(line)-len(line.lstrip())]
    extra=[
        'try:',
        '    from map_observation_bridge import poll_map_observations',
        '    poll_map_observations(',
        f'        data_dir={str(map_data)!r},',
        '        destinations=[TELEGRAM_CHAT_ID, TELEGRAM_ALERT_CHAT_ID, COMMUNITY_CHAT_ID],',
        '        send_function=telegram_send,',
        '    )',
        'except Exception:',
        f'    print({MARKER!r}, flush=True)',
    ]
    lines.insert(target.lineno-1,''.join(indent+x+'\n' for x in extra))
    updated=''.join(lines)
    compile(updated,'node_watch.py','exec')
    return updated


def patch_policy(source):
    tree=ast.parse(source)
    funcs=[n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='classify_event']
    if len(funcs)!=1:raise ValueError('Expected priority classifier not found; no files changed.')
    rules=[n.value for n in ast.walk(funcs[0]) if isinstance(n,ast.Assign) and isinstance(n.value,ast.Dict)
           and any(isinstance(t,ast.Name) and t.id=='rules' for t in n.targets)]
    if len(rules)!=1:raise ValueError('Expected priority rules not found; no files changed.')
    values={k.value:v.value for k,v in zip(rules[0].keys,rules[0].values) if isinstance(k,ast.Constant) and isinstance(v,ast.Constant)}
    if 'map_stale' in values:
        if values['map_stale']!='important':raise ValueError('Existing map priority differs; no files changed.')
        return source
    lines=source.splitlines(keepends=True)
    index=rules[0].lineno
    indent=lines[index][:len(lines[index])-len(lines[index].lstrip())]
    lines.insert(index,indent+'"map_stale": "important",\n')
    updated=''.join(lines)
    compile(updated,'alert_policy.py','exec')
    return updated


def install(target,sources,map_data,apply=False):
    if not (map_data/'map.json').is_file() or not (map_data/'observation.json').is_file():
        raise ValueError('Public map/report files not found; no files changed.')
    helper=(sources/'monitor_map_observation_bridge.py').read_text(encoding='utf-8')
    replacements={
        'map_observation_bridge.py':helper,
        'alert_policy.py':patch_policy((target/'alert_policy.py').read_text(encoding='utf-8')),
        'node_watch.py':patch_node((target/'node_watch.py').read_text(encoding='utf-8'),map_data),
    }
    current_helper=target/'map_observation_bridge.py'
    if current_helper.exists() and current_helper.read_text(encoding='utf-8')!=helper:
        raise ValueError('Existing map observer differs; no files changed.')
    for name,text in replacements.items():compile(text,name,'exec')
    changes={n:t for n,t in replacements.items() if not (target/n).exists() or (target/n).read_text(encoding='utf-8')!=t}
    if not changes:
        print('Map observation already installed.')
        return None
    print('Validated public map observer and existing five-minute polling hook.')
    if not apply:
        print('Check only. Add --apply to install.')
        return None
    backup=target/'backups'/('map-observation-'+datetime.now().strftime('%Y%m%d-%H%M%S-%f'))
    backup.mkdir(parents=True)
    existing=[]
    for name in changes:
        if (target/name).exists():
            shutil.copy2(target/name,backup/name)
            existing.append(name)
    written=[]
    try:
        for name,text in changes.items():
            temp=target/(name+'.observation-tmp')
            temp.write_text(text,encoding='utf-8')
            temp.replace(target/name)
            written.append(name)
    except Exception:
        for name in written:
            if name in existing:shutil.copy2(backup/name,target/name)
            else:(target/name).unlink()
        raise
    print('Backup:',backup)
    print('Map observation installed; service not restarted. First report is the wallet baseline.')
    return backup


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--target',type=Path,default=Path.home()/'qubitcoin-monitor')
    parser.add_argument('--map-data',type=Path)
    parser.add_argument('--apply',action='store_true')
    args=parser.parse_args()
    sources=Path(__file__).resolve().parent
    data=(args.map_data or sources.parent/'docs/data').resolve()
    try:install(args.target.resolve(),sources,data,args.apply)
    except (OSError,ValueError,SyntaxError) as exc:raise SystemExit(str(exc))
