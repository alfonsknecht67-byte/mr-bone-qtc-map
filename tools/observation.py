#!/usr/bin/env python3
"""Public observations. Scanner DB is always read-only; no RPC or credentials."""
import argparse
import json
import sqlite3
from collections import defaultdict
from datetime import datetime, timezone, timedelta
from decimal import Decimal
from pathlib import Path


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + '.tmp')
    temp.write_text(json.dumps(value, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
    temp.replace(path)


def sat(value):
    return int((Decimal(str(value or 0)) * 100000000).to_integral_value())


def qtc(value):
    return value / 100000000


def summarize_transactions(transactions, groups, cutoff):
    """Net movement per TX across a labeled address set; never sum graph edges."""
    result = {}
    for group, addresses in groups.items():
        incoming = outgoing = internal = count = 0
        for tx in transactions:
            if tx['timestamp'] < cutoff:
                continue
            ins, outs = tx['inputs'], tx['outputs']
            spent = sum(sat(r['amount']) for r in ins if r['address'] in addresses)
            received = sum(sat(r['amount']) for r in outs if r['address'] in addresses)
            if not spent and not received:
                continue
            count += 1
            # A fully resolved transaction staying within the labeled set is internal.
            if ins and tx['inputs_resolved'] and tx['outputs_resolved'] and all(r['address'] in addresses for r in ins + outs):
                internal += 1
                continue
            delta = received - spent
            incoming += max(0, delta)
            outgoing += max(0, -delta)
        result[group] = dict(net_positive_qtc=qtc(incoming), net_negative_qtc=qtc(outgoing),
                             net_qtc=qtc(incoming-outgoing), transactions=count, internal_transactions=internal)
    return result


def read_transactions(db, expected_height, now, limit=10000):
    conn = sqlite3.connect(db.resolve().as_uri() + '?mode=ro', uri=True)
    conn.row_factory = sqlite3.Row
    try:
        conn.execute('BEGIN')
        height = conn.execute('SELECT MAX(block_height) FROM chain_index').fetchone()[0]
        if height != expected_height:
            raise ValueError('Scanner advanced during export; retry a consistent publication.')
        columns = {r['name'] for r in conn.execute('PRAGMA table_info(chain_index)')}
        if 'block_timestamp' not in columns:
            raise ValueError('chain_index.block_timestamp is required for calendar-based flow windows.')
        cutoff = int((now - timedelta(days=30)).timestamp())
        # Fetch limit+1 to disclose incomplete coverage instead of presenting partial totals as complete.
        rows = conn.execute('''SELECT DISTINCT u.txid, u.block_height, b.block_timestamp
            FROM chain_utxos u JOIN chain_index b ON b.block_height=u.block_height
            WHERE b.block_timestamp >= ? ORDER BY u.block_height DESC, u.txid LIMIT ?''', (cutoff, limit+1)).fetchall()
        complete = len(rows) <= limit
        rows = rows[:limit]
        records = {r['txid']: dict(txid=r['txid'], block=r['block_height'], timestamp=int(r['block_timestamp']), inputs=[], outputs=[]) for r in rows}
        keys = list(records)
        for start in range(0, len(keys), 300):
            batch = keys[start:start+300]
            placeholders = ','.join('?' for _ in batch)
            for table, field in [('chain_inputs', 'inputs'), ('chain_utxos', 'outputs')]:
                for r in conn.execute(f'SELECT txid,address,amount FROM {table} WHERE txid IN ({placeholders})', batch):
                    records[r['txid']][field].append(dict(address=r['address'], amount=float(r['amount'] or 0)))
        for tx in records.values():
            tx['inputs_resolved'] = all(r['address'] and r['amount'] > 0 for r in tx['inputs'])
            tx['outputs_resolved'] = all(r['address'] for r in tx['outputs'])
        return list(records.values()), complete
    finally:
        conn.close()


def candidate_evidence(raw, labels):
    """Descriptive support, not an uncalibrated numeric ownership probability."""
    totals = defaultdict(float)
    linked = defaultdict(lambda: defaultdict(float))
    for edge in raw.get('edges', []):
        a, b, value = edge['from'], edge['to'], max(0, edge['value'])
        for address, peer in [(a, b), (b, a)]:
            totals[address] += value
            if peer in labels:
                linked[address][labels[peer]] += value
    output = []
    for address, peers in linked.items():
        if address in labels:
            continue
        group, value = max(peers.items(), key=lambda pair: pair[1])
        share = value / totals[address] if totals[address] else 0
        output.append(dict(address=address, related_label=group, allocated_qtc=round(value, 8),
                           share_of_observed_allocated_flow=round(share, 4),
                           assessment='connection observed; ownership unconfirmed'))
    return sorted(output, key=lambda r: -r['allocated_qtc'])[:100]


def build(raw_path, map_path, db=None, now=None):
    now = now or datetime.now(timezone.utc)
    raw = json.loads(raw_path.read_text(encoding='utf-8-sig'))
    current = json.loads(map_path.read_text(encoding='utf-8-sig'))
    if raw['verified_block'] != current['verified_block']:
        raise ValueError('Raw/public snapshot mismatch')
    base = map_path.parent
    registry = Path(__file__).resolve().parents[1] / 'data/verified-exchange-wallets.json'
    labels = json.loads(registry.read_text(encoding='utf-8'))
    groups = defaultdict(set)
    for address, label in labels.items():
        groups[label].add(address)
    # Chain balances include zero-balance addresses, enabling honest disappearance comparisons.
    balances = {n['id']: n['balance'] for n in raw['nodes']}
    day = datetime.fromisoformat(current['generated_at'].replace('Z', '+00:00')).astimezone(timezone.utc).date().isoformat()
    snapshot = dict(current)
    snapshot['balances'] = balances
    snapshot['small_flows'] = None
    snapshot['snapshot_scope'] = 'Funded graph, >=1000 QTC links; balances include all indexed addresses.'
    history_path = base / 'history/index.json'
    history = json.loads(history_path.read_text()) if history_path.exists() else {'snapshots': []}
    entries = [e for e in history['snapshots'] if e['date'] != day]
    entries.append(dict(date=day, generated_at=current['generated_at'], block=current['verified_block'], file=f'data/history/{day}.json'))
    entries.sort(key=lambda e: e['date'], reverse=True)
    history = dict(snapshots=entries, policy='Latest successful snapshot per UTC day. No reconstructed past observations.')
    changes = []
    previous = next((e for e in entries if e['date'] < day), None)
    if previous:
        older = json.loads((base / 'history' / (previous['date'] + '.json')).read_text())
        before = older['balances']
        for address in balances.keys() | before.keys():
            delta = sat(balances.get(address, 0)) - sat(before.get(address, 0))
            if abs(delta) >= 30000 * 100000000:
                changes.append(dict(address=address, change_qtc=qtc(delta), label=labels.get(address),
                                    interpretation='Balance change between snapshots; not evidence of buying or selling.'))
        changes.sort(key=lambda x: -abs(x['change_qtc']))
    report = dict(version=1, generated_at=now.isoformat(), verified_block=current['verified_block'],
                  comparison_date=previous['date'] if previous else None, whale_balance_changes=changes[:100],
                  exchange_candidates=candidate_evidence(raw, labels), exchange_windows={},
                  attribution_notice='Exchange labels are maintained project labels. Connections and flow concentration do not verify ownership.',
                  flow_notice='Net positive/negative transaction movement across each labeled address set. Fees may contribute to net negative movement; internal transactions are excluded. Deposits do not prove selling.',
                  candidate_scope=dict(minimum_allocated_flow_qtc=raw.get('graph_scope', {}).get('minimum_edge_qtc'),
                                       notice='Concentration uses only exported graph flows; it is not transaction ownership probability.'),
                  transaction_coverage=None, error=None)
    evidence = dict(verified_block=current['verified_block'], transactions=[], coverage=None)
    if db:
        # Fail the build on inconsistent source data; never publish mismatched evidence.
        transactions, complete = read_transactions(db, current['verified_block'], now)
        coverage = dict(window_days=30, complete=complete, limit=10000, count=len(transactions),
                        oldest_timestamp=min((tx['timestamp'] for tx in transactions), default=None))
        report['transaction_coverage'] = coverage
        evidence.update(transactions=transactions, coverage=coverage)
        for days in (1, 7, 30):
            cutoff = int((now - timedelta(days=days)).timestamp())
            unresolved = sum(1 for t in transactions if t['timestamp'] >= cutoff and not (t['inputs_resolved'] and t['outputs_resolved']))
            covered = (complete or bool(transactions and min(t['timestamp'] for t in transactions) < cutoff)) and unresolved == 0
            report['exchange_windows'][str(days)] = dict(complete=covered, unresolved_transactions=unresolved,
                groups=summarize_transactions([t for t in transactions if t['inputs_resolved'] and t['outputs_resolved']], groups, cutoff))
    else:
        report['error'] = 'Transaction evidence awaits a successful local scanner export.'
    write_json(base / 'history' / (day + '.json'), snapshot)
    write_json(history_path, history)
    write_json(base / 'observation.json', report)
    write_json(base / 'transactions.json', evidence)
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('raw', type=Path)
    parser.add_argument('map', type=Path)
    parser.add_argument('--db', type=Path)
    args = parser.parse_args()
    report = build(args.raw, args.map, args.db)
    print('Observation saved through block', report['verified_block'])
