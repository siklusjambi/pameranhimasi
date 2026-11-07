/**
 * Upload Page Controller — Momen dalam Bingkai
 *
 * Handles: file selection, client-side compression, upload, status tracking.
 * Anti-spam: 1 active photo per device (deviceId in localStorage).
 */

(function () {
  'use strict';

  const socket = io();

  // DOM refs
  const uploadZone      = document.getElementById('upload-zone');
  const fileInput       = document.getElementById('file-input');
  const previewContainer= document.getElementById('preview-container');
  const previewImg      = document.getElementById('preview-img');
  const previewRemove   = document.getElementById('preview-remove');
  const previewName     = document.getElementById('preview-name');
  const previewSize     = document.getElementById('preview-size');
  const uploadBtn       = document.getElementById('upload-btn');
  const uploadActions   = document.getElementById('upload-actions');
  const uploadProgress  = document.getElementById('upload-progress');
  const progressFill    = document.getElementById('upload-progress-fill');
  const progressText    = document.getElementById('upload-progress-text');
  const uploadCard      = document.getElementById('upload-card');
  const statusCard      = document.getElementById('status-card');
  const statusNumber    = document.getElementById('status-number');
  const statusBadge     = document.getElementById('status-badge');
  const statusText      = document.getElementById('status-text');
  const statusSpinner   = document.getElementById('status-spinner');
  const statusPosition  = document.getElementById('status-position');
  const uploadAnotherBtn= document.getElementById('upload-another-btn');
  const queueFullMsg    = document.getElementById('queue-full-message');
  const retryBtn        = document.getElementById('retry-btn');
  const queueBarDots    = document.getElementById('queue-bar-dots');
  const queueBarText    = document.getElementById('queue-bar-text');

  // State
  let selectedFile = null;
  let compressedBlob = null;
  let deviceId = localStorage.getItem('mdb_device_id');
  if (!deviceId) {
    deviceId = 'dev_' + Math.random().toString(36).substr(2, 12) + Date.now().toString(36);
    localStorage.setItem('mdb_device_id', deviceId);
  }

  let myPhotoId = null;
  let queueData = [];

  const MAX_LONG_SIDE = 1600;

  // ---- Queue Updates ----
  socket.on('queue:update', (data) => {
    queueData = data.queue || [];
    updateQueueBar(data.count, data.max);

    // Update my photo status if I have one
    if (myPhotoId) {
      const myEntry = queueData.find(e => e.id === myPhotoId);
      if (myEntry) {
        updateMyStatus(myEntry.status, data.queue);
      } else {
        // My photo has been removed (done or deleted by admin)
        updateMyStatus('done', data.queue);
      }
    }

    // If queue was full and now has space, update UI
    if (data.count < data.max && queueFullMsg.classList.contains('visible')) {
      queueFullMsg.classList.remove('visible');
      uploadZone.style.display = '';
      uploadActions.style.display = '';
    }
  });

  // ---- Queue Bar ----
  function updateQueueBar(count, max) {
    const dots = queueBarDots.children;
    for (let i = 0; i < dots.length; i++) {
      dots[i].classList.toggle('filled', i < count);
    }
    queueBarText.textContent = `Antrean: ${count} / ${max}`;
  }

  // ---- File Selection ----
  uploadZone.addEventListener('click', () => fileInput.click());

  uploadZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadZone.classList.add('dragover');
  });
  uploadZone.addEventListener('dragleave', () => {
    uploadZone.classList.remove('dragover');
  });
  uploadZone.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadZone.classList.remove('dragover');
    if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files.length) handleFile(fileInput.files[0]);
  });

  previewRemove.addEventListener('click', clearSelection);

  function handleFile(file) {
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowed.includes(file.type)) {
      alert('Tipe file tidak didukung. Gunakan JPG, PNG, atau WEBP.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      alert('File terlalu besar. Maksimal 5 MB.');
      return;
    }

    selectedFile = file;

    // Show preview
    const reader = new FileReader();
    reader.onload = (e) => {
      previewImg.src = e.target.result;
      previewContainer.classList.add('visible');
      uploadZone.style.display = 'none';
      uploadBtn.disabled = false;
    };
    reader.readAsDataURL(file);

    previewName.textContent = file.name;
    previewSize.textContent = formatSize(file.size);
  }

  function clearSelection() {
    selectedFile = null;
    compressedBlob = null;
    fileInput.value = '';
    previewContainer.classList.remove('visible');
    uploadZone.style.display = '';
    uploadBtn.disabled = true;
    previewImg.src = '';
  }

  function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  // ---- Client-Side Compression ----
  function compressImage(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        const longSide = Math.max(width, height);

        if (longSide > MAX_LONG_SIDE) {
          const ratio = MAX_LONG_SIDE / longSide;
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob(
          (blob) => {
            if (blob) resolve(blob);
            else reject(new Error('Compression failed'));
          },
          'image/jpeg',
          0.85
        );
      };
      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = URL.createObjectURL(file);
    });
  }

  // ---- Upload ----
  uploadBtn.addEventListener('click', startUpload);

  async function startUpload() {
    if (!selectedFile) return;

    uploadBtn.disabled = true;
    uploadProgress.classList.add('visible');
    uploadActions.style.display = 'none';
    progressText.textContent = 'Mengompres foto...';
    progressFill.style.width = '20%';

    try {
      // Compress
      compressedBlob = await compressImage(selectedFile);
      progressFill.style.width = '50%';
      progressText.textContent = 'Mengunggah...';

      // Upload
      const formData = new FormData();
      formData.append('photo', compressedBlob, 'photo.jpg');
      formData.append('deviceId', deviceId);

      const res = await fetch('/api/upload', {
        method: 'POST',
        body: formData
      });

      const data = await res.json();

      if (!res.ok) {
        progressFill.style.width = '0%';
        uploadProgress.classList.remove('visible');
        uploadActions.style.display = '';

        if (res.status === 429) {
          if (data.existingId) {
            // Already has active photo
            myPhotoId = data.existingId;
            showStatusCard(data.queueNumber);
            return;
          }
          // Queue full
          showQueueFull();
          return;
        }

        alert(data.error || 'Upload gagal.');
        uploadBtn.disabled = false;
        return;
      }

      progressFill.style.width = '100%';
      progressText.textContent = 'Berhasil!';

      myPhotoId = data.id;

      setTimeout(() => {
        showStatusCard(data.queueNumber);
      }, 500);

    } catch (e) {
      console.error('Upload error:', e);
      alert('Gagal mengunggah. Coba lagi.');
      uploadProgress.classList.remove('visible');
      uploadActions.style.display = '';
      uploadBtn.disabled = false;
    }
  }

  // ---- Status Card ----
  function showStatusCard(queueNumber) {
    uploadCard.style.display = 'none';
    statusCard.classList.add('visible');
    statusNumber.textContent = `#${queueNumber}`;
    const myEntry = queueData.find((entry) => entry.id === myPhotoId);
    updateMyStatus(myEntry ? myEntry.status : 'waiting', queueData);
  }

  function updateMyStatus(status, queue) {
    if (!statusCard.classList.contains('visible')) return;

    statusBadge.className = 'status-badge';
    statusSpinner.style.display = 'none';

    switch (status) {
      case 'waiting':
        statusBadge.classList.add('status-waiting');
        statusText.textContent = 'Menunggu giliran';
        statusSpinner.style.display = '';
        break;
      case 'displaying':
        statusBadge.classList.add('status-displaying');
        statusText.textContent = '✨ Sedang tampil!';
        break;
      case 'done':
        statusBadge.classList.add('status-done');
        statusText.textContent = 'Selesai';
        uploadAnotherBtn.style.display = '';
        myPhotoId = null;
        break;
    }

    // Position info
    if (queue && status !== 'done') {
      const activeQueue = queue.filter(e => e.status !== 'done');
      const myIdx = activeQueue.findIndex(e => e.id === myPhotoId);
      if (myIdx >= 0) {
        statusPosition.textContent = `Posisi ${myIdx + 1} dari ${activeQueue.length} dalam antrean`;
      }
    } else if (status === 'done') {
      statusPosition.textContent = 'Fotomu sudah selesai ditampilkan 🎉';
    }
  }

  // ---- Upload Another ----
  uploadAnotherBtn.addEventListener('click', () => {
    statusCard.classList.remove('visible');
    uploadCard.style.display = '';
    clearSelection();
    uploadProgress.classList.remove('visible');
    uploadActions.style.display = '';
    uploadAnotherBtn.style.display = 'none';
  });

  // ---- Queue Full ----
  function showQueueFull() {
    uploadZone.style.display = 'none';
    previewContainer.classList.remove('visible');
    uploadActions.style.display = 'none';
    queueFullMsg.classList.add('visible');
  }

  retryBtn.addEventListener('click', () => {
    queueFullMsg.classList.remove('visible');
    clearSelection();
  });
})();
