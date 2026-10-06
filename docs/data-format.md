# Public map data format

The public map reads `data/map.json`.

Only data explicitly approved for public release belongs here.

## Node

A node may contain:

- `id` — stable public identifier
- `label` — public display label
- `group` — `address`, `cluster`, or `exchange`
- optional public metadata used for visualization

## Edge

An edge represents a public on-chain relationship and may contain:

- `from`
- `to`
- optional public metadata such as transaction count or amount
- `count` — number of transactions represented by this aggregated connection
- `first_block` and `last_block` — observed block interval for the connection

The full address set is built from addresses present in indexed transaction
inputs and outputs. The address activity view is derived from public
connection intervals.
It shows when each aggregated relationship was first and last observed and its
recorded transaction count. The current public dataset does not contain
individual transaction dates or historical balance snapshots, so it cannot
support a daily activity histogram or balance-over-time chart.

The full-map exporter may omit low-value links below its configured aggregate
QTC threshold while retaining every indexed address as a node.

## Security rule

Do not put RPC credentials, private keys, API tokens, local filesystem paths, private wallet databases, internal labels, Telegram credentials, or tax records into this file.
