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

The scan discovers addresses present in indexed transaction inputs and
outputs, but the published graph includes only addresses with a positive
current unspent balance. Links are shown only when both endpoints are
currently funded. A refreshed scan includes newly funded addresses and removes
addresses whose balance has reached zero. The address activity view is derived from public connection intervals.
It shows when each aggregated relationship was first and last observed and its
recorded transaction count. The current public dataset does not contain
individual transaction dates or historical balance snapshots, so it cannot
support a daily activity histogram or balance-over-time chart.

The full-map exporter may omit low-value links below its configured aggregate
QTC threshold. The public map build also filters out unfunded addresses and
links that point to them.

## Security rule

Do not put RPC credentials, private keys, API tokens, local filesystem paths, private wallet databases, internal labels, Telegram credentials, or tax records into this file.
