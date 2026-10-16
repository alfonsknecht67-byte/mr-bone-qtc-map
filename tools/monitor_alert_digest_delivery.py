"""One confirmed daily digest per destination, using existing state locks."""
import uuid
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo
from alert_manager import update_state_safely


def _now():
    return datetime.now(timezone.utc)


def reserve_digest(chat_id, lease_seconds=120):
    chat_id = str(chat_id)

    def change(state):
        now = _now()
        local = now.astimezone(ZoneInfo('Europe/Berlin'))
        today = local.date().isoformat()
        if local.hour < 12:
            return None
        if state.get('digest_daily_delivered', {}).get(chat_id) == today:
            return None
        leases = state.setdefault('digest_reservations', {})
        old = leases.get(chat_id)
        if old and datetime.fromisoformat(old['expires']) > now:
            return {'status': 'busy'}
        items = {}
        for key, event in state.get('events', {}).items():
            if not event.get('active') or event.get('priority') not in ('info', 'normal'):
                continue
            version = event.get('version', 1)
            if event.get('digest_delivered_to', {}).get(chat_id) == version:
                continue
            items[key] = dict(version=version, message=event['message'], count=event.get('count', 1))
        if not items:
            leases.pop(chat_id, None)
            return None
        token = uuid.uuid4().hex
        leases[chat_id] = dict(token=token, day=today, expires=(now+timedelta(seconds=lease_seconds)).isoformat())
        return dict(token=token, items=items)
    return update_state_safely(change)


def finish_digest(chat_id, token, items, success):
    chat_id = str(chat_id)

    def change(state):
        leases = state.setdefault('digest_reservations', {})
        lease = leases.get(chat_id)
        if not lease or lease.get('token') != token:
            return False
        leases.pop(chat_id, None)
        if not success:
            return False
        day = lease.get('day') or _now().astimezone(ZoneInfo('Europe/Berlin')).date().isoformat()
        # Day and acknowledged event versions are saved in the same locked transaction.
        state.setdefault('digest_daily_delivered', {})[chat_id] = day
        for key, item in items.items():
            event = state.get('events', {}).get(key)
            if not event or not event.get('active') or event.get('version', 1) != item['version']:
                continue
            if event.get('priority') not in ('info', 'normal'):
                continue
            event.setdefault('digest_delivered_to', {})[chat_id] = item['version']
        return True
    return update_state_safely(change)


def _render(items):
    lines = ['📋 QUBITCOIN — EVENT DIGEST', '']
    selected = {}
    def units(text):
        return len(text.encode('utf-16-le')) // 2
    for key, item in sorted(items.items()):
        text = item['message']
        # Bound single legacy messages too; do not mark omitted items as delivered.
        if units(text) > 3300:
            text = text[:1600] + '\n… [message shortened]'
        entry = '• ' + text
        if units('\n'.join(lines + [entry])) > 3700:
            break
        lines.extend([entry, ''])
        selected[key] = item
    remaining = len(items) - len(selected)
    if remaining:
        lines.append(f'More pending events: {remaining}. Retained for a later daily report.')
    return '\n'.join(lines), selected


def deliver_digest(chat_id, send_function):
    reservation = reserve_digest(chat_id)
    if reservation is None:
        return 'skipped'
    if reservation.get('status') == 'busy':
        return 'busy'
    text, items = _render(reservation['items'])
    try:
        success = bool(send_function(text, chat_id=str(chat_id)))
    except Exception:
        success = False
    confirmed = finish_digest(chat_id, reservation['token'], items, success)
    return 'sent' if success and confirmed else 'failed'
