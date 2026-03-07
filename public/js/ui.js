export function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, 3000);
}

export function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

export function populatePeerRibbon() {
  const ribbon = document.getElementById('peer-ribbon');
  const expandedContainer = document.querySelector('.video-container.expanded');
  ribbon.innerHTML = '';
  const containers = document.querySelectorAll('.video-container');
  containers.forEach(container => {
    if (container === expandedContainer) return;
    const video = container.querySelector('video');
    const label = container.querySelector('.video-label span');
    if (!video) return;
    const thumb = document.createElement('div');
    thumb.className = 'peer-ribbon-thumb';
    thumb.dataset.containerId = container.id;
    const thumbVideo = document.createElement('video');
    thumbVideo.srcObject = video.srcObject;
    thumbVideo.autoplay = true;
    thumbVideo.muted = true;
    thumbVideo.playsInline = true;
    thumb.appendChild(thumbVideo);
    const nameLabel = document.createElement('div');
    nameLabel.className = 'ribbon-label';
    nameLabel.textContent = label ? label.textContent : '';
    thumb.appendChild(nameLabel);
    ribbon.appendChild(thumb);
  });
}

export function copyInviteLink() {
  const link = `${window.location.origin}/?room=${encodeURIComponent(this.roomId)}`;
  navigator.clipboard.writeText(link).then(() => {
    this.showToast('Invite link copied to clipboard', 'success');
  }).catch(() => {
    this.showToast('Failed to copy link', 'error');
  });
}
