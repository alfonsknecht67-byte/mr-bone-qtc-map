# Observation extension — 16 October 2026

## Implemented

- Public UI separates node, scanner and displayed map height, including stale-data warnings.
- Daily archives contain the latest successful export per UTC day; historical graphs can be selected. Historic small-flow links are excluded and explicitly disclosed.
- Wallet balance comparisons include addresses whose balance became zero. Large changes use a 30,000 QTC threshold and do not imply trades.
- Exchange reports calculate transaction-level net movement across the existing labeled address sets, excluding fully resolved internal transactions. Fees can contribute to negative movement. Labels remain project-maintained attribution, not newly verified exchange ownership.
- Candidate evidence shows observed allocated-flow concentration with its coverage threshold. It does not assign ownership probabilities.
- Recent transaction evidence preserves TXID, height, timestamp, input/output addresses and values. Evidence covers up to 10,000 newest transactions within 30 days; partial windows are marked. Unresolved transactions are excluded from exchange totals and make the affected window incomplete.
- The Windows refresh script invokes the observer after the map build, checks source heights, and stages reports and archives alongside map data.

## Initial data

The initial archive is the existing public map generated on 15 October 2026 at block 112232. It is not a new scanner observation. Initial transaction evidence is unavailable until the local exporter runs. Older observations are not fabricated. New daily snapshots accrue after the updated local refresh script is installed.

## Monitor helpers prepared, integration still required

`tools/monitor_intelligence.py` provides tested report helpers, not a second Telegram bot:

- `github_observation(event)` normalizes repository paths, direct discussion URLs, actor, title, action, review state and merge status. Ordinary activity defaults to digest; relevant merges/releases can push.
- `fold_github(previous, observation)` groups one discussion lifecycle and deduplicates event IDs. Persist this state under the existing manager's lock. Delayed older events do not replace newer merge state.
- `github_text(observation, now)` renders absolute event/report times and marks delayed reports. Do not cache relative ages in digest entries.
- `archive_website(contents, archive_dir)` accepts a complete URL-to-bytes fetch, stores content-addressed original files and manifests, and reports links, wallet/download strings and HTML text diffs. A first archive is only a baseline. Minified-code comparison does not establish runtime behavior or security.
- `freshness_observation(...)` distinguishes healthy, lagging and unknown. Send only state transitions through the existing alert manager; unknown data is not a recovery.

The running WSL monitor source (`node_watch.py`, `alert_github.py`, `website_watch.py`, delivery modules) was inaccessible in this session. These helpers have **not** been connected to the running Telegram service. Existing digest delivery, daily scheduling, locks and retries were not modified or verified. Back up the actual current monitor source before integrating helpers; preserve existing alert-manager reservation and acknowledgement interfaces. Website archive writes must remain in the existing single-writer check path and follow complete asset fetches.

## Local activation boundary

GitHub changes do not automatically update the Windows checkout used by `MrBoneQtcFundedMapRefresh`. That checkout must receive the new tools before its next export. The session could not modify that checkout or access WSL because the environment returned access denied. No task, service, node configuration, RPC credentials or Telegram credentials were changed.

## Checks

From the repository root:

```text
python -m unittest discover -s tools -p test_observation.py -v
node --test tools/test-observation-ui.cjs
node --check docs/app.js
node --check docs/observation.js
python -m py_compile tools/observation.py tools/monitor_intelligence.py
```

The scanner exporter is read-only. The observer writes public data beneath the provided map's directory. A scanner/map height mismatch aborts publication rather than mixing observations.
