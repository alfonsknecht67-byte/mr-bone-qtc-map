/* Pure analysis of already loaded, qualifying on-chain links. */
(function(root) {
  function compare(a, b, adjacency, threshold = 0) {
    const links = id => (adjacency.get(id) || []).filter(e => Number(e.value) >= threshold);
    const aLinks = links(a), bLinks = links(b);
    const peers = (id, list) => {
      const result = new Map();
      for (const edge of list) {
        const peer = edge.from === id ? edge.to : edge.from;
        if (peer === id) continue;
        if (!result.has(peer)) result.set(peer, []);
        result.get(peer).push(edge);
      }
      return result;
    };
    const ap = peers(a, aLinks), bp = peers(b, bLinks);
    const direct = aLinks.filter(e => (e.from === a && e.to === b) || (e.from === b && e.to === a));
    const shared = [];
    for (const [id, left] of ap) {
      if (id === a || id === b || !bp.has(id)) continue;
      const right = bp.get(id);
      shared.push({ id, edges: [...left, ...right],
        value: [...left, ...right].reduce((sum, e) => sum + Number(e.value || 0), 0),
        aToB: left.some(e => e.from === a && e.to === id) && right.some(e => e.from === id && e.to === b),
        bToA: right.some(e => e.from === b && e.to === id) && left.some(e => e.from === id && e.to === a)
      });
    }
    shared.sort((x, y) => y.value - x.value || String(x.id).localeCompare(String(y.id)));
    return { a, b, direct, shared, aNeighbors: ap.size, bNeighbors: bp.size };
  }
  const api = { compare };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WalletRelationships = api;
})(typeof window !== 'undefined' ? window : globalThis);
