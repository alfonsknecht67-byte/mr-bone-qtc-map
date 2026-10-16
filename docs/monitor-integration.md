# Monitor integration installer

The installer targets the existing Ubuntu monitor, default ~/qubitcoin-monitor. It never reads environment files, credentials or RPC configuration. It does not restart services or send Telegram messages.

It checks the inspected AST fingerprints of alert_github.py and alert_digest_delivery.py before writing, validates Python syntax, and backs up every existing affected file under the monitor's backups directory. An unknown source revision stops installation without changes. Repeating a successful installation makes no further changes.

It installs rich general GitHub event registration, preserving public GitHub event IDs and payloads in the existing EVENT dictionary. Event IDs distinguish separate events sharing a repository URL. Messages include original absolute times, actor, title, comment excerpt and direct discussion URL. Existing dedicated PR lifecycle handling remains in place.

Daily digests use Europe/Berlin noon and a successful-delivery day per destination. Day and event-version acknowledgements are committed together through the existing update_state_safely transaction. Failed destinations can retry without resending to already acknowledged destinations that day. Concurrent active leases return busy so the scheduler does not mark that attempt complete. Long reports remain within a bounded message length; omitted event versions remain pending for later days.

An external-send/process-crash window still exists between Telegram accepting a message and local acknowledgement. Telegram delivery cannot be guaranteed exactly once across that window. Existing leases and sender behavior are retained. The new daily state applies prospectively; previously sent reports are not reconstructed.

The tests replace manager and sender interfaces with in-memory stubs and write only temporary fixture directories. No Telegram test messages are sent.

Run in Ubuntu:
```bash
repo=/mnt/c/Users/julia/Documents/Codex/mr-bone-qtc-map
python3 -m unittest discover -s "$repo/tools" -p test_monitor_integration.py -v
python3 "$repo/tools/install-monitor-observation.py"
python3 "$repo/tools/install-monitor-observation.py" --apply
```

After successful installation, compile the four changed Python files, then restart only qubitcoin-watch.service and check status/logs. Website code-analysis integration and any relay of map observations into Telegram remain separate work; this installer does not claim to activate those.
