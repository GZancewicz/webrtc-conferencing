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

export function copyInviteLink() {
  const link = `${window.location.origin}/?room=${encodeURIComponent(this.roomId)}`;
  navigator.clipboard.writeText(link).then(() => {
    this.showToast('Invite link copied to clipboard', 'success');
  }).catch(() => {
    this.showToast('Failed to copy link', 'error');
  });
}
