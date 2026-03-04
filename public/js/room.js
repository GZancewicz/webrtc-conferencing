import * as ui from './ui.js';
import * as chat from './chat.js';
import * as media from './media.js';
import * as webrtc from './webrtc.js';
import * as stats from './stats.js';
import * as telemetry from './telemetry.js';
import * as topology from './topology.js';
import * as ai from './ai.js';

class WebConference {
  constructor() {
    this.socket = io();
    this.localStream = null;
    this.screenStream = null;
    this.peers = new Map();
    this.pendingCandidates = new Map();
    this.roomId = null;
    this.username = null;
    this.isAudioEnabled = true;
    this.isVideoEnabled = true;
    this.isScreenSharing = false;
    this.isChatVisible = true;

    // AI Assistant state
    this.aiAvailable = false;
    this.aiEnabled = false;
    this.aiSpeaking = false;
    this.isListening = false;
    this.recognition = null;

    this.iceServers = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    };

    this.roomPassword = sessionStorage.getItem('roomPassword') || null;

    // Per-peer ICE candidate tracking: Map<userId, {local: [], remote: []}>
    this.iceCandidates = new Map();

    // Telemetry via DataChannel
    this.telemetryEnabled = true;
    this.telemetryChannels = new Map();
    this.telemetryBroadcastInterval = null;

    // Last received stats from each peer: Map<username, {stats, timestamp}>
    this.receivedPeerStats = new Map();

    // Connection timestamps: Map<nodeId, Date>
    this.connectionTimestamps = new Map();

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

    // Fetch ICE servers (including TURN) before any peer connections
    await this.fetchIceServers();

    // Check if AI is available
    await this.checkAIAvailability();

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

    // Telemetry enabled by default — start broadcast
    if (this.telemetryEnabled) {
      this.startTelemetryBroadcast();
    }
  }

  async fetchIceServers() {
    try {
      const response = await fetch('/api/ice-servers');
      const data = await response.json();
      this.iceServers = { iceServers: data.iceServers };
    } catch (error) {
      console.error('Failed to fetch ICE servers, using STUN-only fallback:', error);
    }
  }

  joinRoom() {
    this.connectionTimestamps.set('signaling', new Date());
    this.socket.emit('join-room', {
      roomId: this.roomId,
      username: this.username,
      password: this.roomPassword
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

    // Toggle stats panel
    document.getElementById('toggle-stats').addEventListener('click', () => {
      this.toggleStats();
    });
    document.getElementById('stats-refresh').addEventListener('click', () => {
      this.renderStats();
    });
    document.getElementById('stats-close').addEventListener('click', () => {
      this.toggleStats();
    });

    // Toggle telemetry
    document.getElementById('toggle-telemetry').addEventListener('click', () => {
      this.toggleTelemetry();
    });

    // Telemetry panel controls
    document.getElementById('telemetry-refresh').addEventListener('click', () => {
      this.renderTelemetry();
    });
    document.getElementById('telemetry-close').addEventListener('click', () => {
      this.toggleTelemetry();
    });

    // Toggle topology panel
    document.getElementById('toggle-topology').addEventListener('click', () => {
      this.toggleTopology();
    });
    document.getElementById('topology-refresh').addEventListener('click', () => {
      this.renderTopology();
    });
    document.getElementById('topology-close').addEventListener('click', () => {
      this.toggleTopology();
    });

    // Tooltip click/tap handling
    document.addEventListener('click', (e) => {
      const tip = e.target.closest('.has-tip');
      // Close all open tips
      document.querySelectorAll('.has-tip.tip-open').forEach(el => {
        if (el !== tip) el.classList.remove('tip-open');
      });
      // Toggle clicked tip
      if (tip) {
        e.stopPropagation();
        tip.classList.toggle('tip-open');
      }
    });

    // Toggle AI
    document.getElementById('toggle-ai').addEventListener('click', () => {
      this.toggleAI();
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
    // Handle join errors (e.g., wrong room password)
    this.socket.on('join-error', ({ message }) => {
      this.showToast(message, 'error');
      sessionStorage.setItem('joinError', message);
      window.location.href = `/?room=${encodeURIComponent(this.roomId)}`;
    });

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
      this.addSystemMessage(`${username} joined the meeting`);
      this.createPeerConnection(userId, username, false);
      this.updateParticipantCount();
    });

    // User left
    this.socket.on('user-left', ({ userId, username }) => {
      this.showToast(`${username} left the meeting`);
      this.addSystemMessage(`${username} left the meeting`);
      this.removePeer(userId);
      this.updateParticipantCount();
    });

    // WebRTC signaling
    this.socket.on('offer', async ({ from, username, offer }) => {
      try {
        const peer = this.peers.get(from) || this.createPeerConnection(from, username, false);
        await peer.connection.setRemoteDescription(new RTCSessionDescription(offer));
        this.flushPendingCandidates(from);
        const answer = await peer.connection.createAnswer();
        await peer.connection.setLocalDescription(answer);
        this.socket.emit('answer', { to: from, answer });
      } catch (error) {
        console.error('Error handling offer:', error);
      }
    });

    this.socket.on('answer', async ({ from, answer }) => {
      try {
        const peer = this.peers.get(from);
        if (peer) {
          await peer.connection.setRemoteDescription(new RTCSessionDescription(answer));
          this.flushPendingCandidates(from);
        }
      } catch (error) {
        console.error('Error handling answer:', error);
      }
    });

    this.socket.on('ice-candidate', async ({ from, candidate }) => {
      if (!candidate) return;
      const entry = this.iceCandidates.get(from);
      if (entry) entry.remote.push(candidate);
      const peer = this.peers.get(from);
      if (peer && peer.connection.remoteDescription) {
        try {
          await peer.connection.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (error) {
          console.error('Error adding ICE candidate:', error);
        }
      } else {
        // Buffer candidates that arrive before remote description is set
        if (!this.pendingCandidates.has(from)) {
          this.pendingCandidates.set(from, []);
        }
        this.pendingCandidates.get(from).push(candidate);
      }
    });

    // Chat messages
    this.socket.on('chat-message', ({ userId, username, message, timestamp }) => {
      this.addChatMessage(username, message, timestamp, userId === this.socket.id);

      // If AI is enabled and message is not from self, check if it's directed at AI
      if (this.aiEnabled && userId !== this.socket.id && this.isMessageForAI(message)) {
        this.handleAIMessage(message, username);
      }
    });

    // Media state changes
    this.socket.on('user-toggle-audio', ({ userId, enabled }) => {
      this.updatePeerAudioStatus(userId, enabled);
      const peer = this.peers.get(userId);
      if (peer) this.addSystemMessage(`${peer.username} ${enabled ? 'unmuted' : 'muted'} their mic`);
    });

    this.socket.on('user-toggle-video', ({ userId, enabled }) => {
      this.updatePeerVideoStatus(userId, enabled);
      const peer = this.peers.get(userId);
      if (peer) this.addSystemMessage(`${peer.username} ${enabled ? 'started' : 'stopped'} their camera`);
    });
  }

  toggleChat() {
    const sidebar = document.getElementById('sidebar');
    this.isChatVisible = !this.isChatVisible;
    sidebar.classList.toggle('hidden', !this.isChatVisible);
    sidebar.classList.toggle('visible', this.isChatVisible);
  }

  updateParticipantCount() {
    let count = this.peers.size + 1; // +1 for self
    if (this.aiEnabled) count++; // +1 for AI
    document.getElementById('participant-count').textContent = count;
  }

  leaveRoom() {
    this.stopTelemetryBroadcast();
    // Close all telemetry channels
    for (const [, channel] of this.telemetryChannels) {
      channel.close();
    }
    this.telemetryChannels.clear();

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
}

// Attach module methods to prototype
Object.assign(WebConference.prototype, ui);
Object.assign(WebConference.prototype, chat);
Object.assign(WebConference.prototype, media);
Object.assign(WebConference.prototype, webrtc);
Object.assign(WebConference.prototype, stats);
Object.assign(WebConference.prototype, telemetry);
Object.assign(WebConference.prototype, topology);
Object.assign(WebConference.prototype, ai);

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.conference = new WebConference();
});
