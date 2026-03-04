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
      // Refresh telemetry panel if visible
      const telPanel = document.getElementById('telemetry-panel');
      if (telPanel && telPanel.style.display !== 'none') {
        this.renderTelemetry();
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
    this.telemetryBroadcastInterval = setInterval(() => this.broadcastTelemetry(), 10000);
  }, 5000);
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

        if (audioCodecId && codecMap.has(audioCodecId)) rows.set('Audio Codec', codecMap.get(audioCodecId));
        if (videoCodecId && codecMap.has(videoCodecId)) rows.set('Video Codec', codecMap.get(videoCodecId));
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
      const candidateEntry = this.iceCandidates.get(userId);
      if (candidateEntry && candidateEntry.local.length > 0) {
        html += '<div style="margin-top:8px;font-weight:600;font-size:12px;color:var(--text-secondary);">Local Candidates</div>';
        candidateEntry.local.forEach(c => {
          const parsed = this.parseCandidateString(c.candidate);
          html += `<div class="stats-candidate">${parsed.type} ${parsed.protocol} ${parsed.address}:${parsed.port}</div>`;
        });
      }
      if (candidateEntry && candidateEntry.remote.length > 0) {
        html += '<div style="margin-top:8px;font-weight:600;font-size:12px;color:var(--text-secondary);">Remote Candidates</div>';
        candidateEntry.remote.forEach(c => {
          const candStr = c.candidate || c;
          const parsed = this.parseCandidateString(typeof candStr === 'string' ? candStr : c.candidate);
          html += `<div class="stats-candidate">${parsed.type} ${parsed.protocol} ${parsed.address}:${parsed.port}</div>`;
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

      html += '</table></div>';
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

      rows.push(['Connection', pc.connectionState || 'N/A']);
      rows.push(['ICE State', pc.iceConnectionState || 'N/A']);

      rawStats.forEach(report => {
        if (report.type === 'transport') {
          if (report.dtlsState) rows.push(['DTLS', report.dtlsState]);
          activePairId = report.selectedCandidatePairId;
        }
        if (report.type === 'candidate-pair' && report.state === 'succeeded') {
          if (!activePairId) activePairId = report.id;
          if (report.currentRoundTripTime != null) rows.push(['RTT', `${(report.currentRoundTripTime * 1000).toFixed(0)} ms`]);
          if (report.bytesSent != null) rows.push(['Bytes Sent', this.formatBytes(report.bytesSent)]);
          if (report.bytesReceived != null) rows.push(['Bytes Recv', this.formatBytes(report.bytesReceived)]);
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
          if (report.jitter != null && !stats._hasJitter) { rows.push(['Jitter', `${(report.jitter * 1000).toFixed(1)} ms`]); stats._hasJitter = true; }
        }
        if (report.type === 'inbound-rtp' && report.kind === 'video') {
          if (report.codecId) videoCodecId = report.codecId;
          if (report.frameWidth && report.frameHeight) rows.push(['Recv Res', this.formatRes(report.frameWidth, report.frameHeight)]);
          if (report.framesPerSecond != null) rows.push(['Recv FPS', `${Math.round(report.framesPerSecond)} fps`]);
          packetsLost = report.packetsLost;
          packetsRecv = report.packetsReceived;
          if (report.jitter != null) { rows.push(['Jitter', `${(report.jitter * 1000).toFixed(1)} ms`]); stats._hasJitter = true; }
        }
        if (report.type === 'outbound-rtp' && report.kind === 'video') {
          if (report.frameWidth && report.frameHeight) rows.push(['Send Res', this.formatRes(report.frameWidth, report.frameHeight)]);
          if (report.framesPerSecond != null) rows.push(['Send FPS', `${Math.round(report.framesPerSecond)} fps`]);
        }
      });

      if (audioCodecId && codecMap.has(audioCodecId)) rows.push(['Audio Codec', codecMap.get(audioCodecId)]);
      if (videoCodecId && codecMap.has(videoCodecId)) rows.push(['Video Codec', codecMap.get(videoCodecId)]);
      if (packetsRecv != null && packetsLost != null) {
        const lossRate = packetsRecv > 0 ? ((packetsLost / (packetsRecv + packetsLost)) * 100).toFixed(2) : '0.00';
        rows.push(['Packet Loss', `${lossRate}% (${packetsLost} lost)`]);
      }

      if (activePairId) {
        rawStats.forEach(report => {
          if (report.id === activePairId) {
            const local = candidateMap.get(report.localCandidateId);
            const remote = candidateMap.get(report.remoteCandidateId);
            if (local) rows.push(['Active Local', `${local.candidateType} ${local.protocol || ''} ${local.address || local.ip || ''}:${local.port || ''}`]);
            if (remote) rows.push(['Active Remote', `${remote.candidateType} ${remote.protocol || ''} ${remote.address || remote.ip || ''}:${remote.port || ''}`]);
          }
        });
      }

      stats.rows = rows;
      delete stats._hasJitter;

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
