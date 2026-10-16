# Published node snapshot freshness

The browser checks the published network.json every 30 seconds. It does not query the private node directly. The source is published by the hourly Windows map-refresh task, so a three-minute source-age cutoff was inconsistent with the actual publishing cadence.

The shared network-freshness helper always exposes the observation timestamp and age. It uses publishing_interval_seconds when present and an hourly fallback for existing data. A snapshot is overdue after 1.5 publishing intervals (90 minutes for the hourly task). Missing or implausibly future timestamps remain warnings. Block differences are explicitly relative to the last published node snapshot, not a guaranteed current network tip.

The updater now writes and commits a fresh network-only snapshot even when no new indexed block exists. Scanner/map data remains unchanged on that path. Both refresh paths use one atomic network writer, validate node/scanner/map heights, and declare the publishing interval. Existing Telegram map checks still query the local node and scanner directly every five minutes; their alert thresholds are unchanged.

Validation: shared timing unit tests, existing map UI test, JavaScript and PowerShell syntax checks, and a mocked PowerShell test covering unchanged-height timestamp renewal and publication plus preservation of the previous file on invalid heights. Tests do not query the real node or push to GitHub.

Local activation requires pulling the new tools into the Windows checkout used by MrBoneQtcFundedMapRefresh. GitHub Pages publishes the browser changes separately.
