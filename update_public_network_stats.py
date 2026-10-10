#!/usr/bin/env python3

import json
import subprocess
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

REPO = Path.home() / "mr-bone-qtc-map"
OUTPUT = REPO / "docs" / "data" / "network.json"

CLI = Path.home() / "qubitcoin-source" / "src" / "qubitcoin-cli"
DATADIR = Path.home() / "qubitcoin" / "data"
CONF = DATADIR / "qubitcoin.conf"


def rpc(method):
    cmd = [
        str(CLI),
        f"-datadir={DATADIR}",
        f"-conf={CONF}",
        method,
    ]
    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        check=True,
    )
    return json.loads(result.stdout)


def main():
    blockchain = rpc("getblockchaininfo")
    hashrate_result = rpc("getnetworkhashps")
    mempool = rpc("getmempoolinfo")

    block = int(blockchain["blocks"])
    difficulty = float(blockchain["difficulty"])
    hashrate = float(hashrate_result)
    pooledtx = int(mempool["size"])

    try:
        db = Path.home() / "qubitcoin-monitor/data/qubitcoin_monitor.db"
        with sqlite3.connect(f"file:{db.as_posix()}?mode=ro", uri=True, timeout=2) as conn:
            scanner_indexed = int(conn.execute("SELECT COALESCE(MAX(block_height), 0) FROM chain_index").fetchone()[0])
    except (sqlite3.Error, OSError, ValueError):
        scanner_indexed = None

    data = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": "local-qubitcoin-node",
        "block": block,
        "latest_indexed_block": scanner_indexed,
        "scanner_indexed_block": scanner_indexed,
        "difficulty": difficulty,
        "network_hashps": hashrate,
        "tx_count": pooledtx,
        "pooledtx": pooledtx,
    }

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)

    with OUTPUT.open("w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
        f.write("\n")

    print(json.dumps(data, indent=2))


if __name__ == "__main__":
    main()
