export async function toggleTopology() {
  const panel = document.getElementById('topology-panel');
  const btn = document.getElementById('toggle-topology');
  const isVisible = panel.style.display !== 'none';

  if (isVisible) {
    panel.style.display = 'none';
    btn.classList.remove('active');
    // Stop auto-refresh
    if (this._topoInterval) {
      clearInterval(this._topoInterval);
      this._topoInterval = null;
    }
  } else {
    panel.style.display = 'flex';
    btn.classList.add('active');
    await this.renderTopology();
    // Start auto-refresh every 2 seconds
    this._topoInterval = setInterval(() => {
      if (panel.style.display === 'none') {
        clearInterval(this._topoInterval);
        this._topoInterval = null;
        return;
      }
      this.renderTopology();
    }, 2000);
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
  edges.push({ from: 'self', to: 'signaling', label: wsProtocol, style: 'signaling', serverUrl: signalingUri, serverIp });

  // STUN/TURN servers from ICE config
  const stunServers = []; // { id, url }
  const turnId = [];
  if (this.iceServers && this.iceServers.iceServers) {
    let stunIndex = 0;
    for (const server of this.iceServers.iceServers) {
      const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
      for (const url of urls) {
        if (url.startsWith('stun:')) {
          const id = `stun-${stunIndex++}`;
          nodes.push({ id, label: `STUN\n${url}`, type: 'stun', connectedAt: this.connectionTimestamps.get(id) || null });
          stunServers.push({ id, url });
          edges.push({ from: 'self', to: id, label: 'stun:', style: 'stun', serverUrl: url });
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
    edges.push({ from: peerId, to: 'signaling', label: wsProtocol, style: 'signaling', serverUrl: signalingUri, serverIp });

    // STUN edges for each peer (all peers discover their public IP via STUN)
    for (const stun of stunServers) {
      edges.push({ from: peerId, to: stun.id, label: 'stun:', style: 'stun', serverUrl: stun.url });
    }

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

  // Add peer-to-peer mesh connections (every peer connects to every other peer)
  const peerIds = [...this.peers.keys()].map(id => `peer-${id}`);
  for (let i = 0; i < peerIds.length; i++) {
    for (let j = i + 1; j < peerIds.length; j++) {
      edges.push({ from: peerIds[i], to: peerIds[j], label: 'DTLS-SRTP/UDP', style: 'direct', isMedia: true });
    }
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

  // Add hint (once)
  if (!canvas.querySelector('.topo-hint')) {
    const hint = document.createElement('div');
    hint.className = 'topo-hint';
    hint.textContent = 'Click on nodes and connections for more detail';
    canvas.appendChild(hint);
  }

  // TURN placeholder in upper left (always visible, semi-transparent, no connections)
  const hasTurnNode = data.nodes.some(n => n.type === 'turn');
  if (!hasTurnNode) {
    const turnPlaceholder = document.createElement('div');
    turnPlaceholder.className = 'topo-node topo-node-placeholder';
    const turnIcon = document.createElement('div');
    turnIcon.className = 'topo-node-icon turn server';
    turnIcon.textContent = '🔄';
    turnPlaceholder.appendChild(turnIcon);
    const turnLabel = document.createElement('div');
    turnLabel.className = 'topo-node-label';
    const turnName = document.createElement('div');
    turnName.className = 'topo-name';
    turnName.textContent = 'TURN';
    turnLabel.appendChild(turnName);
    turnPlaceholder.appendChild(turnLabel);
    turnPlaceholder.style.left = '40px';
    turnPlaceholder.style.top = '40px';
    turnPlaceholder.style.transform = 'translate(0, 0)';
    turnPlaceholder.addEventListener('click', (e) => {
      e.stopPropagation();
      this.showTopologyStatsPopup(turnPlaceholder, { id: 'turn-placeholder', type: 'turn', label: 'TURN\n(not configured)' });
    });
    canvas.appendChild(turnPlaceholder);
  }

  // Position nodes elliptically to fill available space
  requestAnimationFrame(() => {
    const rect = canvas.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    // Elliptical radii — use most of the available space (leave margin for labels)
    const rx = cx * 0.82;
    const ry = cy * 0.78;

    // Self at center
    if (selfNode) {
      const el = nodeElements.get(selfNode.id);
      el.style.left = cx + 'px';
      el.style.top = cy + 'px';
    }

    // Infrastructure in narrow upper arc (-130° to -50°), pushed higher
    const infraStart = -130 * (Math.PI / 180);
    const infraEnd = -50 * (Math.PI / 180);
    infraNodes.forEach((node, i) => {
      const count = infraNodes.length;
      const angle = count === 1
        ? -Math.PI / 2
        : infraStart + (infraEnd - infraStart) * (i / (count - 1));
      const el = nodeElements.get(node.id);
      el.style.left = (cx + rx * Math.cos(angle)) + 'px';
      el.style.top = (cy + ry * 0.9 * Math.sin(angle)) + 'px';
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
      el.style.left = (cx + rx * Math.cos(angle)) + 'px';
      el.style.top = (cy + ry * Math.sin(angle)) + 'px';
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
  el.dataset.nodeType = node.type;

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

  // Click handler for stats popup
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    this.showTopologyStatsPopup(el, node);
  });

  return el;
}

export function drawTopologyEdges(svg, edges, nodeElements, container) {
  const ns = 'http://www.w3.org/2000/svg';
  svg.innerHTML = '';

  // Add animation defs
  const defs = document.createElementNS(ns, 'defs');
  svg.appendChild(defs);

  const containerRect = container.getBoundingClientRect();

  const styleColors = {
    signaling: '#94a3b8',
    direct: '#22c55e',
    stun: '#eab308',
    turn: '#f97316',
    connecting: '#64748b'
  };

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
    const isLight = edge.style === 'signaling' || edge.style === 'stun';
    const strokeWidth = isLight ? '1.5' : '2';
    const isMedia = edge.isMedia && edge.style !== 'connecting';

    if (isMedia) {
      // Draw two parallel lines offset slightly, flowing in opposite directions
      const perpX = -ny;  // perpendicular to line direction
      const perpY = nx;
      const offset = 1.5;  // pixel offset from center

      // Forward line (from → to)
      const fwd = document.createElementNS(ns, 'line');
      fwd.setAttribute('x1', sx + perpX * offset);
      fwd.setAttribute('y1', sy + perpY * offset);
      fwd.setAttribute('x2', ex + perpX * offset);
      fwd.setAttribute('y2', ey + perpY * offset);
      fwd.setAttribute('stroke', color);
      fwd.setAttribute('stroke-width', strokeWidth);
      fwd.setAttribute('stroke-dasharray', '8 4');
      fwd.setAttribute('stroke-opacity', '0.8');
      fwd.classList.add('topo-edge-animated');
      svg.appendChild(fwd);

      // Reverse line (to → from) — opposite animation direction
      const rev = document.createElementNS(ns, 'line');
      rev.setAttribute('x1', sx - perpX * offset);
      rev.setAttribute('y1', sy - perpY * offset);
      rev.setAttribute('x2', ex - perpX * offset);
      rev.setAttribute('y2', ey - perpY * offset);
      rev.setAttribute('stroke', color);
      rev.setAttribute('stroke-width', strokeWidth);
      rev.setAttribute('stroke-dasharray', '8 4');
      rev.setAttribute('stroke-opacity', '0.8');
      rev.classList.add('topo-edge-animated-reverse');
      svg.appendChild(rev);

      // Invisible wider hit-area line for click detection (centered)
      const hitLine = document.createElementNS(ns, 'line');
      hitLine.setAttribute('x1', sx);
      hitLine.setAttribute('y1', sy);
      hitLine.setAttribute('x2', ex);
      hitLine.setAttribute('y2', ey);
      hitLine.setAttribute('stroke', 'transparent');
      hitLine.setAttribute('stroke-width', '18');
      hitLine.setAttribute('pointer-events', 'stroke');
      hitLine.style.cursor = 'pointer';
      hitLine.addEventListener('click', (e) => {
        e.stopPropagation();
        this.showEdgePopup(e, edge);
      });
      // Hover highlight
      hitLine.addEventListener('mouseenter', () => {
        fwd.setAttribute('stroke-opacity', '1');
        fwd.setAttribute('stroke-width', parseFloat(strokeWidth) + 1);
        rev.setAttribute('stroke-opacity', '1');
        rev.setAttribute('stroke-width', parseFloat(strokeWidth) + 1);
      });
      hitLine.addEventListener('mouseleave', () => {
        fwd.setAttribute('stroke-opacity', '0.8');
        fwd.setAttribute('stroke-width', strokeWidth);
        rev.setAttribute('stroke-opacity', '0.8');
        rev.setAttribute('stroke-width', strokeWidth);
      });
      svg.appendChild(hitLine);
    } else {
      // Single line for non-media edges
      const line = document.createElementNS(ns, 'line');
      line.setAttribute('x1', sx);
      line.setAttribute('y1', sy);
      line.setAttribute('x2', ex);
      line.setAttribute('y2', ey);
      line.setAttribute('stroke', color);
      line.setAttribute('stroke-width', strokeWidth);
      if (isLight) {
        line.setAttribute('stroke-dasharray', '6 4');
        line.setAttribute('stroke-opacity', '0.3');
      }

      svg.appendChild(line);

      // Invisible wider hit-area line for click detection
      const hitLine = document.createElementNS(ns, 'line');
      hitLine.setAttribute('x1', sx);
      hitLine.setAttribute('y1', sy);
      hitLine.setAttribute('x2', ex);
      hitLine.setAttribute('y2', ey);
      hitLine.setAttribute('stroke', 'transparent');
      hitLine.setAttribute('stroke-width', '14');
      hitLine.setAttribute('pointer-events', 'stroke');
      hitLine.style.cursor = 'pointer';
      hitLine.addEventListener('click', (e) => {
        e.stopPropagation();
        this.showEdgePopup(e, edge);
      });
      // Hover highlight
      hitLine.addEventListener('mouseenter', () => {
        line.setAttribute('stroke-opacity', '1');
        line.setAttribute('stroke-width', parseFloat(strokeWidth) + 1.5);
      });
      hitLine.addEventListener('mouseleave', () => {
        line.setAttribute('stroke-opacity', isLight ? '0.3' : '1');
        line.setAttribute('stroke-width', strokeWidth);
      });
      svg.appendChild(hitLine);
    }
  }
}

export function renderTopologyLegend(container) {
  const items = [
    { color: '#94a3b8', dashed: true, text: 'wss:// Socket.IO (Signaling)' },
    { color: '#22c55e', dashed: false, text: 'DTLS-SRTP/UDP (Direct)' },
    { color: '#eab308', dashed: true, text: 'stun: STUN (NAT Discovery)' },
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

// Infrastructure explanations for topology popup
const TOPO_EXPLANATIONS = {
  infrastructure: 'WebSocket connection used for session signaling — joining rooms, exchanging SDP offers/answers, and relaying ICE candidates between peers.',
  stun: 'Session Traversal Utilities for NAT. A lightweight server that tells your browser its public IP address so peers can connect directly. Free and fast, but fails if both peers are behind strict firewalls.',
  turn: 'Traversal Using Relays around NAT. A relay server that forwards all media traffic when direct connection fails. Always works but adds latency and costs bandwidth. Used as a last resort.'
};

function lastValid(arr) {
  if (!arr) return null;
  for (let i = arr.length - 1; i >= 0; i--) {
    if (arr[i] != null) return arr[i];
  }
  return null;
}

function mosLabel(mos) {
  if (mos >= 4.3) return 'Excellent';
  if (mos >= 4.0) return 'Good';
  if (mos >= 3.6) return 'Fair';
  if (mos >= 3.0) return 'Acceptable';
  return 'Poor';
}

function mosDotClass(mos) {
  if (mos == null) return '';
  if (mos >= 4.0) return 'green';
  if (mos >= 3.0) return 'yellow';
  return 'red';
}

function mosBadgeClass(mos) {
  if (mos == null) return '';
  if (mos >= 4.0) return 'good';
  if (mos >= 3.0) return 'warn';
  return 'crit';
}

function stripCodecPrefix(codec) {
  return (codec || '–').replace(/^(audio|video)\//, '');
}

function formatUptime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function addPopupCloseBtn(popup) {
  const btn = document.createElement('button');
  btn.className = 'topo-popup-close';
  btn.innerHTML = '&times;';
  btn.addEventListener('click', (e) => { e.stopPropagation(); popup.remove(); });
  popup.appendChild(btn);
}

function centerPopup(popup) {
  document.body.appendChild(popup);
  popup.style.top = '50%';
  popup.style.left = '50%';
  popup.style.transform = 'translate(-50%, -50%)';
  const dismiss = (e) => {
    if (popup.contains(e.target)) return;
    popup.remove();
    document.removeEventListener('click', dismiss);
  };
  setTimeout(() => document.addEventListener('click', dismiss), 0);
}

function positionAndShowPopup(popup, anchorRect, pad) {
  document.body.appendChild(popup);
  const popRect = popup.getBoundingClientRect();
  let top = anchorRect.top - popRect.height - pad;
  if (top < pad) top = anchorRect.bottom + pad;
  let left = anchorRect.left + anchorRect.width / 2 - popRect.width / 2;
  if (left + popRect.width > window.innerWidth - pad) left = window.innerWidth - popRect.width - pad;
  if (left < pad) left = pad;
  popup.style.top = top + 'px';
  popup.style.left = left + 'px';
  const dismiss = (e) => {
    if (popup.contains(e.target)) return;
    popup.remove();
    document.removeEventListener('click', dismiss);
  };
  setTimeout(() => document.addEventListener('click', dismiss), 0);
}

// Protocol descriptions for edge popups
const EDGE_DESCRIPTIONS = {
  signaling: 'WebSocket (Socket.IO) — carries signaling messages: SDP offers/answers, ICE candidates, room join/leave events. No media flows through this channel.',
  stun: 'STUN (Session Traversal Utilities for NAT) — your browser sends a binding request to discover its public IP:port. The server echoes back your reflexive address so peers can attempt a direct connection.',
  turn: 'TURN (Traversal Using Relays around NAT) — when direct P2P fails, media is relayed through this server. Adds latency but guarantees connectivity behind restrictive NATs/firewalls.',
  media: 'DTLS-SRTP — media is encrypted with DTLS (Datagram TLS) for the key exchange and SRTP (Secure Real-time Transport Protocol) for audio/video packets. Data flows directly between browsers over UDP.',
};

export async function showEdgePopup(event, edge) {
  // Remove any existing popup
  document.querySelectorAll('.topo-stats-popup').forEach(p => p.remove());

  const popup = document.createElement('div');
  popup.className = 'topo-stats-popup';

  // Determine if this is a peer media edge
  const peerEndpoint = [edge.from, edge.to].find(id => id.startsWith('peer-'));
  const isSelfEdge = [edge.from, edge.to].includes('self');
  const isPeerMedia = edge.isMedia && peerEndpoint && isSelfEdge;

  if (isPeerMedia) {
    const userId = peerEndpoint.replace(/^peer-/, '');
    const peer = this.peers.get(userId);

    if (!peer || !peer.connection) {
      popup.innerHTML = `<div class="topo-stats-header"><span class="topo-stats-name">Connection</span></div><div style="color:#64748b;">Peer not connected</div>`;
    } else {
      const pc = peer.connection;
      const selfName = this.username || 'You';
      let html = `<div class="topo-stats-header"><span class="topo-stats-name">${this.escapeHtml(selfName)} ⇄ ${this.escapeHtml(peer.username || 'Peer')}</span><span class="topo-stats-badge good">${edge.label}</span></div>`;
      html += `<div class="topo-stats-explain">${EDGE_DESCRIPTIONS.media}</div>`;

      // Transceivers (media tracks)
      const transceivers = pc.getTransceivers();
      if (transceivers.length > 0) {
        html += `<div class="topo-edge-section">Media Tracks</div>`;
        for (const t of transceivers) {
          const sender = t.sender;
          const receiver = t.receiver;
          const sTrack = sender && sender.track;
          const rTrack = receiver && receiver.track;
          const kind = sTrack ? sTrack.kind : (rTrack ? rTrack.kind : 'unknown');
          const kindIcon = kind === 'audio' ? '🎤' : kind === 'video' ? '📹' : '❓';
          const dir = t.direction || 'unknown';
          const dirArrow = { sendrecv: '⇄', sendonly: '→', recvonly: '←', inactive: '⏸' }[dir] || dir;

          // Track states
          const sState = sTrack ? (sTrack.enabled ? (sTrack.muted ? 'muted' : 'live') : 'disabled') : '–';
          const rState = rTrack ? (rTrack.enabled ? (rTrack.muted ? 'muted' : 'live') : 'disabled') : '–';

          html += `<div class="topo-edge-channel">`;
          html += `<span class="topo-edge-kind">${kindIcon} ${kind}</span>`;
          html += `<span class="topo-edge-dir">${dirArrow} ${dir}</span>`;
          html += `<span class="topo-edge-state">send: <em>${sState}</em> recv: <em>${rState}</em></span>`;
          html += `</div>`;
        }
      }

      // DataChannels
      const dc = this.telemetryChannels ? this.telemetryChannels.get(userId) : null;
      html += `<div class="topo-edge-section">Data Channels</div>`;
      if (dc) {
        const stateClass = dc.readyState === 'open' ? 'green' : (dc.readyState === 'connecting' ? 'yellow' : 'red');
        html += `<div class="topo-edge-channel">`;
        html += `<span class="topo-edge-kind">📡 ${dc.label || 'telemetry'}</span>`;
        html += `<span class="topo-edge-state"><span class="topo-stats-dot ${stateClass}" style="display:inline-block;vertical-align:middle;margin-right:4px;"></span>${dc.readyState}</span>`;
        html += `</div>`;
      } else {
        html += `<div class="topo-edge-channel"><span style="color:#64748b;">No DataChannels</span></div>`;
      }

      // Connection details from stats
      try {
        const stats = await pc.getStats();
        let activePair = null;
        const candidateMap = new Map();

        stats.forEach(report => {
          if (report.type === 'transport' && report.selectedCandidatePairId) {
            stats.forEach(r => { if (r.id === report.selectedCandidatePairId) activePair = r; });
          }
          if (report.type === 'local-candidate' || report.type === 'remote-candidate') {
            candidateMap.set(report.id, report);
          }
        });
        if (!activePair) {
          stats.forEach(r => { if (r.type === 'candidate-pair' && r.state === 'succeeded') activePair = r; });
        }

        if (activePair) {
          const localCand = candidateMap.get(activePair.localCandidateId);
          const remoteCand = candidateMap.get(activePair.remoteCandidateId);

          html += `<div class="topo-edge-section">Active Candidate Pair</div>`;
          if (localCand) {
            html += `<div class="topo-stats-row wrap"><span class="topo-stats-label">Local</span><span class="topo-stats-value">${localCand.candidateType} ${localCand.protocol || ''} ${localCand.address || ''}:${localCand.port || ''}</span></div>`;
          }
          if (remoteCand) {
            html += `<div class="topo-stats-row wrap"><span class="topo-stats-label">Remote</span><span class="topo-stats-value">${remoteCand.candidateType} ${remoteCand.protocol || ''} ${remoteCand.address || ''}:${remoteCand.port || ''}</span></div>`;
          }
        }
      } catch (e) { /* stats unavailable */ }

      // Connection state summary
      html += `<div class="topo-edge-section">State</div>`;
      html += `<div class="topo-stats-row"><span class="topo-stats-label">Connection</span><span class="topo-stats-value">${pc.connectionState}</span></div>`;
      html += `<div class="topo-stats-row"><span class="topo-stats-label">ICE</span><span class="topo-stats-value">${pc.iceConnectionState}</span></div>`;
      html += `<div class="topo-stats-row"><span class="topo-stats-label">Signaling</span><span class="topo-stats-value">${pc.signalingState}</span></div>`;

      popup.innerHTML = html;
    }
  } else if (edge.isMedia) {
    // Peer-to-peer media edge between two remote peers — show full details from our connections to each
    const fromId = edge.from.replace(/^peer-/, '');
    const toId = edge.to.replace(/^peer-/, '');
    const fromPeer = this.peers.get(fromId);
    const toPeer = this.peers.get(toId);
    const fromName = fromPeer ? (fromPeer.username || 'Peer') : edge.from;
    const toName = toPeer ? (toPeer.username || 'Peer') : edge.to;

    let html = `<div class="topo-stats-header"><span class="topo-stats-name">${this.escapeHtml(fromName)} ⇄ ${this.escapeHtml(toName)}</span><span class="topo-stats-badge good">${edge.label}</span></div>`;
    html += `<div class="topo-stats-explain">${EDGE_DESCRIPTIONS.media}</div>`;

    // Show full connection details for each peer (from our connection to them)
    for (const [userId, name] of [[fromId, fromName], [toId, toName]]) {
      const peer = this.peers.get(userId);
      if (!peer || !peer.connection) continue;
      const pc = peer.connection;

      html += `<div class="topo-edge-section">${this.escapeHtml(name)}</div>`;

      // Transceivers
      const transceivers = pc.getTransceivers();
      if (transceivers.length > 0) {
        for (const t of transceivers) {
          const sTrack = t.sender && t.sender.track;
          const rTrack = t.receiver && t.receiver.track;
          const kind = sTrack ? sTrack.kind : (rTrack ? rTrack.kind : 'unknown');
          const kindIcon = kind === 'audio' ? '🎤' : kind === 'video' ? '📹' : '❓';
          const dir = t.direction || 'unknown';
          const dirArrow = { sendrecv: '⇄', sendonly: '→', recvonly: '←', inactive: '⏸' }[dir] || dir;
          const sState = sTrack ? (sTrack.enabled ? (sTrack.muted ? 'muted' : 'live') : 'disabled') : '–';
          const rState = rTrack ? (rTrack.enabled ? (rTrack.muted ? 'muted' : 'live') : 'disabled') : '–';
          html += `<div class="topo-edge-channel"><span class="topo-edge-kind">${kindIcon} ${kind}</span><span class="topo-edge-dir">${dirArrow} ${dir}</span><span class="topo-edge-state">send: <em>${sState}</em> recv: <em>${rState}</em></span></div>`;
        }
      }

      // DataChannel
      const dc = this.telemetryChannels ? this.telemetryChannels.get(userId) : null;
      if (dc) {
        const stateClass = dc.readyState === 'open' ? 'green' : (dc.readyState === 'connecting' ? 'yellow' : 'red');
        html += `<div class="topo-edge-channel"><span class="topo-edge-kind">📡 ${dc.label || 'telemetry'}</span><span class="topo-edge-state"><span class="topo-stats-dot ${stateClass}" style="display:inline-block;vertical-align:middle;margin-right:4px;"></span>${dc.readyState}</span></div>`;
      }

      // Active candidate pair
      try {
        const stats = await pc.getStats();
        let activePair = null;
        const candidateMap = new Map();
        stats.forEach(report => {
          if (report.type === 'transport' && report.selectedCandidatePairId) {
            stats.forEach(r => { if (r.id === report.selectedCandidatePairId) activePair = r; });
          }
          if (report.type === 'local-candidate' || report.type === 'remote-candidate') candidateMap.set(report.id, report);
        });
        if (!activePair) stats.forEach(r => { if (r.type === 'candidate-pair' && r.state === 'succeeded') activePair = r; });

        if (activePair) {
          const localCand = candidateMap.get(activePair.localCandidateId);
          const remoteCand = candidateMap.get(activePair.remoteCandidateId);
          if (localCand) html += `<div class="topo-stats-row wrap"><span class="topo-stats-label">Local</span><span class="topo-stats-value">${localCand.candidateType} ${localCand.protocol || ''} ${localCand.address || ''}:${localCand.port || ''}</span></div>`;
          if (remoteCand) html += `<div class="topo-stats-row wrap"><span class="topo-stats-label">Remote</span><span class="topo-stats-value">${remoteCand.candidateType} ${remoteCand.protocol || ''} ${remoteCand.address || ''}:${remoteCand.port || ''}</span></div>`;
        }
      } catch (e) { /* stats unavailable */ }

      // State
      html += `<div class="topo-stats-row"><span class="topo-stats-label">Connection</span><span class="topo-stats-value">${pc.connectionState}</span></div>`;
      html += `<div class="topo-stats-row"><span class="topo-stats-label">ICE</span><span class="topo-stats-value">${pc.iceConnectionState}</span></div>`;
    }

    popup.innerHTML = html;
  } else if (edge.style === 'stun') {
    // STUN edge — show server URL, endpoint, and discovered reflexive addresses
    const stunNodeId = [edge.from, edge.to].find(id => id.startsWith('stun-'));
    const endpointId = [edge.from, edge.to].find(id => id !== stunNodeId);
    const isSelf = endpointId === 'self';
    const endpointName = isSelf ? (this.username || 'You') : (() => {
      const uid = endpointId.replace(/^peer-/, '');
      const p = this.peers.get(uid);
      return p ? (p.username || 'Peer') : 'Peer';
    })();

    const stunUrl = edge.serverUrl || 'STUN server';

    let html = `<div class="topo-stats-header"><span class="topo-stats-name">${this.escapeHtml(endpointName)} → STUN</span><span class="topo-stats-badge">${this.escapeHtml(stunUrl)}</span></div>`;
    html += `<div class="topo-stats-explain">${EDGE_DESCRIPTIONS.stun}</div>`;

    // Gather srflx candidates from peer connections
    const srflxAddresses = new Set();
    if (isSelf) {
      for (const [, peer] of this.peers) {
        try {
          const stats = await peer.connection.getStats();
          stats.forEach(report => {
            if (report.type === 'local-candidate' && report.candidateType === 'srflx' && report.address) {
              srflxAddresses.add(`${report.protocol || 'udp'} ${report.address}:${report.port || ''}`);
            }
          });
        } catch (e) { /* skip */ }
      }
    } else {
      const uid = endpointId.replace(/^peer-/, '');
      const peer = this.peers.get(uid);
      if (peer && peer.connection) {
        try {
          const stats = await peer.connection.getStats();
          stats.forEach(report => {
            if (report.type === 'remote-candidate' && report.candidateType === 'srflx' && report.address) {
              srflxAddresses.add(`${report.protocol || 'udp'} ${report.address}:${report.port || ''}`);
            }
          });
        } catch (e) { /* skip */ }
      }
    }

    if (srflxAddresses.size > 0) {
      html += `<div class="topo-edge-section">Discovered Reflexive Address${srflxAddresses.size > 1 ? 'es' : ''}</div>`;
      for (const addr of srflxAddresses) {
        html += `<div class="topo-stats-row"><span class="topo-stats-label">srflx</span><span class="topo-stats-value">${this.escapeHtml(addr)}</span></div>`;
      }
    } else {
      html += `<div class="topo-edge-section">Reflexive Addresses</div>`;
      html += `<div class="topo-stats-row"><span class="topo-stats-value" style="color:#64748b;">No srflx candidates found</span></div>`;
    }

    popup.innerHTML = html;
  } else if (edge.style === 'signaling') {
    // Signaling edge — show server URL, IP, endpoint, and Socket.IO transport
    const endpointId = [edge.from, edge.to].find(id => id !== 'signaling');
    const isSelf = endpointId === 'self';
    const endpointName = isSelf ? (this.username || 'You') : (() => {
      const uid = endpointId.replace(/^peer-/, '');
      const p = this.peers.get(uid);
      return p ? (p.username || 'Peer') : 'Peer';
    })();

    let html = `<div class="topo-stats-header"><span class="topo-stats-name">${this.escapeHtml(endpointName)} → Signaling</span><span class="topo-stats-badge">${this.escapeHtml(edge.serverUrl || '')}</span></div>`;
    html += `<div class="topo-stats-explain">${EDGE_DESCRIPTIONS.signaling}</div>`;

    html += `<div class="topo-edge-section">Connection Details</div>`;
    if (edge.serverUrl) {
      html += `<div class="topo-stats-row"><span class="topo-stats-label">URL</span><span class="topo-stats-value">${this.escapeHtml(edge.serverUrl)}</span></div>`;
    }
    if (edge.serverIp) {
      html += `<div class="topo-stats-row"><span class="topo-stats-label">Server IP</span><span class="topo-stats-value">${this.escapeHtml(edge.serverIp)}</span></div>`;
    }

    if (isSelf && this.socket) {
      const transport = this.socket.io && this.socket.io.engine ? this.socket.io.engine.transport.name : null;
      html += `<div class="topo-stats-row"><span class="topo-stats-label">Transport</span><span class="topo-stats-value">${transport || 'unknown'}</span></div>`;
      html += `<div class="topo-stats-row"><span class="topo-stats-label">Socket ID</span><span class="topo-stats-value">${this.escapeHtml(this.socket.id || 'unknown')}</span></div>`;
      html += `<div class="topo-stats-row"><span class="topo-stats-label">Connected</span><span class="topo-stats-value">${this.socket.connected ? 'Yes' : 'No'}</span></div>`;
    } else if (!isSelf) {
      html += `<div class="topo-stats-row"><span class="topo-stats-value" style="color:#64748b;">Detailed transport info only available for your own connection</span></div>`;
    }

    popup.innerHTML = html;
  } else {
    // Non-media edge (TURN, etc.)
    const desc = EDGE_DESCRIPTIONS[edge.style] || `${edge.label} connection`;
    popup.innerHTML = `<div class="topo-stats-header"><span class="topo-stats-name">${edge.label}</span></div><div class="topo-stats-explain">${desc}</div>`;
  }

  addPopupCloseBtn(popup);
  centerPopup(popup);
}

export function showConfigurationsPopup() {
  // Remove any existing configurations popup
  document.querySelectorAll('.config-popup-overlay').forEach(p => p.remove());

  const n = this.peers.size + 1; // peers + self
  // Dynamic import to keep configurations.js standalone
  import('./configurations.js').then(({ enumerateConfigurations }) => {
    const result = enumerateConfigurations(n);
    const { totalRaw, configurations } = result;

    // Overlay
    const overlay = document.createElement('div');
    overlay.className = 'config-popup-overlay';

    // Modal
    const modal = document.createElement('div');
    modal.className = 'config-popup';

    // Header
    const header = document.createElement('div');
    header.className = 'config-popup-header';
    header.innerHTML =
      `<div>
        <div class="config-popup-title">${n} nodes &mdash; ${configurations.length} potential topologies</div>
        <div class="config-popup-subtitle">Possibilities if Selective Forwarding Units (SFUs) were to be employed</div>
        <div class="config-popup-subtitle">${totalRaw} total configurations before isomorphism collapse</div>
      </div>`;
    const closeBtn = document.createElement('button');
    closeBtn.className = 'stats-close-btn';
    closeBtn.innerHTML = '&times;';
    closeBtn.addEventListener('click', () => overlay.remove());
    header.appendChild(closeBtn);
    modal.appendChild(header);

    // Grid of mini-diagrams
    const grid = document.createElement('div');
    grid.className = 'config-grid';

    for (const cfg of configurations) {
      const card = document.createElement('div');
      card.className = 'config-card';

      // SVG mini-diagram
      const size = 90;
      const ns = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(ns, 'svg');
      svg.setAttribute('width', size);
      svg.setAttribute('height', size);
      svg.setAttribute('viewBox', `0 0 ${size} ${size}`);

      const cx = size / 2;
      const cy = size / 2;
      const radius = size * 0.35;
      const nodeRadius = n <= 4 ? 6 : 5;

      // Position nodes on a circle
      const positions = cfg.nodes.map((_, i) => {
        if (cfg.nodes.length === 1) return { x: cx, y: cy };
        const angle = -Math.PI / 2 + (2 * Math.PI * i) / cfg.nodes.length;
        return { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) };
      });

      // Draw edges
      for (const [i, j] of cfg.edges) {
        const line = document.createElementNS(ns, 'line');
        line.setAttribute('x1', positions[i].x);
        line.setAttribute('y1', positions[i].y);
        line.setAttribute('x2', positions[j].x);
        line.setAttribute('y2', positions[j].y);
        // SFU-SFU edges are dashed orange; SFU-peer edges are solid
        const isSfuEdge = cfg.nodes[i].type === 'sfu' && cfg.nodes[j].type === 'sfu';
        line.setAttribute('stroke', isSfuEdge ? '#f97316' : '#64748b');
        line.setAttribute('stroke-width', '1.5');
        if (isSfuEdge) line.setAttribute('stroke-dasharray', '3 2');
        line.setAttribute('stroke-opacity', '0.7');
        svg.appendChild(line);
      }

      // Draw nodes
      for (let i = 0; i < cfg.nodes.length; i++) {
        const circle = document.createElementNS(ns, 'circle');
        circle.setAttribute('cx', positions[i].x);
        circle.setAttribute('cy', positions[i].y);
        circle.setAttribute('r', nodeRadius);
        circle.setAttribute('fill', cfg.nodes[i].type === 'sfu' ? '#f97316' : '#3b82f6');
        circle.setAttribute('stroke', cfg.nodes[i].type === 'sfu' ? '#ea580c' : '#2563eb');
        circle.setAttribute('stroke-width', '1.5');
        svg.appendChild(circle);
      }

      card.appendChild(svg);

      // Label
      const label = document.createElement('div');
      label.className = 'config-card-label';
      if (cfg.k === 0) {
        label.textContent = 'full mesh';
      } else if (cfg.k === n) {
        label.textContent = 'all SFU';
      } else {
        const dist = cfg.distribution.filter(d => d > 0);
        label.textContent = cfg.k + ' SFU' + (cfg.k > 1 ? 's' : '') +
          (dist.length ? ' [' + cfg.distribution.join(',') + ']' : '');
      }
      card.appendChild(label);

      grid.appendChild(card);
    }

    modal.appendChild(grid);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // Click overlay background to dismiss
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });
  });
}

export function showTopologyStatsPopup(anchorEl, node) {
  // Remove any existing popup
  document.querySelectorAll('.topo-stats-popup').forEach(p => p.remove());

  const popup = document.createElement('div');
  popup.className = 'topo-stats-popup';

  if (node.type === 'peer') {
    // Peer node — show dashboard stats
    const userId = node.id.replace(/^peer-/, '');
    const history = this.dashboardHistory ? this.dashboardHistory.get(userId) : null;

    if (!history) {
      popup.innerHTML = `<div class="topo-stats-header"><span class="topo-stats-name">${node.label.split('\n')[0]}</span></div><div style="color:#64748b;">No stats available yet</div>`;
    } else {
      const mos = lastValid(history.mos);
      const rtt = lastValid(history.rtt);
      const jitter = lastValid(history.jitter);
      const packetLoss = lastValid(history.packetLoss);
      const sendRes = lastValid(history.sendRes);
      const recvRes = lastValid(history.recvRes);
      const connTs = this.connectionTimestamps.get(`peer-${userId}`);
      const connTime = connTs ? connTs.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : null;

      let html = `<div class="topo-stats-header">`;
      if (mos != null) html += `<span class="topo-stats-dot ${mosDotClass(mos)}"></span>`;
      html += `<span class="topo-stats-name">${this.escapeHtml(history.username || node.label.split('\n')[0])}</span>`;
      if (mos != null) html += `<span class="topo-stats-badge ${mosBadgeClass(mos)}">${mosLabel(mos)} (${mos.toFixed(2)}/5)</span>`;
      html += `</div>`;

      const rows = [];
      if (rtt != null) rows.push(['RTT', `${rtt.toFixed(0)} ms`]);
      if (jitter != null) rows.push(['Jitter', `${jitter.toFixed(1)} ms`]);
      if (packetLoss != null) rows.push(['Packet Loss', `${packetLoss.toFixed(2)}%`]);
      if (history.audioCodec) rows.push(['Audio', stripCodecPrefix(history.audioCodec)]);
      if (history.videoCodec) rows.push(['Video', stripCodecPrefix(history.videoCodec)]);
      if (sendRes) rows.push(['Send Res', sendRes]);
      if (recvRes) rows.push(['Recv Res', recvRes]);
      if (history.dtlsState) rows.push(['DTLS', history.dtlsState]);
      if (history.localCandidate) rows.push(['Local', history.localCandidate, true]);
      if (history.remoteCandidate) rows.push(['Remote', history.remoteCandidate, true]);
      if (connTime) rows.push(['Connected', connTime]);

      for (const row of rows) {
        const [label, value, wrap] = row;
        html += `<div class="topo-stats-row${wrap ? ' wrap' : ''}"><span class="topo-stats-label">${label}</span><span class="topo-stats-value">${this.escapeHtml(value)}</span></div>`;
      }

      popup.innerHTML = html;
    }
  } else if (node.type === 'self') {
    // Self node — show own info with aggregated stats from all peers
    const selfTs = this.connectionTimestamps.get('self');
    const uptime = selfTs ? Math.floor((Date.now() - selfTs.getTime()) / 1000) : 0;
    const peerCount = this.peers.size;

    // Aggregate stats from all peer entries in dashboardHistory
    const mosArr = [], rttArr = [], jitterArr = [], lossArr = [];
    const codecs = { audio: new Set(), video: new Set() };
    const resolutions = { send: new Set(), recv: new Set() };

    if (this.dashboardHistory) {
      for (const [k, h] of this.dashboardHistory) {
        if (k === '__group__' || k.startsWith('remote-')) continue;
        const m = lastValid(h.mos);
        const r = lastValid(h.rtt);
        const j = lastValid(h.jitter);
        const pl = lastValid(h.packetLoss);
        if (m != null) mosArr.push(m);
        if (r != null) rttArr.push(r);
        if (j != null) jitterArr.push(j);
        if (pl != null) lossArr.push(pl);
        if (h.audioCodec) codecs.audio.add(stripCodecPrefix(h.audioCodec));
        if (h.videoCodec) codecs.video.add(stripCodecPrefix(h.videoCodec));
        const sr = lastValid(h.sendRes);
        const rr = lastValid(h.recvRes);
        if (sr) resolutions.send.add(sr);
        if (rr) resolutions.recv.add(rr);
      }
    }

    const avg = arr => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
    const avgMOS = avg(mosArr);
    const avgRTT = avg(rttArr);
    const avgJitter = avg(jitterArr);
    const avgLoss = avg(lossArr);

    let html = `<div class="topo-stats-header">`;
    if (avgMOS != null) html += `<span class="topo-stats-dot ${mosDotClass(avgMOS)}"></span>`;
    html += `<span class="topo-stats-name">${this.escapeHtml(this.username || 'You')} (You)</span>`;
    if (avgMOS != null) html += `<span class="topo-stats-badge ${mosBadgeClass(avgMOS)}">${mosLabel(avgMOS)} (${avgMOS.toFixed(2)}/5)</span>`;
    html += `</div>`;

    const rows = [];
    rows.push(['Peers', `${peerCount}`]);
    rows.push(['Session', formatUptime(uptime)]);
    if (avgRTT != null) rows.push(['Avg RTT', `${avgRTT.toFixed(0)} ms`]);
    if (avgJitter != null) rows.push(['Avg Jitter', `${avgJitter.toFixed(1)} ms`]);
    if (avgLoss != null) rows.push(['Avg Pkt Loss', `${avgLoss.toFixed(2)}%`]);
    if (codecs.audio.size > 0) rows.push(['Audio', [...codecs.audio].join(', ')]);
    if (codecs.video.size > 0) rows.push(['Video', [...codecs.video].join(', ')]);
    if (resolutions.send.size > 0) rows.push(['Send Res', [...resolutions.send].join(', ')]);
    if (resolutions.recv.size > 0) rows.push(['Recv Res', [...resolutions.recv].join(', ')]);
    // Show effective preferences — explicit choice if set, otherwise the in-use/default value
    const effRes = this.preferredResolution
      ? `${this.preferredResolution.width}x${this.preferredResolution.height}`
      : (resolutions.send.size > 0 ? [...resolutions.send][0] : 'auto');
    const effAudio = this.preferredAudioCodec
      || (codecs.audio.size > 0 ? [...codecs.audio][0] : 'auto');
    const effVideo = this.preferredVideoCodec
      || (codecs.video.size > 0 ? [...codecs.video][0] : 'auto');
    rows.push(['Pref. Res', effRes]);
    rows.push(['Pref. Audio', effAudio]);
    rows.push(['Pref. Video', effVideo]);
    if (selfTs) rows.push(['Connected', selfTs.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })]);

    for (const [label, value] of rows) {
      html += `<div class="topo-stats-row"><span class="topo-stats-label">${label}</span><span class="topo-stats-value">${this.escapeHtml(value)}</span></div>`;
    }

    popup.innerHTML = html;
  } else {
    // Infrastructure node — show explanation
    const explanation = TOPO_EXPLANATIONS[node.type] || 'Network infrastructure node.';
    popup.innerHTML = `<div class="topo-stats-header"><span class="topo-stats-name">${node.label.split('\n')[0]}</span></div><div class="topo-stats-explain">${explanation}</div>`;
  }

  addPopupCloseBtn(popup);
  positionAndShowPopup(popup, anchorEl.getBoundingClientRect(), 8);
}
