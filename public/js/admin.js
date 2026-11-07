/**
 * Admin Page Controller — Momen dalam Bingkai
 */

(function () {
  'use strict';

  const socket = io();

  // DOM refs
  const loginScreen   = document.getElementById('login-screen');
  const dashboard     = document.getElementById('dashboard');
  const passwordInput = document.getElementById('password-input');
  const loginBtn      = document.getElementById('login-btn');
  const loginError    = document.getElementById('login-error');
  const logoutBtn     = document.getElementById('logout-btn');
  const clearAllBtn   = document.getElementById('clear-all-btn');
  const queueList     = document.getElementById('queue-list');
  const statCount     = document.getElementById('stat-count');
  const statDisplaying= document.getElementById('stat-displaying');
  const toastContainer= document.getElementById('toast-container');

  let adminPassword = '';

  // ---- Auth ----
  loginBtn.addEventListener('click', tryLogin);
  passwordInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') tryLogin();
  });

  async function tryLogin() {
    const pw = passwordInput.value.trim();
    if (!pw) return;

    try {
      const res = await fetch('/api/admin/queue', {
        headers: { 'X-Admin-Password': pw }
      });

      if (res.ok) {
        adminPassword = pw;
        loginScreen.style.display = 'none';
        dashboard.classList.add('visible');
        loginError.style.display = 'none';
        const data = await res.json();
        renderQueue(data);
      } else {
        loginError.style.display = 'block';
        loginError.textContent = 'Password salah';
        passwordInput.focus();
      }
    } catch (e) {
      loginError.style.display = 'block';
      loginError.textContent = 'Gagal terhubung ke server';
    }
  }

  logoutBtn.addEventListener('click', () => {
    adminPassword = '';
    passwordInput.value = '';
    dashboard.classList.remove('visible');
    loginScreen.style.display = '';
  });

  // ---- Socket: Live Queue Updates ----
  socket.on('queue:update', (data) => {
    if (!adminPassword) return;
    // Re-fetch full admin data to get filenames etc
    fetchQueue();
  });

  async function fetchQueue() {
    try {
      const res = await fetch('/api/admin/queue', {
        headers: { 'X-Admin-Password': adminPassword }
      });
      if (res.ok) {
        const data = await res.json();
        renderQueue(data);
      }
    } catch (e) {
      console.error('Failed to fetch queue:', e);
    }
  }

  // ---- Render Queue ----
  function renderQueue(data) {
    const { queue, count, max } = data;
    statCount.textContent = count;

    const displaying = queue.find(e => e.status === 'displaying');
    statDisplaying.textContent = displaying ? `#${displaying.queueNumber}` : '—';

    if (queue.length === 0) {
      queueList.innerHTML = '<div class="admin-queue-empty">Belum ada foto dalam antrean</div>';
      return;
    }

    queueList.innerHTML = queue.map(entry => {
      const statusClass = entry.status === 'displaying' ? 'badge-displaying'
                        : entry.status === 'waiting' ? 'badge-waiting'
                        : 'badge-done';
      const statusLabel = entry.status === 'displaying' ? 'Tampil'
                        : entry.status === 'waiting' ? 'Menunggu'
                        : 'Selesai';
      const time = new Date(entry.uploadedAt).toLocaleTimeString('id-ID');

      return `
        <div class="admin-queue-item">
          <div class="admin-queue-num">#${entry.queueNumber}</div>
          <div class="admin-queue-info">
            <div class="admin-queue-filename">${entry.filename}</div>
            <div class="admin-queue-meta">
              <span class="badge ${statusClass}">${statusLabel}</span>
              · ${time} · ${entry.deviceId.substring(0, 10)}…
            </div>
          </div>
          <button class="btn btn-danger btn-sm" onclick="deletePhoto('${entry.id}')">Hapus</button>
        </div>
      `;
    }).join('');
  }

  // ---- Actions ----
  window.deletePhoto = async function (id) {
    if (!confirm('Hapus foto ini dari antrian?')) return;
    try {
      const res = await fetch(`/api/admin/photo/${id}`, {
        method: 'DELETE',
        headers: { 'X-Admin-Password': adminPassword }
      });
      if (res.ok) {
        showToast('Foto dihapus', 'success');
        fetchQueue();
      } else {
        showToast('Gagal menghapus', 'error');
      }
    } catch (e) {
      showToast('Gagal menghapus', 'error');
    }
  };

  clearAllBtn.addEventListener('click', async () => {
    if (!confirm('Kosongkan semua antrian?')) return;
    try {
      const res = await fetch('/api/admin/queue', {
        method: 'DELETE',
        headers: { 'X-Admin-Password': adminPassword }
      });
      if (res.ok) {
        showToast('Antrian dikosongkan', 'success');
        fetchQueue();
      } else {
        showToast('Gagal mengosongkan', 'error');
      }
    } catch (e) {
      showToast('Gagal mengosongkan', 'error');
    }
  });

  // ---- Toast ----
  function showToast(message, type) {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    toastContainer.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
  }
})();
