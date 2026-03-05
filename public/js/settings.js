export function toggleSettings() {
  const panel = document.getElementById('settings-panel');
  const btn = document.getElementById('toggle-settings');
  const isVisible = panel.style.display !== 'none';

  if (isVisible) {
    panel.style.display = 'none';
    btn.classList.remove('on');
  } else {
    panel.style.display = 'flex';
    btn.classList.add('on');
    this.populateCodecOptions();
    this.syncSettingsUI();
  }
}

export function populateCodecOptions() {
  // Audio codecs
  const audioSelect = document.getElementById('setting-audio-codec');
  while (audioSelect.options.length > 1) audioSelect.remove(1);

  if (typeof RTCRtpSender !== 'undefined' && RTCRtpSender.getCapabilities) {
    const audioCaps = RTCRtpSender.getCapabilities('audio');
    if (audioCaps) {
      const seen = new Set();
      for (const codec of audioCaps.codecs) {
        const name = codec.mimeType.split('/')[1];
        if (seen.has(name)) continue;
        seen.add(name);
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = `${name} (${codec.clockRate}Hz)`;
        audioSelect.appendChild(opt);
      }
    }
  }

  // Video codecs
  const videoSelect = document.getElementById('setting-video-codec');
  while (videoSelect.options.length > 1) videoSelect.remove(1);

  if (typeof RTCRtpSender !== 'undefined' && RTCRtpSender.getCapabilities) {
    const videoCaps = RTCRtpSender.getCapabilities('video');
    if (videoCaps) {
      const seen = new Set();
      const skip = ['rtx', 'red', 'ulpfec', 'flexfec-03'];
      for (const codec of videoCaps.codecs) {
        const name = codec.mimeType.split('/')[1];
        if (skip.includes(name.toLowerCase()) || seen.has(name)) continue;
        seen.add(name);
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        videoSelect.appendChild(opt);
      }
    }
  }
}

export function syncSettingsUI() {
  const resSelect = document.getElementById('setting-resolution');
  if (this.preferredResolution) {
    resSelect.value = `${this.preferredResolution.width}x${this.preferredResolution.height}`;
  } else {
    resSelect.value = '';
  }

  document.getElementById('setting-audio-codec').value = this.preferredAudioCodec || '';
  document.getElementById('setting-video-codec').value = this.preferredVideoCodec || '';
}

export async function applyResolution(value) {
  if (!value) {
    this.preferredResolution = null;
  } else {
    const [w, h] = value.split('x').map(Number);
    this.preferredResolution = { width: w, height: h };
  }

  if (this.localStream && !this.isScreenSharing) {
    const videoTrack = this.localStream.getVideoTracks()[0];
    if (videoTrack) {
      const constraints = this.preferredResolution
        ? { width: { ideal: this.preferredResolution.width }, height: { ideal: this.preferredResolution.height } }
        : {};
      try {
        await videoTrack.applyConstraints(constraints);
        this.showToast(`Resolution: ${value || 'default'}`, 'success');
      } catch (e) {
        this.showToast('Resolution not supported by device', 'error');
      }
    }
  }
}

export function applyAudioCodec(value) {
  this.preferredAudioCodec = value || null;
  this.renegotiateAllPeers();
  this.showToast(`Audio codec: ${value || 'default'}`, 'success');
}

export function applyVideoCodec(value) {
  this.preferredVideoCodec = value || null;
  this.renegotiateAllPeers();
  this.showToast(`Video codec: ${value || 'default'}`, 'success');
}

export async function renegotiateAllPeers() {
  for (const [userId, peer] of this.peers) {
    try {
      this.applyCodecPreferences(peer.connection);
      const offer = await peer.connection.createOffer();
      await peer.connection.setLocalDescription(offer);
      this.socket.emit('offer', { to: userId, offer });
    } catch (e) {
      console.error('Renegotiation error for peer', userId, e);
    }
  }
}

export function applyCodecPreferences(pc) {
  const transceivers = pc.getTransceivers();
  for (const transceiver of transceivers) {
    if (!transceiver.sender || !transceiver.sender.track) continue;
    const kind = transceiver.sender.track.kind;

    if (kind === 'audio' && this.preferredAudioCodec) {
      const caps = RTCRtpSender.getCapabilities('audio');
      if (caps) {
        const preferred = caps.codecs.filter(c =>
          c.mimeType.toLowerCase().includes(this.preferredAudioCodec.toLowerCase())
        );
        const rest = caps.codecs.filter(c =>
          !c.mimeType.toLowerCase().includes(this.preferredAudioCodec.toLowerCase())
        );
        if (preferred.length > 0) {
          try { transceiver.setCodecPreferences([...preferred, ...rest]); } catch (e) { /* unsupported */ }
        }
      }
    }

    if (kind === 'video' && this.preferredVideoCodec) {
      const caps = RTCRtpSender.getCapabilities('video');
      if (caps) {
        const preferred = caps.codecs.filter(c =>
          c.mimeType.toLowerCase().includes(this.preferredVideoCodec.toLowerCase())
        );
        const rest = caps.codecs.filter(c =>
          !c.mimeType.toLowerCase().includes(this.preferredVideoCodec.toLowerCase())
        );
        if (preferred.length > 0) {
          try { transceiver.setCodecPreferences([...preferred, ...rest]); } catch (e) { /* unsupported */ }
        }
      }
    }
  }
}
