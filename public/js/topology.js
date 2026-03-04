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

function estimateNodeSize(node) {
  const lines = node.label.split('\n');
  // Estimate text width at 11px font (~6.5px per char)
  const maxLineWidth = Math.max(...lines.map(l => l.length * 6.5));

  // Shape dimensions
  const shapeW = node.type === 'self' || node.type === 'peer' ? 44 : 70;
  const shapeH = node.type === 'self' || node.type === 'peer' ? 44 : 36;

  // Label height: lines * 14px + optional timestamp
  const labelH = lines.length * 14 + (node.connectedAt ? 14 : 0);

  const totalW = Math.max(shapeW, maxLineWidth) + 20;
  const totalH = shapeH + labelH + 8;

  return { w: totalW, h: totalH };
}

export function layoutTopologyNodes(nodes, edges, width, height) {
  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir: 'BT',
    nodesep: 60,
    ranksep: 80,
    marginx: 0,
    marginy: 0
  });
  g.setDefaultEdgeLabel(() => ({}));

  // Add nodes with estimated dimensions
  for (const node of nodes) {
    const size = estimateNodeSize(node);
    g.setNode(node.id, { width: size.w, height: size.h });
  }

  // Add deduplicated edges
  const seen = new Set();
  for (const edge of edges) {
    const key = `${edge.from}|${edge.to}`;
    if (!seen.has(key)) {
      seen.add(key);
      g.setEdge(edge.from, edge.to);
    }
  }

  // Run dagre layout
  dagre.layout(g);

  // Find bounding box of dagre output
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const node of nodes) {
    const dn = g.node(node.id);
    minX = Math.min(minX, dn.x - dn.width / 2);
    maxX = Math.max(maxX, dn.x + dn.width / 2);
    minY = Math.min(minY, dn.y - dn.height / 2);
    maxY = Math.max(maxY, dn.y + dn.height / 2);
  }

  const graphW = maxX - minX || 1;
  const graphH = maxY - minY || 1;
  const padding = 50;
  const legendH = 80;
  const scaleX = (width - padding * 2) / graphW;
  const scaleY = (height - padding * 2 - legendH) / graphH;
  const scale = Math.min(scaleX, scaleY, 1);

  // Center the graph in the canvas
  const scaledW = graphW * scale;
  const scaledH = graphH * scale;
  const offsetX = padding + (width - padding * 2 - scaledW) / 2;
  const offsetY = padding + (height - padding * 2 - legendH - scaledH) / 2;

  // Apply scaled positions back to our nodes
  for (const node of nodes) {
    const dn = g.node(node.id);
    node.x = offsetX + (dn.x - minX) * scale;
    node.y = offsetY + (dn.y - minY) * scale;
  }

  return nodes;
}

export async function renderTopology() {
  const canvas = document.getElementById('topology-canvas');
  const body = document.getElementById('topology-panel-body');
  if (!canvas || !body) return;

  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const rect = body.getBoundingClientRect();
  const w = rect.width;
  const h = rect.height;

  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  ctx.scale(dpr, dpr);

  // Background
  ctx.fillStyle = '#1e293b';
  ctx.fillRect(0, 0, w, h);

  const data = await this.gatherTopologyData();
  this.layoutTopologyNodes(data.nodes, data.edges, w, h);

  const nodeMap = new Map();
  data.nodes.forEach(n => nodeMap.set(n.id, n));

  // Draw edges first
  // Deduplicate media edges (avoid drawing duplicate TURN relay edges)
  const drawnEdges = new Set();
  for (const edge of data.edges) {
    const key = [edge.from, edge.to, edge.label].sort().join('|');
    if (drawnEdges.has(key)) continue;
    drawnEdges.add(key);

    const fromNode = nodeMap.get(edge.from);
    const toNode = nodeMap.get(edge.to);
    if (fromNode && toNode) {
      this.drawTopologyEdge(ctx, fromNode, toNode, edge.style);
    }
  }

  // Draw nodes on top
  for (const node of data.nodes) {
    this.drawTopologyNode(ctx, node);
  }

  // Legend
  this.drawTopologyLegend(ctx, w, h);
}

export function drawTopologyNode(ctx, node) {
  const colors = {
    self: '#4f46e5',
    peer: '#22c55e',
    infrastructure: '#94a3b8',
    stun: '#eab308',
    turn: '#f97316'
  };
  const color = colors[node.type] || '#94a3b8';
  const radius = node.type === 'self' || node.type === 'peer' ? 22 : 18;

  ctx.save();
  if (node.type === 'self' || node.type === 'peer') {
    // Circle
    ctx.beginPath();
    ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = '#f8fafc';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Icon inside
    ctx.fillStyle = '#fff';
    ctx.font = `${radius}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(node.type === 'self' ? '👤' : '👥', node.x, node.y);
  } else {
    // Rounded rect for servers
    const rw = 70;
    const rh = 36;
    const cr = 8;
    const x = node.x - rw / 2;
    const y = node.y - rh / 2;
    ctx.beginPath();
    ctx.moveTo(x + cr, y);
    ctx.lineTo(x + rw - cr, y);
    ctx.quadraticCurveTo(x + rw, y, x + rw, y + cr);
    ctx.lineTo(x + rw, y + rh - cr);
    ctx.quadraticCurveTo(x + rw, y + rh, x + rw - cr, y + rh);
    ctx.lineTo(x + cr, y + rh);
    ctx.quadraticCurveTo(x, y + rh, x, y + rh - cr);
    ctx.lineTo(x, y + cr);
    ctx.quadraticCurveTo(x, y, x + cr, y);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = '#f8fafc';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Icon inside rect
    ctx.fillStyle = '#fff';
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (node.type === 'infrastructure') {
      ctx.fillText('🖥️', node.x, node.y);
    } else if (node.type === 'stun') {
      ctx.fillText('📡', node.x, node.y);
    } else {
      ctx.fillText('🔄', node.x, node.y);
    }
  }

  // Label below
  const lines = node.label.split('\n');
  ctx.fillStyle = '#f8fafc';
  ctx.font = '11px -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const labelY = node.y + (node.type === 'self' || node.type === 'peer' ? 28 : 24);
  lines.forEach((line, i) => {
    ctx.fillText(line, node.x, labelY + i * 14);
  });

  // Connection timestamp
  if (node.connectedAt) {
    const timeStr = node.connectedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    ctx.fillStyle = '#64748b';
    ctx.font = '9px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillText(timeStr, node.x, labelY + lines.length * 14 + 2);
  }

  ctx.restore();
}

export function drawTopologyEdge(ctx, from, to, style) {
  const colors = {
    signaling: '#94a3b8',
    direct: '#22c55e',
    stun: '#eab308',
    turn: '#f97316',
    connecting: '#64748b'
  };
  const color = colors[style] || '#94a3b8';

  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = style === 'signaling' ? 1.5 : 2.5;

  if (style === 'signaling') {
    ctx.setLineDash([6, 4]);
  } else {
    ctx.setLineDash([]);
  }

  // Calculate line start/end to stop at node edges
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist === 0) { ctx.restore(); return; }

  const nx = dx / dist;
  const ny = dy / dist;
  const fromRadius = 26;
  const toRadius = 26;
  const x1 = from.x + nx * fromRadius;
  const y1 = from.y + ny * fromRadius;
  const x2 = to.x - nx * toRadius;
  const y2 = to.y - ny * toRadius;

  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();

  // Arrowhead
  ctx.setLineDash([]);
  const arrowLen = 10;
  const arrowAngle = Math.PI / 7;
  const angle = Math.atan2(y2 - y1, x2 - x1);
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - arrowLen * Math.cos(angle - arrowAngle), y2 - arrowLen * Math.sin(angle - arrowAngle));
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - arrowLen * Math.cos(angle + arrowAngle), y2 - arrowLen * Math.sin(angle + arrowAngle));
  ctx.stroke();

  ctx.restore();
}

export function drawTopologyLegend(ctx, w, h) {
  const items = [
    { color: '#94a3b8', dash: true, label: 'wss:// Socket.IO (Signaling)' },
    { color: '#22c55e', dash: false, label: 'DTLS-SRTP/UDP (Direct)' },
    { color: '#eab308', dash: false, label: 'stun: STUN (NAT Discovery)' },
    { color: '#f97316', dash: false, label: 'turn:/turns: TURN (Relay)' }
  ];

  const x = 12;
  const y = h - items.length * 16 - 8;

  ctx.save();
  ctx.font = '10px -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';

  items.forEach((item, i) => {
    const ly = y + i * 16;
    ctx.strokeStyle = item.color;
    ctx.lineWidth = 2;
    ctx.setLineDash(item.dash ? [4, 3] : []);
    ctx.beginPath();
    ctx.moveTo(x, ly);
    ctx.lineTo(x + 20, ly);
    ctx.stroke();

    ctx.setLineDash([]);
    ctx.fillStyle = item.color;
    ctx.fillText(item.label, x + 26, ly);
  });

  ctx.restore();
}
