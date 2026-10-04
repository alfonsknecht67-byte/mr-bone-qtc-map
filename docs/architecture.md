# Public Architecture

## Public layer

The `public/` directory contains the browser-facing Bubble Map.

## Private layer

Scanning, wallet discovery, node access, credentials and internal monitoring remain outside this repository.

## Data release rule

Only data explicitly classified as safe for public release may be copied into `data/`.

Before adding a dataset, check that it contains no credentials, private metadata, personal information or internal infrastructure details.
