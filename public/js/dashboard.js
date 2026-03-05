const MAX_SAMPLES = 60; // ~10 min at 10s intervals

// Strip mime-type prefix from codec strings (e.g. "audio/opus" → "opus")
function stripCodecPrefix(codec) {
  return (codec || '–').replace(/^(audio|video)\//, '');
}

// Explanations map for clickable tooltips
const EXPLANATIONS = {
  'ICE Servers': 'Interactive Connectivity Establishment servers help peers discover how to connect to each other. They find the best network path through NATs and firewalls.',
  'STUN': 'Session Traversal Utilities for NAT. A lightweight server that tells your browser its public IP address so peers can connect directly. Free and fast, but fails if both peers are behind strict firewalls.',
  'TURN': 'Traversal Using Relays around NAT. A relay server that forwards all media traffic when direct connection fails. Always works but adds latency and costs bandwidth. Used as a last resort.',
  'Audio': 'The audio codec negotiated between peers. Opus adapts bitrate dynamically and works well for speech and music.',
  'Video': 'The video codec negotiated between peers. VP8 is widely supported; VP9 offers better compression; H.264 has hardware acceleration.',
  'DTLS': 'Datagram Transport Layer Security state. Encrypts all media between peers. "connected" = secure channel established.',
  'Local': 'Your local ICE candidate (network endpoint). "host" = direct address, "srflx" = behind NAT, "relay" = routed through TURN server.',
  'Remote': 'The peer\'s ICE candidate. Same types: host, srflx, relay. Both "host" = direct LAN connection.',
  'RTT': 'Round-Trip Time. How long a packet takes to reach the peer and return. Under 100ms is excellent, over 300ms causes noticeable lag.',
  'One-Way Latency': 'Estimated one-way delay (RTT/2). The actual delay before hearing/seeing the other person.',
  'Jitter': 'Variation in packet arrival times. High jitter causes choppy audio/video even with low average latency. Under 30ms is ideal.',
  'Packet Loss': 'Percentage of packets that never arrived. 1-2% degrades voice quality; above 5% causes severe artifacts.',
  'MOS Score': 'Mean Opinion Score (1-5), estimated using a simplified E-model (ITU-T G.107). Uses RTT, jitter, and packet loss to approximate call quality. The full ITU-T standard also includes codec impairment factors and echo/noise modeling. 4.0+ good, below 3.0 poor.',
  'Avg MOS': 'Average Mean Opinion Score (1-5) across all peers, estimated using a simplified E-model (ITU-T G.107). Uses RTT, jitter, and packet loss to approximate call quality. 4.0+ Excellent, 3.6+ Good, 3.0+ Fair, below 3.0 Poor.',
  'Send FPS': 'Frames per second being sent. 30fps is standard for video calls. Drops indicate CPU or bandwidth pressure.',
  'Recv FPS': 'Frames per second being received. 30fps is standard. Drops indicate the remote peer\'s CPU or bandwidth pressure.',
  'Avg Send FPS': 'Average send FPS across all peers.',
  'Avg Recv FPS': 'Average receive FPS across all peers.',
  'Send Rate': 'Current send bitrate in kilobits per second. Higher means better quality but more bandwidth usage.',
  'Recv Rate': 'Current receive bitrate in kilobits per second.',
  'Total Send Rate': 'Total send bitrate across all peers.',
  'Total Recv Rate': 'Total receive bitrate across all peers.',
  'Resolution': 'Video dimensions being sent/received. Higher resolution needs more bandwidth and CPU.',
  'Data Transfer': 'Total bytes sent and received over the connection lifetime.',
  'Total Data Transfer': 'Total bytes sent and received across all peer connections.',
  'Avg RTT': 'Average Round-Trip Time across all peers.',
  'Avg One-Way Latency': 'Average estimated one-way delay (RTT/2) across all peers.',
  'Avg Jitter': 'Average jitter across all peers.',
  'Avg Packet Loss': 'Average packet loss percentage across all peers.',
  'Peers Connected': 'Number of peers currently connected over time.',
  'Connected Peers': 'Number of peers currently in the session.',
  'Session Duration': 'Time since you joined this session.',
  'Data Transferred': 'Total data sent and received across all peer connections.',
  'host': 'A direct local network address. Best performance, no relay overhead.',
  'srflx': 'Server-reflexive: your public IP discovered by a STUN server. You\'re behind a NAT. Works for most connections.',
  'relay': 'Traffic relayed through a TURN server. Highest latency but always works when direct connection is impossible.',
  'udp': 'Preferred transport for real-time media. Lower latency than TCP.',
  'tcp': 'Fallback transport when UDP is blocked by firewalls.',
  'ICE Candidates': 'ICE (Interactive Connectivity Establishment) candidates are potential network endpoints (IP address + port) that a peer can use to receive media. Each peer gathers candidates of different types: host (direct local address), srflx (public IP via STUN), and relay (via TURN). The ICE agent tests candidate pairs to find the best working connection path.',
};

export function toggleDashboard() {
  const panel = document.getElementById('dashboard-panel');
  const btn = document.getElementById('toggle-dashboard');
  const isVisible = panel.style.display !== 'none';

  if (isVisible) {
    panel.style.display = 'none';
    btn.classList.remove('on');
  } else {
    panel.style.display = 'flex';
    btn.classList.add('on');
    this.startDashboardCollection();
    this.collectDashboardSnapshot().then(() => this.renderDashboard());
  }
}

export function startDashboardCollection() {
  if (this.dashboardInterval) return;
  this.dashboardInterval = setInterval(() => {
    this.collectDashboardSnapshot().then(() => {
      const panel = document.getElementById('dashboard-panel');
      if (panel && panel.style.display !== 'none') {
        this.renderDashboard();
      }
    });
  }, 2000);
}

export function stopDashboardCollection() {
  if (this.dashboardInterval) {
    clearInterval(this.dashboardInterval);
    this.dashboardInterval = null;
  }
}

export async function collectDashboardSnapshot() {
  if (!this.dashboardHistory) {
    this.dashboardHistory = new Map();
  }

  const now = Date.now();

  for (const [userId, peer] of this.peers) {
    const pc = peer.connection;
    if (!this.dashboardHistory.has(userId)) {
      this.dashboardHistory.set(userId, {
        username: peer.username,
        timestamps: [],
        rtt: [],
        jitter: [],
        packetLoss: [],
        sendFps: [],
        recvFps: [],
        sendBitrate: [],
        recvBitrate: [],
        sendRes: [],
        recvRes: [],
        mos: [],
        prevBytesSent: null,
        prevBytesRecv: null,
        prevTimestamp: null,
        totalBytesSent: 0,
        totalBytesRecv: 0,
        audioCodec: '',
        videoCodec: '',
        connectionState: '',
        iceState: '',
        dtlsState: '',
        localCandidate: '',
        remoteCandidate: '',
        localCandidates: [],
        remoteCandidates: []
      });
    }

    const history = this.dashboardHistory.get(userId);
    history.username = peer.username;

    try {
      const stats = await pc.getStats();
      let rtt = null, jitter = null, packetsLost = null, packetsRecv = null;
      let sendFps = null, recvFps = null;
      let sendResW = null, sendResH = null, recvResW = null, recvResH = null;
      let bytesSent = null, bytesRecv = null;
      let audioCodecId = null, videoCodecId = null;
      const codecMap = new Map();
      const candidateMap = new Map();
      let activePairId = null;

      history.connectionState = pc.connectionState || 'N/A';
      history.iceState = pc.iceConnectionState || 'N/A';

      stats.forEach(report => {
        if (report.type === 'transport') {
          activePairId = report.selectedCandidatePairId;
          if (report.dtlsState) history.dtlsState = report.dtlsState;
        }
        if (report.type === 'candidate-pair' && report.state === 'succeeded') {
          if (!activePairId) activePairId = report.id;
        }
        if (report.type === 'local-candidate' || report.type === 'remote-candidate') {
          candidateMap.set(report.id, report);
        }
        if (report.type === 'codec') {
          codecMap.set(report.id, report.mimeType);
        }
        if (report.type === 'inbound-rtp' && report.kind === 'audio') {
          if (report.codecId) audioCodecId = report.codecId;
          if (packetsLost == null) { packetsLost = report.packetsLost; packetsRecv = report.packetsReceived; }
          if (report.jitter != null && jitter == null) jitter = report.jitter * 1000;
        }
        if (report.type === 'inbound-rtp' && report.kind === 'video') {
          if (report.codecId) videoCodecId = report.codecId;
          if (report.frameWidth && report.frameHeight) { recvResW = report.frameWidth; recvResH = report.frameHeight; }
          if (report.framesPerSecond != null) recvFps = report.framesPerSecond;
          packetsLost = report.packetsLost;
          packetsRecv = report.packetsReceived;
          if (report.jitter != null) jitter = report.jitter * 1000;
        }
        if (report.type === 'outbound-rtp' && report.kind === 'video') {
          if (report.frameWidth && report.frameHeight) { sendResW = report.frameWidth; sendResH = report.frameHeight; }
          if (report.framesPerSecond != null) sendFps = report.framesPerSecond;
        }
      });

      if (audioCodecId && codecMap.has(audioCodecId)) history.audioCodec = codecMap.get(audioCodecId);
      if (videoCodecId && codecMap.has(videoCodecId)) history.videoCodec = codecMap.get(videoCodecId);

      // Read RTT, bytes, and candidate info from the active pair only
      if (activePairId) {
        stats.forEach(report => {
          if (report.id === activePairId) {
            if (report.currentRoundTripTime != null) rtt = report.currentRoundTripTime * 1000;
            if (report.bytesSent != null) bytesSent = report.bytesSent;
            if (report.bytesReceived != null) bytesRecv = report.bytesReceived;
            const local = candidateMap.get(report.localCandidateId);
            const remote = candidateMap.get(report.remoteCandidateId);
            if (local) history.localCandidate = `${local.candidateType} ${local.protocol || ''} ${local.address || local.ip || ''}:${local.port || ''}`;
            if (remote) history.remoteCandidate = `${remote.candidateType} ${remote.protocol || ''} ${remote.address || remote.ip || ''}:${remote.port || ''}`;
          }
        });
      }

      // Packet loss percentage
      let packetLoss = null;
      if (packetsRecv != null && packetsLost != null && (packetsRecv + packetsLost) > 0) {
        packetLoss = (packetsLost / (packetsRecv + packetsLost)) * 100;
      }

      // Bitrate (kbps) — only from the active candidate pair
      let sendBitrate = null, recvBitrate = null;
      if (history.prevBytesSent != null && bytesSent != null && history.prevTimestamp != null) {
        const dt = (now - history.prevTimestamp) / 1000;
        if (dt > 0) {
          sendBitrate = ((bytesSent - history.prevBytesSent) * 8) / dt / 1000;
          recvBitrate = ((bytesRecv - history.prevBytesRecv) * 8) / dt / 1000;
        }
      }
      history.prevBytesSent = bytesSent;
      history.prevBytesRecv = bytesRecv;
      history.prevTimestamp = now;

      // Track total data
      if (bytesSent != null) history.totalBytesSent = bytesSent;
      if (bytesRecv != null) history.totalBytesRecv = bytesRecv;

      // MOS score (E-model simplified)
      let mos = null;
      if (rtt != null || jitter != null || packetLoss != null) {
        mos = calcMOS(rtt, jitter, packetLoss);
      }

      // Collect full candidate lists from iceCandidates map
      const candidateEntry = this.iceCandidates.get(userId);
      if (candidateEntry) {
        history.localCandidates = candidateEntry.local.map(c => {
          const parsed = this.parseCandidateString(c.candidate);
          return `${parsed.type} ${parsed.protocol} ${parsed.address}:${parsed.port}`;
        });
        history.remoteCandidates = candidateEntry.remote.map(c => {
          const candStr = c.candidate || c;
          const parsed = this.parseCandidateString(typeof candStr === 'string' ? candStr : c.candidate);
          return `${parsed.type} ${parsed.protocol} ${parsed.address}:${parsed.port}`;
        });
      }

      // Push data points
      history.timestamps.push(now);
      history.rtt.push(rtt);
      history.jitter.push(jitter);
      history.packetLoss.push(packetLoss);
      history.sendFps.push(sendFps);
      history.recvFps.push(recvFps);
      history.sendBitrate.push(sendBitrate);
      history.recvBitrate.push(recvBitrate);
      history.sendRes.push(sendResW && sendResH ? `${sendResW}x${sendResH}` : null);
      history.recvRes.push(recvResW && recvResH ? `${recvResW}x${recvResH}` : null);
      history.mos.push(mos);

      // Trim to MAX_SAMPLES
      if (history.timestamps.length > MAX_SAMPLES) {
        const excess = history.timestamps.length - MAX_SAMPLES;
        for (const key of ['timestamps', 'rtt', 'jitter', 'packetLoss', 'sendFps', 'recvFps', 'sendBitrate', 'recvBitrate', 'sendRes', 'recvRes', 'mos']) {
          history[key].splice(0, excess);
        }
      }
    } catch (e) {
      // Stats unavailable
    }
  }

  // --- Compute group aggregates ---
  this.computeGroupAggregates(now);
}

export function computeGroupAggregates(now) {
  const GROUP_KEY = '__group__';
  if (!this.dashboardHistory.has(GROUP_KEY)) {
    this.dashboardHistory.set(GROUP_KEY, {
      username: '__group__',
      timestamps: [],
      avgRtt: [],
      avgJitter: [],
      avgPacketLoss: [],
      avgMos: [],
      totalSendBitrate: [],
      totalRecvBitrate: [],
      avgSendFps: [],
      avgRecvFps: [],
      peersConnected: []
    });
  }

  const group = this.dashboardHistory.get(GROUP_KEY);
  const peerHistories = [];
  for (const [key, h] of this.dashboardHistory) {
    if (key === GROUP_KEY || key.startsWith('remote-')) continue;
    peerHistories.push(h);
  }

  if (peerHistories.length === 0) return;

  // Average/sum the latest value from each peer
  const avgOf = (arr) => {
    const valid = arr.filter(v => v != null);
    return valid.length > 0 ? valid.reduce((a, b) => a + b, 0) / valid.length : null;
  };
  const sumOf = (arr) => {
    const valid = arr.filter(v => v != null);
    return valid.length > 0 ? valid.reduce((a, b) => a + b, 0) : null;
  };

  const latestVals = (key) => peerHistories.map(h => lastValid(h[key]));

  group.timestamps.push(now);
  group.avgRtt.push(avgOf(latestVals('rtt')));
  group.avgJitter.push(avgOf(latestVals('jitter')));
  group.avgPacketLoss.push(avgOf(latestVals('packetLoss')));
  group.avgMos.push(avgOf(latestVals('mos')));
  group.totalSendBitrate.push(sumOf(latestVals('sendBitrate')));
  group.totalRecvBitrate.push(sumOf(latestVals('recvBitrate')));
  group.avgSendFps.push(avgOf(latestVals('sendFps')));
  group.avgRecvFps.push(avgOf(latestVals('recvFps')));
  group.peersConnected.push(peerHistories.length);

  // Trim
  if (group.timestamps.length > MAX_SAMPLES) {
    const excess = group.timestamps.length - MAX_SAMPLES;
    for (const key of ['timestamps', 'avgRtt', 'avgJitter', 'avgPacketLoss', 'avgMos', 'totalSendBitrate', 'totalRecvBitrate', 'avgSendFps', 'avgRecvFps', 'peersConnected']) {
      group[key].splice(0, excess);
    }
  }
}

// E-model simplified MOS calculation
function calcMOS(rtt, jitter, packetLoss) {
  const d = (rtt != null ? rtt : 0) / 2; // one-way delay
  const j = jitter != null ? jitter : 0;
  const pl = packetLoss != null ? packetLoss : 0;

  // Effective latency
  const effectiveLatency = d + j * 2 + 10;

  // R-factor
  let R;
  if (effectiveLatency < 160) {
    R = 93.2 - (effectiveLatency / 40);
  } else {
    R = 93.2 - ((effectiveLatency - 120) / 10);
  }
  R = R - (pl * 2.5);
  R = Math.max(0, Math.min(100, R));

  // Convert R to MOS
  if (R < 0) return 1.0;
  if (R > 100) return 4.5;
  const mos = 1 + 0.035 * R + R * (R - 60) * (100 - R) * 7e-6;
  return Math.max(1.0, Math.min(5.0, mos));
}


export function renderDashboard() {
  const body = document.getElementById('dashboard-body');
  if (!body) return;

  // Only count real peer entries (not __group__ or remote-*)
  const peerEntryCount = [...this.dashboardHistory.keys()].filter(k => k !== '__group__' && !k.startsWith('remote-')).length;

  if (!this.dashboardHistory || peerEntryCount === 0) {
    body.innerHTML = this.peers.size === 0
      ? '<div class="dash-empty">No peers connected</div>'
      : '<div class="dash-empty">Collecting data...</div>';
    return;
  }

  body.innerHTML = '';

  // Build extended explanations with dynamic codec availability for column tooltips
  const localExplanations = { ...EXPLANATIONS };
  if (typeof RTCRtpSender !== 'undefined' && RTCRtpSender.getCapabilities) {
    const audioCaps = RTCRtpSender.getCapabilities('audio');
    if (audioCaps) {
      const seen = new Set();
      audioCaps.codecs.forEach(c => { const n = c.mimeType.split('/')[1]; if (!seen.has(n)) seen.add(n); });
      const list = [...seen].join(', ');
      localExplanations['Col Audio'] = `Negotiated audio codec. Browser-supported codecs: ${list}.`;
      localExplanations['Col Pref. Audio'] = `Preferred audio codec (from Media Settings). Browser-supported codecs: ${list}.`;
    }
    const videoCaps = RTCRtpSender.getCapabilities('video');
    if (videoCaps) {
      const seen = new Set();
      const skip = ['rtx', 'red', 'ulpfec', 'flexfec-03'];
      videoCaps.codecs.forEach(c => { const n = c.mimeType.split('/')[1]; if (!skip.includes(n.toLowerCase()) && !seen.has(n)) seen.add(n); });
      const list = [...seen].join(', ');
      localExplanations['Col Video'] = `Negotiated video codec. Browser-supported codecs: ${list}.`;
      localExplanations['Col Pref. Video'] = `Preferred video codec (from Media Settings). Browser-supported codecs: ${list}.`;
    }
  }
  if (!localExplanations['Col Audio']) localExplanations['Col Audio'] = 'Negotiated audio codec for this peer connection.';
  if (!localExplanations['Col Video']) localExplanations['Col Video'] = 'Negotiated video codec for this peer connection.';
  if (!localExplanations['Col Pref. Audio']) localExplanations['Col Pref. Audio'] = 'Preferred audio codec from Media Settings.';
  if (!localExplanations['Col Pref. Video']) localExplanations['Col Pref. Video'] = 'Preferred video codec from Media Settings.';
  localExplanations['Col Peer'] = 'Display name of the participant in this session.';
  localExplanations['Col Send Res'] = 'Video resolution currently being sent to this peer.';
  localExplanations['Col Recv Res'] = 'Video resolution currently being received from this peer.';
  localExplanations['Col Pref. Res'] = 'Preferred resolution from Media Settings. Choices: Default (camera native), 360p (640x360), 480p (854x480), 720p (1280x720), 1080p (1920x1080).';

  // --- KPI Bar ---
  const kpiBar = document.createElement('div');
  kpiBar.className = 'dash-kpi-bar';

  const totalPeers = this.peers.size;
  const selfTs = this.connectionTimestamps.get('self');
  const uptime = selfTs ? Math.floor((Date.now() - selfTs.getTime()) / 1000) : 0;

  let mosScores = [];
  let totalSent = 0, totalRecv = 0;
  for (const [key, history] of this.dashboardHistory) {
    if (key === '__group__' || key.startsWith('remote-')) continue;
    const m = lastValid(history.mos);
    if (m != null) mosScores.push(m);
    totalSent += history.totalBytesSent || 0;
    totalRecv += history.totalBytesRecv || 0;
  }

  const avgMOS = mosScores.length > 0
    ? (mosScores.reduce((a, b) => a + b, 0) / mosScores.length)
    : null;

  const samples = this.dashboardHistory.size > 0
    ? this.dashboardHistory.values().next().value.timestamps.length
    : 0;

  kpiBar.innerHTML = `
    <div class="dash-kpi-card accent" data-explain="Avg MOS">
      <div class="dash-kpi-header">
        <span class="dash-kpi-label">Average MOS Score</span>
        <span class="dash-health-dot ${mosHealthDot(avgMOS)}"></span>
      </div>
      <div class="dash-kpi-value">${avgMOS != null ? avgMOS.toFixed(2) + '/5' : '–'}</div>
      <div class="dash-kpi-sub">${avgMOS != null ? mosLabel(avgMOS) : 'Waiting...'}</div>
    </div>
    <div class="dash-kpi-card" data-explain="Connected Peers">
      <div class="dash-kpi-header">
        <span class="dash-kpi-label">Connected Peers</span>
      </div>
      <div class="dash-kpi-value">${totalPeers}</div>
      <div class="dash-kpi-sub">${samples} samples</div>
    </div>
    <div class="dash-kpi-card" data-explain="Session Duration">
      <div class="dash-kpi-header">
        <span class="dash-kpi-label">Session Duration</span>
      </div>
      <div class="dash-kpi-value">${formatUptime(uptime)}</div>
      <div class="dash-kpi-sub">since join</div>
    </div>
    <div class="dash-kpi-card" data-explain="Data Transferred">
      <div class="dash-kpi-header">
        <span class="dash-kpi-label">Data Transferred</span>
      </div>
      <div class="dash-kpi-value">${formatDataSize(totalSent + totalRecv)}</div>
      <div class="dash-kpi-sub">${formatDataSize(totalSent)} sent / ${formatDataSize(totalRecv)} recv</div>
    </div>
  `;
  body.appendChild(kpiBar);

  // --- ICE Servers Section ---
  if (this.iceServers && this.iceServers.iceServers) {
    const iceSection = document.createElement('div');
    iceSection.className = 'dash-ice-section';
    let iceHtml = '<div class="dash-ice-title" data-explain="ICE Servers">Configured ICE Servers</div><div class="dash-ice-list">';
    this.iceServers.iceServers.forEach(server => {
      const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
      urls.forEach(url => {
        const type = url.startsWith('turn') ? 'TURN' : 'STUN';
        const dotClass = type === 'TURN' ? 'cyan' : 'blue';
        iceHtml += `<div class="dash-ice-item" data-explain="${type}"><span class="dash-health-dot ${dotClass}"></span><span class="dash-ice-type">${type}</span><span class="dash-ice-url">${this.escapeHtml(url)}</span></div>`;
      });
    });
    iceHtml += '</div>';
    iceSection.innerHTML = iceHtml;
    body.appendChild(iceSection);
  }

  // --- Group Analytics Section ---
  const group = this.dashboardHistory.get('__group__');
  if (group && group.timestamps.length > 0) {
    const groupSection = document.createElement('div');
    groupSection.className = 'dash-group-section';

    // Group header
    const groupHeader = document.createElement('div');
    groupHeader.className = 'dash-group-header';

    // Connection health breakdown from latest MOS scores
    const healthCounts = { excellent: 0, good: 0, fair: 0, poor: 0 };
    for (const [k, h] of this.dashboardHistory) {
      if (k === '__group__' || k.startsWith('remote-')) continue;
      const m = lastValid(h.mos);
      if (m == null) continue;
      if (m >= 4.0) healthCounts.excellent++;
      else if (m >= 3.6) healthCounts.good++;
      else if (m >= 3.0) healthCounts.fair++;
      else healthCounts.poor++;
    }
    const hasMosData = healthCounts.excellent + healthCounts.good + healthCounts.fair + healthCounts.poor > 0;

    groupHeader.innerHTML = `
      <div class="dash-group-title-row">
        <span class="dash-group-title">Group Analytics</span>
        <span class="dash-group-subtitle">${totalPeers} peer${totalPeers !== 1 ? 's' : ''} aggregated</span>
      </div>
      <div class="dash-health-summary">
        ${healthCounts.excellent > 0 ? `<div class="dash-health-item"><span class="dash-health-dot green"></span><span>${healthCounts.excellent} Excellent</span></div>` : ''}
        ${healthCounts.good > 0 ? `<div class="dash-health-item"><span class="dash-health-dot green"></span><span>${healthCounts.good} Good</span></div>` : ''}
        ${healthCounts.fair > 0 ? `<div class="dash-health-item"><span class="dash-health-dot yellow"></span><span>${healthCounts.fair} Fair</span></div>` : ''}
        ${healthCounts.poor > 0 ? `<div class="dash-health-item"><span class="dash-health-dot red"></span><span>${healthCounts.poor} Poor</span></div>` : ''}
        ${!hasMosData ? '<div class="dash-health-item"><span>Collecting...</span></div>' : ''}
      </div>
    `;
    groupSection.appendChild(groupHeader);

    // Group metric cards
    const groupGrid = document.createElement('div');
    groupGrid.className = 'dash-card-grid';

    groupGrid.appendChild(this.createDashboardCard('Avg RTT', group.avgRtt, 'ms', {
      color: '#3b82f6', warnThreshold: 200, critThreshold: 300,
      infraBar: true, infraMax: 500
    }));
    groupGrid.appendChild(this.createDashboardCard('Avg One-Way Latency', group.avgRtt.map(v => v != null ? v / 2 : null), 'ms', {
      color: '#6366f1', warnThreshold: 100, critThreshold: 150,
      infraBar: true, infraMax: 250
    }));
    groupGrid.appendChild(this.createDashboardCard('Avg Jitter', group.avgJitter, 'ms', {
      color: '#8b5cf6', warnThreshold: 50, critThreshold: 80, decimals: 1,
      infraBar: true, infraMax: 120
    }));
    groupGrid.appendChild(this.createDashboardCard('Avg Packet Loss', group.avgPacketLoss, '%', {
      color: '#ef4444', warnThreshold: 3, critThreshold: 5, decimals: 2,
      infraBar: true, infraMax: 10
    }));
    groupGrid.appendChild(this.createDashboardCard('Avg MOS', group.avgMos, '', {
      color: '#06b6d4', decimals: 2
    }));
    groupGrid.appendChild(this.createDashboardCard('Total Send Rate', group.totalSendBitrate, 'kbps', {
      color: '#f59e0b', decimals: 0
    }));
    groupGrid.appendChild(this.createDashboardCard('Total Recv Rate', group.totalRecvBitrate, 'kbps', {
      color: '#06b6d4', decimals: 0
    }));
    groupGrid.appendChild(this.createDashboardCard('Avg Send FPS', group.avgSendFps, 'fps', {
      color: '#22c55e'
    }));
    groupGrid.appendChild(this.createDashboardCard('Avg Recv FPS', group.avgRecvFps, 'fps', {
      color: '#14b8a6'
    }));

    // Peers connected over time card
    groupGrid.appendChild(this.createDashboardCard('Peers Connected', group.peersConnected, '', {
      color: '#8b5cf6'
    }));

    // Total data transfer summary
    const groupDataCard = document.createElement('div');
    groupDataCard.className = 'dash-card';
    groupDataCard.innerHTML = `
      <div class="dash-card-title">Total Data Transfer</div>
      <div style="margin-top:8px">
        <div class="dash-data-row"><span class="dash-data-label">All Peers Sent</span><span class="dash-data-value">${formatDataSize(totalSent)}</span></div>
        <div class="dash-data-row"><span class="dash-data-label">All Peers Recv</span><span class="dash-data-value">${formatDataSize(totalRecv)}</span></div>
        <div class="dash-data-row"><span class="dash-data-label">Grand Total</span><span class="dash-data-value">${formatDataSize(totalSent + totalRecv)}</span></div>
      </div>
    `;
    groupGrid.appendChild(groupDataCard);

    groupSection.appendChild(groupGrid);

    // --- Peer Media Summary Table ---
    const summaryCard = document.createElement('div');
    summaryCard.className = 'dash-card';
    summaryCard.style.marginTop = '12px';
    summaryCard.style.gridColumn = '1 / -1';
    let summaryHtml = '<div class="dash-card-title">Peer Media Summary</div>';
    summaryHtml += '<table class="dash-summary-table"><thead><tr>';
    summaryHtml += '<th data-explain="Col Peer">Peer</th><th data-explain="Col Audio">Audio</th><th data-explain="Col Video">Video</th><th data-explain="Col Send Res">Send Res</th><th data-explain="Col Recv Res">Recv Res</th><th data-explain="Col Pref. Res">Pref. Res</th><th data-explain="Col Pref. Audio">Pref. Audio</th><th data-explain="Col Pref. Video">Pref. Video</th>';
    summaryHtml += '</tr></thead><tbody>';

    // "You" row — local user's own settings
    // Get local send res and in-use codecs from any peer connection (same to all peers)
    let mySendRes = '–';
    let myInUseAudio = '–';
    let myInUseVideo = '–';
    for (const [k, h] of this.dashboardHistory) {
      if (k === '__group__' || k.startsWith('remote-')) continue;
      const sr = lastValid(h.sendRes);
      if (sr && mySendRes === '–') mySendRes = sr;
      if (h.audioCodec && myInUseAudio === '–') myInUseAudio = stripCodecPrefix(h.audioCodec);
      if (h.videoCodec && myInUseVideo === '–') myInUseVideo = stripCodecPrefix(h.videoCodec);
    }
    const myPrefRes = this.preferredResolution ? `${this.preferredResolution.width}x${this.preferredResolution.height}` : mySendRes;
    const myPrefAudio = this.preferredAudioCodec || myInUseAudio;
    const myPrefVideo = this.preferredVideoCodec || myInUseVideo;
    summaryHtml += `<tr style="border-bottom:2px solid var(--dash-border-accent,#3b4d7a);">
      <td><strong>${this.escapeHtml(this.username || 'You')} (You)</strong></td>
      <td>–</td>
      <td>–</td>
      <td class="dash-res-bold">${this.escapeHtml(mySendRes)}</td>
      <td>–</td>
      <td class="dash-res-bold">${this.escapeHtml(myPrefRes)}</td>
      <td>${this.escapeHtml(myPrefAudio)}</td>
      <td>${this.escapeHtml(myPrefVideo)}</td>
    </tr>`;

    // One row per peer — merge preferred settings from their remote-* entry
    for (const [k, h] of this.dashboardHistory) {
      if (k === '__group__' || k.startsWith('remote-')) continue;
      const sendRes = lastValid(h.sendRes) || '–';
      const recvRes = lastValid(h.recvRes) || '–';
      const remoteEntry = this.dashboardHistory.get(`remote-${h.username}`);
      const prefRes = remoteEntry?.preferredResolution ? `${remoteEntry.preferredResolution.width}x${remoteEntry.preferredResolution.height}` : (recvRes !== '–' ? recvRes : '–');
      const prefAudio = remoteEntry?.preferredAudioCodec || (h.audioCodec ? stripCodecPrefix(h.audioCodec) : '–');
      const prefVideo = remoteEntry?.preferredVideoCodec || (h.videoCodec ? stripCodecPrefix(h.videoCodec) : '–');
      summaryHtml += `<tr>
        <td>${this.escapeHtml(h.username)}</td>
        <td>${this.escapeHtml(stripCodecPrefix(h.audioCodec))}</td>
        <td>${this.escapeHtml(stripCodecPrefix(h.videoCodec))}</td>
        <td class="dash-res-bold">${this.escapeHtml(sendRes)}</td>
        <td class="dash-res-bold">${this.escapeHtml(recvRes)}</td>
        <td class="dash-res-bold">${this.escapeHtml(prefRes)}</td>
        <td>${this.escapeHtml(prefAudio)}</td>
        <td>${this.escapeHtml(prefVideo)}</td>
      </tr>`;
    }
    summaryHtml += '</tbody></table>';
    summaryCard.innerHTML = summaryHtml;
    groupSection.appendChild(summaryCard);

    // --- Group ICE Candidate Counts ---
    const allLocalCands = new Map(); // peer → candidates[]
    const allRemoteCands = new Map();
    const localCandSet = new Set();
    const remoteCandSet = new Set();
    for (const [k, h] of this.dashboardHistory) {
      if (k === '__group__' || k.startsWith('remote-')) continue;
      if (h.localCandidates && h.localCandidates.length > 0) {
        allLocalCands.set(h.username, { candidates: h.localCandidates, active: h.localCandidate });
        h.localCandidates.forEach(c => localCandSet.add(c));
      }
      if (h.remoteCandidates && h.remoteCandidates.length > 0) {
        allRemoteCands.set(h.username, { candidates: h.remoteCandidates, active: h.remoteCandidate });
        h.remoteCandidates.forEach(c => remoteCandSet.add(c));
      }
    }

    const iceCountCard = document.createElement('div');
    iceCountCard.className = 'dash-card';
    iceCountCard.style.marginTop = '12px';
    iceCountCard.style.gridColumn = '1 / -1';
    iceCountCard.innerHTML = `
      <div class="dash-card-title" data-explain="ICE Candidates">Group ICE Candidates</div>
      <div style="display:flex;gap:24px;margin-top:8px;">
        <div class="dash-ice-count-item" data-ice-type="local" style="cursor:pointer;">
          <span class="dash-data-label" data-explain="Local">Unique Local ICE Candidates:</span>
          <span class="dash-data-value" style="margin-left:6px;">${localCandSet.size}</span>
        </div>
        <div class="dash-ice-count-item" data-ice-type="remote" style="cursor:pointer;">
          <span class="dash-data-label" data-explain="Remote">Unique Remote ICE Candidates:</span>
          <span class="dash-data-value" style="margin-left:6px;">${remoteCandSet.size}</span>
        </div>
      </div>
      <div class="dash-ice-popup" id="dash-ice-local-popup" style="display:none;margin-top:10px;"></div>
      <div class="dash-ice-popup" id="dash-ice-remote-popup" style="display:none;margin-top:10px;"></div>
    `;
    groupSection.appendChild(iceCountCard);

    // Build popup content for local/remote ICE candidate lists
    const buildCandPopup = (candMap, popupId) => {
      const popup = iceCountCard.querySelector(`#${popupId}`);
      if (!popup) return;
      let html = '';
      for (const [peer, entry] of candMap) {
        html += `<div style="margin-bottom:8px;"><div style="font-weight:600;font-size:12px;color:var(--dash-text-secondary);margin-bottom:4px;">${this.escapeHtml(peer)}:</div>`;
        entry.candidates.forEach(c => {
          const isActive = entry.active && c.trim() === entry.active.trim();
          const parts = c.trim().split(/\s+/);
          const candType = parts[0] || '';
          const candProto = parts[1] || '';
          html += `<div class="dash-candidate-item${isActive ? ' active' : ''}" data-cand-type="${this.escapeHtml(candType)}" data-cand-proto="${this.escapeHtml(candProto)}" style="cursor:pointer;">${isActive ? '&#9679; ' : '&nbsp;&nbsp;'}${this.escapeHtml(c)}${isActive ? ' (active)' : ''}</div>`;
        });
        html += '</div>';
      }
      popup.innerHTML = html;
    };
    buildCandPopup(allLocalCands, 'dash-ice-local-popup');
    buildCandPopup(allRemoteCands, 'dash-ice-remote-popup');

    body.appendChild(groupSection);
  }

  // --- Per-peer sections (local stats) ---
  for (const [key, history] of this.dashboardHistory) {
    if (key === '__group__' || key.startsWith('remote-')) continue;
    const section = document.createElement('div');
    section.className = 'dash-peer-section';

    const currentMOS = lastValid(history.mos);
    const peerConnectedAt = this.connectionTimestamps.get(`peer-${key}`);
    const connTimeStr = peerConnectedAt ? peerConnectedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : null;

    // Header
    const header = document.createElement('div');
    header.className = 'dash-peer-header';
    header.innerHTML = `
      <span class="dash-health-dot ${mosHealthDot(currentMOS)}"></span>
      <span class="dash-peer-name">${this.escapeHtml(history.username)}</span>
      ${connTimeStr ? `<span class="dash-peer-telemetry-time" title="Connected at">Connected ${connTimeStr}</span>` : ''}
      <span class="dash-peer-state">${history.connectionState} / ${history.iceState}</span>
      ${currentMOS != null ? `<span class="dash-quality-badge ${mosClass(currentMOS)}" data-explain="MOS Score">${mosLabel(currentMOS)} (${currentMOS.toFixed(2)}/5)</span>` : ''}
    `;
    section.appendChild(header);

    // Info row with pills
    const info = document.createElement('div');
    info.className = 'dash-info-row';
    info.innerHTML = `
      <span class="dash-info-pill" data-explain="Audio">Audio: ${this.escapeHtml(stripCodecPrefix(history.audioCodec))}</span>
      <span class="dash-info-pill" data-explain="Video">Video: ${this.escapeHtml(stripCodecPrefix(history.videoCodec))}</span>
      <span class="dash-info-pill" data-explain="DTLS">DTLS: ${this.escapeHtml(history.dtlsState || '–')}</span>
      <span class="dash-info-pill" data-explain="Local">Local: ${this.escapeHtml(history.localCandidate || '–')}</span>
      <span class="dash-info-pill" data-explain="Remote">Remote: ${this.escapeHtml(history.remoteCandidate || '–')}</span>
    `;
    section.appendChild(info);

    // Metric cards grid
    const grid = document.createElement('div');
    grid.className = 'dash-card-grid';

    grid.appendChild(this.createDashboardCard('RTT', history.rtt, 'ms', {
      color: '#3b82f6', warnThreshold: 200, critThreshold: 300,
      infraBar: true, infraMax: 500
    }));
    grid.appendChild(this.createDashboardCard('One-Way Latency', history.rtt.map(v => v != null ? v / 2 : null), 'ms', {
      color: '#6366f1', warnThreshold: 100, critThreshold: 150,
      infraBar: true, infraMax: 250
    }));
    grid.appendChild(this.createDashboardCard('Jitter', history.jitter, 'ms', {
      color: '#8b5cf6', warnThreshold: 50, critThreshold: 80, decimals: 1,
      infraBar: true, infraMax: 120
    }));
    grid.appendChild(this.createDashboardCard('Packet Loss', history.packetLoss, '%', {
      color: '#ef4444', warnThreshold: 3, critThreshold: 5, decimals: 2,
      infraBar: true, infraMax: 10
    }));
    grid.appendChild(this.createDashboardCard('MOS Score', history.mos, '', {
      color: '#06b6d4', decimals: 2, invert: true,
      warnThreshold: null, critThreshold: null
    }));
    grid.appendChild(this.createDashboardCard('Send FPS', history.sendFps, 'fps', {
      color: '#22c55e'
    }));
    grid.appendChild(this.createDashboardCard('Recv FPS', history.recvFps, 'fps', {
      color: '#14b8a6'
    }));
    grid.appendChild(this.createDashboardCard('Send Rate', history.sendBitrate, 'kbps', {
      color: '#f59e0b', decimals: 0
    }));
    grid.appendChild(this.createDashboardCard('Recv Rate', history.recvBitrate, 'kbps', {
      color: '#06b6d4', decimals: 0
    }));

    // Resolution card
    const resCard = document.createElement('div');
    resCard.className = 'dash-card';
    const lastSendRes = lastValid(history.sendRes) || '–';
    const lastRecvRes = lastValid(history.recvRes) || '–';
    resCard.innerHTML = `
      <div class="dash-card-title" data-explain="Resolution">Resolution</div>
      <div class="dash-card-res">
        <div class="dash-res-row"><span class="dash-res-label">Send</span><span class="dash-res-value">${this.escapeHtml(lastSendRes)}</span></div>
        <div class="dash-res-row"><span class="dash-res-label">Recv</span><span class="dash-res-value">${this.escapeHtml(lastRecvRes)}</span></div>
      </div>
    `;
    grid.appendChild(resCard);

    // Data transfer card
    const dataCard = document.createElement('div');
    dataCard.className = 'dash-card';
    dataCard.innerHTML = `
      <div class="dash-card-title" data-explain="Data Transfer">Data Transfer</div>
      <div style="margin-top:8px">
        <div class="dash-data-row"><span class="dash-data-label">Total Sent</span><span class="dash-data-value">${formatDataSize(history.totalBytesSent)}</span></div>
        <div class="dash-data-row"><span class="dash-data-label">Total Recv</span><span class="dash-data-value">${formatDataSize(history.totalBytesRecv)}</span></div>
        <div class="dash-data-row"><span class="dash-data-label">Combined</span><span class="dash-data-value">${formatDataSize(history.totalBytesSent + history.totalBytesRecv)}</span></div>
      </div>
    `;
    grid.appendChild(dataCard);

    section.appendChild(grid);

    // Local candidates list
    if (history.localCandidates && history.localCandidates.length > 0) {
      const localCandSection = document.createElement('div');
      localCandSection.className = 'dash-candidates-section';
      localCandSection.innerHTML = `
        <div class="dash-candidates-title">Local ICE Candidates (${history.localCandidates.length})</div>
        <div class="dash-candidates-list">
          ${history.localCandidates.map(c => {
            const isActive = history.localCandidate && c.trim() === history.localCandidate.trim();
            const cParts = c.trim().split(/\s+/);
            return `<div class="dash-candidate-item${isActive ? ' active' : ''}" data-cand-type="${cParts[0] || ''}" data-cand-proto="${cParts[1] || ''}" style="cursor:pointer;">${this.escapeHtml(c)}</div>`;
          }).join('')}
        </div>
      `;
      section.appendChild(localCandSection);
    }

    // Remote candidates list
    if (history.remoteCandidates && history.remoteCandidates.length > 0) {
      const remoteCandSection = document.createElement('div');
      remoteCandSection.className = 'dash-candidates-section';
      remoteCandSection.innerHTML = `
        <div class="dash-candidates-title">Remote ICE Candidates (${history.remoteCandidates.length})</div>
        <div class="dash-candidates-list">
          ${history.remoteCandidates.map(c => {
            const isActive = history.remoteCandidate && c.trim() === history.remoteCandidate.trim();
            const cParts = c.trim().split(/\s+/);
            return `<div class="dash-candidate-item${isActive ? ' active' : ''}" data-cand-type="${cParts[0] || ''}" data-cand-proto="${cParts[1] || ''}" style="cursor:pointer;">${this.escapeHtml(c)}</div>`;
          }).join('')}
        </div>
      `;
      section.appendChild(remoteCandSection);
    }

    body.appendChild(section);
  }

  // --- Remote peer sections (received via DataChannel) ---
  for (const [key, history] of this.dashboardHistory) {
    if (!key.startsWith('remote-')) continue;

    const section = document.createElement('div');
    section.className = 'dash-peer-section';

    const remoteMOS = lastValid(history.mos);

    // Find connection time for this remote peer by matching username
    let remoteConnTimeStr = null;
    for (const [uid, p] of this.peers) {
      if (p.username === history.username) {
        const ts = this.connectionTimestamps.get(`peer-${uid}`);
        if (ts) remoteConnTimeStr = ts.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        break;
      }
    }

    // Header with cyan dot to distinguish from local stats
    const header = document.createElement('div');
    header.className = 'dash-peer-header';
    header.innerHTML = `
      <span class="dash-health-dot cyan"></span>
      <span class="dash-peer-name">${this.escapeHtml(history.username)}'s view &rarr; ${this.escapeHtml(history.remotePeer || '?')} (You)</span>
      ${remoteConnTimeStr ? `<span class="dash-peer-telemetry-time" title="Connected at">Connected ${remoteConnTimeStr}</span>` : ''}
      <span class="dash-peer-state">${history.connectionState} / ${history.iceState}</span>
      ${remoteMOS != null ? `<span class="dash-quality-badge ${mosClass(remoteMOS)}" data-explain="MOS Score">${mosLabel(remoteMOS)} (${remoteMOS.toFixed(2)}/5)</span>` : ''}
    `;
    section.appendChild(header);

    // Info pills
    const info = document.createElement('div');
    info.className = 'dash-info-row';
    info.innerHTML = `
      <span class="dash-info-pill">via DataChannel</span>
      <span class="dash-info-pill" data-explain="Audio">Audio: ${this.escapeHtml(stripCodecPrefix(history.audioCodec))}</span>
      <span class="dash-info-pill" data-explain="Video">Video: ${this.escapeHtml(stripCodecPrefix(history.videoCodec))}</span>
      <span class="dash-info-pill" data-explain="DTLS">DTLS: ${this.escapeHtml(history.dtlsState || '–')}</span>
      <span class="dash-info-pill" data-explain="Local">Local: ${this.escapeHtml(history.localCandidate || '–')}</span>
      <span class="dash-info-pill" data-explain="Remote">Remote: ${this.escapeHtml(history.remoteCandidate || '–')}</span>
    `;
    section.appendChild(info);

    // Preferred settings pills — show explicit preference or fall back to in-use values
    {
      const prefsRow = document.createElement('div');
      prefsRow.className = 'dash-info-row';
      const prefRes = history.preferredResolution ? `${history.preferredResolution.width}x${history.preferredResolution.height}` : (lastValid(history.sendRes) || '–');
      const prefAudio = history.preferredAudioCodec || (history.audioCodec ? stripCodecPrefix(history.audioCodec) : '–');
      const prefVideo = history.preferredVideoCodec || (history.videoCodec ? stripCodecPrefix(history.videoCodec) : '–');
      prefsRow.innerHTML = `
        <span class="dash-info-pill" style="border-color:var(--dash-cyan);color:var(--dash-cyan);">Preferred Res: ${this.escapeHtml(prefRes)}</span>
        <span class="dash-info-pill" style="border-color:var(--dash-cyan);color:var(--dash-cyan);">Preferred Audio: ${this.escapeHtml(prefAudio)}</span>
        <span class="dash-info-pill" style="border-color:var(--dash-cyan);color:var(--dash-cyan);">Preferred Video: ${this.escapeHtml(prefVideo)}</span>
      `;
      section.appendChild(prefsRow);
    }

    // Metric cards grid
    const grid = document.createElement('div');
    grid.className = 'dash-card-grid';

    grid.appendChild(this.createDashboardCard('RTT', history.rtt, 'ms', {
      color: '#3b82f6', warnThreshold: 200, critThreshold: 300,
      infraBar: true, infraMax: 500
    }));
    grid.appendChild(this.createDashboardCard('One-Way Latency', history.rtt.map(v => v != null ? v / 2 : null), 'ms', {
      color: '#6366f1', warnThreshold: 100, critThreshold: 150,
      infraBar: true, infraMax: 250
    }));
    grid.appendChild(this.createDashboardCard('Jitter', history.jitter, 'ms', {
      color: '#8b5cf6', warnThreshold: 50, critThreshold: 80, decimals: 1,
      infraBar: true, infraMax: 120
    }));
    grid.appendChild(this.createDashboardCard('Packet Loss', history.packetLoss, '%', {
      color: '#ef4444', warnThreshold: 3, critThreshold: 5, decimals: 2,
      infraBar: true, infraMax: 10
    }));
    grid.appendChild(this.createDashboardCard('MOS Score', history.mos, '', {
      color: '#06b6d4', decimals: 2, invert: true,
      warnThreshold: null, critThreshold: null
    }));
    grid.appendChild(this.createDashboardCard('Send FPS', history.sendFps, 'fps', {
      color: '#22c55e'
    }));
    grid.appendChild(this.createDashboardCard('Recv FPS', history.recvFps, 'fps', {
      color: '#14b8a6'
    }));
    grid.appendChild(this.createDashboardCard('Send Rate', history.sendBitrate, 'kbps', {
      color: '#f59e0b', decimals: 0
    }));
    grid.appendChild(this.createDashboardCard('Recv Rate', history.recvBitrate, 'kbps', {
      color: '#06b6d4', decimals: 0
    }));

    // Resolution card
    const resCard = document.createElement('div');
    resCard.className = 'dash-card';
    const lastSendRes = lastValid(history.sendRes) || '–';
    const lastRecvRes = lastValid(history.recvRes) || '–';
    resCard.innerHTML = `
      <div class="dash-card-title" data-explain="Resolution">Resolution</div>
      <div class="dash-card-res">
        <div class="dash-res-row"><span class="dash-res-label">Send</span><span class="dash-res-value">${this.escapeHtml(lastSendRes)}</span></div>
        <div class="dash-res-row"><span class="dash-res-label">Recv</span><span class="dash-res-value">${this.escapeHtml(lastRecvRes)}</span></div>
      </div>
    `;
    grid.appendChild(resCard);

    // Data transfer card
    const dataCard = document.createElement('div');
    dataCard.className = 'dash-card';
    dataCard.innerHTML = `
      <div class="dash-card-title" data-explain="Data Transfer">Data Transfer</div>
      <div style="margin-top:8px">
        <div class="dash-data-row"><span class="dash-data-label">Total Sent</span><span class="dash-data-value">${formatDataSize(history.totalBytesSent)}</span></div>
        <div class="dash-data-row"><span class="dash-data-label">Total Recv</span><span class="dash-data-value">${formatDataSize(history.totalBytesRecv)}</span></div>
        <div class="dash-data-row"><span class="dash-data-label">Combined</span><span class="dash-data-value">${formatDataSize(history.totalBytesSent + history.totalBytesRecv)}</span></div>
      </div>
    `;
    grid.appendChild(dataCard);

    section.appendChild(grid);

    // Candidate lists
    if (history.localCandidates && history.localCandidates.length > 0) {
      const localCandSection = document.createElement('div');
      localCandSection.className = 'dash-candidates-section';
      localCandSection.innerHTML = `
        <div class="dash-candidates-title">Their Local ICE Candidates (${history.localCandidates.length})</div>
        <div class="dash-candidates-list">
          ${history.localCandidates.map(c => {
            const isActive = history.localCandidate && c.trim() === history.localCandidate.trim();
            const cParts = c.trim().split(/\s+/);
            return `<div class="dash-candidate-item${isActive ? ' active' : ''}" data-cand-type="${cParts[0] || ''}" data-cand-proto="${cParts[1] || ''}" style="cursor:pointer;">${this.escapeHtml(c)}</div>`;
          }).join('')}
        </div>
      `;
      section.appendChild(localCandSection);
    }
    if (history.remoteCandidates && history.remoteCandidates.length > 0) {
      const remoteCandSection = document.createElement('div');
      remoteCandSection.className = 'dash-candidates-section';
      remoteCandSection.innerHTML = `
        <div class="dash-candidates-title">Their Remote ICE Candidates (${history.remoteCandidates.length})</div>
        <div class="dash-candidates-list">
          ${history.remoteCandidates.map(c => {
            const isActive = history.remoteCandidate && c.trim() === history.remoteCandidate.trim();
            const cParts = c.trim().split(/\s+/);
            return `<div class="dash-candidate-item${isActive ? ' active' : ''}" data-cand-type="${cParts[0] || ''}" data-cand-proto="${cParts[1] || ''}" style="cursor:pointer;">${this.escapeHtml(c)}</div>`;
          }).join('')}
        </div>
      `;
      section.appendChild(remoteCandSection);
    }

    body.appendChild(section);
  }

  // --- Tooltip positioning helper ---
  const showExplainPopup = (anchorEl, text) => {
    document.querySelectorAll('.dash-explain-popup').forEach(p => p.remove());
    if (!text) return;
    const popup = document.createElement('div');
    popup.className = 'dash-explain-popup';
    popup.textContent = text;
    document.body.appendChild(popup);

    // Position relative to anchor, staying within viewport
    const rect = anchorEl.getBoundingClientRect();
    const popRect = popup.getBoundingClientRect();
    const pad = 8;

    // Try above first, fall back to below
    let top = rect.top - popRect.height - pad;
    if (top < pad) top = rect.bottom + pad;

    // Horizontal: align left edge, but keep within viewport
    let left = rect.left;
    if (left + popRect.width > window.innerWidth - pad) {
      left = window.innerWidth - popRect.width - pad;
    }
    if (left < pad) left = pad;

    popup.style.top = top + 'px';
    popup.style.left = left + 'px';

    const dismiss = () => { popup.remove(); document.removeEventListener('click', dismiss); };
    setTimeout(() => document.addEventListener('click', dismiss), 0);
  };

  // --- Attach explanation click handlers ---
  body.querySelectorAll('[data-explain]').forEach(el => {
    el.style.cursor = 'pointer';
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const key = el.getAttribute('data-explain');
      showExplainPopup(el, localExplanations[key]);
    });
  });

  // Candidate item click handlers (contextual explanation)
  body.querySelectorAll('[data-cand-type]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const candType = el.getAttribute('data-cand-type');
      const candProto = el.getAttribute('data-cand-proto');
      let text = '';
      if (localExplanations[candType]) text += localExplanations[candType];
      if (localExplanations[candProto]) text += (text ? ' ' : '') + localExplanations[candProto];
      if (el.classList.contains('active')) text += (text ? ' ' : '') + 'This is the currently selected network path.';
      showExplainPopup(el, text);
    });
  });

  // ICE candidate count popup toggles
  body.querySelectorAll('.dash-ice-count-item').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const type = el.getAttribute('data-ice-type');
      const popup = body.querySelector(`#dash-ice-${type}-popup`);
      if (popup) {
        popup.style.display = popup.style.display === 'none' ? 'block' : 'none';
      }
    });
  });
}

export function createDashboardCard(title, data, unit, opts = {}) {
  const {
    color = '#3b82f6', warnThreshold = null, critThreshold = null,
    decimals = 0, infraBar = false, infraMax = 100
  } = opts;

  const card = document.createElement('div');
  card.className = 'dash-card';

  const validData = data.filter(v => v != null);
  const current = validData.length > 0 ? validData[validData.length - 1] : null;
  const min = validData.length > 0 ? Math.min(...validData) : null;
  const max = validData.length > 0 ? Math.max(...validData) : null;
  const avg = validData.length > 0 ? validData.reduce((a, b) => a + b, 0) / validData.length : null;

  let valueClass = '';
  if (current != null && critThreshold != null && current >= critThreshold) {
    valueClass = 'dash-val-crit';
  } else if (current != null && warnThreshold != null && current >= warnThreshold) {
    valueClass = 'dash-val-warn';
  }

  const titleEl = document.createElement('div');
  titleEl.className = 'dash-card-title';
  titleEl.textContent = title;
  if (EXPLANATIONS[title]) titleEl.setAttribute('data-explain', title);
  card.appendChild(titleEl);

  const valueEl = document.createElement('div');
  valueEl.className = `dash-card-value ${valueClass}`;
  valueEl.innerHTML = current != null
    ? `${current.toFixed(decimals)} <span class="dash-card-unit">${unit}</span>`
    : '–';
  card.appendChild(valueEl);

  // Sparkline canvas
  const canvas = document.createElement('canvas');
  canvas.className = 'dash-sparkline';
  card.appendChild(canvas);
  this.drawSparkline(canvas, data, { color, warnThreshold, critThreshold });

  // Infrastructure-style progress bar
  if (infraBar && current != null) {
    const barContainer = document.createElement('div');
    barContainer.className = 'dash-infra-bar';
    const barFill = document.createElement('div');
    barFill.className = 'dash-infra-bar-fill';
    const pct = Math.min(100, (current / infraMax) * 100);
    barFill.style.width = pct + '%';

    let barColor = '#10b981'; // green
    if (critThreshold != null && current >= critThreshold) barColor = '#ef4444';
    else if (warnThreshold != null && current >= warnThreshold) barColor = '#f59e0b';
    barFill.style.background = barColor;

    barContainer.appendChild(barFill);
    card.appendChild(barContainer);
  }

  // Min / Avg / Max
  const statsEl = document.createElement('div');
  statsEl.className = 'dash-card-stats';
  statsEl.innerHTML = `
    <span>Min: ${min != null ? min.toFixed(decimals) : '–'}</span>
    <span>Avg: ${avg != null ? avg.toFixed(decimals) : '–'}</span>
    <span>Max: ${max != null ? max.toFixed(decimals) : '–'}</span>
  `;
  card.appendChild(statsEl);

  return card;
}

export function drawSparkline(canvas, data, opts = {}) {
  const { color = '#3b82f6', warnThreshold = null, critThreshold = null } = opts;
  const dpr = window.devicePixelRatio || 1;
  const logicalW = 280;
  const logicalH = 60;

  canvas.width = logicalW * dpr;
  canvas.height = logicalH * dpr;

  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const w = logicalW;
  const h = logicalH;

  // Gather valid points
  const validPoints = [];
  for (let i = 0; i < data.length; i++) {
    if (data[i] != null) validPoints.push({ idx: i, value: data[i] });
  }

  if (validPoints.length < 2) {
    ctx.fillStyle = 'rgba(148, 163, 184, 0.4)';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Collecting...', w / 2, h / 2 + 4);
    return;
  }

  const pad = { top: 4, bottom: 4, left: 2, right: 2 };
  const chartW = w - pad.left - pad.right;
  const chartH = h - pad.top - pad.bottom;

  const vals = validPoints.map(p => p.value);
  let minVal = Math.min(...vals);
  let maxVal = Math.max(...vals);
  if (minVal === maxVal) { minVal -= 1; maxVal += 1; }

  const totalIdx = Math.max(data.length - 1, 1);
  const points = validPoints.map(p => ({
    x: pad.left + (p.idx / totalIdx) * chartW,
    y: pad.top + chartH - ((p.value - minVal) / (maxVal - minVal)) * chartH
  }));

  // Threshold lines
  const drawThreshold = (threshold, threshColor) => {
    if (threshold != null && threshold >= minVal && threshold <= maxVal) {
      const y = pad.top + chartH - ((threshold - minVal) / (maxVal - minVal)) * chartH;
      ctx.strokeStyle = threshColor;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(w - pad.right, y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  };
  drawThreshold(warnThreshold, 'rgba(245, 158, 11, 0.35)');
  drawThreshold(critThreshold, 'rgba(239, 68, 68, 0.35)');

  // Filled area
  ctx.beginPath();
  ctx.moveTo(points[0].x, h - pad.bottom);
  for (const p of points) ctx.lineTo(p.x, p.y);
  ctx.lineTo(points[points.length - 1].x, h - pad.bottom);
  ctx.closePath();

  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, color + '40');
  grad.addColorStop(1, color + '08');
  ctx.fillStyle = grad;
  ctx.fill();

  // Line
  ctx.beginPath();
  for (let i = 0; i < points.length; i++) {
    if (i === 0) ctx.moveTo(points[i].x, points[i].y);
    else ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.lineJoin = 'round';
  ctx.stroke();

  // Current value dot with glow
  const last = points[points.length - 1];
  ctx.beginPath();
  ctx.arc(last.x, last.y, 4, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 6;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = '#0a0e1a';
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

// --- Helpers ---

function lastValid(arr) {
  if (!arr) return null;
  for (let i = arr.length - 1; i >= 0; i--) {
    if (arr[i] != null) return arr[i];
  }
  return null;
}

function mosClass(mos) {
  if (mos == null) return '';
  if (mos >= 4.0) return 'dash-quality-good';
  if (mos >= 3.0) return 'dash-quality-warn';
  return 'dash-quality-crit';
}

function mosHealthDot(mos) {
  if (mos == null) return '';
  if (mos >= 4.0) return 'green';
  if (mos >= 3.0) return 'yellow';
  return 'red';
}

function mosLabel(mos) {
  if (mos >= 4.3) return 'Excellent';
  if (mos >= 4.0) return 'Good';
  if (mos >= 3.6) return 'Fair';
  if (mos >= 3.0) return 'Acceptable';
  return 'Poor';
}

function formatUptime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatDataSize(bytes) {
  if (bytes == null || bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let size = bytes;
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i++;
  }
  return size.toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
}
