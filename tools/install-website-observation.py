#!/usr/bin/env python3
"""Guarded patch of the inspected website monitor. Never executes the monitor."""
import argparse
import ast
import shutil
from datetime import datetime
from pathlib import Path

IMPORT = 'from website_observation_support import retained_archive_reports, previous_archive_for\n'


def patch(source):
    tree = ast.parse(source)
    if IMPORT.strip() in source:
        return source
    checks = [n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='check_website']
    statuses = [n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='status_text']
    if len(checks)!=1 or len(statuses)!=1:
        raise ValueError('Expected website functions not found; no files changed.')
    lines = source.splitlines(keepends=True)
    edits=[]
    def replace(node,text):
        if node.lineno != node.end_lineno:
            raise ValueError('Unexpected multiline statement; no files changed.')
        original=lines[node.lineno-1]
        indent=original[:len(original)-len(original.lstrip())]
        edits.append((node.lineno-1,node.end_lineno,indent+text+'\n'))
    def target(node,name):
        return isinstance(node,ast.Assign) and len(node.targets)==1 and isinstance(node.targets[0],ast.Name) and node.targets[0].id==name
    matches=[n for n in ast.walk(checks[0]) if target(n,'archive_reports') and isinstance(n.value,ast.List) and not n.value.elts]
    if len(matches)!=1:raise ValueError('Archive report baseline differs; no files changed.')
    replace(matches[0],'archive_reports = retained_archive_reports(old)')
    matches=[n for n in ast.walk(checks[0]) if target(n,'previous_archive') and ast.unparse(n.value)=='archive_index.get(key)']
    if len(matches)!=1:raise ValueError('Archive comparison differs; no files changed.')
    replace(matches[0],'previous_archive = previous_archive_for(key, kind, downloaded, old, archive_index)')
    reports=[n for n in ast.walk(checks[0]) if isinstance(n,ast.Dict) and {'old_sha256','new_sha256','diff_path'}.issubset({k.value for k in n.keys if isinstance(k,ast.Constant)})]
    if len(reports)!=1:raise ValueError('Expected comparison report not found; no files changed.')
    report=reports[0]
    indent=lines[report.lineno][:len(lines[report.lineno])-len(lines[report.lineno].lstrip())]
    edits.append((report.lineno,report.lineno,indent+'"time": now,\n'))
    missing=[n for n in ast.walk(statuses[0]) if isinstance(n,ast.Constant) and n.value=='No code analysis available yet.']
    if len(missing)!=1:raise ValueError('Status text differs; no files changed.')
    line=missing[0].lineno-1
    edits.append((line,line+1,lines[line].replace('No code analysis available yet.','No saved code comparison yet; two archived versions are required.')))
    for start,end,text in sorted(edits,key=lambda item:item[0],reverse=True):
        lines[start:end]=[text]
    updated=IMPORT+''.join(lines)
    compile(updated,'website_watch.py','exec')
    return updated


def install(target,sources,apply=False):
    path=target/'website_watch.py'
    before=path.read_text(encoding='utf-8')
    after=patch(before)
    support=(sources/'website_observation_support.py').read_text(encoding='utf-8')
    helper=target/'website_observation_support.py'
    compile(support,helper.name,'exec')
    if helper.exists() and helper.read_text(encoding='utf-8')!=support:
        raise ValueError('Existing helper differs; no files changed.')
    if before==after and helper.exists():
        print('Website correction already installed.')
        return None
    print('Validated website retention and unambiguous asset pairing.')
    if not apply:
        print('Check only. Add --apply to install.')
        return None
    backup=target/'backups'/('website-observation-'+datetime.now().strftime('%Y%m%d-%H%M%S-%f'))
    backup.mkdir(parents=True)
    shutil.copy2(path,backup/path.name)
    existed=helper.exists()
    if existed:shutil.copy2(helper,backup/helper.name)
    try:
        for destination,text in [(helper,support),(path,after)]:
            temp=destination.with_name(destination.name+'.observation-tmp')
            temp.write_text(text,encoding='utf-8')
            temp.replace(destination)
    except Exception:
        shutil.copy2(backup/path.name,path)
        if existed:shutil.copy2(backup/helper.name,helper)
        elif helper.exists():helper.unlink()
        raise
    print('Backup:',backup)
    print('Website correction installed; service not restarted.')
    return backup


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--target',type=Path,default=Path.home()/'qubitcoin-monitor')
    parser.add_argument('--apply',action='store_true')
    args=parser.parse_args()
    try:install(args.target.resolve(),Path(__file__).resolve().parent,args.apply)
    except (ValueError,OSError,SyntaxError) as exc:raise SystemExit(str(exc))
