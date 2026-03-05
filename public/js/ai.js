export async function checkAIAvailability() {
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

export function setupSpeechRecognition() {
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

export function startListening() {
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

export function handleVoiceInput(transcript) {
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

export async function handleAIMessageDirect(message, fromUsername) {
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

export function showListeningText(text) {
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

export function updateTalkToAIButton() {
  const btn = document.getElementById('talk-to-ai');
  if (!btn) return;

  btn.classList.toggle('active', this.isListening);
  btn.classList.toggle('listening', this.isListening);

  const icon = btn.querySelector('.control-icon');
  const label = btn.querySelector('.control-label');

  if (icon) icon.textContent = this.isListening ? '🎙️' : '🗣️';
  if (label) label.textContent = this.isListening ? 'Listening...' : 'Talk to AI';
}

export function toggleAI() {
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

export function addAIParticipant() {
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
      <span class="status-icon">🗣️</span>
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

export function removeAIParticipant() {
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

export function isMessageForAI(message) {
  const lowerMessage = message.toLowerCase();
  return lowerMessage.startsWith('@ai') ||
         lowerMessage.startsWith('ai,') ||
         lowerMessage.startsWith('hey ai') ||
         lowerMessage.startsWith('ai:');
}

export async function handleAIMessage(message, fromUsername) {
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

export async function playAIResponse(text) {
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

export function setAISpeaking(speaking) {
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

export function showAITyping(typing) {
  const container = document.getElementById('video-ai-assistant');
  if (container) {
    container.classList.toggle('typing', typing);
  }
}
