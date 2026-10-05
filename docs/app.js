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

const liveBlockEl = document.getElementById("live-block");
const liveDifficultyEl = document.getElementById("live-difficulty");
const liveHashrateEl = document.getElementById("live-hashrate");
const liveIndexedEl = document.getElementById("live-indexed");
const liveTxEl = document.getElementById("live-tx");
const liveDataStatusEl = document.getElementById("live-data-status");

function updateBlockTicker(data) {
  const stats = data.live_stats || {};
  const indexed = Number(
    stats.latest_indexed_block ||
    data.verified_block ||
    data.balance_definition?.verified_block ||
    0
  );

  const difficulty = Number(
    stats.difficulty ||
    data.difficulty ||
    0
  );

  const hashrate = Number(
    stats.network_hashrate ||
    stats.network_hashps ||
    data.network_hashrate ||
    0
  );

  const txCount = Number(
    stats.latest_block_tx_count ||
    stats.latest_block_transactions ||
    0
  );

  if (liveBlockEl) liveBlockEl.textContent =
    indexed ? "#" + indexed.toLocaleString("en-US") : "—";

  if (liveDifficultyEl) liveDifficultyEl.textContent =
    difficulty
      ? difficulty.toLocaleString("en-US", { maximumFractionDigits: 2 })
      : "—";

  if (liveHashrateEl) liveHashrateEl.textContent =
    hashrate
      ? formatHashrate(hashrate)
      : "—";

  if (liveIndexedEl) liveIndexedEl.textContent =
    indexed ? indexed.toLocaleString("en-US") : "—";

  if (liveTxEl) liveTxEl.textContent =
    txCount ? txCount.toLocaleString("en-US") : "—";

  if (liveDataStatusEl) {
    liveDataStatusEl.textContent =
      (difficulty || hashrate || txCount) ? "NETWORK" : "SNAPSHOT";
    liveDataStatusEl.title =
      data.generated_at
        ? "Dataset generated: " + data.generated_at
        : "Public dataset snapshot";
  }
}

function formatHashrate(value) {
  if (!Number.isFinite(value) || value <= 0) return "—";

  const units = ["H/s", "kH/s", "MH/s", "GH/s", "TH/s", "PH/s", "EH/s"];
  let v = value;
  let i = 0;

  while (v >= 1000 && i < units.length - 1) {
    v /= 1000;
    i++;
  }

  return v.toLocaleString("en-US", {
    maximumFractionDigits: 2
  }) + " " + units[i];
}

let network = null;
let nodeData = [];