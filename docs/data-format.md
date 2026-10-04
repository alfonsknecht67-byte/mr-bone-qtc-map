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

## Security rule

Do not put RPC credentials, private keys, API tokens, local filesystem paths, private wallet databases, internal labels, Telegram credentials, or tax records into this file.
