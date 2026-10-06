#!/usr/bin/env python3

import json
import subprocess
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

    data = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": "local-qubitcoin-node",
        "block": block,
        "latest_indexed_block": block,
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
