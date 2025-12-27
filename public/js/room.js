// Room logic with WebRTC
class WebConference {
  constructor() {
    this.socket = io();
    this.localStream = null;
    this.screenStream = null;
    this.peers = new Map();
    this.roomId = null;
    this.username = null;
    this.isAudioEnabled = true;
    this.isVideoEnabled = true;
    this.isScreenSharing = false;
    this.isChatVisible = true;

    this.iceServers = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    };

    this.init();
  }

  async init() {
    // Get room ID from URL
    const urlParams = new URLSearchParams(window.location.search);
    this.roomId = urlParams.get('room');

    if (!this.roomId) {
      window.location.href = '/';
      return;
    }

    // Get username from session storage
    this.username = sessionStorage.getItem('username');
    if (!this.username) {
      window.location.href = `/?room=${encodeURIComponent(this.roomId)}`;
      return;
    }

    // Update UI
    document.getElementById('room-id-display').textContent = this.roomId;
    document.getElementById('local-username').textContent = `${this.username} (You)`;

    // Set up event listeners
    this.setupEventListeners();
    this.setupSocketListeners();

    // Get media and join room
    try {
      await this.getLocalMedia();
      this.joinRoom();
    } catch (error) {
      console.error('Failed to get media:', error);
      this.showToast('Failed to access camera/microphone', 'error');
    }
  }

  async getLocalMedia() {
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true
      });

      const localVideo = document.getElementById('local-video');
      localVideo.srcObject = this.localStream;
      this.updateParticipantCount();
    } catch (error) {
      // Try audio only
      try {
        this.localStream = await navigator.mediaDevices.getUserMedia({
          video: false,
          audio: true
        });
        this.isVideoEnabled = false;
        this.updateVideoButton();
      } catch (audioError) {
        throw audioError;
      }
    }
  }

  joinRoom() {
    this.socket.emit('join-room', {
      roomId: this.roomId,
      username: this.username
    });
  }

  setupEventListeners() {
    // Toggle audio
    document.getElementById('toggle-audio').addEventListener('click', () => {
      this.toggleAudio();
    });

    // Toggle video
    document.getElementById('toggle-video').addEventListener('click', () => {
      this.toggleVideo();
    });

    // Toggle screen share
    document.getElementById('toggle-screen').addEventListener('click', () => {
      this.toggleScreenShare();
    });

    // Toggle chat
    document.getElementById('toggle-chat').addEventListener('click', () => {
      this.toggleChat();
    });

    // Leave room
    document.getElementById('leave-room').addEventListener('click', () => {
      this.leaveRoom();
    });

    // Copy link
    document.getElementById('copy-link-btn').addEventListener('click', () => {
      this.copyInviteLink();
    });

    // Chat form
    document.getElementById('chat-form').addEventListener('submit', (e) => {
      e.preventDefault();
      this.sendChatMessage();
    });

    // Tab switching
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        this.switchTab(e.target.dataset.tab);
      });
    });
  }

  setupSocketListeners() {
    // Existing users in room
    this.socket.on('existing-users', (users) => {
      users.forEach(user => {
        this.createPeerConnection(user.id, user.username, true);
      });
      this.updateParticipantCount();
    });

    // New user joined
    this.socket.on('user-joined', ({ userId, username }) => {
      this.showToast(`${username} joined the meeting`);
      this.createPeerConnection(userId, username, false);
      this.updateParticipantCount();
    });

    // User left
    this.socket.on('user-left', ({ userId, username }) => {
      this.showToast(`${username} left the meeting`);
      this.removePeer(userId);
      this.updateParticipantCount();
    });

    // WebRTC signaling
    this.socket.on('offer', async ({ from, username, offer }) => {
      const peer = this.peers.get(from) || this.createPeerConnection(from, username, false);
      await peer.connection.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await peer.connection.createAnswer();
      await peer.connection.setLocalDescription(answer);
      this.socket.emit('answer', { to: from, answer });
    });

    this.socket.on('answer', async ({ from, answer }) => {
      const peer = this.peers.get(from);
      if (peer) {
        await peer.connection.setRemoteDescription(new RTCSessionDescription(answer));
      }
    });

    this.socket.on('ice-candidate', async ({ from, candidate }) => {
      const peer = this.peers.get(from);
      if (peer && candidate) {
        try {
          await peer.connection.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (error) {
          console.error('Error adding ICE candidate:', error);
        }
      }
    });

    // Chat messages
    this.socket.on('chat-message', ({ userId, username, message, timestamp }) => {
      this.addChatMessage(username, message, timestamp, userId === this.socket.id);
    });

    // Media state changes
    this.socket.on('user-toggle-audio', ({ userId, enabled }) => {
      this.updatePeerAudioStatus(userId, enabled);
    });

    this.socket.on('user-toggle-video', ({ userId, enabled }) => {
      this.updatePeerVideoStatus(userId, enabled);
    });
  }

  createPeerConnection(userId, username, initiator) {
    const connection = new RTCPeerConnection(this.iceServers);

    // Add local tracks
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => {
        connection.addTrack(track, this.localStream);
      });
    }

    // Handle ICE candidates
    connection.onicecandidate = (event) => {
      if (event.candidate) {
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
      if (connection.connectionState === 'disconnected' ||
          connection.connectionState === 'failed') {
        this.removePeer(userId);
      }
    };

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

  async createAndSendOffer(userId, connection) {
    try {
      const offer = await connection.createOffer();
      await connection.setLocalDescription(offer);
      this.socket.emit('offer', { to: userId, offer });
    } catch (error) {
      console.error('Error creating offer:', error);
    }
  }

  addRemoteVideo(userId, username, stream) {
    // Check if video container already exists
    let container = document.getElementById(`video-${userId}`);

    if (!container) {
      container = document.createElement('div');
      container.id = `video-${userId}`;
      container.className = 'video-container';
      container.innerHTML = `
        <video autoplay playsinline></video>
        <div class="video-label">
          <span>${username}</span>
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
  }

  removePeer(userId) {
    const peer = this.peers.get(userId);
    if (peer) {
      peer.connection.close();
      this.peers.delete(userId);
    }

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

  toggleAudio() {
    if (this.localStream) {
      const audioTrack = this.localStream.getAudioTracks()[0];
      if (audioTrack) {
        this.isAudioEnabled = !this.isAudioEnabled;
        audioTrack.enabled = this.isAudioEnabled;
        this.updateAudioButton();
        this.socket.emit('toggle-audio', {
          roomId: this.roomId,
          enabled: this.isAudioEnabled
        });
      }
    }
  }

  toggleVideo() {
    if (this.localStream) {
      const videoTrack = this.localStream.getVideoTracks()[0];
      if (videoTrack) {
        this.isVideoEnabled = !this.isVideoEnabled;
        videoTrack.enabled = this.isVideoEnabled;
        this.updateVideoButton();
        this.socket.emit('toggle-video', {
          roomId: this.roomId,
          enabled: this.isVideoEnabled
        });
      }
    }
  }

  async toggleScreenShare() {
    if (this.isScreenSharing) {
      this.stopScreenShare();
    } else {
      await this.startScreenShare();
    }
  }

  async startScreenShare() {
    try {
      this.screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: true
      });

      const screenTrack = this.screenStream.getVideoTracks()[0];

      // Replace video track in all peer connections
      this.peers.forEach((peer) => {
        const sender = peer.connection.getSenders().find(s =>
          s.track && s.track.kind === 'video'
        );
        if (sender) {
          sender.replaceTrack(screenTrack);
        }
      });

      // Update local video
      const localVideo = document.getElementById('local-video');
      localVideo.srcObject = this.screenStream;

      // Handle screen share stop
      screenTrack.onended = () => {
        this.stopScreenShare();
      };

      this.isScreenSharing = true;
      this.updateScreenButton();
    } catch (error) {
      console.error('Error sharing screen:', error);
    }
  }

  stopScreenShare() {
    if (this.screenStream) {
      this.screenStream.getTracks().forEach(track => track.stop());
    }

    // Replace screen track with camera track
    const videoTrack = this.localStream?.getVideoTracks()[0];
    if (videoTrack) {
      this.peers.forEach((peer) => {
        const sender = peer.connection.getSenders().find(s =>
          s.track && s.track.kind === 'video'
        );
        if (sender) {
          sender.replaceTrack(videoTrack);
        }
      });
    }

    // Update local video
    const localVideo = document.getElementById('local-video');
    localVideo.srcObject = this.localStream;

    this.isScreenSharing = false;
    this.updateScreenButton();
  }

  toggleChat() {
    const sidebar = document.getElementById('sidebar');
    this.isChatVisible = !this.isChatVisible;
    sidebar.classList.toggle('hidden', !this.isChatVisible);
    sidebar.classList.toggle('visible', this.isChatVisible);
  }

  leaveRoom() {
    // Stop all streams
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
    }
    if (this.screenStream) {
      this.screenStream.getTracks().forEach(track => track.stop());
    }

    // Close all peer connections
    this.peers.forEach((peer) => {
      peer.connection.close();
    });

    // Disconnect socket
    this.socket.disconnect();

    // Navigate back to home
    window.location.href = '/';
  }

  copyInviteLink() {
    const link = `${window.location.origin}/?room=${encodeURIComponent(this.roomId)}`;
    navigator.clipboard.writeText(link).then(() => {
      this.showToast('Invite link copied to clipboard', 'success');
    }).catch(() => {
      this.showToast('Failed to copy link', 'error');
    });
  }

  sendChatMessage() {
    const input = document.getElementById('chat-input');
    const message = input.value.trim();

    if (message) {
      this.socket.emit('chat-message', {
        roomId: this.roomId,
        message
      });
      input.value = '';
    }
  }

  addChatMessage(username, message, timestamp, isOwn) {
    const container = document.getElementById('chat-messages');
    const time = new Date(timestamp).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit'
    });

    const messageEl = document.createElement('div');
    messageEl.className = 'chat-message';
    messageEl.innerHTML = `
      <div class="chat-message-header">
        <span class="chat-username">${isOwn ? 'You' : username}</span>
        <span class="chat-time">${time}</span>
      </div>
      <div class="chat-text">${this.escapeHtml(message)}</div>
    `;

    container.appendChild(messageEl);
    container.scrollTop = container.scrollHeight;
  }

  addParticipant(userId, username) {
    const list = document.getElementById('participants-list');

    if (!document.getElementById(`participant-${userId}`)) {
      const item = document.createElement('li');
      item.id = `participant-${userId}`;
      item.className = 'participant-item';
      item.innerHTML = `
        <span class="participant-name">${username}</span>
        <div class="participant-status">
          <span class="status-icon" id="p-mic-${userId}">🎤</span>
          <span class="status-icon" id="p-cam-${userId}">📷</span>
        </div>
      `;
      list.appendChild(item);
    }
  }

  updateParticipantCount() {
    const count = this.peers.size + 1; // +1 for self
    document.getElementById('participant-count').textContent = count;
  }

  switchTab(tab) {
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tab);
    });
    document.querySelectorAll('.tab-content').forEach(content => {
      content.classList.toggle('active', content.id === `${tab}-tab`);
    });
  }

  updateAudioButton() {
    const btn = document.getElementById('toggle-audio');
    const icon = btn.querySelector('.control-icon');
    const label = btn.querySelector('.control-label');
    const statusIcon = document.getElementById('local-mic-status');

    btn.classList.toggle('active', !this.isAudioEnabled);
    icon.textContent = this.isAudioEnabled ? '🎤' : '🔇';
    label.textContent = this.isAudioEnabled ? 'Mute' : 'Unmute';
    statusIcon.classList.toggle('disabled', !this.isAudioEnabled);
  }

  updateVideoButton() {
    const btn = document.getElementById('toggle-video');
    const icon = btn.querySelector('.control-icon');
    const label = btn.querySelector('.control-label');
    const statusIcon = document.getElementById('local-cam-status');

    btn.classList.toggle('active', !this.isVideoEnabled);
    icon.textContent = this.isVideoEnabled ? '📷' : '📷';
    label.textContent = this.isVideoEnabled ? 'Stop Video' : 'Start Video';
    statusIcon.classList.toggle('disabled', !this.isVideoEnabled);
  }

  updateScreenButton() {
    const btn = document.getElementById('toggle-screen');
    const label = btn.querySelector('.control-label');

    btn.classList.toggle('active', this.isScreenSharing);
    label.textContent = this.isScreenSharing ? 'Stop Sharing' : 'Share Screen';
  }

  updatePeerAudioStatus(userId, enabled) {
    const micIcon = document.getElementById(`mic-${userId}`);
    const pMicIcon = document.getElementById(`p-mic-${userId}`);

    if (micIcon) micIcon.classList.toggle('disabled', !enabled);
    if (pMicIcon) pMicIcon.classList.toggle('disabled', !enabled);
  }

  updatePeerVideoStatus(userId, enabled) {
    const camIcon = document.getElementById(`cam-${userId}`);
    const pCamIcon = document.getElementById(`p-cam-${userId}`);

    if (camIcon) camIcon.classList.toggle('disabled', !enabled);
    if (pCamIcon) pCamIcon.classList.toggle('disabled', !enabled);
  }

  showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => {
      toast.remove();
    }, 3000);
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  new WebConference();
});
