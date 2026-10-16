# Public map alert integration

The installer adds a guarded hook before the existing five-minute website check in node_watch.py and one important-priority rule, map_stale. It installs the adapter as map_observation_bridge.py in the existing monitor. All existing changed files are backed up and syntax-checked. The installer does not restart services.

The adapter reads only map.json and observation.json from this repository's public docs/data directory. It obtains a fresh node block count via the existing CLI configuration and scanner height via read-only SQLite. It does not load RPC credentials or environment files into reports.

The first valid matching map/report pair establishes the wallet baseline without sending historical balance alerts. Later changes of at least 30,000 QTC use the published snapshot comparisons, including addresses emptied since the prior snapshot. Identical change values are not re-alerted solely because a newer map block was published. Existing project labels are identified as labels; no ownership, buying or selling inference is asserted. These are snapshot observations, not real-time transaction monitoring.

A map more than 12 blocks behind the local node opens an important alert. It resolves with a notification when the lag is at most 12 blocks and map/scanner/node heights are consistent. Unknown runtime data never produces an all-clear. This freshness check does not establish the wider network tip or blockchain health.

All messages go through the existing submit_alert/send_important and recovery interfaces. Pending failed destinations are retried at the next poll, including failures for events no longer in the latest report. The existing manager's reservations and version acknowledgements handle delivery. No exactly-once guarantee is made across an external-send/process-crash window.

Nine tests use in-memory manager/sender doubles; they send no Telegram messages. Installation tests operate only on temporary fixtures.

Run in Ubuntu, using the existing map checkout:
```bash
qtc_repo=/mnt/c/Users/julia/Documents/Codex/mr-bone-qtc-map
python3 -m unittest discover -s "$qtc_repo/tools" -p test_map_observation.py -v
python3 "$qtc_repo/tools/install-map-observation.py" --apply
```

Compile node_watch.py, alert_policy.py and map_observation_bridge.py before restarting only qubitcoin-watch.service. The installed hook logs a wallet-baseline message and subsequent node/scanner/map heights. An adapter failure is caught independently so the website check can still run.
