const mobileViewButton = document.getElementById("mobile-view");
const desktopViewButton = document.getElementById("desktop-view");
const savedLayout = localStorage.getItem("qtc-map-layout");
const mobileLayoutQuery = window.matchMedia("(max-width: 700px)");
let hasManualLayout = Boolean(savedLayout);

function setPageLayout(isMobile, persist = true) {
  document.body.classList.toggle("mobile-view", isMobile);
  mobileViewButton?.setAttribute("aria-pressed", String(isMobile));
  desktopViewButton?.setAttribute("aria-pressed", String(!isMobile));
  if (persist) {
    hasManualLayout = true;
    localStorage.setItem("qtc-map-layout", isMobile ? "mobile" : "desktop");
  }
  requestAnimationFrame(() => {
    network?.setSize("100%", "100%");
    network?.redraw();
  });
}

mobileViewButton?.addEventListener("click", () => setPageLayout(true));
desktopViewButton?.addEventListener("click", () => setPageLayout(false));
setPageLayout(savedLayout ? savedLayout === "mobile" : mobileLayoutQuery.matches, false);
mobileLayoutQuery.addEventListener("change", event => {
  if (!hasManualLayout) setPageLayout(event.matches, false);
});
const statusEl = document.getElementById("status");
const edgeCountEl = document.getElementById("edge-count");
const detailsEl = document.getElementById("details");
const datasetInfoEl = document.getElementById("dataset-info");
const searchEl = document.getElementById("search");
const addressActivityEl = document.getElementById("address-activity");

const analysisStatsEl = document.getElementById("analysis-stats");

const tickerKnownEl = document.getElementById("ticker-known");
const tickerFundedEl = document.getElementById("ticker-funded");
const tickerSupplyEl = document.getElementById("ticker-supply");
const clusterInfoEl = document.getElementById("cluster-info");

const liveBlockEl = document.getElementById("live-block");
const liveDifficultyEl = document.getElementById("live-difficulty");
const liveHashrateEl = document.getElementById("live-hashrate");
const liveIndexedEl = document.getElementById("live-indexed");
const liveTxEl = document.getElementById("live-tx");
const liveDataStatusEl = document.getElementById("live-data-status");
const circulatingSupplyEl = document.getElementById("circulating-supply");
const emissionRewardEl = document.getElementById("emission-reward");
const emissionPhaseEl = document.getElementById("emission-phase");
const emissionNoteEl = document.getElementById("emission-note");
const emissionRows = document.querySelectorAll("#emission-table-body tr[data-phase]");

const QTC_HALVING_INTERVAL = 210000;
const QTC_INITIAL_BLOCK_REWARD = 50;
const QTC_SATOSHIS = 100000000;
let indexedBlockHeight = null;

function formatQtc(value) {
  return Number(value).toLocaleString("en-US", { maximumFractionDigits: 8 }) + " QTC";
}

function updateEmissionDisplay(blockHeight) {
  if (!Number.isFinite(blockHeight) || blockHeight < 0) return;

  const phase = Math.floor(blockHeight / QTC_HALVING_INTERVAL);
  const reward = QTC_INITIAL_BLOCK_REWARD / (2 ** phase);
  const nextHalving = (phase + 1) * QTC_HALVING_INTERVAL;
  indexedBlockHeight = blockHeight;
  if (emissionRewardEl) emissionRewardEl.textContent = `${formatQtc(reward)} / block`;
  if (emissionPhaseEl) emissionPhaseEl.textContent = `Phase ${phase}`;
  if (emissionNoteEl) emissionNoteEl.textContent =
    `Block #${blockHeight.toLocaleString("en-US")} · ${Math.max(0, nextHalving - blockHeight).toLocaleString("en-US")} blocks until next halving`;
  emissionRows.forEach(row => row.classList.toggle("is-current-phase", Number(row.dataset.phase) === Math.min(phase, 10)));
  updateSupplyMetrics();
}

function estimateCirculatingSupply(blockHeight) {
  let blocksRemaining = blockHeight + 1;
  let issuedSatoshis = 0;

  for (let phase = 0; blocksRemaining > 0; phase++) {
    const blocksInPhase = Math.min(blocksRemaining, QTC_HALVING_INTERVAL);
    const rewardSatoshis = Math.floor((QTC_INITIAL_BLOCK_REWARD * QTC_SATOSHIS) / (2 ** phase));
    issuedSatoshis += blocksInPhase * rewardSatoshis;
    blocksRemaining -= blocksInPhase;
    if (phase >= 63 || rewardSatoshis === 0) break;
  }

  // The genesis coinbase is provably unspendable, so exclude its 50 QTC reward.
  return Math.max(0, (issuedSatoshis - QTC_INITIAL_BLOCK_REWARD * QTC_SATOSHIS) / QTC_SATOSHIS);
}

function updateSupplyMetrics() {
  if (!Number.isFinite(indexedBlockHeight)) return;
  const circulating = estimateCirculatingSupply(indexedBlockHeight);
  if (circulatingSupplyEl) circulatingSupplyEl.textContent = `${formatQtc(circulating)}`;
}

let networkStats = null;

function updateBlockTicker(data) {
  const stats = { ...(data.live_stats || {}), ...(networkStats || {}) };

  const indexed = Number(stats.latest_indexed_block || stats.block || data.verified_block || data.balance_definition?.verified_block || 0);
  const difficulty = Number(stats.difficulty || data.difficulty || 0);
  const hashrate = Number(stats.network_hashrate || stats.network_hashps || data.network_hashrate || 0);
  const txCount = Number(stats.latest_block_tx_count || stats.latest_block_transactions || stats.tx_count || 0);

  updateEmissionDisplay(indexed);

  if (liveBlockEl) liveBlockEl.textContent = indexed ? "#" + indexed.toLocaleString("en-US") : "—";
  if (liveDifficultyEl) liveDifficultyEl.textContent = difficulty ? difficulty.toLocaleString("en-US", { maximumFractionDigits: 2 }) : "—";
  if (liveHashrateEl) liveHashrateEl.textContent = hashrate ? formatHashrate(hashrate) : "—";
  const mapBlock = Number(data.verified_block || data.balance_definition?.verified_block || data.live_stats?.latest_indexed_block || 0);
  if (liveIndexedEl) {
    liveIndexedEl.textContent = mapBlock ? mapBlock.toLocaleString("en-US") : "—";
    liveIndexedEl.title = "Map snapshot block; network height is shown separately";
  }
  if (liveTxEl) liveTxEl.textContent = txCount ? txCount.toLocaleString("en-US") : "—";

  if (liveDataStatusEl) {
    liveDataStatusEl.textContent = networkStats ? "NODE" : "SNAPSHOT";
    liveDataStatusEl.title = networkStats?.generated_at ? "Node stats updated: " + networkStats.generated_at : "Public dataset snapshot";
  }
}

function formatHashrate(value) {
  if (!Number.isFinite(value) || value <= 0) return "—";
  const units = ["H/s", "kH/s", "MH/s", "GH/s", "TH/s", "PH/s", "EH/s"];
  let v = value;
  let i = 0;
  while (v >= 1000 && i < units.length - 1) { v /= 1000; i++; }
  return v.toLocaleString("en-US", { maximumFractionDigits: 2 }) + " " + units[i];
}

async function loadNetworkStats() {
  try {
    const response = await fetch("data/network.json?ts=" + Date.now(), { cache: "no-store" });
    if (!response.ok) throw new Error("HTTP " + response.status);
    networkStats = await response.json();
    if (window.currentMapData) updateBlockTicker(window.currentMapData);
    const updated = document.getElementById("network-updated");
    if (updated) updated.textContent = "Network updated: " + (networkStats.generated_at || "Unavailable");
  } catch (error) {
    networkStats = null;
  }
}

let network = null;
let nodeData = [];
let nodeById = new Map();
let adjacentEdges = new Map();
window.currentMapData = null;
let edgeData = [];
let nodes = null;
let edges = null;

let physicsEnabled = true;
let whaleMode = false;
let neighborhoodMode = false;
let selectedNode = null;
let neighborhoodSnapshot = null;

function restoreOverview() {
  if (!neighborhoodSnapshot) return;
  nodes.update(neighborhoodSnapshot.nodes);
  edges.update(neighborhoodSnapshot.edges);
  physicsEnabled = neighborhoodSnapshot.physics;
  network.setOptions({ physics: { enabled: physicsEnabled } });
  document.getElementById("physics").textContent = physicsEnabled ? "Physics: On" : "Physics: Off";
  neighborhoodSnapshot = null;
  neighborhoodMode = false;
  document.getElementById("neighborhood").textContent = "Show Neighborhood";
}


const WHALE_THRESHOLD = 30000;

function updateWalletTicker(data) {
  const stats = data.live_stats || {};

  if (tickerKnownEl) {
    tickerKnownEl.textContent =
      Number(stats.known_addresses || 0).toLocaleString("en-US");
  }

  if (tickerFundedEl) {
    tickerFundedEl.textContent =
      Number(stats.active_wallets || stats.utxo_addresses || 0)
        .toLocaleString("en-US");
  }

  if (tickerSupplyEl) {
    tickerSupplyEl.textContent =
      Number(stats.total_utxo_qtc || 0).toLocaleString("en-US") + " QTC";
  }

}

function number(value) {
  return Number.isFinite(Number(value))
    ? Number(value).toLocaleString(undefined, {
        maximumFractionDigits: 6
      })
    : "—";
}

function rawNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>\"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  })[character]);
}

function nodeSize(n) {
  const balance = Math.abs(rawNumber(n.balance));

  if (balance >= 1000000) return 52;
  if (balance >= 500000) return 42;
  if (balance >= 100000) return 32;
  if (balance >= 50000) return 25;
  if (balance >= 30000) return 20;
  if (balance >= 10000) return 17;

  return 13;
}

function buildNodes(data) {
  return data.nodes.map(n => {
    const isExchange = n.type === "exchange" || n.group === "exchange" ||
      n.label === "CoinEx Exchange Wallet" ||
      n.label === "SafeTrade Exchange Wallet";

    return {
      ...n,
      label: n.label || n.id,
      group: isExchange ? "exchange" : undefined,
      title:
        `<b>${n.label || n.full_address || n.id}</b><br>` +
        `${n.full_address || n.id}<br>` +
        `Balance: ${number(n.balance)} QTC<br>` +
        `Received: ${number(n.received)} QTC<br>` +
        `Sent: ${number(n.sent)} QTC<br>` +
        `Transactions: ${number(n.tx_count)}`,
      size: isExchange
        ? Math.max(nodeSize(n), 20)
        : nodeSize(n),
      borderWidth: isExchange ? 4 : 2,
      color: isExchange
        ? {
            background: "#f2c94c",
            border: "#fff1a8",
            highlight: {
              background: "#ffe082",
              border: "#ffffff"
            },
            hover: {
              background: "#ffd54f",
              border: "#ffffff"
            }
          }
        : undefined,
      shadow: isExchange
        ? {
            enabled: true,
            color: "rgba(242, 201, 76, 0.85)",
            size: 22,
            x: 0,
            y: 0
          }
        : undefined,
      font: isExchange
        ? {
            color: "#ffffff",
            size: 13,
            face: "Inter",
            strokeWidth: 3,
            strokeColor: "#000000"
          }
        : undefined
    };
  });
}

function buildEdges(data) {
  return data.edges.map((e, i) => ({
    ...e,
    id: `edge-${i}`,
    title:
      `<b>On-chain relationship</b><br>` +
      `Value: ${number(e.value)} QTC<br>` +
      `Transactions: ${number(e.count)}<br>` +
      `First block: ${e.first_block ?? "—"}<br>` +
      `Last block: ${e.last_block ?? "—"}`
  }));
}

function showNode(id) {
  const n = nodeById.get(id);

  if (!n) {
    detailsEl.textContent = "Address not found.";
    return;
  }

  detailsEl.innerHTML =
    `<div class="address">${escapeHtml(n.full_address || n.id)}</div>` +
    `<dl>` +
    `<dt>Balance</dt><dd>${number(n.balance)} QTC</dd>` +
    `<dt>Received</dt><dd>${number(n.received)} QTC</dd>` +
    `<dt>Sent</dt><dd>${number(n.sent)} QTC</dd>` +
    `<dt>Transactions</dt><dd>${number(n.tx_count)}</dd>` +
    `<dt>Map size</dt><dd>${n.size ?? "—"}</dd>` +
    `</dl>`;

  showAddressActivity(n);
}

function showAddressActivity(node) {
  if (!addressActivityEl) return;

  const records = (adjacentEdges.get(node.id) || [])
    .map(edge => ({
      edge,
      first: Number.isFinite(Number(edge.first_block)) ? Number(edge.first_block) : null,
      last: Number.isFinite(Number(edge.last_block)) ? Number(edge.last_block) : null
    }))
    .filter(record => record.first !== null || record.last !== null)
    .sort((a, b) => (a.first ?? a.last) - (b.first ?? b.last));

  if (!records.length) {
    addressActivityEl.textContent =
      "No block interval data is available for this address in the public map.";
    return;
  }

  const { minBlock, maxBlock } = records.reduce((range, record) => {
    const first = record.first ?? record.last;
    const last = record.last ?? record.first;
    if (Number.isFinite(first)) range.minBlock = Math.min(range.minBlock, first);
    if (Number.isFinite(last)) range.maxBlock = Math.max(range.maxBlock, last);
    return range;
  }, { minBlock: Infinity, maxBlock: -Infinity });
  const span = Math.max(1, maxBlock - minBlock);
  const totalRecordedTx = records.reduce((sum, record) =>
    sum + Math.max(0, rawNumber(record.edge.count)), 0);

  const visibleRecords = [...records]
    .sort((a, b) => rawNumber(b.edge.value) - rawNumber(a.edge.value))
    .slice(0, 40);

  const rows = visibleRecords.map(({ edge, first, last }) => {
    const start = first ?? last;
    const end = last ?? first;
    const left = ((start - minBlock) / span) * 100;
    const width = Math.max(1.5, ((end - start) / span) * 100);
    const counterpartId = edge.from === node.id ? edge.to : edge.from;
    const counterpart = nodeById.get(counterpartId);
    const address = counterpart?.full_address || counterpart?.label || counterpartId;

    return `<div class="activity-row">` +
      `<div class="activity-address" title="${escapeHtml(address)}">${escapeHtml(address)}</div>` +
      `<div class="activity-track" aria-label="Blocks ${start} to ${end}">` +
      `<span class="activity-range" style="left:${left}%;width:${width}%"></span></div>` +
      `<div class="activity-meta">Blocks ${start.toLocaleString("en-US")}–${end.toLocaleString("en-US")} · ` +
      `${Math.max(0, rawNumber(edge.count)).toLocaleString("en-US")} recorded tx</div>` +
      `</div>`;
  }).join("");

  addressActivityEl.innerHTML =
    `<div class="activity-summary">${records.length} recorded connections · ` +
    `${totalRecordedTx.toLocaleString("en-US")} transactions across blocks ` +
    `${minBlock.toLocaleString("en-US")}–${maxBlock.toLocaleString("en-US")}</div>` +
    `<div class="activity-axis"><span>Block ${minBlock.toLocaleString("en-US")}</span>` +
    `<span>Block ${maxBlock.toLocaleString("en-US")}</span></div>` +
    `<div class="activity-rows">${rows}</div>` +
    (records.length > visibleRecords.length
      ? `<p class="activity-note">Showing the 40 highest-value connections.</p>`
      : "") +
    `<p class="activity-note">Intervals show the first and last recorded block for each aggregated connection. ` +
    `The public map does not include individual transaction dates or historical balance snapshots.</p>`;
}

function updateCounts() {
  const visibleNodes = nodes.get({
    filter: n => !n.hidden
  }).length;

  const visibleEdges = edges.get({
    filter: e => !e.hidden
  }).length;

  edgeCountEl.textContent = visibleEdges;

  analysisStatsEl.innerHTML =
    `<b>Visible Analysis</b><br>` +
    `Nodes: ${visibleNodes}<br>` +
    `Edges: ${visibleEdges}<br>` +
    `Whale Mode: ${whaleMode ? "ON ≥30k" : "OFF"}`;

  if (selectedNode !== null && !neighborhoodMode) {
    calculateCluster(selectedNode);
  }
}

function resetVisibility(focusId = null) {
  restoreOverview();
  if (typeof focusId === "object") focusId = null;
  whaleMode = false;
  neighborhoodMode = false;
  selectedNode = null;

  document.getElementById("whale-mode").textContent =
    "🐋 Whale Mode ≥30k";

  document.getElementById("flow-filter").value = "0";

  nodes.update(nodes.getIds().map(id => ({ id, hidden: false })));
  edges.update(edges.getIds().map(id => ({ id, hidden: false })));

  network.unselectAll();

  clusterInfoEl.innerHTML = "";
  detailsEl.textContent = "Click a node to inspect it.";
  if (addressActivityEl) {
    addressActivityEl.textContent = "Select an address to inspect its recorded activity intervals.";
  }

  updateCounts();

  if (focusId !== null) {
    network.focus(focusId, {
      scale: 1.8,
      animation: { duration: 600, easingFunction: "easeInOutQuad" }
    });
  } else {
    network.fit({
      animation: {
        duration: 600,
        easingFunction: "easeInOutQuad"
      }
    });
  }
}

function applyFilters() {
  if (neighborhoodMode) {
    showNeighborhood();
    return;
  }
  const threshold =
    rawNumber(document.getElementById("flow-filter").value);

  const visibleNodeIds = new Set();

  const edgeUpdates = [];
  edges.forEach(e => {
    const show = rawNumber(e.value) >= threshold;

    edgeUpdates.push({
      id: e.id,
      hidden: !show
    });

    if (show) {
      visibleNodeIds.add(e.from);
      visibleNodeIds.add(e.to);
    }
  });
  edges.update(edgeUpdates);

  const nodeUpdates = [];
  nodes.forEach(n => {
    let show =
      threshold === 0 ||
      visibleNodeIds.has(n.id);

    if (whaleMode) {
      show =
        show &&
        rawNumber(n.balance) >= WHALE_THRESHOLD;
    }

    nodeUpdates.push({
      id: n.id,
      hidden: !show
    });
  });
  nodes.update(nodeUpdates);

  const visibleIds = new Set(
    nodes.get({
      filter: n => !n.hidden
    }).map(n => n.id)
  );

  const hiddenEdgeUpdates = [];
  edges.forEach(e => {
    if (!visibleIds.has(e.from) || !visibleIds.has(e.to)) {
      hiddenEdgeUpdates.push({
        id: e.id,
        hidden: true
      });
    }
  });
  edges.update(hiddenEdgeUpdates);

  updateCounts();
}

function whaleView() {
  restoreOverview();
  whaleMode = !whaleMode;
  neighborhoodMode = false;

  document.getElementById("whale-mode").textContent =
    whaleMode
      ? "🐋 Whale Mode: ON ≥30k"
      : "🐋 Whale Mode ≥30k";

  applyFilters();
}

function showNeighborhood() {
  if (selectedNode === null) {
    detailsEl.textContent = "Select an address first, then open its neighborhood.";
    return;
  }
  if (!neighborhoodSnapshot) {
    const positions = network.getPositions();
    neighborhoodSnapshot = {
      physics: physicsEnabled,
      nodes: nodes.get().map(n => ({
        ...n, ...positions[n.id], hidden: false,
        font: n.font || null, color: n.color || null
      })),
      edges: edges.get().map(e => ({
        ...e, hidden: false, width: e.width || 1, label: e.label || "",
        color: e.color || { color: "#555", highlight: "#aaa" },
        font: e.font || { color: "#343434", size: 14, strokeWidth: 2, strokeColor: "#ffffff", align: "horizontal" },
        smooth: e.smooth || (nodeData.length > 2000 ? false : { enabled: true, type: "dynamic" }),
        arrows: e.arrows || { to: { enabled: true, scaleFactor: 0.35 } }
      }))
    };
  }
  neighborhoodMode = true;
  whaleMode = false;
  physicsEnabled = false;
  network.setOptions({ physics: { enabled: false } });
  document.getElementById("physics").textContent = "Physics: Off (neighborhood)";
  document.getElementById("whale-mode").textContent = "🐋 Whale Mode ≥30k";
  document.getElementById("neighborhood").textContent = "Neighborhood: ON";
  const threshold = rawNumber(document.getElementById("flow-filter").value);
  const links = (adjacentEdges.get(selectedNode) || [])
    .filter(e => rawNumber(e.value) >= threshold);
  const peers = new Map();
  for (const e of links) {
    const id = e.from === selectedNode ? e.to : e.from;
    if (id === selectedNode) continue;
    if (!peers.has(id)) peers.set(id, { id, incoming: 0, outgoing: 0, links: 0 });
    const peer = peers.get(id);
    peer[e.to === selectedNode ? "incoming" : "outgoing"] += rawNumber(e.value);
    peer.links++;
  }
  const ordered = [...peers.values()].sort((a, b) =>
    (b.incoming + b.outgoing) - (a.incoming + a.outgoing) || String(a.id).localeCompare(String(b.id)));
  const positions = new Map([[selectedNode, { x: 0, y: 0 }]]);
  // Concentric rings keep labels apart without running global graph physics.
  let offset = 0;
  let ring = 1;
  while (offset < ordered.length) {
    const capacity = Math.min(ordered.length - offset, ring * 12);
    for (let i = 0; i < capacity; i++) {
      const angle = -Math.PI / 2 + 2 * Math.PI * i / capacity;
      positions.set(ordered[offset + i].id, {
        x: Math.cos(angle) * ring * 260,
        y: Math.sin(angle) * ring * 260
      });
    }
    offset += capacity;
    ring++;
  }
  const baseNodes = new Map(neighborhoodSnapshot.nodes.map(n => [n.id, n]));
  nodes.update(nodes.getIds().map(id => {
    const base = baseNodes.get(id);
    const visible = positions.has(id);
    return {
      ...base, id, hidden: !visible, ...(positions.get(id) || {}),
      label: visible ? (nodeById.get(id)?.label || String(id)) : base.label,
      borderWidth: id === selectedNode ? 5 : base.borderWidth,
      font: visible ? { color: "#ffffff", size: 13, strokeWidth: 4, strokeColor: "#101010" } : base.font
    };
  }));
  const ids = new Set(links.map(e => e.id));
  edges.update(edges.getIds().map(id => {
    const e = edges.get(id);
    const visible = ids.has(id);
    const color = e.to === selectedNode ? "#54d7ed" : "#f2c94c";
    return {
      id, hidden: !visible, width: visible ? 2.5 : 1,
      color: { color, highlight: color, opacity: 0.85 },
      label: visible && links.length <= 16 ? Number(e.value).toLocaleString("en-US", { maximumFractionDigits: 2 }) + " QTC" : "",
      font: { color: "#ffffff", size: 11, strokeWidth: 3, strokeColor: "#101010", align: "middle" },
      smooth: { enabled: true, type: "curvedCW", roundness: 0.12 },
      arrows: { to: { enabled: true, scaleFactor: 0.65 } }
    };
  }));
  network.selectNodes([selectedNode]);
  network.fit({ nodes: [...positions.keys()], maxZoomLevel: 1.25,
    animation: { duration: 400, easingFunction: "easeInOutQuad" } });
  showNode(selectedNode);
  updateCounts();
  const rows = ordered.slice(0, 40).map(peer => {
    const node = nodeById.get(peer.id);
    return `<button class="relationship-peer" data-peer="${escapeHtml(String(peer.id))}">` +
      `<strong>${escapeHtml(node?.label || String(peer.id))}</strong>` +
      `<span class="relationship-address">${escapeHtml(String(node?.full_address || peer.id))}</span>` +
      `<span class="flow-in">← In: ${formatQtc(peer.incoming)}</span>` +
      `<span class="flow-out">→ Out: ${formatQtc(peer.outgoing)}</span></button>`;
  }).join("");
  clusterInfoEl.innerHTML = `<b>Direct neighborhood · ${ordered.length} other addresses</b>` +
    `<p class="relationship-note"><span class="flow-in">Cyan: toward selected address</span><br>` +
    `<span class="flow-out">Gold: away from selected address</span><br>` +
    `Arrows follow the recorded link direction. Values are heuristically allocated on-chain flows; ` +
    `they do not prove direct transfers or common ownership.</p>` +
    (rows ? "" : `<p>No links match this filter in the published dataset.</p>`) +
    (ordered.length > 40 ? `<p>Showing the 40 highest-value neighbors in this list; all are on the map.</p>` : "") +
    `<p>Click a neighbor to explore it. Use Show All to return to the overview.</p>` +
    `<div class="relationship-list">${rows}</div>`;
}

clusterInfoEl.addEventListener("click", event => {
  const button = event.target.closest("button[data-peer]");
  if (!button) return;
  const id = [...nodeById.keys()].find(key => String(key) === button.dataset.peer);
  if (id === undefined) return;
  selectedNode = id;
  showNeighborhood();
});

function calculateCluster(id) {
  const seen = new Set([id]);
  const queue = [id];
  let head = 0;

  while (head < queue.length) {
    const current = queue[head++];
    for (const edge of adjacentEdges.get(current) || []) {
      if (edges.get(edge.id)?.hidden) continue;
      const next = edge.from === current ? edge.to : edge.from;
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }

  clusterInfoEl.innerHTML =
    `<b>Connected Group</b><br>` +
    `Addresses: ${seen.size}`;
}

function exportView() {
  const result = {
    title: "Mr. Bone — QTC Bubble Map Analysis",
    generated: new Date().toISOString(),
    whale_threshold_qtc: WHALE_THRESHOLD,
    heuristic_notice:
      "Flows may be heuristically reconstructed. " +
      "A connection does not automatically prove ownership.",
    nodes: [],
    edges: []
  };

  nodes.forEach(n => {
    if (!n.hidden) {
      const original = nodeById.get(n.id);

      result.nodes.push(original || n);
    }
  });

  edges.forEach(e => {
    if (!e.hidden) {
      const index =
        Number(String(e.id).replace("edge-", ""));

      result.edges.push(edgeData[index] || e);
    }
  });

  const blob = new Blob(
    [JSON.stringify(result, null, 2)],
    { type: "application/json" }
  );

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");

  a.href = url;
  a.download = "mr-bone-qtc-map-analysis.json";
  a.click();

  setTimeout(
    () => URL.revokeObjectURL(url),
    1000
  );
}

function findAddress() {
  const query =
    searchEl.value.trim().toLowerCase();

  if (!query) return;

  const found = nodeById.get(searchEl.value.trim()) || nodeData.find(n =>
    String(n.id).toLowerCase() === query ||
    String(n.full_address || "").toLowerCase() === query
  ) || nodeData.find(n =>
    String(n.full_address || n.id).toLowerCase().startsWith(query)
  );

  if (!found) {
    detailsEl.textContent =
      "No matching address found in the published map.";
    return;
  }

  resetVisibility(found.id);

  selectedNode = found.id;

  network.selectNodes([found.id]);

  showNode(found.id);
  calculateCluster(found.id);
}

function render(data) {
  window.currentMapData = data;
  updateWalletTicker(data);
  updateBlockTicker(data);

  nodeData =
    Array.isArray(data.nodes) ? data.nodes : [];

  edgeData =
    Array.isArray(data.edges) ? data.edges : [];

  nodeById = new Map(nodeData.map(node => [node.id, node]));
  adjacentEdges = new Map();

  const largeGraph = nodeData.length > 2000;

  // Performance profile: large funded maps use a deterministic spiral layout
  // immediately instead of spending hundreds of physics iterations on first load.
  // The positions are stable between visits and still leave physics available
  // through the existing button when someone wants to experiment.
  physicsEnabled = !largeGraph;
  const preparedNodes = buildNodes(data).map((node, index) => {
    if (!largeGraph) return node;

    const goldenAngle = Math.PI * (3 - Math.sqrt(5));
    const radius = 35 * Math.sqrt(index + 1);
    const angle = index * goldenAngle;
    const isExchange = node.group === "exchange";

    return {
      ...node,
      label: isExchange ? node.label : "",
      x: isExchange ? Math.cos(angle) * 140 : Math.cos(angle) * radius,
      y: isExchange ? Math.sin(angle) * 140 : Math.sin(angle) * radius
    };
  });
  const preparedEdges = buildEdges(data);
  for (const edge of preparedEdges) {
    if (!adjacentEdges.has(edge.from)) adjacentEdges.set(edge.from, []);
    if (!adjacentEdges.has(edge.to)) adjacentEdges.set(edge.to, []);
    adjacentEdges.get(edge.from).push(edge);
    adjacentEdges.get(edge.to).push(edge);
  }

  nodes =
    new vis.DataSet(preparedNodes);

  edges =
    new vis.DataSet(preparedEdges);

  network = new vis.Network(
    document.getElementById("map"),
    { nodes, edges },
    {
      autoResize: true,

      interaction: {
        // Hit-testing every frame is expensive with thousands of nodes.
        // Large maps keep click/selection but skip continuous hover hit-tests.
        hover: !largeGraph,
        navigationButtons: true,
        keyboard: true,
        hideEdgesOnDrag: largeGraph,
        hideEdgesOnZoom: largeGraph
      },

      layout: {
        improvedLayout: !largeGraph
      },

      physics: {
        enabled: physicsEnabled,
        solver: "barnesHut",
        barnesHut: {
          gravitationalConstant: -1800,
          centralGravity: 0.08,
          springLength: 110,
          springConstant: 0.02,
          damping: 0.35,
          avoidOverlap: 0.4
        },
        stabilization: {
          enabled: physicsEnabled,
          iterations: largeGraph ? 1 : 300,
          updateInterval: 80,
          fit: true
        }
      },

      nodes: {
        shape: "dot",
        borderWidth: 2,
        font: {
          color: "#e8e8e8",
          size: 11
        }
      },

      groups: {
        exchange: {
          shape: "dot",
          size: 30,
          borderWidth: 5,
          color: {
            background: "#f2c94c",
            border: "#fff4b0",
            highlight: {
              background: "#ffe082",
              border: "#ffffff"
            },
            hover: {
              background: "#ffd54f",
              border: "#ffffff"
            }
          },
          font: {
            color: "#ffffff",
            size: 14,
            face: "Inter",
            strokeWidth: 4,
            strokeColor: "#000000"
          },
          shadow: {
            enabled: true,
            color: "rgba(242, 201, 76, 0.95)",
            size: 30,
            x: 0,
            y: 0
          }
        }
      },

      edges: {
        width: 1,
        color: {
          color: "#555",
          highlight: "#aaa"
        },
        arrows: {
          to: {
            enabled: true,
            scaleFactor: 0.35
          }
        },
        smooth: largeGraph ? false : {
          type: "dynamic"
        }
      }
    }
  );

  network.on("click", params => {
    if (params.nodes.length) {
      selectedNode = params.nodes[0];
      showNode(selectedNode);

      if (neighborhoodMode) showNeighborhood();
      else calculateCluster(selectedNode);
    }
  });

  network.on("doubleClick", params => {
    if (params.nodes.length) {
      network.focus(params.nodes[0], {
        scale: 2,
        animation: true
      });
    }
  });

  statusEl.textContent = `PUBLIC MAP ONLINE · ${nodeData.length.toLocaleString("en-US")} ADDRESSES`;
  document.getElementById("physics").textContent =
    physicsEnabled ? "Physics: On" : "Physics: Off (large map)";

  datasetInfoEl.innerHTML =
    `<div>Version: <strong>${data.version ?? "—"}</strong></div>` +
    `<div>Source: <strong>${data.source ?? "—"}</strong></div>` +
    `<div>Map generated: <strong>${escapeHtml(data.generated_at ?? "—")}</strong></div>` +
    `<div>Map verified block: <strong>${data.verified_block ?? "—"}</strong></div>` +
    `<div id="network-updated">Network updated: <strong>${escapeHtml(networkStats?.generated_at || "Snapshot only")}</strong></div>` +
    `<div>Attribution: <strong>${data.attribution ?? "Mr. Bone"}</strong></div>` +
    (Number.isFinite(data.graph_scope?.minimum_edge_qtc)
      ? `<div>Minimum link value: <strong>${formatQtc(data.graph_scope.minimum_edge_qtc)}</strong></div>`
      : "");

  updateCounts();

  // Avoid a second expensive animation pass after the initial layout.
  network.fit({
    animation: false
  });
}

async function loadData() {
  try {
    const response =
      // Allow browser caching, while still revalidating when GitHub Pages
      // publishes a newer dataset version.
      await fetch("data/map.json", {
        cache: "no-cache"
      });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data =
      await response.json();

    render(data);

  } catch (error) {
    console.error(error);

    statusEl.textContent =
      "DATA LOAD ERROR";

    datasetInfoEl.textContent =
      "The public dataset could not be loaded.";
  }
}

document.getElementById("fit").onclick = () => {
  if (network) {
    network.fit({ animation: true });
  }
};

document.getElementById("physics").onclick = () => {
  if (neighborhoodMode) return;
  physicsEnabled = !physicsEnabled;
  document.getElementById("physics").textContent =
    physicsEnabled ? "Physics: On" : "Physics: Off";

  if (network) {
    network.setOptions({
      physics: {
        enabled: physicsEnabled
      }
    });
  }
};

document.getElementById("show-all").onclick = () => resetVisibility();

document.getElementById("large-only").onclick =
  () => {
    restoreOverview();
    whaleMode = false;
    neighborhoodMode = false;

    document.getElementById("flow-filter").value = "0";

    const nodeUpdates = nodes.get().map(n => {
      const original = nodeById.get(n.id);
      const visible =
        Math.abs(rawNumber(original?.balance)) >= 50000;

      return {
        id: n.id,
        hidden: !visible
      };
    });
    nodes.update(nodeUpdates);

    const visibleIds = new Set(
      nodes.get({
        filter: n => !n.hidden
      }).map(n => n.id)
    );

    const edgeUpdates = edges.get().map(e => ({
      id: e.id,
      hidden:
        !visibleIds.has(e.from) ||
        !visibleIds.has(e.to)
    }));
    edges.update(edgeUpdates);

    updateCounts();
  };

document.getElementById("whale-mode").onclick =
  whaleView;

document.getElementById("neighborhood").onclick =
  showNeighborhood;

document.getElementById("export-view").onclick =
  exportView;

document.getElementById("flow-filter").onchange =
  applyFilters;

document.getElementById("reset").onclick = () => resetVisibility();

document.getElementById("search-btn").onclick =
  findAddress;

searchEl.setAttribute("aria-label", "Search a full or beginning QTC address");

searchEl.addEventListener("keydown", event => {
  if (event.key === "Enter") {
    findAddress();
  }
});

loadData();


loadNetworkStats();
setInterval(loadNetworkStats, 30000);
