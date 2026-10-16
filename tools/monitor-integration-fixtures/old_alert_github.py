import hashlib
from alert_bridge import submit_alert, send_important
def event_key(alert):
    kind = str(alert.get("type", "UNKNOWN"))
    repo = str(alert.get("repo", ""))
    if kind == "COMMIT":
        identity = alert.get("sha")
    elif kind == "PULL_REQUEST":
        identity = alert.get("number")
    elif kind == "RELEASE":
        identity = alert.get("tag") or alert.get("url")
    elif kind == "BRANCH":
        identity = alert.get("name")
    else:
        identity = alert.get("url") or repo
    raw = f"{kind}|{repo}|{identity}"
    digest = hashlib.sha256(raw.encode()).hexdigest()[:20]
    return f"github:{kind.lower()}:{digest}"
def event_priority_category(alert):
    kind = alert.get("type")
    if kind in ("RELEASE", "NEW_REPOSITORY"):
        return "github_important"
    if kind in ("COMMIT", "PULL_REQUEST") and alert.get("relevant"):
        return "github_important"
    return "github_commit"
def register_github_alert(alert, message):
    key = event_key(alert)
    category = event_priority_category(alert)
    result = submit_alert(key, category, message)
    return key, category, result
