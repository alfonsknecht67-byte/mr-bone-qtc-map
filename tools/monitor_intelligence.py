"""Pure report helpers for the existing monitor. No Telegram or token access.

Integration boundary: pass normalized events to the existing alert manager;
reserve/send/acknowledge through its current delivery implementation.
"""
import hashlib
import json
import re
from datetime import datetime, timezone
from difflib import unified_diff
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin, urlsplit


def repository_name(value):
    if isinstance(value, dict):
        value = value.get('full_name') or value.get('name') or ''
    value = str(value or '').strip().removeprefix('https://github.com/').strip('/')
    pieces = value.split('/')
    if len(pieces) >= 3 and pieces[0] == pieces[1]:
        pieces.pop(0)
    return '/'.join(pieces[:2])


def github_observation(event):
    payload = event.get('payload') or {}
    kind = event.get('type', '')
    repo = repository_name(event.get('repo') or event.get('repository'))
    pr, issue, comment, review = (payload.get(k) or {} for k in ('pull_request', 'issue', 'comment', 'review'))
    item = pr or issue
    number = item.get('number') or payload.get('number')
    action = payload.get('action') or 'observed'
    if kind == 'PullRequestEvent' and action == 'closed':
        action = 'merged' if pr.get('merged') else 'closed without merge'
    elif kind == 'PullRequestReviewEvent':
        action = review.get('state') or action
    actor = event.get('actor') or {}
    if isinstance(actor, dict):
        actor = actor.get('login') or ''
    url = comment.get('html_url') or review.get('html_url') or item.get('html_url') or ('https://github.com/' + repo)
    if not url.startswith('https://github.com/'):
        url = 'https://github.com/' + repo
    relevant = repo.startswith('super-quantum/qubitcoin')
    important = relevant and ((kind == 'PullRequestEvent' and action == 'merged') or kind == 'ReleaseEvent')
    if not number:
        identity = str(event.get('id') or hashlib.sha256(json.dumps(event, sort_keys=True).encode()).hexdigest()[:20])
    else:
        identity = str(number)
    return dict(key=f'github:{repo}:{identity}', event_id=str(event.get('id') or ''),
                repository=repo, actor=actor, type=kind, action=action,
                title=item.get('title') or (payload.get('release') or {}).get('name') or '',
                excerpt=(comment.get('body') or review.get('body') or '')[:600],
                url=url, occurred_at=event.get('created_at'), relevant=relevant,
                delivery='push' if important else 'digest',
                affiliation='unconfirmed' if str(actor).lower() in {'fenrir-15', 'brittojo7n'} else None)


def github_text(observation, now=None):
    now = now or datetime.now(timezone.utc)
    stamp = observation.get('occurred_at') or 'Unknown'
    # Relative ages are computed only during rendering, never stored in event text.
    delayed = ''
    try:
        age = (now - datetime.fromisoformat(stamp.replace('Z', '+00:00'))).total_seconds()
        if age > 3600:
            delayed = '\nDelayed report of an earlier event.'
    except (ValueError, TypeError):
        pass
    affiliation = '\nAffiliation with the official team is unconfirmed.' if observation.get('affiliation') else ''
    return (f"GITHUB · {observation['repository']}\n{observation['type']} · {observation['action']}\n"
            f"{observation['title']}\nActor: {observation['actor']}\nOccurred: {stamp}\n"
            f"Reported: {now.isoformat(timespec='seconds')}{delayed}{affiliation}\n"
            f"{observation.get('excerpt', '')}\n{observation['url']}")


def fold_github(previous, observation):
    """Lifecycle grouping only. Persistence/locking belong to the existing manager."""
    previous = previous or {}
    if previous and previous.get('key') != observation['key']:
        raise ValueError('Cannot combine unrelated GitHub discussions')
    seen = list(previous.get('event_ids', []))
    identity = observation.get('event_id') or hashlib.sha256(json.dumps(observation, sort_keys=True).encode()).hexdigest()
    if identity in seen:
        return previous, False
    seen.append(identity)
    timeline = list(previous.get('timeline', []))
    timeline.append({k: observation.get(k) for k in ('event_id', 'occurred_at', 'type', 'action', 'actor', 'url')})
    # A delayed older comment must not overwrite a later merge as the current state.
    newer = not previous or (observation.get('occurred_at') or '') >= (previous.get('occurred_at') or '')
    result = dict(observation if newer else previous)
    result.update(event_ids=seen, timeline=sorted(timeline, key=lambda e: e.get('occurred_at') or ''))
    return result, True


def freshness_observation(node, scanner, map_height, observed_at, now=None, threshold=12):
    now = now or datetime.now(timezone.utc)
    try:
        age = (now - datetime.fromisoformat(observed_at.replace('Z', '+00:00'))).total_seconds()
        heights = (node, scanner, map_height)
        if not all(isinstance(h, int) and not isinstance(h, bool) and h >= 0 for h in heights):
            raise ValueError('Unknown heights')
        if age < -60 or age > 180 or scanner > node or map_height > scanner:
            raise ValueError('Stale or inconsistent observation')
    except (TypeError, ValueError, AttributeError):
        return dict(key='map:freshness', status='unknown', delivery='digest', reason='Fresh, consistent node/scanner/map data is required.')
    lag = node - map_height
    return dict(key='map:freshness', status='lagging' if lag > threshold else 'healthy',
                delivery='push' if lag > threshold else 'digest', node=node, scanner=scanner,
                map_block=map_height, scanner_lag=node-scanner, map_lag=lag,
                note='Emit only on status transition using the existing alert manager; healthy after lagging is recovery.')


def wallet_observations(report):
    """Normalized candidates for the existing manager; this function sends nothing."""
    if not report.get('comparison_date'):
        return []
    result = []
    for change in report.get('whale_balance_changes', []):
        if abs(change['change_qtc']) < 30000:
            continue
        result.append(dict(key=f"map:balance:{change['address']}:{report['comparison_date']}",
                           delivery='push', type='wallet_balance_change', address=change['address'],
                           label=change.get('label'), change_qtc=change['change_qtc'],
                           verified_block=report['verified_block'], observed_at=report['generated_at'],
                           evidence='Indexed balance difference between saved observations.',
                           interpretation='No claim of buying, selling, exchange ownership or specific coin tracing.'))
    return result


class WebsiteText(HTMLParser):
    def __init__(self, base):
        super().__init__()
        self.base, self.links, self.text, self.hidden = base, set(), [], 0

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag in ('script', 'style'):
            self.hidden += 1
        if tag == 'a' and attrs.get('href'):
            url = urljoin(self.base, attrs['href'])
            if urlsplit(url).scheme in ('http', 'https'):
                self.links.add(url)

    def handle_endtag(self, tag):
        if tag in ('script', 'style'):
            self.hidden = max(0, self.hidden-1)

    def handle_data(self, data):
        text = ' '.join(data.split())
        if not self.hidden and text:
            self.text.append(text)


def website_facts(content, url):
    text = content.decode('utf-8', errors='replace')
    if urlsplit(url).path.endswith(('.js', '.css')):
        links = set(re.findall(r'https?://[^\s\x22\x27<>`\\]+', text))
        strings = set(re.findall(r'[\x22\x27]([^\x22\x27\n]{4,180})[\x22\x27]', text))
        downloads = {s for s in strings if re.search(r'(?i)electrum|wallet|\.exe|\.dmg|\.apk|\.zip|\.AppImage', s)}
        return dict(links=sorted(links), text=[], wallet_strings=sorted(downloads)[:1000])
    parser = WebsiteText(url)
    parser.feed(text)
    return dict(links=sorted(parser.links), text=parser.text, wallet_strings=[])


def archive_website(contents, archive_dir, now=None):
    """Call only after ALL HTML/assets fetches succeed. URL -> original bytes.

    Content-addressed blobs preserve exact evidence. Manifest is committed last.
    A first archive establishes a baseline and never invents historical diffs.
    """
    now = now or datetime.now(timezone.utc)
    root = Path(archive_dir)
    root.mkdir(parents=True, exist_ok=True)
    manifest_path = root / 'latest.json'
    previous = json.loads(manifest_path.read_text()) if manifest_path.exists() else None
    manifest = dict(time=now.isoformat(), files={})
    for url, content in sorted(contents.items()):
        sha = hashlib.sha256(content).hexdigest()
        blob = root / 'blobs' / sha
        blob.parent.mkdir(exist_ok=True)
        if not blob.exists():
            blob.write_bytes(content)
        manifest['files'][url] = dict(sha256=sha, facts=website_facts(content, url))
    changes = []
    if previous:
        for url in sorted(previous['files'].keys() | manifest['files'].keys()):
            old, new = previous['files'].get(url), manifest['files'].get(url)
            if old and new and old['sha256'] == new['sha256']:
                continue
            before, after = (old or {}).get('facts', {}), (new or {}).get('facts', {})
            change = dict(url=url, action='added' if not old else 'removed' if not new else 'changed',
                          before_sha256=(old or {}).get('sha256'), after_sha256=(new or {}).get('sha256'))
            for field in ('links', 'wallet_strings'):
                a, b = set(before.get(field, [])), set(after.get(field, []))
                change[field+'_added'], change[field+'_removed'] = sorted(b-a), sorted(a-b)
            change['text_diff'] = '\n'.join(unified_diff(before.get('text', []), after.get('text', []), lineterm=''))[:12000]
            change['analysis'] = 'Static source comparison; runtime behavior and security are not established.'
            changes.append(change)
    evidence = dict(time=manifest['time'], baseline=previous is None, changes=changes,
                    delivery='push' if any(c['links_added'] or c['links_removed'] or c['wallet_strings_added'] or c['wallet_strings_removed'] for c in changes) else 'digest')
    key = now.strftime('%Y%m%dT%H%M%S%fZ')
    for filename, value in [(root / (key+'.json'), manifest), (root / (key+'-diff.json'), evidence), (manifest_path, manifest)]:
        temp = filename.with_suffix('.tmp')
        temp.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')
        temp.replace(filename)
    return evidence
