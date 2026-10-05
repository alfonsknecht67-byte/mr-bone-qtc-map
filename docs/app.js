const statusEl = document.getElementById("status");
const nodeCountEl = document.getElementById("node-count");
const edgeCountEl = document.getElementById("edge-count");
const detailsEl = document.getElementById("details");
const datasetInfoEl = document.getElementById("dataset-info");
const searchEl = document.getElementById("search");
const addressActivityEl = document.getElementById("address-activity");

const analysisStatsEl = document.getElementById("analysis-stats");

const tickerKnownEl = document.getElementById("ticker-known");
const tickerFundedEl = document.getElementById("ticker-funded");
const tickerSupplyEl = document.getElementById("ticker-supply");
const tickerBlockEl = document.getElementById("ticker-block");
const clusterInfoEl = document.getElementById("cluster-info");

const liveBlockEl = document.getElementById("live-block");
const liveDifficultyEl = document.getElementById("live-difficulty");
const liveHashrateEl = document.getElementById("live-hashrate");
const liveIndexedEl = document.getElementById("live-indexed");
const liveTxEl = document.getElementById("live-tx");
const liveDataStatusEl = document.getElementById("live-data-status");
const marketPriceEl = document.getElementById("market-price");
const marketChangeEl = document.getElementById("market-change");
const marketCapEl = document.getElementById("market-cap");
const circulatingSupplyEl = document.getElementById("circulating-supply");
const emissionRewardEl = document.getElementById("emission-reward");
const emissionPhaseEl = document.getElementById("emission-phase");
const emissionNoteEl = document.getElementById("emission-note");
const emissionRows = document.querySelectorAll("#emission-table-body tr[data-phase]");

const QTC_HALVING_INTERVAL = 210000;
const QTC_INITIAL_BLOCK_REWARD = 50;
const QTC_SATOSHIS = 100000000;
let indexedBlockHeight = null;
let qtcPriceEur = null;

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
  if (marketCapEl) {
    marketCapEl.textContent = Number.isFinite(qtcPriceEur)
      ? new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR", notation: "compact", maximumFractionDigits: 2 }).format(qtcPriceEur * circulating)
      : "Awaiting QTC price";
    marketCapEl.title = Number.isFinite(qtcPriceEur)
      ? `Calculated as ${qtcPriceEur} EUR × ${circulating} QTC estimated mined supply`
      : "CoinMarketCap price data is not available";
  }
}

async function loadQtcMarketPrice() {
  try {
    const url = "https://pro-api.coinmarketcap.com/public-api/v2/simple/price?slug=superquantum-qubitcoin&convert=EUR&include_24h_change=true&include_last_updated=true";
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    const asset = Array.isArray(payload.data)
      ? payload.data.find(item => item.slug === "superquantum-qubitcoin" || Number(item.id) === 37629)
      : null;
    const quote = asset?.quotes?.find(item => item.symbol === "EUR");
    const price = Number(quote?.price);
    if (!Number.isFinite(price) || price <= 0) throw new Error("QTC/EUR quote unavailable");
    const change24h = quote?.percent_change_24h;

    qtcPriceEur = price;
    if (marketPriceEl) marketPriceEl.textContent = new Intl.NumberFormat("de-DE", {
      style: "currency", currency: "EUR", maximumFractionDigits: 8
    }).format(price);
    if (marketChangeEl && change24h != null && Number.isFinite(Number(change24h))) {
      const formattedChange = new Intl.NumberFormat("en-US", { signDisplay: "always", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(change24h));
      marketChangeEl.textContent = `${formattedChange}% (24h)`;
      marketChangeEl.classList.toggle("is-negative", Number(change24h) < 0);
      marketChangeEl.hidden = false;
    }
    if (marketPriceEl && quote.last_updated) marketPriceEl.title = `CMC price updated ${quote.last_updated}`;
    updateSupplyMetrics();
  } catch (error) {
    if (!Number.isFinite(qtcPriceEur)) {
      if (marketPriceEl) marketPriceEl.hidden = true;
      const logo = document.getElementById("qtc-logo");
      if (logo) logo.hidden = true;
      const fallback = document.getElementById("cmc-widget-fallback");
      if (fallback) fallback.hidden = false;
      if (marketCapEl) marketCapEl.textContent = "Price feed unavailable";
    }
  }
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
  if (liveIndexedEl) liveIndexedEl.textContent = indexed ? indexed.toLocaleString("en-US") : "—";
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
  } catch (error) {
    networkStats = null;
  }
}

let network = null;
let nodeData = [];
window.currentMapData = null;
let edgeData = [];
let nodes = null;
let edges = null;

let physicsEnabled = true;
let whaleMode = false;
let neighborhoodMode = false;
let selectedNode = null;

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

  if (tickerBlockEl) {
    tickerBlockEl.textContent =
      Number(stats.latest_indexed_block || 0).toLocaleString("en-US");
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
  const n = nodeData.find(x => x.id === id);

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

  const records = edgeData
    .filter(edge => edge.from === node.id || edge.to === node.id)
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

  const blocks = records.flatMap(record => [record.first, record.last])
    .filter(Number.isFinite);
  const minBlock = Math.min(...blocks);
  const maxBlock = Math.max(...blocks);
  const span = Math.max(1, maxBlock - minBlock);
  const totalRecordedTx = records.reduce((sum, record) =>
    sum + Math.max(0, rawNumber(record.edge.count)), 0);

  const rows = records.map(({ edge, first, last }) => {
    const start = first ?? last;
    const end = last ?? first;
    const left = ((start - minBlock) / span) * 100;
    const width = Math.max(1.5, ((end - start) / span) * 100);
    const counterpartId = edge.from === node.id ? edge.to : edge.from;
    const counterpart = nodeData.find(item => item.id === counterpartId);
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

  nodeCountEl.textContent = visibleNodes;
  edgeCountEl.textContent = visibleEdges;

  analysisStatsEl.innerHTML =
    `<b>Visible Analysis</b><br>` +
    `Nodes: ${visibleNodes}<br>` +
    `Edges: ${visibleEdges}<br>` +
    `Whale Mode: ${whaleMode ? "ON ≥30k" : "OFF"}`;

  if (selectedNode !== null) {
    calculateCluster(selectedNode);
  }
}

function resetVisibility(focusId = null) {
  whaleMode = false;
  neighborhoodMode = false;
  selectedNode = null;

  document.getElementById("whale-mode").textContent =
    "🐋 Whale Mode ≥30k";

  document.getElementById("flow-filter").value = "0";

  nodes.forEach(n => {
    nodes.update({
      id: n.id,
      hidden: false
    });
  });

  edges.forEach(e => {
    edges.update({
      id: e.id,
      hidden: false
    });
  });

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
  const threshold =
    rawNumber(document.getElementById("flow-filter").value);

  const visibleNodeIds = new Set();

  edges.forEach(e => {
    const show = rawNumber(e.value) >= threshold;

    edges.update({
      id: e.id,
      hidden: !show
    });

    if (show) {
      visibleNodeIds.add(e.from);
      visibleNodeIds.add(e.to);
    }
  });

  nodes.forEach(n => {
    let show =
      threshold === 0 ||
      visibleNodeIds.has(n.id);

    if (whaleMode) {
      show =
        show &&
        rawNumber(n.balance) >= WHALE_THRESHOLD;
    }

    nodes.update({
      id: n.id,
      hidden: !show
    });
  });

  const visibleIds = new Set(
    nodes.get({
      filter: n => !n.hidden
    }).map(n => n.id)
  );

  edges.forEach(e => {
    if (!visibleIds.has(e.from) || !visibleIds.has(e.to)) {
      edges.update({
        id: e.id,
        hidden: true
      });
    }
  });

  updateCounts();
}

function whaleView() {
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
    alert("Please click an address to inspect it first.");
    return;
  }

  neighborhoodMode = true;
  whaleMode = false;

  document.getElementById("whale-mode").textContent =
    "🐋 Whale Mode ≥30k";

  const connected = new Set([selectedNode]);

  edges.forEach(e => {
    if (
      e.from === selectedNode ||
      e.to === selectedNode
    ) {
      connected.add(e.from);
      connected.add(e.to);
    }
  });

  nodes.forEach(n => {
    nodes.update({
      id: n.id,
      hidden: !connected.has(n.id)
    });
  });

  edges.forEach(e => {
    edges.update({
      id: e.id,
      hidden: !(
        connected.has(e.from) &&
        connected.has(e.to)
      )
    });
  });

  network.selectNodes([selectedNode]);

  network.focus(selectedNode, {
    scale: 1.5,
    animation: {
      duration: 600,
      easingFunction: "easeInOutQuad"
    }
  });

  calculateCluster(selectedNode);
  updateCounts();
}

function calculateCluster(id) {
  const seen = new Set([id]);
  const queue = [id];

  while (queue.length) {
    const current = queue.shift();

    edges.forEach(e => {
      if (e.hidden) return;

      let next = null;

      if (e.from === current) next = e.to;
      if (e.to === current) next = e.from;

      if (next !== null && !seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    });
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
      const original =
        nodeData.find(x => x.id === n.id);

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

  const found = nodeData.find(n =>
    String(n.id).toLowerCase() === query ||
    String(n.full_address || "").toLowerCase() === query
  ) || nodeData.find(n =>
    String(n.full_address || n.id).toLowerCase().startsWith(query)
  );

  if (!found) {
    detailsEl.textContent =
      "No matching address found in the public map subset.";
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

  nodes =
    new vis.DataSet(buildNodes(data));

  edges =
    new vis.DataSet(buildEdges(data));

  network = new vis.Network(
    document.getElementById("map"),
    { nodes, edges },
    {
      autoResize: true,

      interaction: {
        hover: true,
        navigationButtons: true,
        keyboard: true
      },

      physics: {
        enabled: physicsEnabled,
        stabilization: {
          iterations: 250
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
        smooth: {
          type: "dynamic"
        }
      }
    }
  );

  network.on("click", params => {
    if (params.nodes.length) {
      selectedNode = params.nodes[0];
      showNode(selectedNode);

      if (!neighborhoodMode) {
        calculateCluster(selectedNode);
      }
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

  statusEl.textContent =
    "PUBLIC MAP ONLINE";

  datasetInfoEl.innerHTML =
    `<div>Version: <strong>${data.version ?? "—"}</strong></div>` +
    `<div>Source: <strong>${data.source ?? "—"}</strong></div>` +
    `<div>Generated: <strong>${data.generated_at ?? "—"}</strong></div>` +
    `<div>Attribution: <strong>${data.attribution ?? "Mr. Bone"}</strong></div>`;

  updateCounts();

  network.fit({
    animation: true
  });
}

async function loadData() {
  try {
    const response =
      await fetch("data/map.json", {
        cache: "no-store"
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
  physicsEnabled = !physicsEnabled;

  if (network) {
    network.setOptions({
      physics: {
        enabled: physicsEnabled
      }
    });
  }
};

document.getElementById("show-all").onclick =
  resetVisibility;

document.getElementById("large-only").onclick =
  () => {
    whaleMode = false;
    neighborhoodMode = false;

    document.getElementById("flow-filter").value = "0";

    nodes.forEach(n => {
      const original =
        nodeData.find(x => x.id === n.id);

      const visible =
        Math.abs(rawNumber(original?.balance)) >= 50000;

      nodes.update({
        id: n.id,
        hidden: !visible
      });
    });

    const visibleIds = new Set(
      nodes.get({
        filter: n => !n.hidden
      }).map(n => n.id)
    );

    edges.forEach(e => {
      edges.update({
        id: e.id,
        hidden:
          !visibleIds.has(e.from) ||
          !visibleIds.has(e.to)
      });
    });

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

document.getElementById("reset").onclick =
  resetVisibility;

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
loadQtcMarketPrice();
setInterval(loadQtcMarketPrice, 60000);
