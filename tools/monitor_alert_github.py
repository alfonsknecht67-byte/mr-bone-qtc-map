"""GitHub event registration through the existing delivery manager."""
import hashlib
import json
import re
from alert_bridge import submit_alert, send_important
from qubitcoin_observation_details import github_observation, github_text, repository_name


def event_key(alert):
    kind = str(alert.get('type', 'UNKNOWN'))
    repo = repository_name(alert.get('repo', ''))
    if kind == 'COMMIT':
        identity = alert.get('sha')
    elif kind == 'PULL_REQUEST':
        identity = alert.get('number')
    elif kind == 'RELEASE':
        identity = alert.get('tag') or alert.get('url')
    elif kind == 'BRANCH':
        identity = alert.get('name')
    elif kind == 'EVENT':
        event = alert.get('github_event') or {}
        identity = event.get('id') or alert.get('event_id')
        if not identity:
            identity = json.dumps({
                'event_type': event.get('type') or alert.get('event_type'),
                'actor': event.get('actor') or alert.get('actor'),
                'timestamp': event.get('created_at') or alert.get('timestamp'),
                'url': alert.get('url'),
                'payload': event.get('payload'),
            }, sort_keys=True, default=str)
    else:
        identity = alert.get('url') or repo
    raw = f'{kind}|{repo}|{identity}'
    return 'github:' + kind.lower() + ':' + hashlib.sha256(raw.encode()).hexdigest()[:20]


def event_priority_category(alert):
    kind = alert.get('type')
    if kind == 'EVENT' and alert.get('github_event'):
        details = github_observation(alert['github_event'])
        return 'github_important' if details['delivery'] == 'push' else 'github_commit'
    if kind in ('RELEASE', 'NEW_REPOSITORY'):
        return 'github_important'
    if kind in ('COMMIT', 'PULL_REQUEST') and alert.get('relevant'):
        return 'github_important'
    return 'github_commit'


def register_github_alert(alert, message):
    alert = dict(alert, repo=repository_name(alert.get('repo', '')))
    if alert.get('type') == 'EVENT' and alert.get('github_event'):
        message = github_text(github_observation(alert['github_event']))
    else:
        # Existing messages already contain absolute times; discard cached age suffixes.
        message = re.sub(r'\s*\(\d+\s+(?:seconds?|minutes?|hours?|days?) ago\)', '', message)
    key = event_key(alert)
    category = event_priority_category(alert)
    result = submit_alert(key, category, message)
    return key, category, result
