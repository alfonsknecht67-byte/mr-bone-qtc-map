# Mr. Bone — QTC Bubble Map

Public-facing Bubble Map project for visualizing publicly available on-chain information around the Mr. Bone QTC ecosystem.

## Purpose

This repository contains only the components intended for public presentation of the map.

It is deliberately separated from private infrastructure and monitoring projects.

## Security boundary

This public repository must **not** contain:

- private wallet databases or private wallet lists
- RPC credentials or API keys
- node configuration files
- Telegram bot tokens
- private monitoring scripts
- personal or tax-related records
- other secrets or credentials

Private scanning, node and monitoring infrastructure remains outside this repository.

## Project structure

- `public/` — browser-facing map application
- `docs/` — public project documentation
- `data/` — placeholder for data that is explicitly approved for public release

## Status

Initial public project scaffold. The actual Bubble Map will be added after the public/private data boundary has been checked.

## Disclaimer

The map is an informational visualization of on-chain data. Addresses and labels shown by the project should not automatically be interpreted as verified ownership or identity.
