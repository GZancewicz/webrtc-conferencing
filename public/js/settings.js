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

// Quality ranking for codec sorting (lower = higher quality)
const AUDIO_QUALITY = { opus: 1, G722: 2, PCMU: 3, PCMA: 4, CN: 90, 'telephone-event': 91, red: 92 };
const VIDEO_QUALITY = { AV1: 1, VP9: 2, H264: 3, VP8: 4 };

// Technical codec descriptions
const AUDIO_DESCRIPTIONS = {
  opus: 'Lossy; 6\u2013510 kbps VBR; 48 kHz; supports FEC, DTX, stereo; ~26.5 ms frame',
  G722: 'ITU-T wideband; 64 kbps CBR; 16 kHz sub-band ADPCM; low complexity',
  PCMU: '\u00B5-law PCM (G.711); 64 kbps CBR; 8 kHz narrowband; no compression',
  PCMA: 'A-law PCM (G.711); 64 kbps CBR; 8 kHz narrowband; no compression',
  CN: 'Comfort Noise (RFC 3389); generates background noise during silence',
  'telephone-event': 'RFC 4733 DTMF tones; out-of-band signaling for telephony events',
  red: 'Redundant Audio (RFC 2198); duplicates packets for FEC recovery',
};

const VIDEO_DESCRIPTIONS = {
  AV1: 'AOMedia; ~30% better compression than VP9; hardware decode varies; royalty-free',
  VP9: 'Google/WebM; scalable video coding (SVC); 4K support; royalty-free',
  H264: 'ITU-T/ISO; Constrained Baseline profile in WebRTC; wide hardware support; patent-licensed',
  VP8: 'Google/WebM; DCT-based; temporal scalability; royalty-free; lower complexity than VP9',
};

const DEFAULT_DESCRIPTIONS = {
  'setting-audio-codec': 'Browser negotiates codec automatically (typically opus)',
  'setting-video-codec': 'Browser negotiates codec automatically (typically VP8)',
};

function updateCodecDescription(selectId, descId, descriptions) {
  const select = document.getElementById(selectId);
  const desc = document.getElementById(descId);
  if (!select || !desc) return;
  const val = select.value;
  if (!val) {
    desc.textContent = DEFAULT_DESCRIPTIONS[selectId] || '';
  } else {
    desc.textContent = descriptions[val] || '';
  }
}

export function populateCodecOptions() {
  // Audio codecs — sorted by descending quality
  const audioSelect = document.getElementById('setting-audio-codec');
  while (audioSelect.options.length > 0) audioSelect.remove(0);

  if (typeof RTCRtpSender !== 'undefined' && RTCRtpSender.getCapabilities) {
    const audioCaps = RTCRtpSender.getCapabilities('audio');
    if (audioCaps) {
      const seen = new Set();
      const codecs = [];
      for (const codec of audioCaps.codecs) {
        const name = codec.mimeType.split('/')[1];
        if (seen.has(name)) continue;
        seen.add(name);
        codecs.push({ name, clockRate: codec.clockRate });
      }
      codecs.sort((a, b) => (AUDIO_QUALITY[a.name] || 50) - (AUDIO_QUALITY[b.name] || 50));
      // "Default" option first (browser negotiates freely)
      const defOpt = document.createElement('option');
      defOpt.value = '';
      defOpt.textContent = 'Default';
      audioSelect.appendChild(defOpt);
      codecs.forEach(codec => {
        const opt = document.createElement('option');
        opt.value = codec.name;
        opt.textContent = `${codec.name} (${codec.clockRate}Hz)`;
        audioSelect.appendChild(opt);
      });
    }
  }
  if (audioSelect.options.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'Default';
    audioSelect.appendChild(opt);
  }

  // Video codecs — sorted by descending quality
  const videoSelect = document.getElementById('setting-video-codec');
  while (videoSelect.options.length > 0) videoSelect.remove(0);

  if (typeof RTCRtpSender !== 'undefined' && RTCRtpSender.getCapabilities) {
    const videoCaps = RTCRtpSender.getCapabilities('video');
    if (videoCaps) {
      const seen = new Set();
      const skip = ['rtx', 'red', 'ulpfec', 'flexfec-03'];
      const codecs = [];
      for (const codec of videoCaps.codecs) {
        const name = codec.mimeType.split('/')[1];
        if (skip.includes(name.toLowerCase()) || seen.has(name)) continue;
        seen.add(name);
        codecs.push({ name });
      }
      codecs.sort((a, b) => (VIDEO_QUALITY[a.name] || 50) - (VIDEO_QUALITY[b.name] || 50));
      // "Default" option first (browser negotiates freely)
      const defOpt = document.createElement('option');
      defOpt.value = '';
      defOpt.textContent = 'Default';
      videoSelect.appendChild(defOpt);
      codecs.forEach(codec => {
        const opt = document.createElement('option');
        opt.value = codec.name;
        opt.textContent = codec.name;
        videoSelect.appendChild(opt);
      });
    }
  }
  if (videoSelect.options.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'Default';
    videoSelect.appendChild(opt);
  }

  // Resolution — mark the matching static option with "- Default" instead of top
  const resSelect = document.getElementById('setting-resolution');
  if (this.localStream) {
    const videoTrack = this.localStream.getVideoTracks()[0];
    if (videoTrack) {
      const settings = videoTrack.getSettings();
      if (settings.width && settings.height) {
        const camH = settings.height;
        for (let i = 1; i < resSelect.options.length; i++) {
          const val = resSelect.options[i].value; // e.g. "854x480"
          const optH = parseInt(val.split('x')[1]);
          if (optH === camH) {
            resSelect.options[i].textContent += ' - Default';
            break;
          }
        }
      }
    }
  }

  // Update codec descriptions for current selection
  updateCodecDescription('setting-audio-codec', 'audio-codec-desc', AUDIO_DESCRIPTIONS);
  updateCodecDescription('setting-video-codec', 'video-codec-desc', VIDEO_DESCRIPTIONS);
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

  updateCodecDescription('setting-audio-codec', 'audio-codec-desc', AUDIO_DESCRIPTIONS);
  updateCodecDescription('setting-video-codec', 'video-codec-desc', VIDEO_DESCRIPTIONS);
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
  updateCodecDescription('setting-audio-codec', 'audio-codec-desc', AUDIO_DESCRIPTIONS);
  this.showToast(`Audio codec: ${value || 'default'}`, 'success');
}

export function applyVideoCodec(value) {
  this.preferredVideoCodec = value || null;
  this.renegotiateAllPeers();
  updateCodecDescription('setting-video-codec', 'video-codec-desc', VIDEO_DESCRIPTIONS);
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

export function applyCodecPreferences(pc, remotePrefs) {
  const transceivers = pc.getTransceivers();

  // Determine effective codec preferences:
  // Local user's own preferences take priority, then fall back to remote peer's preferences.
  // This lets the answerer honor the offerer's codec requests when the answerer has no preference.
  const effectiveAudio = this.preferredAudioCodec || (remotePrefs && remotePrefs.audioCodec) || null;
  const effectiveVideo = this.preferredVideoCodec || (remotePrefs && remotePrefs.videoCodec) || null;

  for (const transceiver of transceivers) {
    if (!transceiver.sender || !transceiver.sender.track) continue;
    const kind = transceiver.sender.track.kind;

    if (kind === 'audio' && effectiveAudio) {
      const caps = RTCRtpSender.getCapabilities('audio');
      if (caps) {
        const preferred = caps.codecs.filter(c =>
          c.mimeType.toLowerCase().includes(effectiveAudio.toLowerCase())
        );
        const rest = caps.codecs.filter(c =>
          !c.mimeType.toLowerCase().includes(effectiveAudio.toLowerCase())
        );
        if (preferred.length > 0) {
          try { transceiver.setCodecPreferences([...preferred, ...rest]); } catch (e) { /* unsupported */ }
        }
      }
    }

    if (kind === 'video' && effectiveVideo) {
      const caps = RTCRtpSender.getCapabilities('video');
      if (caps) {
        const preferred = caps.codecs.filter(c =>
          c.mimeType.toLowerCase().includes(effectiveVideo.toLowerCase())
        );
        const rest = caps.codecs.filter(c =>
          !c.mimeType.toLowerCase().includes(effectiveVideo.toLowerCase())
        );
        if (preferred.length > 0) {
          try { transceiver.setCodecPreferences([...preferred, ...rest]); } catch (e) { /* unsupported */ }
        }
      }
    }
  }
}
