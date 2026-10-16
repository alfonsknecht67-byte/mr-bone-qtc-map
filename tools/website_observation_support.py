"""Preserve saved website evidence and pair only unambiguous asset changes."""


def retained_archive_reports(state):
    reports = state.get('archive_reports', [])
    if not isinstance(reports, list):
        return []
    return [dict(report) for report in reports if isinstance(report, dict)][-20:]


def previous_archive_for(key, kind, downloaded, old, archive_index):
    previous = old.get('fingerprints') or {}
    if not isinstance(previous, dict):
        return archive_index.get(key)
    if key in previous:
        return archive_index.get(key)
    if kind not in ('JS', 'CSS'):
        return archive_index.get(key)
    prefix = kind + ': '
    removed = [name for name in previous if name.startswith(prefix) and name not in downloaded]
    added = [name for name in downloaded if name.startswith(prefix) and name not in previous]
    if len(removed) == len(added) == 1 and added[0] == key:
        return archive_index.get(removed[0])
    # Historical records for a reused filename are not the previous deployment.
    return None
