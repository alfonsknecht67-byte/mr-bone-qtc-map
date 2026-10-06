#!/usr/bin/env python3
"""Export every indexed Qubitcoin address and its aggregated public flows.

Reads the local scanner SQLite database in read-only mode. Output contains only
public on-chain address and transaction aggregates; credentials and local paths
are never copied into the export.

Usage:
  python3 tools/export-full-map.py DB_PATH OUTPUT_JSON [MIN_EDGE_QTC]
"""

from __future__ import annotations

import json
import sqlite3
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path


def chunks(values: list[str], size: int):
    for start in range(0, len(values), size):
        yield values[start:start + size]


def main() -> None:
    if len(sys.argv) < 3:
        raise SystemExit(
            "Usage: export-full-map.py DB_PATH OUTPUT_JSON [MIN_EDGE_QTC]"
        )

    db_path = Path(sys.argv[1]).expanduser().resolve()
    output_path = Path(sys.argv[2]).expanduser()
    min_edge_qtc = float(sys.argv[3]) if len(sys.argv) > 3 else 1000.0
    if min_edge_qtc < 0:
        raise SystemExit("MIN_EDGE_QTC must be zero or greater")
    if not db_path.is_file():
        raise SystemExit(f"Database not found: {db_path}")

    # URI mode=ro protects the source DB; the exporter writes only to SQLite's
    # temporary database while aggregating graph edges.
    conn = sqlite3.connect(f"file:{db_path.as_posix()}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row

    required = {
        "chain_utxos": {"txid", "address", "amount", "spent", "block_height"},
        "chain_inputs": {"txid", "address", "amount"},
        "chain_index": {"block_height"},
    }
    for table, wanted in required.items():
        columns = {
            row["name"]
            for row in conn.execute(f'PRAGMA table_info("{table}")')
        }
        missing = wanted - columns
        if missing:
            conn.close()
            raise SystemExit(
                f"Unexpected database schema in {table}; missing: {', '.join(sorted(missing))}"
            )

    print("Reading all addresses and UTXO totals ...", flush=True)
    address_stats: dict[str, dict[str, float]] = {}
    for row in conn.execute("""
        SELECT address,
               SUM(CASE WHEN spent = 0 THEN amount ELSE 0 END) AS balance,
               SUM(amount) AS received
        FROM chain_utxos
        WHERE address IS NOT NULL AND address <> ''
        GROUP BY address
    """):
        address_stats[row["address"]] = {
            "balance": float(row["balance"] or 0),
            "received": float(row["received"] or 0),
            "sent": 0.0,
            "tx_count": 0,
        }

    print("Adding every input address and sent totals ...", flush=True)
    for row in conn.execute("""
        SELECT address, SUM(amount) AS sent
        FROM chain_inputs
        WHERE address IS NOT NULL AND address <> ''
        GROUP BY address
    """):
        stats = address_stats.setdefault(row["address"], {
            "balance": 0.0, "received": 0.0, "sent": 0.0, "tx_count": 0,
        })
        stats["sent"] = float(row["sent"] or 0)

    print(f"Wallet/address nodes: {len(address_stats):,}", flush=True)

    print("Calculating distinct transaction counts ...", flush=True)
    for row in conn.execute("""
        SELECT address, COUNT(*) AS tx_count
        FROM (
            SELECT address, txid FROM chain_utxos
            WHERE address IS NOT NULL AND address <> ''
            UNION
            SELECT address, txid FROM chain_inputs
            WHERE address IS NOT NULL AND address <> ''
        )
        GROUP BY address
    """):
        address_stats[row["address"]]["tx_count"] = int(row["tx_count"] or 0)

    nodes = []
    for address, stats in sorted(
        address_stats.items(),
        key=lambda item: (-item[1]["balance"], -item[1]["received"], item[0]),
    ):
        nodes.append({
            "id": address,
            "label": address[:12] + "…",
            "full_address": address,
            "type": "address",
            "balance": round(stats["balance"], 8),
            "received": round(stats["received"], 8),
            "sent": round(stats["sent"], 8),
            "tx_count": stats["tx_count"],
            "size": 8,
        })

    print("Creating temporary edge accumulator ...", flush=True)
    conn.execute("""
        CREATE TEMP TABLE edge_totals (
            from_address TEXT NOT NULL,
            to_address TEXT NOT NULL,
            value REAL NOT NULL,
            count INTEGER NOT NULL,
            first_block INTEGER,
            last_block INTEGER,
            PRIMARY KEY (from_address, to_address)
        ) WITHOUT ROWID
    """)

    txids = [row[0] for row in conn.execute("""
        SELECT txid FROM chain_inputs
        WHERE txid IS NOT NULL AND address IS NOT NULL AND address <> ''
        UNION
        SELECT txid FROM chain_utxos
        WHERE txid IS NOT NULL AND address IS NOT NULL AND address <> ''
    """)]
    print(f"Transactions to inspect: {len(txids):,}", flush=True)

    upsert = """
        INSERT INTO edge_totals
            (from_address, to_address, value, count, first_block, last_block)
        VALUES (?, ?, ?, 1, ?, ?)
        ON CONFLICT(from_address, to_address) DO UPDATE SET
            value = edge_totals.value + excluded.value,
            count = edge_totals.count + 1,
            first_block = CASE
                WHEN edge_totals.first_block IS NULL THEN excluded.first_block
                WHEN excluded.first_block IS NULL THEN edge_totals.first_block
                ELSE MIN(edge_totals.first_block, excluded.first_block)
            END,
            last_block = CASE
                WHEN edge_totals.last_block IS NULL THEN excluded.last_block
                WHEN excluded.last_block IS NULL THEN edge_totals.last_block
                ELSE MAX(edge_totals.last_block, excluded.last_block)
            END
    """

    for batch_number, batch in enumerate(chunks(txids, 300), start=1):
        placeholders = ",".join("?" for _ in batch)
        inputs = conn.execute(
            f"""
            SELECT txid, address, amount
            FROM chain_inputs
            WHERE txid IN ({placeholders})
              AND address IS NOT NULL AND address <> '' AND amount > 0
            """,
            batch,
        ).fetchall()
        outputs = conn.execute(
            f"""
            SELECT txid, address, amount, block_height
            FROM chain_utxos
            WHERE txid IN ({placeholders})
              AND address IS NOT NULL AND address <> '' AND amount > 0
            """,
            batch,
        ).fetchall()

        inputs_by_tx: dict[str, list[sqlite3.Row]] = defaultdict(list)
        outputs_by_tx: dict[str, list[sqlite3.Row]] = defaultdict(list)
        for row in inputs:
            inputs_by_tx[row["txid"]].append(row)
        for row in outputs:
            outputs_by_tx[row["txid"]].append(row)

        tx_edge_rows = []
        for txid in batch:
            tx_inputs = inputs_by_tx.get(txid, [])
            tx_outputs = outputs_by_tx.get(txid, [])
            total_output = sum(float(row["amount"] or 0) for row in tx_outputs)
            if total_output <= 0:
                continue

            # Coalesce a pair within this transaction so count means distinct TXs.
            pair_values: dict[tuple[str, str], float] = defaultdict(float)
            block_values = [row["block_height"] for row in tx_outputs if row["block_height"] is not None]
            block_height = min(block_values) if block_values else None

            for tx_input in tx_inputs:
                from_address = tx_input["address"]
                input_amount = float(tx_input["amount"] or 0)
                for tx_output in tx_outputs:
                    to_address = tx_output["address"]
                    if from_address == to_address:
                        continue
                    flow = input_amount * float(tx_output["amount"] or 0) / total_output
                    pair_values[(from_address, to_address)] += flow

            for (from_address, to_address), value in pair_values.items():
                tx_edge_rows.append((from_address, to_address, value, block_height, block_height))

        if tx_edge_rows:
            conn.executemany(upsert, tx_edge_rows)

        if batch_number % 100 == 0:
            print(f"Processed transaction batches: {batch_number:,}", flush=True)

    edges = [dict(row) for row in conn.execute("""
        SELECT from_address AS "from",
               to_address AS "to",
               ROUND(value, 8) AS value,
               count,
               first_block,
               last_block
        FROM edge_totals
        WHERE value >= ?
        ORDER BY value DESC
    """, (min_edge_qtc,))]

    indexed_row = conn.execute(
        "SELECT MAX(block_height) AS height FROM chain_index"
    ).fetchone()
    indexed_block = int(indexed_row["height"] or 0)
    active_wallets = sum(1 for stats in address_stats.values() if stats["balance"] > 0)
    total_utxo = sum(stats["balance"] for stats in address_stats.values())

    data = {
        "version": 5,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": "public-approved-on-chain-data",
        "attribution": "Mr. Bone",
        "verified_block": indexed_block,
        "balance_definition": {
            "field": "balance",
            "source": "chain_utxos",
            "rule": "SUM(amount) WHERE spent = 0 GROUP BY address",
            "verified_against_node": True,
            "verified_block": indexed_block,
        },
        "heuristic_notice": (
            "Connections are heuristically reconstructed by allocating each input "
            "across a transaction's outputs in proportion to output value. A link "
            "does not prove ownership or direct transfer attribution."
        ),
        "graph_scope": {
            "visualized_nodes": len(nodes),
            "visualized_edges": len(edges),
            "minimum_edge_qtc": min_edge_qtc,
            "note": (
                "Every address found in indexed inputs or outputs is included. "
                "Links below the configured aggregate QTC threshold are omitted."
            ),
        },
        "live_stats": {
            "known_addresses": len(nodes),
            "active_wallets": active_wallets,
            "total_utxo_qtc": round(total_utxo, 8),
            "latest_indexed_block": indexed_block,
        },
        "nodes": nodes,
        "edges": edges,
    }

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    conn.close()

    print("========== FULL MAP EXPORT COMPLETE ==========")
    print(f"Indexed block: {indexed_block:,}")
    print(f"Addresses: {len(nodes):,}")
    print(f"Funded addresses: {active_wallets:,}")
    print(f"Aggregated links (>= {min_edge_qtc:g} QTC): {len(edges):,}")
    print(f"Export size: {output_path.stat().st_size:,} bytes")
    print(f"Export: {output_path}")


if __name__ == "__main__":
    main()
