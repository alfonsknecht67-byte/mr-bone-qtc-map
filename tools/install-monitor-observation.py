#!/usr/bin/env python3
"""Install only against the inspected monitor revision. No services or credentials."""
import argparse
import ast
import hashlib
import shutil
from datetime import datetime
from pathlib import Path

EXPECTED = {
    'alert_github.py': '806f8022558e506aad26e711932711913d81317fc6dd2f9d2a4430bd8fef0d4f',
    'alert_digest_delivery.py': '3b9bd116575eb7eb503fade002ac8e4e1f3146e01190f786d2feed8d5315d8bb',
}


def syntax_hash(source):
    canonical = ast.dump(ast.parse(source)).replace(', type_params=[]', '')
    return hashlib.sha256(canonical.encode()).hexdigest()


def prepare(target, sources):
    replacements = {
        'alert_github.py': (sources/'monitor_alert_github.py').read_text(encoding='utf-8'),
        'alert_digest_delivery.py': (sources/'monitor_alert_digest_delivery.py').read_text(encoding='utf-8'),
        'qubitcoin_observation_details.py': (sources/'monitor_intelligence.py').read_text(encoding='utf-8'),
    }
    node = target/'node_watch.py'
    source = node.read_text(encoding='utf-8')
    tree = ast.parse(source)
    dictionaries = [n for n in ast.walk(tree) if isinstance(n, ast.Dict) and any(
        isinstance(k, ast.Constant) and k.value == 'type' and isinstance(v, ast.Constant) and v.value == 'EVENT'
        for k,v in zip(n.keys,n.values))]
    if len(dictionaries) != 1:
        raise ValueError('Expected exactly one general GitHub EVENT dictionary; no files changed.')
    item = dictionaries[0]
    installed = any(isinstance(k,ast.Constant) and k.value == 'github_event' for k in item.keys)
    if not installed:
        lines = source.splitlines(keepends=True)
        following = lines[item.lineno]
        indent = following[:len(following)-len(following.lstrip())]
        lines.insert(item.lineno, indent + '"github_event": event,\n')
        source = ''.join(lines)
    replacements['node_watch.py'] = source
    for name, expected in EXPECTED.items():
        old = (target/name).read_text(encoding='utf-8')
        if syntax_hash(old) not in (expected, syntax_hash(replacements[name])):
            raise ValueError(name + ': source differs from inspected version; no files changed.')
    helper = target/'qubitcoin_observation_details.py'
    if helper.exists() and syntax_hash(helper.read_text(encoding='utf-8')) != syntax_hash(replacements[helper.name]):
        raise ValueError('Existing observation helper differs; no files changed.')
    for name, text in replacements.items():
        compile(text, name, 'exec')
    return replacements


def install(target, sources, apply=False):
    replacements = prepare(target, sources)
    changes = {name:text for name,text in replacements.items()
               if not (target/name).exists() or (target/name).read_text(encoding='utf-8') != text}
    if not changes:
        print('Already installed. No files changed.')
        return None
    print('Validated:', ', '.join(changes))
    if not apply:
        print('Check only. Add --apply to install with backups.')
        return None
    backup = target/'backups'/('observation-integration-'+datetime.now().strftime('%Y%m%d-%H%M%S-%f'))
    backup.mkdir(parents=True)
    existed = []
    for name in changes:
        if (target/name).exists():
            shutil.copy2(target/name, backup/name)
            existed.append(name)
    written = []
    try:
        for name in sorted(changes, key=lambda n: n != 'qubitcoin_observation_details.py'):
            text = changes[name]
            temp = target/(name+'.observation-tmp')
            temp.write_text(text, encoding='utf-8')
            temp.replace(target/name)
            written.append(name)
    except Exception:
        for name in written:
            if name in existed:
                shutil.copy2(backup/name,target/name)
            else:
                (target/name).unlink()
        raise
    print('Backup:', backup)
    print('Installed. The running service has not been restarted.')
    return backup


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--target', type=Path, default=Path.home()/'qubitcoin-monitor')
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    try:
        install(args.target.resolve(), Path(__file__).resolve().parent, args.apply)
    except (ValueError, OSError, SyntaxError) as exc:
        raise SystemExit(str(exc))
