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
