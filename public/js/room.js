// Room logic with WebRTC
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

  async checkAIAvailability() {
    try {
      const response = await fetch('/api/ai/status');
      const data = await response.json();
      this.aiAvailable = data.available;

      if (this.aiAvailable) {
        document.getElementById('toggle-ai').style.display = 'flex';
        this.setupSpeechRecognition();
      }
    } catch (error) {
      console.error('Failed to check AI availability:', error);
    }
  }

  setupSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      console.log('Speech recognition not supported');
      return;
    }

    this.recognition = new SpeechRecognition();
    this.recognition.continuous = false;
    this.recognition.interimResults = true;
    this.recognition.lang = 'en-US';

    this.recognition.onstart = () => {
      this.isListening = true;
      this.updateTalkToAIButton();
      this.showToast('Listening... speak now', 'info');
    };

    this.recognition.onresult = (event) => {
      let finalTranscript = '';
      let interimTranscript = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += transcript;
        } else {
          interimTranscript += transcript;
        }
      }

      // Show interim results in the AI container
      if (interimTranscript) {
        this.showListeningText(interimTranscript);
      }

      // When we have a final result, send to AI
      if (finalTranscript) {
        this.showListeningText('');
        this.handleVoiceInput(finalTranscript);
      }
    };

    this.recognition.onerror = (event) => {
      console.error('Speech recognition error:', event.error);
      this.isListening = false;
      this.updateTalkToAIButton();

      if (event.error === 'no-speech') {
        this.showToast('No speech detected. Try again.', 'error');
      } else if (event.error === 'not-allowed') {
        this.showToast('Microphone access denied', 'error');
      }
    };

    this.recognition.onend = () => {
      this.isListening = false;
      this.updateTalkToAIButton();
      this.showListeningText('');
    };
  }

  startListening() {
    if (!this.recognition) {
      this.showToast('Speech recognition not supported in this browser', 'error');
      return;
    }

    if (this.aiSpeaking) {
      this.showToast('Wait for AI to finish speaking', 'info');
      return;
    }

    if (this.isListening) {
      this.recognition.stop();
    } else {
      try {
        this.recognition.start();
      } catch (error) {
        console.error('Failed to start recognition:', error);
      }
    }
  }

  handleVoiceInput(transcript) {
    // Add to chat as user message
    this.addChatMessage(this.username, transcript, new Date().toISOString(), true);

    // Broadcast to other participants
    this.socket.emit('chat-message', {
      roomId: this.roomId,
      message: transcript
    });

    // Send to AI (no prefix needed for voice)
    this.handleAIMessageDirect(transcript, this.username);
  }

  async handleAIMessageDirect(message, fromUsername) {
    const contextMessage = `${fromUsername} says: ${message}`;

    try {
      this.showAITyping(true);

      const response = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: contextMessage,
          roomId: this.roomId
        })
      });

      if (!response.ok) throw new Error('AI request failed');

      const data = await response.json();
      const aiResponse = data.response;

      this.addChatMessage('AI Assistant', aiResponse, new Date().toISOString(), false, true);

      this.socket.emit('chat-message', {
        roomId: this.roomId,
        message: `[AI Assistant]: ${aiResponse}`
      });

      await this.playAIResponse(aiResponse);

    } catch (error) {
      console.error('AI error:', error);
      this.showToast('AI failed to respond', 'error');
    } finally {
      this.showAITyping(false);
    }
  }

  showListeningText(text) {
    const container = document.getElementById('video-ai-assistant');
    if (!container) return;

    let listeningEl = container.querySelector('.listening-text');

    if (text) {
      if (!listeningEl) {
        listeningEl = document.createElement('div');
        listeningEl.className = 'listening-text';
        container.appendChild(listeningEl);
      }
      listeningEl.textContent = text;
    } else if (listeningEl) {
      listeningEl.remove();
    }
  }

  updateTalkToAIButton() {
    const btn = document.getElementById('talk-to-ai');
    if (!btn) return;

    btn.classList.toggle('active', this.isListening);
    btn.classList.toggle('listening', this.isListening);

    const icon = btn.querySelector('.control-icon');
    const label = btn.querySelector('.control-label');

    if (icon) icon.textContent = this.isListening ? '🎙️' : '🗣️';
    if (label) label.textContent = this.isListening ? 'Listening...' : 'Talk to AI';
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
    document.getElementById('stats-close').addEventListener('click', () => {
      this.toggleStats();
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
    });

    this.socket.on('user-toggle-video', ({ userId, enabled }) => {
      this.updatePeerVideoStatus(userId, enabled);
    });
  }

  createPeerConnection(userId, username, initiator) {
    const connection = new RTCPeerConnection(this.iceServers);

    // Init candidate tracking for this peer
    this.iceCandidates.set(userId, { local: [], remote: [] });

    // Add local tracks
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => {
        connection.addTrack(track, this.localStream);
      });
    }

    // Handle ICE candidates
    connection.onicecandidate = (event) => {
      if (event.candidate) {
        const entry = this.iceCandidates.get(userId);
        if (entry) entry.local.push(event.candidate);
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

  async flushPendingCandidates(userId) {
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

  removePeer(userId) {
    const peer = this.peers.get(userId);
    if (peer) {
      peer.connection.close();
      this.peers.delete(userId);
    }
    this.pendingCandidates.delete(userId);
    this.iceCandidates.delete(userId);

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

  // AI Assistant methods
  toggleAI() {
    this.aiEnabled = !this.aiEnabled;
    const btn = document.getElementById('toggle-ai');
    btn.classList.toggle('active', this.aiEnabled);

    if (this.aiEnabled) {
      this.addAIParticipant();
      this.showToast('AI Assistant joined the meeting');
    } else {
      this.removeAIParticipant();
      this.showToast('AI Assistant left the meeting');
    }

    this.updateParticipantCount();
  }

  addAIParticipant() {
    const videoGrid = document.getElementById('video-grid');

    // Add AI video container with static image
    const container = document.createElement('div');
    container.id = 'video-ai-assistant';
    container.className = 'video-container ai-participant';
    container.innerHTML = `
      <img src="/images/ai-avatar.svg" alt="AI Assistant" class="ai-avatar">
      <div class="video-label">
        <span>AI Assistant</span>
      </div>
      <div class="video-status">
        <span class="status-icon" id="ai-speaking-indicator">🔊</span>
      </div>
    `;
    videoGrid.appendChild(container);

    // Add to participants list
    const list = document.getElementById('participants-list');
    const item = document.createElement('li');
    item.id = 'participant-ai-assistant';
    item.className = 'participant-item';
    item.innerHTML = `
      <span class="participant-name">AI Assistant</span>
      <div class="participant-status">
        <span class="status-icon">🤖</span>
      </div>
    `;
    list.appendChild(item);

    // Add "Talk to AI" button to controls
    const controls = document.querySelector('.room-controls');
    const leaveBtn = document.getElementById('leave-room');
    const talkBtn = document.createElement('button');
    talkBtn.id = 'talk-to-ai';
    talkBtn.className = 'control-btn talk-to-ai-btn';
    talkBtn.title = 'Talk to AI';
    talkBtn.innerHTML = `
      <span class="control-icon">🗣️</span>
      <span class="control-label">Talk to AI</span>
    `;
    talkBtn.addEventListener('click', () => this.startListening());
    controls.insertBefore(talkBtn, leaveBtn);
  }

  removeAIParticipant() {
    const container = document.getElementById('video-ai-assistant');
    if (container) container.remove();

    const participant = document.getElementById('participant-ai-assistant');
    if (participant) participant.remove();

    // Remove "Talk to AI" button
    const talkBtn = document.getElementById('talk-to-ai');
    if (talkBtn) talkBtn.remove();

    // Stop listening if active
    if (this.isListening && this.recognition) {
      this.recognition.stop();
    }
  }

  isMessageForAI(message) {
    const lowerMessage = message.toLowerCase();
    return lowerMessage.startsWith('@ai') ||
           lowerMessage.startsWith('ai,') ||
           lowerMessage.startsWith('hey ai') ||
           lowerMessage.startsWith('ai:');
  }

  async handleAIMessage(message, fromUsername) {
    // Remove the AI trigger prefix
    let cleanMessage = message
      .replace(/^@ai\s*/i, '')
      .replace(/^ai,\s*/i, '')
      .replace(/^hey ai\s*/i, '')
      .replace(/^ai:\s*/i, '')
      .trim();

    // Add context about who is asking
    const contextMessage = `${fromUsername} asks: ${cleanMessage}`;

    try {
      // Show typing indicator
      this.showAITyping(true);

      // Get AI response
      const response = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: contextMessage,
          roomId: this.roomId
        })
      });

      if (!response.ok) throw new Error('AI request failed');

      const data = await response.json();
      const aiResponse = data.response;

      // Send AI response to chat
      this.addChatMessage('AI Assistant', aiResponse, new Date().toISOString(), false, true);

      // Broadcast AI response to all participants
      this.socket.emit('chat-message', {
        roomId: this.roomId,
        message: `[AI Assistant]: ${aiResponse}`
      });

      // Generate and play TTS
      await this.playAIResponse(aiResponse);

    } catch (error) {
      console.error('AI error:', error);
      this.showToast('AI failed to respond', 'error');
    } finally {
      this.showAITyping(false);
    }
  }

  async playAIResponse(text) {
    try {
      this.setAISpeaking(true);

      const response = await fetch('/api/ai/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voice: 'nova' })
      });

      if (!response.ok) throw new Error('TTS request failed');

      const audioBlob = await response.blob();
      const audioUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(audioUrl);

      audio.onended = () => {
        this.setAISpeaking(false);
        URL.revokeObjectURL(audioUrl);
      };

      audio.onerror = () => {
        this.setAISpeaking(false);
        URL.revokeObjectURL(audioUrl);
      };

      await audio.play();
    } catch (error) {
      console.error('TTS error:', error);
      this.setAISpeaking(false);
    }
  }

  setAISpeaking(speaking) {
    this.aiSpeaking = speaking;
    const indicator = document.getElementById('ai-speaking-indicator');
    if (indicator) {
      indicator.style.opacity = speaking ? '1' : '0.5';
      indicator.textContent = speaking ? '🔊' : '🔇';
    }

    const container = document.getElementById('video-ai-assistant');
    if (container) {
      container.classList.toggle('speaking', speaking);
    }
  }

  showAITyping(typing) {
    const container = document.getElementById('video-ai-assistant');
    if (container) {
      container.classList.toggle('typing', typing);
    }
  }

  async toggleStats() {
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

  async renderStats() {
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
        html += `<tr><td>${type}</td><td>${this.escapeHtml(url)}</td></tr>`;
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
      html += `<tr><td>Connection</td><td>${pc.connectionState || 'N/A'}</td></tr>`;
      html += `<tr><td>ICE State</td><td>${pc.iceConnectionState || 'N/A'}</td></tr>`;
      html += `<tr><td>ICE Gather</td><td>${pc.iceGatheringState || 'N/A'}</td></tr>`;
      html += `<tr><td>Signaling</td><td>${pc.signalingState || 'N/A'}</td></tr>`;

      // Get stats snapshot
      try {
        const stats = await pc.getStats();
        let activePairId = null;
        const candidateMap = new Map();
        let dtlsState = null, dtlsCipher = null, srtpCipher = null, tlsVersion = null;
        let rtt = null, bytesSent = null, bytesRecv = null;
        let audioCodec = null, videoCodec = null;
        let videoWidth = null, videoHeight = null, fps = null;
        let packetsLost = null, packetsRecv = null, jitter = null;
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
          }
          if (report.type === 'inbound-rtp' && report.kind === 'audio') {
            if (report.codecId) audioCodec = report.codecId;
            if (packetsLost == null) packetsLost = report.packetsLost;
            if (packetsRecv == null) packetsRecv = report.packetsReceived;
            if (jitter == null) jitter = report.jitter;
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
        if (dtlsState) html += `<tr><td>DTLS</td><td>${dtlsState}</td></tr>`;
        if (dtlsCipher) html += `<tr><td>DTLS Cipher</td><td>${dtlsCipher}</td></tr>`;
        if (srtpCipher) html += `<tr><td>SRTP Cipher</td><td>${srtpCipher}</td></tr>`;
        if (tlsVersion) html += `<tr><td>TLS Version</td><td>${tlsVersion}</td></tr>`;

        // Media
        if (audioCodec && codecMap.has(audioCodec)) html += `<tr><td>Audio Codec</td><td>${codecMap.get(audioCodec)}</td></tr>`;
        if (videoCodec && codecMap.has(videoCodec)) html += `<tr><td>Video Codec</td><td>${codecMap.get(videoCodec)}</td></tr>`;
        if (videoWidth && videoHeight) html += `<tr><td>Video Res</td><td>${videoWidth}x${videoHeight}</td></tr>`;
        if (fps != null) html += `<tr><td>Framerate</td><td>${Math.round(fps)} fps</td></tr>`;

        // Network
        if (rtt != null) html += `<tr><td>RTT</td><td>${(rtt * 1000).toFixed(0)} ms</td></tr>`;
        if (packetsRecv != null && packetsLost != null) {
          const lossRate = packetsRecv > 0 ? ((packetsLost / (packetsRecv + packetsLost)) * 100).toFixed(2) : '0.00';
          html += `<tr><td>Packet Loss</td><td>${lossRate}% (${packetsLost} lost)</td></tr>`;
        }
        if (jitter != null) html += `<tr><td>Jitter</td><td>${(jitter * 1000).toFixed(1)} ms</td></tr>`;
        if (bytesSent != null) html += `<tr><td>Bytes Sent</td><td>${this.formatBytes(bytesSent)}</td></tr>`;
        if (bytesRecv != null) html += `<tr><td>Bytes Recv</td><td>${this.formatBytes(bytesRecv)}</td></tr>`;

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

  parseCandidateString(str) {
    if (!str) return { type: '?', protocol: '?', address: '?', port: '?' };
    const parts = str.split(' ');
    return {
      protocol: parts[2] || '?',
      address: parts[4] || '?',
      port: parts[5] || '?',
      type: parts[7] || '?'
    };
  }

  formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
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

      // If AI is enabled and message is for AI, handle it
      if (this.aiEnabled && this.isMessageForAI(message)) {
        this.handleAIMessage(message, this.username);
      }

      input.value = '';
    }
  }

  addChatMessage(username, message, timestamp, isOwn, isAI = false) {
    const container = document.getElementById('chat-messages');
    const time = new Date(timestamp).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit'
    });

    const messageEl = document.createElement('div');
    messageEl.className = `chat-message${isAI ? ' ai-message' : ''}`;
    messageEl.innerHTML = `
      <div class="chat-message-header">
        <span class="chat-username">${isOwn ? 'You' : this.escapeHtml(username)}</span>
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
        <span class="participant-name">${this.escapeHtml(username)}</span>
        <div class="participant-status">
          <span class="status-icon" id="p-mic-${userId}">🎤</span>
          <span class="status-icon" id="p-cam-${userId}">📷</span>
        </div>
      `;
      list.appendChild(item);
    }
  }

  updateParticipantCount() {
    let count = this.peers.size + 1; // +1 for self
    if (this.aiEnabled) count++; // +1 for AI
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
  window.conference = new WebConference();
});
