import uuid
from datetime import datetime, timezone, timedelta
from alert_manager import update_state_safely
def reserve_digest(chat_id, lease_seconds=120):
    chat_id = str(chat_id)
    def change(state):
        now = datetime.now(timezone.utc)
        leases = state.setdefault("digest_reservations", {})
        old = leases.get(chat_id)
        if old and datetime.fromisoformat(old["expires"]) > now:
            return None
        items = {}
        for key, event in state.get("events", {}).items():
            if not event.get("active"):
                continue
            if event.get("priority") not in ("info", "normal"):
                continue
            version = event.get("version", 1)
            if event.get("digest_delivered_to", {}).get(chat_id) == version:
                continue
            items[key] = {
                "version": version,
                "message": event["message"],
                "count": event.get("count", 1),
            }
        if not items:
            return None
        token = uuid.uuid4().hex
        leases[chat_id] = {
            "token": token,
            "expires": (now + timedelta(seconds=lease_seconds)).isoformat(),
        }
        return {"token": token, "items": items}
    return update_state_safely(change)
def finish_digest(chat_id, token, items, success):
    chat_id = str(chat_id)
    def change(state):
        leases = state.setdefault("digest_reservations", {})
        lease = leases.get(chat_id)
        if not lease or lease.get("token") != token:
            return False
        leases.pop(chat_id, None)
        if not success:
            return False
        for key, item in items.items():
            event = state.get("events", {}).get(key)
            if not event or not event.get("active"):
                continue
            if event.get("version", 1) != item["version"]:
                continue
            if event.get("priority") not in ("info", "normal"):
                continue
            event.setdefault("digest_delivered_to", {})[
                chat_id
            ] = item["version"]
        return True
    return update_state_safely(change)
def deliver_digest(chat_id, send_function):
    reservation = reserve_digest(chat_id)
    if reservation is None:
        return "skipped"
    items = reservation["items"]
    lines = ["📋 QUBITCOIN — EVENT DIGEST", ""]
    for key, item in sorted(items.items()):
        lines.append(
            f"• {key}: {item['message']} (x{item['count']})"
        )
    try:
        success = bool(
            send_function("\n".join(lines), chat_id=str(chat_id))
        )
    except Exception:
        success = False
    confirmed = finish_digest(
        chat_id, reservation["token"], items, success
    )
    return "sent" if success and confirmed else "failed"
