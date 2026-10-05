#!/usr/bin/env node

/**
 * Convert an approved private scan export into the public Mr. Bone map.
 *
 * Expected private input shape:
 * {
 *   "nodes": [{ "id": "...", "label": "...", "type": "...", "value": 0 }],
 *   "edges": [{ "from": "...", "to": "...", "value": 0, "label": "..." }]
 * }
 *
 * This script deliberately copies only allow-listed public fields.
 * It does not read credentials, RPC configuration, node configuration,
 * Telegram configuration, tax records or arbitrary private metadata.
 */

import fs from "node:fs";

const input = process.argv[2] || "data/raw/approved-scan.json";
const output = process.argv[3] || "data/map.json";

const raw = JSON.parse(fs.readFileSync(input, "utf8"));

const allowedTypes = new Set(["address", "cluster", "exchange"]);

const nodes = Array.isArray(raw.nodes)
  ? raw.nodes
      .filter(n => n && typeof n.id === "string" && allowedTypes.has(n.type))
      .map(n => {
        const node = {
          id: n.id,
          label: typeof n.label === "string" ? n.label : n.id,
          type: n.type
        };

        // Keep only explicitly approved, public on-chain address fields.
        for (const field of ["full_address", "balance", "received", "sent", "tx_count", "size"]) {
          if (typeof n[field] === "string") node[field] = n[field];
          else if (Number.isFinite(n[field])) node[field] = n[field];
        }

        return node;
      })
  : [];

const nodeIds = new Set(nodes.map(n => n.id));

const edges = Array.isArray(raw.edges)
  ? raw.edges
      .filter(e =>
        e &&
        typeof e.from === "string" &&
        typeof e.to === "string" &&
        nodeIds.has(e.from) &&
        nodeIds.has(e.to)
      )
      .map(e => ({
        from: e.from,
        to: e.to,
        value: Number.isFinite(e.value) ? e.value : null,
        label: typeof e.label === "string" ? e.label : null,
        count: Number.isFinite(e.count) ? e.count : null,
        first_block: Number.isSafeInteger(e.first_block) ? e.first_block : null,
        last_block: Number.isSafeInteger(e.last_block) ? e.last_block : null
      }))
  : [];

const publicMap = {
  version: 1,
  generated_at: new Date().toISOString(),
  source: "public-approved-on-chain-data",
  nodes,
  edges
};

fs.writeFileSync(output, JSON.stringify(publicMap, null, 2) + "\n");
console.log(`Wrote ${nodes.length} nodes and ${edges.length} edges to ${output}`);
