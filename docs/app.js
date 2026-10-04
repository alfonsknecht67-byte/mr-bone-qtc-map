const statusEl = document.getElementById("status");
const nodeCountEl = document.getElementById("node-count");
const edgeCountEl = document.getElementById("edge-count");
const detailsEl = document.getElementById("details");
const datasetInfoEl = document.getElementById("dataset-info");
const searchEl = document.getElementById("search");

const analysisStatsEl = document.getElementById("analysis-stats");

const tickerKnownEl = document.getElementById("ticker-known");
const tickerFundedEl = document.getElementById("ticker-funded");
const tickerSupplyEl = document.getElementById("ticker-supply");
const tickerBlockEl = document.getElementById("ticker-block");
const clusterInfoEl = document.getElementById("cluster-info");

let network = null;
let nodeData = [];
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
    const isExchange =
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
    `<div class="address">${n.full_address || n.id}</div>` +
    `<dl>` +
    `<dt>Balance</dt><dd>${number(n.balance)} QTC</dd>` +
    `<dt>Received</dt><dd>${number(n.received)} QTC</dd>` +
    `<dt>Sent</dt><dd>${number(n.sent)} QTC</dd>` +
    `<dt>Transactions</dt><dd>${number(n.tx_count)}</dd>` +
    `<dt>Map size</dt><dd>${n.size ?? "—"}</dd>` +
    `</dl>`;
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

function resetVisibility() {
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

  updateCounts();

  network.fit({
    animation: {
      duration: 600,
      easingFunction: "easeInOutQuad"
    }
  });
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
    String(n.full_address || "").toLowerCase() === query ||
    String(n.label || "").toLowerCase().includes(query)
  );

  if (!found) {
    detailsEl.textContent =
      "No matching address found.";
    return;
  }

  resetVisibility();

  selectedNode = found.id;

  network.selectNodes([found.id]);

  network.focus(found.id, {
    scale: 1.8,
    animation: true
  });

  showNode(found.id);
  calculateCluster(found.id);
}

function render(data) {
  updateWalletTicker(data);

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

searchEl.addEventListener("keydown", event => {
  if (event.key === "Enter") {
    findAddress();
  }
});

loadData();
