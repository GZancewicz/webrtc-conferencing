export function sendChatMessage() {
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

export function addChatMessage(username, message, timestamp, isOwn, isAI = false) {
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

export function addSystemMessage(text) {
  const container = document.getElementById('chat-messages');
  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const el = document.createElement('div');
  el.className = 'chat-system-message';
  el.innerHTML = `<span class="chat-time">${time}</span> ${this.escapeHtml(text)}`;
  container.appendChild(el);
  container.scrollTop = container.scrollHeight;
}

export function addParticipant(userId, username) {
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

export function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  document.querySelectorAll('.tab-content').forEach(content => {
    content.classList.toggle('active', content.id === `${tab}-tab`);
  });
}
