const statusEl = document.getElementById("status");
const nodeCountEl = document.getElementById("node-count");
const edgeCountEl = document.getElementById("edge-count");
const noticeEl = document.getElementById("notice");

let network;
let physicsEnabled = true;

const emptyData = { nodes: [], edges: [] };

function renderMap(data) {
  const nodes = new vis.DataSet(data.nodes || []);
  const edges = new vis.DataSet(data.edges || []);

  nodeCountEl.textContent = nodes.length;
  edgeCountEl.textContent = edges.length;

  network = new vis.Network(
    document.getElementById("map"),
    { nodes, edges },
    {
      autoResize: true,
      interaction: { hover: true, navigationButtons: true, keyboard: true },
      physics: { enabled: physicsEnabled, stabilization: { iterations: 250 } },
      nodes: {
        shape: "dot",
        size: 18,
        borderWidth: 2,
        font: { color: "#e8e8e8", size: 13 },
      },
      edges: {
        color: { color: "#555", highlight: "#aaa" },
        width: 1,
        smooth: { type: "dynamic" },
      },
    }
  );

  if (!data.nodes?.length) {
    noticeEl.hidden = false;
    statusEl.textContent = "PUBLIC DATASET EMPTY";
  } else {
    noticeEl.hidden = true;
    statusEl.textContent = "PUBLIC MAP ONLINE";
    network.fit({ animation: true });
  }
}

async function loadData() {
  try {
    const response = await fetch("../data/map.json", { cache: "no-store" });
    if (!response.ok) throw new Error("HTTP " + response.status);
    renderMap(await response.json());
  } catch (error) {
    console.error(error);
    renderMap(emptyData);
    statusEl.textContent = "DATA LOAD ERROR";
    noticeEl.textContent = "The public dataset could not be loaded.";
  }
}

document.getElementById("fit").addEventListener("click", () => {
  if (network) network.fit({ animation: true });
});

document.getElementById("physics").addEventListener("click", () => {
  physicsEnabled = !physicsEnabled;
  if (network) network.setOptions({ physics: { enabled: physicsEnabled } });
});

loadData();
