export async function getLocalMedia() {
  try {
    const videoConstraints = this.preferredResolution
      ? { width: { ideal: this.preferredResolution.width }, height: { ideal: this.preferredResolution.height } }
      : true;

    this.localStream = await navigator.mediaDevices.getUserMedia({
      video: videoConstraints,
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

export function toggleAudio() {
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

export function toggleVideo() {
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

export async function toggleScreenShare() {
  if (this.isScreenSharing) {
    this.stopScreenShare();
  } else {
    await this.startScreenShare();
  }
}

export async function startScreenShare() {
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

export function stopScreenShare() {
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

export function updateAudioButton() {
  const btn = document.getElementById('toggle-audio');
  const icon = btn.querySelector('.control-icon');
  const label = btn.querySelector('.control-label');
  const statusIcon = document.getElementById('local-mic-status');

  btn.classList.toggle('active', !this.isAudioEnabled);
  icon.textContent = this.isAudioEnabled ? '🎤' : '🔇';
  label.textContent = this.isAudioEnabled ? 'Mute' : 'Unmute';
  statusIcon.classList.toggle('disabled', !this.isAudioEnabled);
}

export function updateVideoButton() {
  const btn = document.getElementById('toggle-video');
  const icon = btn.querySelector('.control-icon');
  const label = btn.querySelector('.control-label');
  const statusIcon = document.getElementById('local-cam-status');

  btn.classList.toggle('active', !this.isVideoEnabled);
  icon.innerHTML = '<svg class="cam-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M17 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 4V6.5l-4 4z"/></svg>';
  label.textContent = this.isVideoEnabled ? 'Stop Video' : 'Start Video';
  statusIcon.classList.toggle('disabled', !this.isVideoEnabled);
}

export function updateScreenButton() {
  const btn = document.getElementById('toggle-screen');
  const label = btn.querySelector('.control-label');

  btn.classList.toggle('active', this.isScreenSharing);
  label.textContent = this.isScreenSharing ? 'Stop Sharing' : 'Share Screen';
}

export function updatePeerAudioStatus(userId, enabled) {
  const micIcon = document.getElementById(`mic-${userId}`);
  const pMicIcon = document.getElementById(`p-mic-${userId}`);

  if (micIcon) micIcon.classList.toggle('disabled', !enabled);
  if (pMicIcon) pMicIcon.classList.toggle('disabled', !enabled);
}

export function updatePeerVideoStatus(userId, enabled) {
  const camIcon = document.getElementById(`cam-${userId}`);
  const pCamIcon = document.getElementById(`p-cam-${userId}`);

  if (camIcon) camIcon.classList.toggle('disabled', !enabled);
  if (pCamIcon) pCamIcon.classList.toggle('disabled', !enabled);
}
