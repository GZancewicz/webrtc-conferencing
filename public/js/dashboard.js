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
        prevBytesSent: null,
        prevBytesRecv: null,
        prevTimestamp: null,
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

      // Trim to MAX_SAMPLES
      if (history.timestamps.length > MAX_SAMPLES) {
        const excess = history.timestamps.length - MAX_SAMPLES;
        for (const key of ['timestamps', 'rtt', 'jitter', 'packetLoss', 'sendFps', 'recvFps', 'sendBitrate', 'recvBitrate', 'sendRes', 'recvRes']) {
          history[key].splice(0, excess);
        }
      }
    } catch (e) {
      // Stats unavailable
    }
  }
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

  if (!this.dashboardHistory || this.dashboardHistory.size === 0) {
    body.innerHTML = this.peers.size === 0
      ? '<div class="dash-empty">No peers connected</div>'
      : '<div class="dash-empty">Collecting data...</div>';
    return;
  }

  body.innerHTML = '';

  // --- Summary row ---
  const summary = document.createElement('div');
  summary.className = 'dash-summary';

  const totalPeers = this.peers.size;
  const selfTs = this.connectionTimestamps.get('self');
  const uptime = selfTs ? Math.floor((Date.now() - selfTs.getTime()) / 1000) : 0;

  let qualityScores = [];
  for (const [, history] of this.dashboardHistory) {
    const s = this.calcQualityScore(history.rtt, history.jitter, history.packetLoss);
    if (s != null) qualityScores.push(s);
  }
  const avgQuality = qualityScores.length > 0
    ? Math.round(qualityScores.reduce((a, b) => a + b, 0) / qualityScores.length)
    : null;

  const samples = this.dashboardHistory.size > 0
    ? this.dashboardHistory.values().next().value.timestamps.length
    : 0;

  summary.innerHTML = `
    <div class="dash-summary-card">
      <div class="dash-summary-icon">${qualityIcon(avgQuality)}</div>
      <div class="dash-summary-value ${qualityClass(avgQuality)}">${avgQuality != null ? avgQuality : '–'}</div>
      <div class="dash-summary-label">Quality Score</div>
    </div>
    <div class="dash-summary-card">
      <div class="dash-summary-icon">👥</div>
      <div class="dash-summary-value">${totalPeers}</div>
      <div class="dash-summary-label">Connected Peers</div>
    </div>
    <div class="dash-summary-card">
      <div class="dash-summary-icon">⏱️</div>
      <div class="dash-summary-value">${formatUptime(uptime)}</div>
      <div class="dash-summary-label">Session Duration</div>
    </div>
    <div class="dash-summary-card">
      <div class="dash-summary-icon">📈</div>
      <div class="dash-summary-value">${samples}</div>
      <div class="dash-summary-label">Data Points</div>
    </div>
  `;
  body.appendChild(summary);

  // --- Per-peer sections ---
  for (const [, history] of this.dashboardHistory) {
    const section = document.createElement('div');
    section.className = 'dash-peer-section';

    const score = this.calcQualityScore(history.rtt, history.jitter, history.packetLoss);

    // Header
    const header = document.createElement('div');
    header.className = 'dash-peer-header';
    header.innerHTML = `
      <span class="dash-peer-name">${this.escapeHtml(history.username)}</span>
      <span class="dash-peer-state">${history.connectionState} / ${history.iceState}</span>
      ${score != null ? `<span class="dash-quality-badge ${qualityClass(score)}">${qualityLabel(score)}</span>` : ''}
    `;
    section.appendChild(header);

    // Info row
    const info = document.createElement('div');
    info.className = 'dash-info-row';
    info.innerHTML = `
      <span>Audio: ${this.escapeHtml(history.audioCodec || '–')}</span>
      <span>Video: ${this.escapeHtml(history.videoCodec || '–')}</span>
      <span>Local: ${this.escapeHtml(history.localCandidate || '–')}</span>
      <span>Remote: ${this.escapeHtml(history.remoteCandidate || '–')}</span>
    `;
    section.appendChild(info);

    // Metric cards grid
    const grid = document.createElement('div');
    grid.className = 'dash-card-grid';

    grid.appendChild(this.createDashboardCard('RTT', history.rtt, 'ms', {
      color: '#3b82f6', warnThreshold: 200, critThreshold: 300
    }));
    grid.appendChild(this.createDashboardCard('Jitter', history.jitter, 'ms', {
      color: '#8b5cf6', warnThreshold: 50, critThreshold: 80, decimals: 1
    }));
    grid.appendChild(this.createDashboardCard('Packet Loss', history.packetLoss, '%', {
      color: '#ef4444', warnThreshold: 3, critThreshold: 5, decimals: 2
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

    // Resolution card (no sparkline)
    const resCard = document.createElement('div');
    resCard.className = 'dash-card';
    const lastSendRes = lastValid(history.sendRes) || '–';
    const lastRecvRes = lastValid(history.recvRes) || '–';
    resCard.innerHTML = `
      <div class="dash-card-title">Resolution</div>
      <div class="dash-card-res">
        <div><span class="dash-res-label">Send</span><span class="dash-res-value">${this.escapeHtml(lastSendRes)}</span></div>
        <div><span class="dash-res-label">Recv</span><span class="dash-res-value">${this.escapeHtml(lastRecvRes)}</span></div>
      </div>
    `;
    grid.appendChild(resCard);

    section.appendChild(grid);
    body.appendChild(section);
  }
}

export function createDashboardCard(title, data, unit, opts = {}) {
  const { color = '#3b82f6', warnThreshold = null, critThreshold = null, decimals = 0 } = opts;

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
  drawThreshold(warnThreshold, 'rgba(234, 179, 8, 0.35)');
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

  // Current value dot
  const last = points[points.length - 1];
  ctx.beginPath();
  ctx.arc(last.x, last.y, 3, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = '#0f172a';
  ctx.lineWidth = 1;
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

function qualityIcon(score) {
  if (score == null) return '⚪';
  if (score >= 80) return '🟢';
  if (score >= 50) return '🟡';
  return '🔴';
}

function formatUptime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
