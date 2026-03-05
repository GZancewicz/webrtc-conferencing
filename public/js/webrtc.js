export function createPeerConnection(userId, username, initiator) {
  const connection = new RTCPeerConnection(this.iceServers);

  // Init candidate tracking for this peer
  this.iceCandidates.set(userId, { local: [], remote: [] });

  // Add local tracks
  if (this.localStream) {
    this.localStream.getTracks().forEach(track => {
      connection.addTrack(track, this.localStream);
    });
  }

  // Apply codec preferences before offer/answer
  this.applyCodecPreferences(connection);

  // Handle ICE candidates
  connection.onicecandidate = (event) => {
    if (event.candidate) {
      const entry = this.iceCandidates.get(userId);
      if (entry) entry.local.push(event.candidate);
      // Track STUN contact time from srflx candidates
      if (event.candidate.type === 'srflx' || (event.candidate.candidate && event.candidate.candidate.includes('srflx'))) {
        const url = event.candidate.relatedAddress ? event.candidate.url : null;
        // Set timestamp for STUN servers on first srflx candidate
        this.iceServers.iceServers.forEach((server, i) => {
          const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
          urls.forEach(u => {
            if (u.startsWith('stun:')) {
              const key = `stun-${i}`;
              if (!this.connectionTimestamps.has(key)) {
                this.connectionTimestamps.set(key, new Date());
              }
            }
          });
        });
      }
      this.socket.emit('ice-candidate', {
        to: userId,
        candidate: event.candidate
      });
    }
  };

  // Handle incoming tracks
  connection.ontrack = (event) => {
    this.addRemoteVideo(userId, username, event.streams[0]);
  };

  // Handle connection state
  connection.onconnectionstatechange = () => {
    if (connection.connectionState === 'connected') {
      this.connectionTimestamps.set(`peer-${userId}`, new Date());
    }
    if (connection.connectionState === 'disconnected' ||
        connection.connectionState === 'failed') {
      this.removePeer(userId);
    }
  };

  // DataChannel for telemetry
  connection.ondatachannel = (event) => {
    if (event.channel.label === 'telemetry') {
      this.setupTelemetryChannel(event.channel, userId);
    }
  };

  if (initiator && this.telemetryEnabled) {
    const dc = connection.createDataChannel('telemetry');
    this.setupTelemetryChannel(dc, userId);
  }

  const peer = { connection, username };
  this.peers.set(userId, peer);

  // If initiator, create and send offer
  if (initiator) {
    this.createAndSendOffer(userId, connection);
  }

  // Add to participants list
  this.addParticipant(userId, username);

  return peer;
}

export async function flushPendingCandidates(userId) {
  const candidates = this.pendingCandidates.get(userId);
  if (!candidates) return;
  const peer = this.peers.get(userId);
  if (!peer) return;
  for (const candidate of candidates) {
    try {
      await peer.connection.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (error) {
      console.error('Error adding buffered ICE candidate:', error);
    }
  }
  this.pendingCandidates.delete(userId);
}

export async function createAndSendOffer(userId, connection) {
  try {
    const offer = await connection.createOffer();
    await connection.setLocalDescription(offer);
    this.socket.emit('offer', { to: userId, offer });
  } catch (error) {
    console.error('Error creating offer:', error);
  }
}

export function addRemoteVideo(userId, username, stream) {
  // Check if video container already exists
  let container = document.getElementById(`video-${userId}`);

  if (!container) {
    container = document.createElement('div');
    container.id = `video-${userId}`;
    container.className = 'video-container';
    container.innerHTML = `
      <video autoplay playsinline muted></video>
      <div class="video-label">
        <span>${this.escapeHtml(username)}</span>
      </div>
      <div class="video-status">
        <span class="status-icon" id="mic-${userId}">🎤</span>
        <span class="status-icon" id="cam-${userId}">📷</span>
      </div>
    `;
    document.getElementById('video-grid').appendChild(container);
  }

  const video = container.querySelector('video');
  video.srcObject = stream;

  // Start muted to satisfy autoplay policy, then unmute
  video.play().then(() => {
    video.muted = false;
  }).catch(() => {
    video.addEventListener('click', () => {
      video.muted = false;
      video.play();
    }, { once: true });
  });
}

export function removePeer(userId) {
  const peer = this.peers.get(userId);
  if (peer) {
    peer.connection.close();
    this.peers.delete(userId);
  }
  this.pendingCandidates.delete(userId);
  this.iceCandidates.delete(userId);

  // Close telemetry channel for this peer
  const dc = this.telemetryChannels.get(userId);
  if (dc) {
    dc.close();
    this.telemetryChannels.delete(userId);
  }
  this.connectionTimestamps.delete(`peer-${userId}`);

  // Remove video container
  const container = document.getElementById(`video-${userId}`);
  if (container) {
    container.remove();
  }

  // Remove from participants list
  const participant = document.getElementById(`participant-${userId}`);
  if (participant) {
    participant.remove();
  }
}
