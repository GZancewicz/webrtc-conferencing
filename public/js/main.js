// Landing page logic
document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('join-form');
  const usernameInput = document.getElementById('username');
  const roomIdInput = document.getElementById('room-id');
  const passwordInput = document.getElementById('room-password');
  const btnText = document.getElementById('btn-text');

  // Show join error if redirected back from room
  const joinError = sessionStorage.getItem('joinError');
  if (joinError) {
    const errorEl = document.getElementById('join-error');
    errorEl.textContent = joinError;
    errorEl.style.display = 'block';
    sessionStorage.removeItem('joinError');
  }

  // Update button text based on room ID input
  roomIdInput.addEventListener('input', () => {
    if (roomIdInput.value.trim()) {
      btnText.textContent = 'Join Room';
    } else {
      btnText.textContent = 'Create Room';
    }
  });

  // Handle form submission
  form.addEventListener('submit', (e) => {
    e.preventDefault();

    const username = usernameInput.value.trim();
    let roomId = roomIdInput.value.trim();
    const password = passwordInput.value;

    if (!username) {
      alert('Please enter your name');
      return;
    }

    // Generate room ID if not provided
    if (!roomId) {
      roomId = generateRoomId();
    }

    // Store username and password in session storage
    sessionStorage.setItem('username', username);
    if (password) {
      sessionStorage.setItem('roomPassword', password);
    } else {
      sessionStorage.removeItem('roomPassword');
    }

    // Navigate to room
    window.location.href = `/room.html?room=${encodeURIComponent(roomId)}`;
  });

  // Generate a random room ID
  function generateRoomId() {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < 3; i++) {
      if (i > 0) result += '-';
      for (let j = 0; j < 4; j++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
      }
    }
    return result;
  }

  // Check if there's a room ID in the URL (for join links)
  const urlParams = new URLSearchParams(window.location.search);
  const roomFromUrl = urlParams.get('room');
  if (roomFromUrl) {
    roomIdInput.value = roomFromUrl;
    btnText.textContent = 'Join Room';
  }
});
