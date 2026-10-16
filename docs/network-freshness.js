(function (root) {
  'use strict';
  function snapshotStatus(stats, now = Date.now()) {
    stats = stats || {};
    const interval = Number(stats.publishing_interval_seconds);
    const intervalSeconds = Number.isFinite(interval) && interval >= 30 && interval <= 86400 ? interval : 3600;
    const timestamp = Date.parse(stats.generated_at);
    const ageMs = now - timestamp;
    const validTime = Number.isFinite(timestamp) && ageMs >= -60000;
    const maxAgeMs = intervalSeconds * 1500;
    const ageMinutes = validTime ? Math.max(0, Math.floor(ageMs / 60000)) : null;
    return {
      fresh: validTime && ageMs <= maxAgeMs,
      timestampLabel: Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : 'unavailable',
      ageLabel: validTime ? `${ageMinutes} min old` : Number.isFinite(timestamp) ? 'timestamp is in the future' : 'age unavailable',
      cadenceLabel: `${Math.round(intervalSeconds / 60)} min`,
      warning: !validTime ? 'Node snapshot unavailable or timestamp invalid.' : ageMs > maxAgeMs ? 'Node snapshot is overdue for its publishing interval.' : '',
    };
  }
  root.qtcSnapshotStatus = snapshotStatus;
  if (typeof module !== 'undefined' && module.exports) module.exports = snapshotStatus;
})(typeof window === 'undefined' ? globalThis : window);
