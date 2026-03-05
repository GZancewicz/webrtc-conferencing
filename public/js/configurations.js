/**
 * configurations.js — Enumerate distinct peer/SFU topologies for n nodes.
 *
 * Two configurations are "topologically identical" when they differ only in
 * which specific node is assigned which role.  Isomorphism class is fully
 * determined by (k, partition) where k = #SFUs and partition describes how
 * (n-k) peers are distributed among k SFUs (sorted descending).
 *
 * Exports a single pure function with no DOM dependencies.
 */

/**
 * Generate all partitions of m into exactly k positive parts (each ≥ 1),
 * sorted descending.  Every SFU must serve at least one peer, otherwise
 * it's functionally just a peer and the topology is a duplicate.
 * E.g. partitions(3, 2) → [[2,1]].
 */
function partitions(m, k) {
  if (k > m) return []; // can't give each of k SFUs at least 1 peer
  const results = [];
  function recurse(remaining, parts, maxPart) {
    if (parts === 1) {
      if (remaining >= 1 && remaining <= maxPart) results.push([remaining]);
      return;
    }
    const lo = 1;
    const hi = Math.min(remaining - (parts - 1), maxPart); // reserve ≥1 for each remaining part
    for (let p = hi; p >= lo; p--) {
      const rest = partitions(remaining - p, parts - 1);
      for (const r of rest) {
        if (r[0] <= p) results.push([p, ...r]);
      }
    }
  }
  recurse(m, k, m);
  return results;
}

/**
 * Enumerate all topologically distinct peer/SFU configurations for n nodes.
 *
 * @param {number} n  Total number of nodes (≥ 1)
 * @returns {{ n: number, totalRaw: number, configurations: Array }}
 *
 * Each configuration:
 *   k            — number of SFU nodes
 *   distribution — sorted array, e.g. [2,1] means SFU₀ has 2 peers, SFU₁ has 1
 *   nodes        — [{id, type:'sfu'|'peer'}, …]
 *   edges        — [[i,j], …] undirected index pairs
 */
export function enumerateConfigurations(n) {
  if (n < 1) return { n, totalRaw: 0, configurations: [] };

  const configs = [];

  // Compute raw (non-collapsed) total: 1 + Σ C(n,k)·k^(n-k)
  let totalRaw = 1; // k=0 full mesh
  for (let k = 1; k <= n; k++) {
    totalRaw += comb(n, k) * Math.pow(k, n - k);
  }

  // k = 0: pure full mesh (all peers, every pair connected)
  {
    const nodes = Array.from({ length: n }, (_, i) => ({ id: i, type: 'peer' }));
    const edges = [];
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++)
        edges.push([i, j]);
    configs.push({ k: 0, distribution: [], nodes, edges });
  }

  // k = 1..n-1  (k=n is all-SFU, isomorphic to full mesh — skip)
  for (let k = 1; k < n; k++) {
    const m = n - k; // number of peers
    const parts = partitions(m, k);

    for (const dist of parts) {
      const nodes = [];
      // First k nodes are SFUs
      for (let i = 0; i < k; i++) nodes.push({ id: i, type: 'sfu' });
      // Remaining m nodes are peers
      for (let i = 0; i < m; i++) nodes.push({ id: k + i, type: 'peer' });

      const edges = [];
      // SFU ↔ SFU complete subgraph
      for (let i = 0; i < k; i++)
        for (let j = i + 1; j < k; j++)
          edges.push([i, j]);

      // Assign peers to SFUs according to distribution
      let peerIdx = k;
      for (let s = 0; s < k; s++) {
        for (let p = 0; p < dist[s]; p++) {
          edges.push([s, peerIdx]);
          peerIdx++;
        }
      }

      configs.push({ k, distribution: dist, nodes, edges });
    }
  }

  return { n, totalRaw, configurations: configs };
}

/** Binomial coefficient C(n, k). */
function comb(n, k) {
  if (k < 0 || k > n) return 0;
  if (k === 0 || k === n) return 1;
  let result = 1;
  for (let i = 0; i < Math.min(k, n - k); i++) {
    result = result * (n - i) / (i + 1);
  }
  return Math.round(result);
}
