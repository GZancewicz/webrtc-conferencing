const MAX_SAMPLES = 60; // ~10 min at 10s intervals

export function toggleDashboard() {
  const panel = document.getElementById('dashboard-panel');
  const btn = document.getElementById('toggle-dashboard');
  const isVisible = panel.style.display !== 'none';

  if (isVisible) {
    panel.style.display = 'none';
    btn.classList.remove('on');
    this.stopDashboardCollection();
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
  }, 10000);
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
        localCandidate: '',
        remoteCandidate: ''
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
        }
        if (report.type === 'candidate-pair' && report.state === 'succeeded') {
          if (!activePairId) activePairId = report.id;
          if (report.currentRoundTripTime != null) rtt = report.currentRoundTripTime * 1000;
          if (report.bytesSent != null) bytesSent = report.bytesSent;
          if (report.bytesReceived != null) bytesRecv = report.bytesReceived;
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

      // Packet loss percentage
      let packetLoss = null;
      if (packetsRecv != null && packetsLost != null && (packetsRecv + packetsLost) > 0) {
        packetLoss = (packetsLost / (packetsRecv + packetsLost)) * 100;
      }

      // Bitrate (kbps)
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

      // Active candidate info
      if (activePairId) {
        stats.forEach(report => {
          if (report.id === activePairId) {
            const local = candidateMap.get(report.localCandidateId);
            const remote = candidateMap.get(report.remoteCandidateId);
            if (local) history.localCandidate = `${local.candidateType} ${local.protocol || ''} ${local.address || local.ip || ''}:${local.port || ''}`;
            if (remote) history.remoteCandidate = `${remote.candidateType} ${remote.protocol || ''} ${remote.address || remote.ip || ''}:${remote.port || ''}`;
          }
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
      peersConnected: [],
      qualityScores: []
    });
  }

  const group = this.dashboardHistory.get(GROUP_KEY);
  const peerHistories = [];
  for (const [key, h] of this.dashboardHistory) {
    if (key === GROUP_KEY) continue;
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

  // Per-peer quality scores for health breakdown
  const scores = peerHistories.map(h =>
    this.calcQualityScore(h.rtt, h.jitter, h.packetLoss)
  ).filter(s => s != null);
  group.qualityScores.push(scores);

  // Trim
  if (group.timestamps.length > MAX_SAMPLES) {
    const excess = group.timestamps.length - MAX_SAMPLES;
    for (const key of ['timestamps', 'avgRtt', 'avgJitter', 'avgPacketLoss', 'avgMos', 'totalSendBitrate', 'totalRecvBitrate', 'avgSendFps', 'avgRecvFps', 'peersConnected', 'qualityScores']) {
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

export function calcQualityScore(rttArr, jitterArr, lossArr) {
  const rtt = lastValid(rttArr);
  const jitter = lastValid(jitterArr);
  const loss = lastValid(lossArr);

  if (rtt == null && jitter == null && loss == null) return null;

  let score = 100;

  if (rtt != null) {
    if (rtt > 300) score -= 40;
    else if (rtt > 200) score -= 25;
    else if (rtt > 100) score -= 10;
  }
  if (jitter != null) {
    if (jitter > 80) score -= 30;
    else if (jitter > 50) score -= 20;
    else if (jitter > 30) score -= 10;
  }
  if (loss != null) {
    if (loss > 5) score -= 30;
    else if (loss > 3) score -= 20;
    else if (loss > 1) score -= 10;
  }

  return Math.max(0, Math.min(100, score));
}

export function renderDashboard() {
  const body = document.getElementById('dashboard-body');
  if (!body) return;

  // Only count real peer entries (not __group__)
  const peerEntryCount = [...this.dashboardHistory.keys()].filter(k => k !== '__group__').length;

  if (!this.dashboardHistory || peerEntryCount === 0) {
    body.innerHTML = this.peers.size === 0
      ? '<div class="dash-empty">No peers connected</div>'
      : '<div class="dash-empty">Collecting data...</div>';
    return;
  }

  body.innerHTML = '';

  // --- KPI Bar ---
  const kpiBar = document.createElement('div');
  kpiBar.className = 'dash-kpi-bar';

  const totalPeers = this.peers.size;
  const selfTs = this.connectionTimestamps.get('self');
  const uptime = selfTs ? Math.floor((Date.now() - selfTs.getTime()) / 1000) : 0;

  let qualityScores = [];
  let mosScores = [];
  let totalSent = 0, totalRecv = 0;
  for (const [key, history] of this.dashboardHistory) {
    if (key === '__group__') continue;
    const s = this.calcQualityScore(history.rtt, history.jitter, history.packetLoss);
    if (s != null) qualityScores.push(s);
    const m = lastValid(history.mos);
    if (m != null) mosScores.push(m);
    totalSent += history.totalBytesSent || 0;
    totalRecv += history.totalBytesRecv || 0;
  }

  const avgQuality = qualityScores.length > 0
    ? Math.round(qualityScores.reduce((a, b) => a + b, 0) / qualityScores.length)
    : null;
  const avgMOS = mosScores.length > 0
    ? (mosScores.reduce((a, b) => a + b, 0) / mosScores.length)
    : null;

  const samples = this.dashboardHistory.size > 0
    ? this.dashboardHistory.values().next().value.timestamps.length
    : 0;

  kpiBar.innerHTML = `
    <div class="dash-kpi-card accent">
      <div class="dash-kpi-header">
        <span class="dash-kpi-label">Quality Score</span>
        <span class="dash-health-dot ${qualityHealthDot(avgQuality)}"></span>
      </div>
      <div class="dash-kpi-value">${avgQuality != null ? avgQuality : '–'}</div>
      <div class="dash-kpi-sub">${avgQuality != null ? qualityLabel(avgQuality) : 'Waiting...'}</div>
    </div>
    <div class="dash-kpi-card">
      <div class="dash-kpi-header">
        <span class="dash-kpi-label">MOS Score</span>
        <span class="dash-health-dot ${mosHealthDot(avgMOS)}"></span>
      </div>
      <div class="dash-kpi-value">${avgMOS != null ? avgMOS.toFixed(2) : '–'}</div>
      <div class="dash-kpi-sub">${avgMOS != null ? mosLabel(avgMOS) : 'Waiting...'}</div>
    </div>
    <div class="dash-kpi-card">
      <div class="dash-kpi-header">
        <span class="dash-kpi-label">Connected Peers</span>
      </div>
      <div class="dash-kpi-value">${totalPeers}</div>
      <div class="dash-kpi-sub">${samples} samples</div>
    </div>
    <div class="dash-kpi-card">
      <div class="dash-kpi-header">
        <span class="dash-kpi-label">Session Duration</span>
      </div>
      <div class="dash-kpi-value">${formatUptime(uptime)}</div>
      <div class="dash-kpi-sub">since join</div>
    </div>
    <div class="dash-kpi-card">
      <div class="dash-kpi-header">
        <span class="dash-kpi-label">Data Transferred</span>
      </div>
      <div class="dash-kpi-value">${formatDataSize(totalSent + totalRecv)}</div>
      <div class="dash-kpi-sub">${formatDataSize(totalSent)} sent / ${formatDataSize(totalRecv)} recv</div>
    </div>
  `;
  body.appendChild(kpiBar);

  // --- Group Analytics Section ---
  const group = this.dashboardHistory.get('__group__');
  if (group && group.timestamps.length > 0) {
    const groupSection = document.createElement('div');
    groupSection.className = 'dash-group-section';

    // Group header
    const groupHeader = document.createElement('div');
    groupHeader.className = 'dash-group-header';

    // Connection health breakdown from latest quality scores
    const latestScores = group.qualityScores.length > 0
      ? group.qualityScores[group.qualityScores.length - 1]
      : [];
    const healthCounts = { excellent: 0, good: 0, fair: 0, poor: 0 };
    for (const s of latestScores) {
      if (s >= 80) healthCounts.excellent++;
      else if (s >= 60) healthCounts.good++;
      else if (s >= 40) healthCounts.fair++;
      else healthCounts.poor++;
    }

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
        ${latestScores.length === 0 ? '<div class="dash-health-item"><span>Collecting...</span></div>' : ''}
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
    body.appendChild(groupSection);
  }

  // --- Per-peer sections ---
  for (const [key, history] of this.dashboardHistory) {
    if (key === '__group__') continue;
    const section = document.createElement('div');
    section.className = 'dash-peer-section';

    const score = this.calcQualityScore(history.rtt, history.jitter, history.packetLoss);
    const currentMOS = lastValid(history.mos);
    const owLatency = lastValid(history.rtt) != null ? (lastValid(history.rtt) / 2).toFixed(0) : null;

    // Header
    const header = document.createElement('div');
    header.className = 'dash-peer-header';
    header.innerHTML = `
      <span class="dash-health-dot ${qualityHealthDot(score)}"></span>
      <span class="dash-peer-name">${this.escapeHtml(history.username)}</span>
      <span class="dash-peer-state">${history.connectionState} / ${history.iceState}</span>
      ${score != null ? `<span class="dash-quality-badge ${qualityClass(score)}">${qualityLabel(score)} (${score})</span>` : ''}
    `;
    section.appendChild(header);

    // Info row with pills
    const info = document.createElement('div');
    info.className = 'dash-info-row';
    info.innerHTML = `
      <span class="dash-info-pill">Audio: ${this.escapeHtml(history.audioCodec || '–')}</span>
      <span class="dash-info-pill">Video: ${this.escapeHtml(history.videoCodec || '–')}</span>
      <span class="dash-info-pill">Local: ${this.escapeHtml(history.localCandidate || '–')}</span>
      <span class="dash-info-pill">Remote: ${this.escapeHtml(history.remoteCandidate || '–')}</span>
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
      <div class="dash-card-title">Resolution</div>
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
      <div class="dash-card-title">Data Transfer</div>
      <div style="margin-top:8px">
        <div class="dash-data-row"><span class="dash-data-label">Total Sent</span><span class="dash-data-value">${formatDataSize(history.totalBytesSent)}</span></div>
        <div class="dash-data-row"><span class="dash-data-label">Total Recv</span><span class="dash-data-value">${formatDataSize(history.totalBytesRecv)}</span></div>
        <div class="dash-data-row"><span class="dash-data-label">Combined</span><span class="dash-data-value">${formatDataSize(history.totalBytesSent + history.totalBytesRecv)}</span></div>
      </div>
    `;
    grid.appendChild(dataCard);

    section.appendChild(grid);
    body.appendChild(section);
  }
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

function qualityClass(score) {
  if (score == null) return '';
  if (score >= 80) return 'dash-quality-good';
  if (score >= 50) return 'dash-quality-warn';
  return 'dash-quality-crit';
}

function qualityLabel(score) {
  if (score >= 80) return 'Excellent';
  if (score >= 60) return 'Good';
  if (score >= 40) return 'Fair';
  return 'Poor';
}

function qualityHealthDot(score) {
  if (score == null) return '';
  if (score >= 80) return 'green';
  if (score >= 50) return 'yellow';
  return 'red';
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
