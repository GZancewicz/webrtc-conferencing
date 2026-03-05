export function toggleTelemetry() {
  const panel = document.getElementById('telemetry-panel');
  const btn = document.getElementById('toggle-telemetry');
  const isVisible = panel.style.display !== 'none';

  if (isVisible) {
    panel.style.display = 'none';
    btn.classList.remove('on');
  } else {
    panel.style.display = 'flex';
    btn.classList.add('on');
    // Ensure DataChannels exist for all peers
    for (const [userId, peer] of this.peers) {
      if (!this.telemetryChannels.has(userId)) {
        const dc = peer.connection.createDataChannel('telemetry');
        this.setupTelemetryChannel(dc, userId);
      }
    }
    this.startTelemetryBroadcast();
    this.renderTelemetry();
  }
}

export function setupTelemetryChannel(channel, userId) {
  this.telemetryChannels.set(userId, channel);

  channel.onopen = () => {
    // Channel ready for telemetry exchange
  };

  channel.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      this.receivedPeerStats.set(data.username, { stats: data.stats, timestamp: data.timestamp });

      // Store into dashboardHistory for sparkline rendering
      // Works with stats.raw (new format) or falls back to parsing stats.rows (old format)
      if (!this.dashboardHistory) this.dashboardHistory = new Map();

      const remoteKey = `remote-${data.username}`;
      const raw = data.stats.raw || this._parseRowsToRaw(data.stats);
      const now = Date.now();

      if (!this.dashboardHistory.has(remoteKey)) {
        this.dashboardHistory.set(remoteKey, {
          username: data.username,
          remoteView: true,
          remotePeer: data.stats.peer,
          timestamps: [],
          rtt: [], jitter: [], packetLoss: [],
          sendFps: [], recvFps: [],
          sendBitrate: [], recvBitrate: [],
          sendRes: [], recvRes: [],
          mos: [],
          prevBytesSent: null, prevBytesRecv: null, prevTimestamp: null,
          totalBytesSent: 0, totalBytesRecv: 0,
          audioCodec: '', videoCodec: '',
          connectionState: '', iceState: '', dtlsState: '',
          localCandidate: '', remoteCandidate: '',
          localCandidates: [], remoteCandidates: []
        });
      }

      const history = this.dashboardHistory.get(remoteKey);
      history.remotePeer = data.stats.peer;
      history.connectionState = raw.connectionState || '';
      history.iceState = raw.iceState || '';
      history.dtlsState = raw.dtlsState || '';
      history.audioCodec = raw.audioCodec || '';
      history.videoCodec = raw.videoCodec || '';
      history.localCandidate = raw.activeLocal || '';
      history.remoteCandidate = raw.activeRemote || '';

      // Store peer's media settings preferences
      if (data.stats.settings) {
        history.preferredResolution = data.stats.settings.preferredResolution;
        history.preferredAudioCodec = data.stats.settings.preferredAudioCodec;
        history.preferredVideoCodec = data.stats.settings.preferredVideoCodec;
      }

      // Bitrate calculation
      let sendBitrate = null, recvBitrate = null;
      if (history.prevBytesSent != null && raw.bytesSent != null && history.prevTimestamp != null) {
        const dt = (now - history.prevTimestamp) / 1000;
        if (dt > 0) {
          sendBitrate = ((raw.bytesSent - history.prevBytesSent) * 8) / dt / 1000;
          recvBitrate = ((raw.bytesRecv - history.prevBytesRecv) * 8) / dt / 1000;
        }
      }
      history.prevBytesSent = raw.bytesSent;
      history.prevBytesRecv = raw.bytesRecv;
      history.prevTimestamp = now;
      if (raw.bytesSent != null) history.totalBytesSent = raw.bytesSent;
      if (raw.bytesRecv != null) history.totalBytesRecv = raw.bytesRecv;

      // ICE candidates from broadcast
      if (data.stats.localCandidates) {
        history.localCandidates = data.stats.localCandidates.map(c => {
          const parsed = this.parseCandidateString(c);
          return `${parsed.type} ${parsed.protocol} ${parsed.address}:${parsed.port}`;
        });
      }
      if (data.stats.remoteCandidates) {
        history.remoteCandidates = data.stats.remoteCandidates.map(c => {
          const parsed = this.parseCandidateString(c);
          return `${parsed.type} ${parsed.protocol} ${parsed.address}:${parsed.port}`;
        });
      }

      history.timestamps.push(now);
      history.rtt.push(raw.rtt);
      history.jitter.push(raw.jitter);
      history.packetLoss.push(raw.packetLoss);
      history.sendFps.push(raw.sendFps);
      history.recvFps.push(raw.recvFps);
      history.sendBitrate.push(sendBitrate);
      history.recvBitrate.push(recvBitrate);
      history.sendRes.push(raw.sendRes);
      history.recvRes.push(raw.recvRes);
      history.mos.push(raw.mos);

      // Trim to 60 samples
      if (history.timestamps.length > 60) {
        const excess = history.timestamps.length - 60;
        for (const key of ['timestamps', 'rtt', 'jitter', 'packetLoss', 'sendFps', 'recvFps', 'sendBitrate', 'recvBitrate', 'sendRes', 'recvRes', 'mos']) {
          history[key].splice(0, excess);
        }
      }

      // Refresh telemetry panel if visible
      const telPanel = document.getElementById('telemetry-panel');
      if (telPanel && telPanel.style.display !== 'none') {
        this.renderTelemetry();
      }
      // Refresh dashboard if visible (to show remote peer data)
      const dashPanel = document.getElementById('dashboard-panel');
      if (dashPanel && dashPanel.style.display !== 'none') {
        this.renderDashboard();
      }
    } catch (e) {
      // Ignore malformed telemetry
    }
  };

  channel.onclose = () => {
    this.telemetryChannels.delete(userId);
  };
}

export function startTelemetryBroadcast() {
  if (this.telemetryBroadcastInterval) return;
  this.telemetryBroadcastInterval = setTimeout(() => {
    this.broadcastTelemetry();
    this.telemetryBroadcastInterval = setInterval(() => this.broadcastTelemetry(), 2000);
  }, 2000);
}

export function stopTelemetryBroadcast() {
  if (this.telemetryBroadcastInterval) {
    clearInterval(this.telemetryBroadcastInterval);
    clearTimeout(this.telemetryBroadcastInterval);
    this.telemetryBroadcastInterval = null;
  }
}

export async function renderTelemetry() {
  const body = document.getElementById('telemetry-panel-body');
  if (!body) return;

  const expectedFields = [
    'Connection', 'ICE State', 'DTLS', 'RTT', 'Jitter', 'Packet Loss',
    'Audio Codec', 'Video Codec', 'Send Res', 'Send FPS', 'Recv Res', 'Recv FPS',
    'Bytes Sent', 'Bytes Recv', 'Active Local', 'Active Remote'
  ];

  let html = '';

  // ICE server configuration (mirrors stats panel)
  html += '<div class="stats-section">';
  html += '<div class="stats-section-title">Configured ICE Servers</div>';
  html += '<table class="stats-table">';
  this.iceServers.iceServers.forEach((server) => {
    const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
    urls.forEach(url => {
      const type = url.startsWith('turn') ? 'TURN' : 'STUN';
      html += this.statsRow(type, this.escapeHtml(url));
    });
  });
  html += '</table></div>';

  // Local stats (same data as stats panel) for each peer
  if (this.peers.size === 0) {
    html += '<div class="stats-no-peers">No peers connected</div>';
  } else {
    for (const [userId, peer] of this.peers) {
      const pc = peer.connection;
      html += '<div class="stats-section">';
      html += `<div class="stats-section-title">Your view → ${this.escapeHtml(peer.username)}</div>`;
      html += '<table class="stats-table">';

      const rows = new Map();
      rows.set('Connection', pc.connectionState || 'N/A');
      rows.set('ICE State', pc.iceConnectionState || 'N/A');

      try {
        const stats = await pc.getStats();
        let activePairId = null;
        const candidateMap = new Map();
        const codecMap = new Map();
        let audioCodecId = null, videoCodecId = null;
        let packetsLost = null, packetsRecv = null;

        stats.forEach(report => {
          if (report.type === 'transport') {
            if (report.dtlsState) rows.set('DTLS', report.dtlsState);
            activePairId = report.selectedCandidatePairId;
          }
          if (report.type === 'candidate-pair' && report.state === 'succeeded') {
            if (!activePairId) activePairId = report.id;
            if (report.currentRoundTripTime != null) rows.set('RTT', `${(report.currentRoundTripTime * 1000).toFixed(0)} ms`);
            if (report.bytesSent != null) rows.set('Bytes Sent', this.formatBytes(report.bytesSent));
            if (report.bytesReceived != null) rows.set('Bytes Recv', this.formatBytes(report.bytesReceived));
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
            if (report.jitter != null && !rows.has('Jitter')) rows.set('Jitter', `${(report.jitter * 1000).toFixed(1)} ms`);
          }
          if (report.type === 'inbound-rtp' && report.kind === 'video') {
            if (report.codecId) videoCodecId = report.codecId;
            if (report.frameWidth && report.frameHeight) rows.set('Recv Res', this.formatRes(report.frameWidth, report.frameHeight));
            if (report.framesPerSecond != null) rows.set('Recv FPS', `${Math.round(report.framesPerSecond)} fps`);
            packetsLost = report.packetsLost;
            packetsRecv = report.packetsReceived;
            if (report.jitter != null) rows.set('Jitter', `${(report.jitter * 1000).toFixed(1)} ms`);
          }
          if (report.type === 'outbound-rtp' && report.kind === 'video') {
            if (report.frameWidth && report.frameHeight) rows.set('Send Res', this.formatRes(report.frameWidth, report.frameHeight));
            if (report.framesPerSecond != null) rows.set('Send FPS', `${Math.round(report.framesPerSecond)} fps`);
          }
        });

        if (audioCodecId && codecMap.has(audioCodecId)) rows.set('Audio Codec', codecMap.get(audioCodecId).replace(/^(audio|video)\//, ''));
        if (videoCodecId && codecMap.has(videoCodecId)) rows.set('Video Codec', codecMap.get(videoCodecId).replace(/^(audio|video)\//, ''));
        if (packetsRecv != null && packetsLost != null) {
          const lossRate = packetsRecv > 0 ? ((packetsLost / (packetsRecv + packetsLost)) * 100).toFixed(2) : '0.00';
          rows.set('Packet Loss', `${lossRate}% (${packetsLost} lost)`);
        }

        if (activePairId) {
          stats.forEach(report => {
            if (report.id === activePairId) {
              const local = candidateMap.get(report.localCandidateId);
              const remote = candidateMap.get(report.remoteCandidateId);
              if (local) rows.set('Active Local', `${local.candidateType} ${local.protocol || ''} ${local.address || local.ip || ''}:${local.port || ''}`);
              if (remote) rows.set('Active Remote', `${remote.candidateType} ${remote.protocol || ''} ${remote.address || remote.ip || ''}:${remote.port || ''}`);
            }
          });
        }
      } catch (e) {
        // Stats unavailable
      }

      expectedFields.forEach(field => {
        const value = rows.get(field) || '–';
        html += `<tr><td>${this.escapeHtml(field)}</td><td>${this.escapeHtml(value)}</td></tr>`;
      });

      html += '</table>';

      // ICE candidates
      const activeLocal = rows.get('Active Local') || '';
      const activeRemote = rows.get('Active Remote') || '';
      const candidateEntry = this.iceCandidates.get(userId);
      if (candidateEntry && candidateEntry.local.length > 0) {
        html += '<div style="margin-top:8px;font-weight:600;font-size:12px;color:var(--text-secondary);">Local ICE Candidates</div>';
        candidateEntry.local.forEach(c => {
          const parsed = this.parseCandidateString(c.candidate);
          const candText = `${parsed.type} ${parsed.protocol} ${parsed.address}:${parsed.port}`;
          const isActive = activeLocal && candText.trim() === activeLocal.trim();
          html += `<div class="stats-candidate${isActive ? ' active' : ''}">${candText}</div>`;
        });
      }
      if (candidateEntry && candidateEntry.remote.length > 0) {
        html += '<div style="margin-top:8px;font-weight:600;font-size:12px;color:var(--text-secondary);">Remote ICE Candidates</div>';
        candidateEntry.remote.forEach(c => {
          const candStr = c.candidate || c;
          const parsed = this.parseCandidateString(typeof candStr === 'string' ? candStr : c.candidate);
          const candText = `${parsed.type} ${parsed.protocol} ${parsed.address}:${parsed.port}`;
          const isActive = activeRemote && candText.trim() === activeRemote.trim();
          html += `<div class="stats-candidate${isActive ? ' active' : ''}">${candText}</div>`;
        });
      }

      html += '</div>';
    }
  }

  // Received peer telemetry via DataChannel
  if (this.receivedPeerStats.size > 0) {
    for (const [username, { stats, timestamp }] of this.receivedPeerStats) {
      const time = new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      html += '<div class="stats-section">';
      html += `<div class="stats-section-title">${this.escapeHtml(username)}'s view → ${this.escapeHtml(stats.peer)} <span style="font-weight:400;font-size:11px;">(via DataChannel ${time})</span></div>`;
      html += '<table class="stats-table">';

      const rowMap = new Map();
      if (stats.rows) {
        stats.rows.forEach(([label, value]) => {
          rowMap.set(label, value);
        });
      }

      expectedFields.forEach(field => {
        const value = rowMap.get(field) || '–';
        html += `<tr><td>${this.escapeHtml(field)}</td><td>${this.escapeHtml(value)}</td></tr>`;
      });

      html += '</table>';

      const remoteActiveLocal = rowMap.get('Active Local') || '';
      const remoteActiveRemote = rowMap.get('Active Remote') || '';
      if (stats.localCandidates && stats.localCandidates.length > 0) {
        html += '<div style="margin-top:8px;font-weight:600;font-size:12px;color:var(--text-secondary);">Local ICE Candidates</div>';
        stats.localCandidates.forEach(c => {
          const parsed = this.parseCandidateString(c);
          const candText = `${parsed.type} ${parsed.protocol} ${parsed.address}:${parsed.port}`;
          const isActive = remoteActiveLocal && candText.trim() === remoteActiveLocal.trim();
          html += `<div class="stats-candidate${isActive ? ' active' : ''}">${candText}</div>`;
        });
      }
      if (stats.remoteCandidates && stats.remoteCandidates.length > 0) {
        html += '<div style="margin-top:8px;font-weight:600;font-size:12px;color:var(--text-secondary);">Remote ICE Candidates</div>';
        stats.remoteCandidates.forEach(c => {
          const parsed = this.parseCandidateString(c);
          const candText = `${parsed.type} ${parsed.protocol} ${parsed.address}:${parsed.port}`;
          const isActive = remoteActiveRemote && candText.trim() === remoteActiveRemote.trim();
          html += `<div class="stats-candidate${isActive ? ' active' : ''}">${candText}</div>`;
        });
      }

      html += '</div>';
    }
  }

  body.innerHTML = html;
}

export async function broadcastTelemetry() {
  if (this.peers.size === 0 || this.telemetryChannels.size === 0) return;

  for (const [userId, peer] of this.peers) {
    const pc = peer.connection;
    try {
      const rawStats = await pc.getStats();
      const stats = { peer: peer.username };
      const rows = [];
      let activePairId = null;
      const candidateMap = new Map();
      const codecMap = new Map();
      let audioCodecId = null, videoCodecId = null;
      let packetsLost = null, packetsRecv = null;

      // Raw numeric values for dashboard history
      let rttNum = null, jitterNum = null;
      let sendFpsNum = null, recvFpsNum = null;
      let sendResStr = null, recvResStr = null;
      let bytesSentNum = null, bytesRecvNum = null;
      let dtlsState = null;

      rows.push(['Connection', pc.connectionState || 'N/A']);
      rows.push(['ICE State', pc.iceConnectionState || 'N/A']);

      rawStats.forEach(report => {
        if (report.type === 'transport') {
          if (report.dtlsState) { rows.push(['DTLS', report.dtlsState]); dtlsState = report.dtlsState; }
          activePairId = report.selectedCandidatePairId;
        }
        if (report.type === 'candidate-pair' && report.state === 'succeeded') {
          if (!activePairId) activePairId = report.id;
          if (report.currentRoundTripTime != null) { rttNum = report.currentRoundTripTime * 1000; rows.push(['RTT', `${rttNum.toFixed(0)} ms`]); }
          if (report.bytesSent != null) { bytesSentNum = report.bytesSent; rows.push(['Bytes Sent', this.formatBytes(report.bytesSent)]); }
          if (report.bytesReceived != null) { bytesRecvNum = report.bytesReceived; rows.push(['Bytes Recv', this.formatBytes(report.bytesReceived)]); }
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
          if (report.jitter != null && !stats._hasJitter) { jitterNum = report.jitter * 1000; rows.push(['Jitter', `${jitterNum.toFixed(1)} ms`]); stats._hasJitter = true; }
        }
        if (report.type === 'inbound-rtp' && report.kind === 'video') {
          if (report.codecId) videoCodecId = report.codecId;
          if (report.frameWidth && report.frameHeight) { recvResStr = `${report.frameWidth}x${report.frameHeight}`; rows.push(['Recv Res', this.formatRes(report.frameWidth, report.frameHeight)]); }
          if (report.framesPerSecond != null) { recvFpsNum = report.framesPerSecond; rows.push(['Recv FPS', `${Math.round(report.framesPerSecond)} fps`]); }
          packetsLost = report.packetsLost;
          packetsRecv = report.packetsReceived;
          if (report.jitter != null) { jitterNum = report.jitter * 1000; rows.push(['Jitter', `${jitterNum.toFixed(1)} ms`]); stats._hasJitter = true; }
        }
        if (report.type === 'outbound-rtp' && report.kind === 'video') {
          if (report.frameWidth && report.frameHeight) { sendResStr = `${report.frameWidth}x${report.frameHeight}`; rows.push(['Send Res', this.formatRes(report.frameWidth, report.frameHeight)]); }
          if (report.framesPerSecond != null) { sendFpsNum = report.framesPerSecond; rows.push(['Send FPS', `${Math.round(report.framesPerSecond)} fps`]); }
        }
      });

      if (audioCodecId && codecMap.has(audioCodecId)) rows.push(['Audio Codec', codecMap.get(audioCodecId)]);
      if (videoCodecId && codecMap.has(videoCodecId)) rows.push(['Video Codec', codecMap.get(videoCodecId)]);

      let packetLossNum = null;
      if (packetsRecv != null && packetsLost != null) {
        packetLossNum = (packetsRecv + packetsLost) > 0 ? (packetsLost / (packetsRecv + packetsLost)) * 100 : 0;
        rows.push(['Packet Loss', `${packetLossNum.toFixed(2)}% (${packetsLost} lost)`]);
      }

      let activeLocalStr = null, activeRemoteStr = null;
      if (activePairId) {
        rawStats.forEach(report => {
          if (report.id === activePairId) {
            const local = candidateMap.get(report.localCandidateId);
            const remote = candidateMap.get(report.remoteCandidateId);
            if (local) { activeLocalStr = `${local.candidateType} ${local.protocol || ''} ${local.address || local.ip || ''}:${local.port || ''}`; rows.push(['Active Local', activeLocalStr]); }
            if (remote) { activeRemoteStr = `${remote.candidateType} ${remote.protocol || ''} ${remote.address || remote.ip || ''}:${remote.port || ''}`; rows.push(['Active Remote', activeRemoteStr]); }
          }
        });
      }

      stats.rows = rows;
      delete stats._hasJitter;

      // Raw numeric data for dashboard sparklines
      // MOS calculation (E-model simplified)
      let mosNum = null;
      if (rttNum != null || jitterNum != null || packetLossNum != null) {
        const d = (rttNum != null ? rttNum : 0) / 2;
        const j = jitterNum != null ? jitterNum : 0;
        const pl = packetLossNum != null ? packetLossNum : 0;
        const effectiveLatency = d + j * 2 + 10;
        let R = effectiveLatency < 160 ? 93.2 - (effectiveLatency / 40) : 93.2 - ((effectiveLatency - 120) / 10);
        R = Math.max(0, Math.min(100, R - pl * 2.5));
        mosNum = R < 0 ? 1.0 : R > 100 ? 4.5 : Math.max(1.0, Math.min(5.0, 1 + 0.035 * R + R * (R - 60) * (100 - R) * 7e-6));
      }

      stats.raw = {
        rtt: rttNum, jitter: jitterNum, packetLoss: packetLossNum,
        sendFps: sendFpsNum, recvFps: recvFpsNum,
        sendRes: sendResStr, recvRes: recvResStr,
        mos: mosNum,
        bytesSent: bytesSentNum, bytesRecv: bytesRecvNum,
        audioCodec: audioCodecId && codecMap.has(audioCodecId) ? codecMap.get(audioCodecId) : '',
        videoCodec: videoCodecId && codecMap.has(videoCodecId) ? codecMap.get(videoCodecId) : '',
        connectionState: pc.connectionState || 'N/A',
        iceState: pc.iceConnectionState || 'N/A',
        dtlsState: dtlsState || 'N/A',
        activeLocal: activeLocalStr,
        activeRemote: activeRemoteStr
      };

      // Include ICE candidates
      const candidateEntry = this.iceCandidates.get(userId);
      if (candidateEntry) {
        stats.localCandidates = candidateEntry.local.map(c => c.candidate);
        stats.remoteCandidates = candidateEntry.remote.map(c => {
          const candStr = c.candidate || c;
          return typeof candStr === 'string' ? candStr : c.candidate;
        });
      }

      // Include media settings preferences
      stats.settings = {
        preferredResolution: this.preferredResolution,
        preferredAudioCodec: this.preferredAudioCodec,
        preferredVideoCodec: this.preferredVideoCodec
      };

      // Send via DataChannel to all peers with open channels
      const message = JSON.stringify({ username: this.username, stats, timestamp: new Date().toISOString() });
      for (const [, channel] of this.telemetryChannels) {
        if (channel.readyState === 'open') {
          channel.send(message);
        }
      }
    } catch (e) {
      // Stats unavailable, skip
    }
  }
}

// Fallback: parse formatted row strings into raw numeric values
// Used when receiving telemetry from a peer running older code without stats.raw
export function _parseRowsToRaw(stats) {
  const rowMap = new Map();
  if (stats.rows) {
    stats.rows.forEach(([label, value]) => rowMap.set(label, value));
  }

  const parseNum = (str) => {
    if (!str || str === '–') return null;
    const m = str.match(/([\d.]+)/);
    return m ? parseFloat(m[1]) : null;
  };

  const rtt = parseNum(rowMap.get('RTT'));
  const jitter = parseNum(rowMap.get('Jitter'));
  const packetLoss = parseNum(rowMap.get('Packet Loss'));
  const sendFps = parseNum(rowMap.get('Send FPS'));
  const recvFps = parseNum(rowMap.get('Recv FPS'));

  // MOS calculation from parsed values
  let mos = null;
  if (rtt != null || jitter != null || packetLoss != null) {
    const d = (rtt != null ? rtt : 0) / 2;
    const j = jitter != null ? jitter : 0;
    const pl = packetLoss != null ? packetLoss : 0;
    const effectiveLatency = d + j * 2 + 10;
    let R = effectiveLatency < 160 ? 93.2 - (effectiveLatency / 40) : 93.2 - ((effectiveLatency - 120) / 10);
    R = Math.max(0, Math.min(100, R - pl * 2.5));
    mos = R < 0 ? 1.0 : R > 100 ? 4.5 : Math.max(1.0, Math.min(5.0, 1 + 0.035 * R + R * (R - 60) * (100 - R) * 7e-6));
  }

  return {
    rtt, jitter, packetLoss,
    sendFps, recvFps,
    sendRes: rowMap.get('Send Res') || null,
    recvRes: rowMap.get('Recv Res') || null,
    mos,
    bytesSent: null, bytesRecv: null,
    audioCodec: rowMap.get('Audio Codec') || '',
    videoCodec: rowMap.get('Video Codec') || '',
    connectionState: rowMap.get('Connection') || 'N/A',
    iceState: rowMap.get('ICE State') || 'N/A',
    dtlsState: rowMap.get('DTLS') || 'N/A',
    activeLocal: rowMap.get('Active Local') || '',
    activeRemote: rowMap.get('Active Remote') || ''
  };
}
