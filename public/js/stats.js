export async function toggleStats() {
  const panel = document.getElementById('stats-panel');
  const btn = document.getElementById('toggle-stats');
  const isVisible = panel.style.display !== 'none';

  if (isVisible) {
    panel.style.display = 'none';
    btn.classList.remove('active');
  } else {
    panel.style.display = 'flex';
    btn.classList.add('active');
    await this.renderStats();
  }
}

export function statsTip(label) {
  const tips = {
    'Connection': 'Overall peer connection state (new, connecting, connected, disconnected, failed, closed)',
    'ICE State': 'ICE agent connection state - tracks whether ICE candidates have successfully created a connection',
    'ICE Gather': 'Whether the browser is still discovering network candidates (new, gathering, complete)',
    'Signaling': 'SDP offer/answer exchange state (stable = negotiation complete)',
    'DTLS': 'Datagram TLS state - secures the media transport (connected = encrypted tunnel established)',
    'DTLS Cipher': 'Encryption cipher used for the DTLS handshake',
    'SRTP Cipher': 'Encryption cipher protecting the actual audio/video media packets',
    'TLS Version': 'TLS protocol version used for DTLS (FEFC = DTLS 1.2)',
    'Audio Codec': 'Codec compressing/decompressing the audio stream',
    'Video Codec': 'Codec compressing/decompressing the video stream',
    'Send Res': 'Resolution of the video you are sending to this peer',
    'Send FPS': 'Frames per second of the video you are sending',
    'Recv Res': 'Resolution of the video you are receiving from this peer',
    'Recv FPS': 'Frames per second of the video you are receiving',
    'RTT': 'Round-trip time - how long a packet takes to reach the peer and return (lower is better)',
    'Latency': 'Estimated one-way latency: RTT/2 (network) + jitter buffer delay. Does not include encode/decode overhead (~5-15ms)',
    'Packet Loss': 'Percentage of packets lost in transit (lower is better, >5% degrades quality)',
    'Jitter': 'Variation in packet arrival times (lower is better, high jitter causes choppy audio/video)',
    'Bytes Sent': 'Total data sent to this peer since connection started',
    'Bytes Recv': 'Total data received from this peer since connection started',
    'STUN': 'Session Traversal Utilities for NAT - helps discover your public IP for peer-to-peer connections',
    'TURN': 'Traversal Using Relays around NAT - relays media when direct peer-to-peer fails'
  };
  return tips[label] || '';
}

export function statsRow(label, value) {
  const tip = this.statsTip(label);
  if (tip) {
    return `<tr><td class="has-tip">${label}<span class="tip-popup">${this.escapeHtml(tip)}</span></td><td>${value}</td></tr>`;
  }
  return `<tr><td>${label}</td><td>${value}</td></tr>`;
}

export async function renderStats() {
  const body = document.getElementById('stats-panel-body');
  let html = '';

  // ICE server configuration
  html += '<div class="stats-section">';
  html += '<div class="stats-section-title">Configured ICE Servers</div>';
  html += '<table class="stats-table">';
  this.iceServers.iceServers.forEach((server, i) => {
    const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
    urls.forEach(url => {
      const type = url.startsWith('turn') ? 'TURN' : 'STUN';
      html += this.statsRow(type, this.escapeHtml(url));
    });
  });
  html += '</table></div>';

  // Per-peer stats
  if (this.peers.size === 0) {
    html += '<div class="stats-no-peers">No peers connected</div>';
    body.innerHTML = html;
    return;
  }

  for (const [userId, peer] of this.peers) {
    const pc = peer.connection;
    html += `<div class="stats-section">`;
    html += `<div class="stats-section-title">Peer: ${this.escapeHtml(peer.username)}</div>`;

    // Connection states
    html += '<table class="stats-table">';
    html += this.statsRow('Connection', pc.connectionState || 'N/A');
    html += this.statsRow('ICE State', pc.iceConnectionState || 'N/A');
    html += this.statsRow('ICE Gather', pc.iceGatheringState || 'N/A');
    html += this.statsRow('Signaling', pc.signalingState || 'N/A');

    // Get stats snapshot
    try {
      const stats = await pc.getStats();
      let activePairId = null;
      const candidateMap = new Map();
      let dtlsState = null, dtlsCipher = null, srtpCipher = null, tlsVersion = null;
      let rtt = null, bytesSent = null, bytesRecv = null;
      let audioCodec = null, videoCodec = null;
      let videoWidth = null, videoHeight = null, fps = null;
      let outVideoWidth = null, outVideoHeight = null, outFps = null;
      let packetsLost = null, packetsRecv = null, jitter = null;
      let jitterBufferDelay = null, jitterBufferCount = null;
      const codecMap = new Map();

      // First pass: collect all stats
      stats.forEach(report => {
        if (report.type === 'transport') {
          dtlsState = report.dtlsState;
          dtlsCipher = report.dtlsCipher;
          srtpCipher = report.srtpCipher;
          tlsVersion = report.tlsVersion;
          activePairId = report.selectedCandidatePairId;
        }
        if (report.type === 'candidate-pair' && report.state === 'succeeded') {
          if (!activePairId) activePairId = report.id;
          rtt = report.currentRoundTripTime;
          bytesSent = report.bytesSent;
          bytesRecv = report.bytesReceived;
        }
        if (report.type === 'local-candidate' || report.type === 'remote-candidate') {
          candidateMap.set(report.id, report);
        }
        if (report.type === 'codec') {
          codecMap.set(report.id, report.mimeType);
        }
        if (report.type === 'inbound-rtp' && report.kind === 'video') {
          videoWidth = report.frameWidth;
          videoHeight = report.frameHeight;
          fps = report.framesPerSecond;
          packetsLost = report.packetsLost;
          packetsRecv = report.packetsReceived;
          jitter = report.jitter;
          if (report.codecId) videoCodec = report.codecId;
          if (report.jitterBufferDelay != null && report.jitterBufferEmittedCount) {
            jitterBufferDelay = report.jitterBufferDelay;
            jitterBufferCount = report.jitterBufferEmittedCount;
          }
        }
        if (report.type === 'inbound-rtp' && report.kind === 'audio') {
          if (report.codecId) audioCodec = report.codecId;
          if (packetsLost == null) packetsLost = report.packetsLost;
          if (packetsRecv == null) packetsRecv = report.packetsReceived;
          if (jitter == null) jitter = report.jitter;
        }
        if (report.type === 'outbound-rtp' && report.kind === 'video') {
          outVideoWidth = report.frameWidth;
          outVideoHeight = report.frameHeight;
          outFps = report.framesPerSecond;
        }
      });

      // Active candidate pair
      let activePair = null;
      if (activePairId) {
        stats.forEach(report => {
          if (report.id === activePairId) activePair = report;
        });
      }

      // Transport/security
      if (dtlsState) html += this.statsRow('DTLS', dtlsState);
      if (dtlsCipher) html += this.statsRow('DTLS Cipher', dtlsCipher);
      if (srtpCipher) html += this.statsRow('SRTP Cipher', srtpCipher);
      if (tlsVersion) html += this.statsRow('TLS Version', tlsVersion);

      // Media
      if (audioCodec && codecMap.has(audioCodec)) html += this.statsRow('Audio Codec', codecMap.get(audioCodec));
      if (videoCodec && codecMap.has(videoCodec)) html += this.statsRow('Video Codec', codecMap.get(videoCodec));
      if (outVideoWidth && outVideoHeight) html += this.statsRow('Send Res', this.formatRes(outVideoWidth, outVideoHeight));
      if (outFps != null) html += this.statsRow('Send FPS', `${Math.round(outFps)} fps`);
      if (videoWidth && videoHeight) html += this.statsRow('Recv Res', this.formatRes(videoWidth, videoHeight));
      if (fps != null) html += this.statsRow('Recv FPS', `${Math.round(fps)} fps`);

      // Network
      if (rtt != null) html += this.statsRow('RTT', `${(rtt * 1000).toFixed(0)} ms`);
      if (rtt != null) {
        const oneWay = (rtt * 1000) / 2;
        const bufferMs = (jitterBufferDelay != null && jitterBufferCount > 0)
          ? (jitterBufferDelay / jitterBufferCount) * 1000
          : 0;
        const estimated = oneWay + bufferMs;
        const parts = [`${oneWay.toFixed(0)} network`];
        if (bufferMs > 0) parts.push(`${bufferMs.toFixed(0)} buffer`);
        html += this.statsRow('Latency', `~${estimated.toFixed(0)} ms (${parts.join(' + ')})`);
      }
      if (packetsRecv != null && packetsLost != null) {
        const lossRate = packetsRecv > 0 ? ((packetsLost / (packetsRecv + packetsLost)) * 100).toFixed(2) : '0.00';
        html += this.statsRow('Packet Loss', `${lossRate}% (${packetsLost} lost)`);
      }
      if (jitter != null) html += this.statsRow('Jitter', `${(jitter * 1000).toFixed(1)} ms`);
      if (bytesSent != null) html += this.statsRow('Bytes Sent', this.formatBytes(bytesSent));
      if (bytesRecv != null) html += this.statsRow('Bytes Recv', this.formatBytes(bytesRecv));

      html += '</table>';

      // Active candidate pair detail
      if (activePair) {
        const localCand = candidateMap.get(activePair.localCandidateId);
        const remoteCand = candidateMap.get(activePair.remoteCandidateId);
        html += '<div style="margin-top:8px;font-weight:600;font-size:12px;color:var(--success-color);">Active Pair</div>';
        if (localCand) {
          html += `<div class="stats-candidate active">Local: ${localCand.candidateType} ${localCand.protocol || ''} ${localCand.address || localCand.ip || ''}:${localCand.port || ''}</div>`;
        }
        if (remoteCand) {
          html += `<div class="stats-candidate active">Remote: ${remoteCand.candidateType} ${remoteCand.protocol || ''} ${remoteCand.address || remoteCand.ip || ''}:${remoteCand.port || ''}</div>`;
        }
      }

      // All gathered local candidates
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

    } catch (e) {
      html += `<tr><td colspan="2">Stats unavailable: ${e.message}</td></tr></table>`;
    }

    html += '</div>';
  }

  body.innerHTML = html;
}

export function parseCandidateString(str) {
  if (!str) return { type: '?', protocol: '?', address: '?', port: '?' };
  const parts = str.split(' ');
  return {
    protocol: parts[2] || '?',
    address: parts[4] || '?',
    port: parts[5] || '?',
    type: parts[7] || '?'
  };
}

export function formatRes(w, h) {
  const short = Math.min(w, h);
  const long = Math.max(w, h);
  if (long >= 3840) return `${w}x${h} (2160p/4K)`;
  if (long >= 2560) return `${w}x${h} (1440p)`;
  if (long >= 1920) return `${w}x${h} (1080p)`;
  if (long >= 1280) return `${w}x${h} (720p)`;
  if (long >= 854) return `${w}x${h} (480p)`;
  if (long >= 640) return `${w}x${h} (360p)`;
  if (long >= 426) return `${w}x${h} (240p)`;
  return `${w}x${h} (${short}p)`;
}

export function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}
