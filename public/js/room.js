import * as ui from './ui.js';
import * as chat from './chat.js';
import * as media from './media.js';
import * as webrtc from './webrtc.js';
import * as stats from './stats.js';
import * as telemetry from './telemetry.js';
import * as topology from './topology.js';
import * as dashboard from './dashboard.js';
import * as settings from './settings.js';
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
    this.isChatVisible = false;

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

    // Dashboard analytics
    this.dashboardHistory = new Map();
    this.dashboardInterval = null;

    // Media preferences
    this.preferredResolution = null;
    this.preferredAudioCodec = null;
    this.preferredVideoCodec = null;

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

    // Start dashboard data collection immediately so history is available when panel opens
    this.startDashboardCollection();
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
    const now = new Date();
    this.connectionTimestamps.set('self', now);
    this.connectionTimestamps.set('signaling', now);
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

    // Toggle more controls
    document.getElementById('toggle-more').addEventListener('click', () => {
      const moreRow = document.getElementById('controls-more');
      const btn = document.getElementById('toggle-more');
      const visible = moreRow.style.display !== 'none';
      moreRow.style.display = visible ? 'none' : 'flex';
      btn.classList.toggle('on', !visible);
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

    // Toggle dashboard
    document.getElementById('toggle-dashboard').addEventListener('click', () => {
      this.toggleDashboard();
    });
    document.getElementById('dashboard-refresh').addEventListener('click', () => {
      this.collectDashboardSnapshot().then(() => this.renderDashboard());
    });
    document.getElementById('dashboard-close').addEventListener('click', () => {
      this.toggleDashboard();
    });

    // Toggle topology panel
    document.getElementById('toggle-topology').addEventListener('click', () => {
      this.toggleTopology();
    });
    document.getElementById('topology-configs').addEventListener('click', () => {
      this.showConfigurationsPopup();
    });
    document.getElementById('topology-refresh').addEventListener('click', () => {
      this.renderTopology();
    });
    document.getElementById('topology-close').addEventListener('click', () => {
      this.toggleTopology();
    });

    // Re-render topology on window resize
    window.addEventListener('resize', () => {
      const panel = document.getElementById('topology-panel');
      if (panel && panel.style.display !== 'none') {
        this.renderTopology();
      }
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

    // Toggle settings
    document.getElementById('toggle-settings').addEventListener('click', () => {
      this.toggleSettings();
    });
    document.getElementById('settings-close').addEventListener('click', () => {
      this.toggleSettings();
    });
    document.getElementById('setting-resolution').addEventListener('change', (e) => {
      this.applyResolution(e.target.value);
    });
    document.getElementById('setting-audio-codec').addEventListener('change', (e) => {
      this.applyAudioCodec(e.target.value);
    });
    document.getElementById('setting-video-codec').addEventListener('change', (e) => {
      this.applyVideoCodec(e.target.value);
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

        // Look up remote peer's codec preferences (received via telemetry DataChannel)
        let remotePrefs = null;
        if (this.dashboardHistory) {
          const remoteEntry = this.dashboardHistory.get(`remote-${username}`);
          if (remoteEntry && (remoteEntry.preferredAudioCodec || remoteEntry.preferredVideoCodec)) {
            remotePrefs = {
              audioCodec: remoteEntry.preferredAudioCodec,
              videoCodec: remoteEntry.preferredVideoCodec
            };
          }
        }
        this.applyCodecPreferences(peer.connection, remotePrefs);
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
    const btn = document.getElementById('toggle-chat');
    this.isChatVisible = !this.isChatVisible;
    sidebar.classList.toggle('hidden', !this.isChatVisible);
    sidebar.classList.toggle('visible', this.isChatVisible);
    btn.classList.toggle('on', this.isChatVisible);
  }

  updateParticipantCount() {
    let count = this.peers.size + 1; // +1 for self
    if (this.aiEnabled) count++; // +1 for AI
    document.getElementById('participant-count').textContent = count;
  }

  leaveRoom() {
    this.stopDashboardCollection();
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
Object.assign(WebConference.prototype, dashboard);
Object.assign(WebConference.prototype, settings);
Object.assign(WebConference.prototype, ai);

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.conference = new WebConference();
});
