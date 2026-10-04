const statusEl = document.getElementById("status");
const nodeCountEl = document.getElementById("node-count");
const edgeCountEl = document.getElementById("edge-count");
const detailsEl = document.getElementById("details");
const datasetInfoEl = document.getElementById("dataset-info");
const searchEl = document.getElementById("search");

let network = null;
let nodeData = [];
let edgeData = [];
let nodes = null;
let edges = null;
let physicsEnabled = true;

const number = value =>
  Number.isFinite(Number(value))
    ? Number(value).toLocaleString(undefined, {
        maximumFractionDigits: 6
      })
    : "—";

function nodeSize(n) {
  const balance = Math.abs(Number(n.balance) || 0);
  if (balance >= 500000) return 42;
  if (balance >= 100000) return 32;
  if (balance >= 50000) return 25;
  if (balance >= 10000) return 19;
  return 13;
}

function buildNodes(data) {
  return data.nodes.map(n => ({
    ...n,
    label: n.label || n.id,
    title:
      `<b>${n.full_address || n.id}</b><br>` +
      `Balance: ${number(n.balance)} QTC<br>` +
      `Received: ${number(n.received)} QTC<br>` +
      `Sent: ${number(n.sent)} QTC<br>` +
      `Transactions: ${number(n.tx_count)}`,
    size: nodeSize(n)
  }));
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
  nodeCountEl.textContent = nodes ? nodes.get({
    filter: n => !n.hidden
  }).length : 0;

  edgeCountEl.textContent = edges ? edges.get({
    filter: e => !e.hidden
  }).length : 0;
}

function resetVisibility() {
  nodes.forEach(n => nodes.update({ id: n.id, hidden: false }));
  edges.forEach(e => edges.update({ id: e.id, hidden: false }));
  updateCounts();
  if (network) network.fit({ animation: true });
}

function showLargeOnly() {
  nodes.forEach(n => {
    const original = nodeData.find(x => x.id === n.id);
    const visible = Math.abs(Number(original?.balance) || 0) >= 50000;
    nodes.update({ id: n.id, hidden: !visible });
  });

  const visibleIds = new Set(
    nodes.get({
      filter: n => !n.hidden
    }).map(n => n.id)
  );

  edges.forEach(e => {
    edges.update({
      id: e.id,
      hidden: !visibleIds.has(e.from) || !visibleIds.has(e.to)
    });
  });

  updateCounts();
}

function findAddress() {
  const query = searchEl.value.trim().toLowerCase();

  if (!query) return;

  const found = nodeData.find(n =>
    String(n.id).toLowerCase() === query ||
    String(n.full_address || "").toLowerCase() === query ||
    String(n.label || "").toLowerCase().includes(query)
  );

  if (!found) {
    detailsEl.textContent = "No matching address found.";
    return;
  }

  resetVisibility();
  network.selectNodes([found.id]);
  network.focus(found.id, {
    scale: 1.8,
    animation: true
  });
  showNode(found.id);
}

function render(data) {
  nodeData = Array.isArray(data.nodes) ? data.nodes : [];
  edgeData = Array.isArray(data.edges) ? data.edges : [];

  nodes = new vis.DataSet(buildNodes(data));
  edges = new vis.DataSet(buildEdges(data));

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
      showNode(params.nodes[0]);
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

  nodeCountEl.textContent = nodeData.length;
  edgeCountEl.textContent = edgeData.length;
  statusEl.textContent = "PUBLIC MAP ONLINE";

  datasetInfoEl.innerHTML =
    `<div>Version: <strong>${data.version ?? "—"}</strong></div>` +
    `<div>Source: <strong>${data.source ?? "—"}</strong></div>` +
    `<div>Generated: <strong>${data.generated_at ?? "—"}</strong></div>` +
    `<div>Attribution: <strong>${data.attribution ?? "Mr. Bone"}</strong></div>`;

  network.fit({ animation: true });
}

async function loadData() {
  try {
    const response = await fetch("data/map.json", {
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    render(data);
  } catch (error) {
    console.error(error);
    statusEl.textContent = "DATA LOAD ERROR";
    datasetInfoEl.textContent =
      "The public dataset could not be loaded.";
  }
}

document.getElementById("fit").onclick = () => {
  if (network) network.fit({ animation: true });
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

document.getElementById("show-all").onclick = resetVisibility;
document.getElementById("large-only").onclick = showLargeOnly;
document.getElementById("reset").onclick = resetVisibility;
document.getElementById("search-btn").onclick = findAddress;

searchEl.addEventListener("keydown", event => {
  if (event.key === "Enter") findAddress();
});

loadData();
