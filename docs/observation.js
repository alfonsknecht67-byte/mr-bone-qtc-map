/* Public snapshot observations; all untrusted strings enter through textContent. */
(() => {
  'use strict';
  const panel = document.getElementById('observation-panel');
  const freshness = document.getElementById('observation-freshness');
  const historySelect = document.getElementById('snapshot-select');
  const balanceSelect = document.getElementById('balance-compare-date');
  const selected = document.getElementById('observation-wallet');
  let latest = null, history = [], report = null, evidencePromise = null, selectedAddress = null;
  let walletRequest = 0, travelRequest = 0;
  const snapshots = new Map();
  const fmt = n => Number(n).toLocaleString('en-US', {maximumFractionDigits: 8});
  const line = (root, text, tag = 'p') => { const el = document.createElement(tag); el.textContent = text; root.append(el); return el; };
  async function json(url) {
    const r = await fetch(url, {cache: 'no-cache'});
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }
  function refreshFreshness() {
    if (!window.currentMapData) return;
    const map = window.currentMapData;
    const stats = window.qtcObservation?.networkStats() || {};
    const node = stats.node_chain_tip ?? stats.block;
    const scanner = stats.scanner_indexed_block;
    const age = Date.now() - Date.parse(stats.generated_at);
    const valid = Number.isFinite(age) && age >= -60000 && age < 180000;
    const lag = Number.isInteger(node) ? node - map.verified_block : null;
    freshness.textContent = `Node: ${node ?? 'unknown'} · Scanner: ${scanner ?? 'unknown'} · Displayed map: ${map.verified_block} · ` +
      (map !== latest ? 'ARCHIVED SNAPSHOT · ' : '') +
      (!valid ? 'Node observation unavailable or older than 3 minutes. ' : '') +
      (lag === null ? 'Lag cannot be calculated.' : lag < 0 ? 'Inconsistent block heights; check source.' : `${fmt(lag)} blocks behind node.`);
    freshness.dataset.warning = String(!valid || lag > 12 || lag < 0);
  }
  async function snapshot(entry) {
    if (!/^data\/history\/\d{4}-\d{2}-\d{2}\.json$/.test(entry.file)) throw new Error('Invalid history path');
    if (!snapshots.has(entry.file)) snapshots.set(entry.file, json(entry.file).catch(e => {snapshots.delete(entry.file); throw e;}));
    return snapshots.get(entry.file);
  }
  async function showWallet(address) {
    selectedAddress = address;
    const request = ++walletRequest;
    selected.replaceChildren();
    line(selected, address, 'strong');
    const current = window.currentMapData;
    const node = current.nodes.find(n => n.id === address);
    const entry = history.find(e => e.date === balanceSelect.value);
    if (entry) {
      try {
        const older = await snapshot(entry);
        if (request !== walletRequest) return;
        const before = older.balances?.[address] ?? 0;
        const after = current.balances?.[address] ?? node?.balance ?? 0;
        line(selected, `${entry.date}: ${fmt(before)} QTC → displayed snapshot: ${fmt(after)} QTC · change: ${fmt(after-before)} QTC`);
        line(selected, 'Balance change between observations; this does not establish buying or selling.');
      } catch (_) { if (request === walletRequest) line(selected, 'The comparison snapshot could not be loaded.'); }
    } else line(selected, 'Select an archived date to compare balances. History begins with the first saved observation.');
    if (request !== walletRequest) return;
    const candidate = current === latest && report?.verified_block === current.verified_block
      ? report.exchange_candidates?.find(c => c.address === address) : null;
    if (candidate) {
      line(selected, `Connection to ${candidate.related_label}: ${fmt(candidate.allocated_qtc)} QTC allocated flow, ${fmt(candidate.share_of_observed_allocated_flow*100)}% of this address’s observed allocated flow.`);
      line(selected, 'Ownership unconfirmed. Flow concentration is a descriptive signal, not a calibrated ownership probability.');
    }
    if (current !== latest) {line(selected, 'Transaction evidence below is available only for the latest snapshot.'); return;}
    line(selected, 'Recent transaction evidence', 'h4');
    try {
      if (!evidencePromise) evidencePromise = json('data/transactions.json').catch(e => {evidencePromise = null; throw e;});
      const evidence = await evidencePromise;
      if (request !== walletRequest) return;
      if (evidence.verified_block !== current.verified_block) {line(selected, 'Evidence and map blocks differ; refresh after publication completes.'); return;}
      const matches = evidence.transactions.filter(t => [...t.inputs, ...t.outputs].some(r => r.address === address));
      line(selected, `Coverage: latest ${evidence.coverage?.count ?? 0} transactions within 30 days · ${evidence.coverage?.complete ? 'complete window' : 'limited or unavailable window'}. Showing up to 20 matching transactions.`);
      if (!matches.length) line(selected, 'No matching transaction in this evidence window; this does not mean the address has no activity.');
      for (const tx of matches.slice(0, 20)) {
        const details = document.createElement('details'); selected.append(details);
        line(details, `Block ${tx.block} · ${new Date(tx.timestamp*1000).toISOString()} · ${tx.txid}`, 'summary');
        line(details, `TXID: ${tx.txid}`);
        for (const side of ['inputs','outputs']) {
          line(details, side === 'inputs' ? 'Inputs' : 'Outputs', 'strong');
          for (const row of tx[side]) line(details, `${row.address || 'Unresolved address'} · ${fmt(row.amount)} QTC`);
        }
        line(details, 'Transaction participation is recorded on-chain. Allocation between individual input/output pairs remains heuristic.');
      }
    } catch (_) {if (request === walletRequest) line(selected, 'Transaction evidence is not available yet.');}
  }
  function showReport() {
    const box = document.getElementById('exchange-observations');
    box.replaceChildren();
    if (!report || !latest || report.verified_block !== latest.verified_block) {line(box, 'Observation report is not yet available for the current map block.'); return;}
    line(box, `Report block: ${report.verified_block} · ${report.generated_at}`);
    line(box, report.attribution_notice);
    const days = document.getElementById('exchange-window').value;
    const window = report.exchange_windows?.[days];
    if (!window) line(box, report.error || 'Transaction analysis awaits the next successful scanner export.');
    else {
      line(box, window.complete ? `Complete ${days}-day evidence window.` : `Partial ${days}-day evidence window; totals are incomplete.`);
      for (const [name, flow] of Object.entries(window.groups)) {
        line(box, name, 'strong');
        line(box, `Net-positive TXs: ${fmt(flow.net_positive_qtc)} QTC · net-negative TXs: ${fmt(flow.net_negative_qtc)} QTC · net movement: ${fmt(flow.net_qtc)} QTC · internal TXs excluded: ${flow.internal_transactions}`);
      }
      line(box, report.flow_notice);
    }
    line(box, 'Large balance changes', 'h4');
    if (!report.comparison_date) line(box, 'A second observation day is needed before changes can be measured.');
    else {
      line(box, `Compared with ${report.comparison_date}; threshold 30,000 QTC.`);
      for (const item of report.whale_balance_changes.slice(0, 10)) line(box, `${item.label || item.address}: ${fmt(item.change_qtc)} QTC`);
      if (!report.whale_balance_changes.length) line(box, 'No balance change above the threshold between these snapshots.');
    }
  }
  async function init() {
    const results = await Promise.allSettled([json('data/history/index.json'), json('data/observation.json')]);
    if (results[0].status === 'fulfilled') history = results[0].value.snapshots || [];
    if (results[1].status === 'fulfilled') report = results[1].value;
    for (const entry of history) for (const select of [historySelect, balanceSelect]) {
      const option = document.createElement('option'); option.value = entry.date; option.textContent = `${entry.date} · block ${entry.block}`; select.append(option);
    }
    showReport();
  }
  historySelect.addEventListener('change', async () => {
    const request = ++travelRequest;
    try {
      const entry = history.find(e => e.date === historySelect.value);
      const data = entry ? await snapshot(entry) : latest;
      if (request !== travelRequest || !data) return;
      window.qtcObservation.render(data);
      selected.replaceChildren(); selectedAddress = null; walletRequest++;
      document.getElementById('snapshot-status').textContent = entry ? `Archived graph: ${entry.date}. Smaller links are available in the latest map only.` : 'Latest published graph';
      refreshFreshness();
    } catch (_) {document.getElementById('snapshot-status').textContent = 'Archive could not be loaded. Displayed map unchanged.';}
  });
  balanceSelect.addEventListener('change', () => {if (selectedAddress) showWallet(selectedAddress);});
  document.getElementById('exchange-window').addEventListener('change', showReport);
  document.addEventListener('qtc:map-loaded', e => {
    if (!latest) latest = e.detail;
    refreshFreshness(); showReport();
  });
  document.addEventListener('qtc:wallet-selected', e => showWallet(e.detail));
  document.addEventListener('qtc:network-updated', refreshFreshness);
  setInterval(refreshFreshness, 30000);
  panel.hidden = false;
  init();
})();
