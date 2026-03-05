export async function toggleTopology() {
  const panel = document.getElementById('topology-panel');
  const btn = document.getElementById('toggle-topology');
  const isVisible = panel.style.display !== 'none';

  if (isVisible) {
    panel.style.display = 'none';
    btn.classList.remove('active');
  } else {
    panel.style.display = 'flex';
    btn.classList.add('active');
    await this.renderTopology();
  }
}

export async function gatherTopologyData() {
  const nodes = [];
  const edges = [];

  // Determine WebSocket protocol from page protocol
  const wsProtocol = (window.location.protocol === 'https:') ? 'wss://' : 'ws://';
  const signalingUri = `${wsProtocol}${window.location.host}`;

  // Fetch server IP for signaling node
  let serverIp = null;
  try {
    const resp = await fetch('/api/server-info');
    const info = await resp.json();
    serverIp = info.ip;
  } catch (e) { /* ignore */ }

  // Self node
  nodes.push({ id: 'self', label: this.username || 'You', type: 'self', connectedAt: this.connectionTimestamps.get('self') || null });

  // Signaling server
  let signalingLabel = `Signaling Server\n${signalingUri}`;
  if (serverIp) signalingLabel += `\n${serverIp}`;
  nodes.push({ id: 'signaling', label: signalingLabel, type: 'infrastructure', connectedAt: this.connectionTimestamps.get('signaling') || null });
  edges.push({ from: 'self', to: 'signaling', label: wsProtocol, style: 'signaling' });

  // STUN/TURN servers from ICE config
  const stunIds = [];
  const turnId = [];
  if (this.iceServers && this.iceServers.iceServers) {
    let stunIndex = 0;
    for (const server of this.iceServers.iceServers) {
      const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
      for (const url of urls) {
        if (url.startsWith('stun:')) {
          const id = `stun-${stunIndex++}`;
          nodes.push({ id, label: `STUN\n${url}`, type: 'stun', connectedAt: this.connectionTimestamps.get(id) || null });
          stunIds.push(id);
          edges.push({ from: 'self', to: id, label: 'stun:', style: 'stun' });
        } else if (url.startsWith('turn:') || url.startsWith('turns:')) {
          const scheme = url.startsWith('turns:') ? 'turns:' : 'turn:';
          const id = 'turn';
          if (!nodes.find(n => n.id === 'turn')) {
            nodes.push({ id, label: `TURN\n${url}`, type: 'turn', connectedAt: this.connectionTimestamps.get(id) || null });
            turnId.push(id);
            edges.push({ from: 'self', to: id, label: scheme, style: 'turn' });
          }
        }
      }
    }
  }

  // Peers and their connections
  for (const [userId, peer] of this.peers) {
    const peerId = `peer-${userId}`;
    let peerLabel = peer.username || 'Peer';

    // Signaling edge for each peer
    edges.push({ from: peerId, to: 'signaling', label: wsProtocol, style: 'signaling' });

    // Determine connection type from active candidate pair
    try {
      const pc = peer.connection;
      const stats = await pc.getStats();
      let activePairId = null;
      const candidateMap = new Map();

      stats.forEach(report => {
        if (report.type === 'transport') {
          activePairId = report.selectedCandidatePairId;
        }
        if (report.type === 'local-candidate' || report.type === 'remote-candidate') {
          candidateMap.set(report.id, report);
        }
      });

      let activePair = null;
      if (activePairId) {
        stats.forEach(report => {
          if (report.id === activePairId) activePair = report;
        });
      }
      if (!activePair) {
        stats.forEach(report => {
          if (report.type === 'candidate-pair' && report.state === 'succeeded') {
            activePair = report;
          }
        });
      }

      if (activePair) {
        const localCand = candidateMap.get(activePair.localCandidateId);
        const remoteCand = candidateMap.get(activePair.remoteCandidateId);
        const localType = localCand ? localCand.candidateType : 'unknown';
        const remoteType = remoteCand ? remoteCand.candidateType : 'unknown';

        // Add peer IP from remote candidate
        if (remoteCand && remoteCand.address) {
          peerLabel += `\n${remoteCand.address}`;
        }

        if (localType === 'relay' || remoteType === 'relay') {
          // TURN relay path
          if (turnId.length > 0) {
            edges.push({ from: 'self', to: turnId[0], label: 'DTLS-SRTP/UDP', style: 'turn', isMedia: true });
            edges.push({ from: turnId[0], to: peerId, label: 'DTLS-SRTP/UDP', style: 'turn', isMedia: true });
          } else {
            edges.push({ from: 'self', to: peerId, label: 'DTLS-SRTP/UDP', style: 'turn', isMedia: true });
          }
        } else if (localType === 'srflx' || remoteType === 'srflx') {
          // STUN-assisted
          edges.push({ from: 'self', to: peerId, label: 'DTLS-SRTP/UDP', style: 'stun', isMedia: true });
        } else {
          // Direct (host)
          edges.push({ from: 'self', to: peerId, label: 'DTLS-SRTP/UDP', style: 'direct', isMedia: true });
        }
      } else {
        // Connection in progress or failed
        edges.push({ from: 'self', to: peerId, label: 'DTLS-SRTP (connecting...)', style: 'connecting', isMedia: true });
      }
    } catch (e) {
      edges.push({ from: 'self', to: peerId, label: 'DTLS-SRTP/UDP', style: 'direct', isMedia: true });
    }

    nodes.push({ id: peerId, label: peerLabel, type: 'peer', connectedAt: this.connectionTimestamps.get(peerId) || null });
  }

  return { nodes, edges };
}

export async function renderTopology() {
  const body = document.getElementById('topology-panel-body');
  if (!body) return;

  const data = await this.gatherTopologyData();

  const canvas = document.getElementById('topo-canvas');
  const legend = document.getElementById('topo-legend');
  const svg = document.getElementById('topo-svg');

  canvas.innerHTML = '';

  const nodeElements = new Map();

  // Categorize nodes
  const selfNode = data.nodes.find(n => n.type === 'self');
  const infraNodes = data.nodes.filter(n => n.type !== 'self' && n.type !== 'peer');
  const peerNodes = data.nodes.filter(n => n.type === 'peer');

  // Create and append all node elements
  for (const node of data.nodes) {
    const el = this.createTopologyNodeElement(node);
    nodeElements.set(node.id, el);
    canvas.appendChild(el);
  }

  // Render legend (once)
  if (!legend.hasChildNodes()) {
    this.renderTopologyLegend(legend);
  }

  // Position nodes radially after DOM layout
  requestAnimationFrame(() => {
    const rect = canvas.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const radius = Math.min(cx, cy) * 0.7;

    // Self at center
    if (selfNode) {
      const el = nodeElements.get(selfNode.id);
      el.style.left = cx + 'px';
      el.style.top = cy + 'px';
    }

    // Infrastructure in upper arc (-150° to -30°)
    const infraStart = -150 * (Math.PI / 180);
    const infraEnd = -30 * (Math.PI / 180);
    infraNodes.forEach((node, i) => {
      const count = infraNodes.length;
      const angle = count === 1
        ? -Math.PI / 2
        : infraStart + (infraEnd - infraStart) * (i / (count - 1));
      const el = nodeElements.get(node.id);
      el.style.left = (cx + radius * Math.cos(angle)) + 'px';
      el.style.top = (cy + radius * Math.sin(angle)) + 'px';
    });

    // Peers in lower arc (30° to 150°), wider for 5+ peers
    peerNodes.forEach((node, i) => {
      const count = peerNodes.length;
      let angle;
      if (count === 1) {
        angle = Math.PI / 2;
      } else if (count <= 4) {
        const start = 30 * (Math.PI / 180);
        const end = 150 * (Math.PI / 180);
        angle = start + (end - start) * (i / (count - 1));
      } else {
        const start = -10 * (Math.PI / 180);
        const end = 190 * (Math.PI / 180);
        angle = start + (end - start) * (i / (count - 1));
      }
      const el = nodeElements.get(node.id);
      el.style.left = (cx + radius * Math.cos(angle)) + 'px';
      el.style.top = (cy + radius * Math.sin(angle)) + 'px';
    });

    // Draw edges after positions settle
    requestAnimationFrame(() => {
      this.drawTopologyEdges(svg, data.edges, nodeElements, body);
    });
  });
}

export function createTopologyNodeElement(node) {
  const el = document.createElement('div');
  el.className = 'topo-node';
  el.dataset.nodeId = node.id;

  // Icon
  const icon = document.createElement('div');
  const isServer = node.type !== 'self' && node.type !== 'peer';
  icon.className = `topo-node-icon ${node.type}${isServer ? ' server' : ''}`;

  const icons = { self: '👤', peer: '👥', infrastructure: '🖥️', stun: '📡', turn: '🔄' };
  icon.textContent = icons[node.type] || '❓';
  el.appendChild(icon);

  // Label
  const label = document.createElement('div');
  label.className = 'topo-node-label';
  const lines = node.label.split('\n');
  lines.forEach((line, i) => {
    const span = document.createElement('div');
    span.className = i === 0 ? 'topo-name' : 'topo-detail';
    span.textContent = line;
    label.appendChild(span);
  });

  // Timestamp
  if (node.connectedAt) {
    const timeSpan = document.createElement('div');
    timeSpan.className = 'topo-time';
    timeSpan.textContent = node.connectedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    label.appendChild(timeSpan);
  }

  el.appendChild(label);
  return el;
}

export function drawTopologyEdges(svg, edges, nodeElements, container) {
  const ns = 'http://www.w3.org/2000/svg';
  svg.innerHTML = '';

  const containerRect = container.getBoundingClientRect();

  // Define arrowhead markers for each style
  const defs = document.createElementNS(ns, 'defs');
  const styleColors = {
    signaling: '#94a3b8',
    direct: '#22c55e',
    stun: '#eab308',
    turn: '#f97316',
    connecting: '#64748b'
  };
  for (const [style, color] of Object.entries(styleColors)) {
    const marker = document.createElementNS(ns, 'marker');
    marker.setAttribute('id', `arrow-${style}`);
    marker.setAttribute('viewBox', '0 0 10 6');
    marker.setAttribute('refX', '10');
    marker.setAttribute('refY', '3');
    marker.setAttribute('markerWidth', '10');
    marker.setAttribute('markerHeight', '6');
    marker.setAttribute('orient', 'auto-start-reverse');
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', 'M 0 0 L 10 3 L 0 6');
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', color);
    path.setAttribute('stroke-width', '1');
    marker.appendChild(path);
    defs.appendChild(marker);
  }
  svg.appendChild(defs);

  // Deduplicate edges
  const drawn = new Set();
  for (const edge of edges) {
    const key = [edge.from, edge.to, edge.style].sort().join('|');
    if (drawn.has(key)) continue;
    drawn.add(key);

    const fromEl = nodeElements.get(edge.from);
    const toEl = nodeElements.get(edge.to);
    if (!fromEl || !toEl) continue;

    // Get icon center positions relative to the container
    const fromIcon = fromEl.querySelector('.topo-node-icon');
    const toIcon = toEl.querySelector('.topo-node-icon');
    const fromRect = fromIcon.getBoundingClientRect();
    const toRect = toIcon.getBoundingClientRect();

    const x1 = fromRect.left + fromRect.width / 2 - containerRect.left;
    const y1 = fromRect.top + fromRect.height / 2 - containerRect.top;
    const x2 = toRect.left + toRect.width / 2 - containerRect.left;
    const y2 = toRect.top + toRect.height / 2 - containerRect.top;

    // Shorten line to stop at icon edge
    const dx = x2 - x1;
    const dy = y2 - y1;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist === 0) continue;

    const fromRadius = Math.max(fromRect.width, fromRect.height) / 2 + 2;
    const toRadius = Math.max(toRect.width, toRect.height) / 2 + 2;
    const nx = dx / dist;
    const ny = dy / dist;
    const sx = x1 + nx * fromRadius;
    const sy = y1 + ny * fromRadius;
    const ex = x2 - nx * toRadius;
    const ey = y2 - ny * toRadius;

    const color = styleColors[edge.style] || '#94a3b8';
    const line = document.createElementNS(ns, 'line');
    line.setAttribute('x1', sx);
    line.setAttribute('y1', sy);
    line.setAttribute('x2', ex);
    line.setAttribute('y2', ey);
    line.setAttribute('stroke', color);
    line.setAttribute('stroke-width', edge.style === 'signaling' ? '1.5' : '2.5');
    if (edge.style === 'signaling') {
      line.setAttribute('stroke-dasharray', '6 4');
    }
    line.setAttribute('marker-end', `url(#arrow-${edge.style})`);
    svg.appendChild(line);
  }
}

export function renderTopologyLegend(container) {
  const items = [
    { color: '#94a3b8', dashed: true, text: 'wss:// Socket.IO (Signaling)' },
    { color: '#22c55e', dashed: false, text: 'DTLS-SRTP/UDP (Direct)' },
    { color: '#eab308', dashed: false, text: 'stun: STUN (NAT Discovery)' },
    { color: '#f97316', dashed: false, text: 'turn:/turns: TURN (Relay)' }
  ];

  container.innerHTML = '';
  for (const item of items) {
    const el = document.createElement('div');
    el.className = 'topo-legend-item';

    const line = document.createElement('span');
    line.className = `topo-legend-line${item.dashed ? ' dashed' : ''}`;
    line.style.borderColor = item.color;
    el.appendChild(line);

    const label = document.createElement('span');
    label.style.color = item.color;
    label.textContent = item.text;
    el.appendChild(label);

    container.appendChild(el);
  }
}
