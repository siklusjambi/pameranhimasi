/**
 * Upload Page Controller — Momen dalam Bingkai
 */

(function () {
  'use strict';

  const socket = io();

  const sourceControls = document.getElementById('photo-source-controls');
  const uploadZone = document.getElementById('upload-zone');
  const fileInput = document.getElementById('file-input');
  const cameraOpenBtn = document.getElementById('camera-open-btn');
  const cameraPanel = document.getElementById('camera-panel');
  const cameraVideo = document.getElementById('camera-video');
  const cameraPrompt = document.getElementById('camera-prompt');
  const cameraPromptRefresh = document.getElementById('camera-prompt-refresh');
  const cameraError = document.getElementById('camera-error');
  const cameraCancelBtn = document.getElementById('camera-cancel-btn');
  const cameraCaptureBtn = document.getElementById('camera-capture-btn');
  const previewContainer = document.getElementById('preview-container');
  const previewImg = document.getElementById('preview-img');
  const previewRemove = document.getElementById('preview-remove');
  const previewName = document.getElementById('preview-name');
  const previewSize = document.getElementById('preview-size');
  const guestForm = document.getElementById('guest-form');
  const uploadBtn = document.getElementById('upload-btn');
  const uploadActions = document.getElementById('upload-actions');
  const uploadProgress = document.getElementById('upload-progress');
  const progressFill = document.getElementById('upload-progress-fill');
  const progressText = document.getElementById('upload-progress-text');
  const uploadCard = document.getElementById('upload-card');
  const statusCard = document.getElementById('status-card');
  const statusNumber = document.getElementById('status-number');
  const statusBadge = document.getElementById('status-badge');
  const statusText = document.getElementById('status-text');
  const statusSpinner = document.getElementById('status-spinner');
  const statusPosition = document.getElementById('status-position');
  const uploadAnotherBtn = document.getElementById('upload-another-btn');
  const queueFullMsg = document.getElementById('queue-full-message');
  const retryBtn = document.getElementById('retry-btn');
  const queueBarDots = document.getElementById('queue-bar-dots');
  const queueBarText = document.getElementById('queue-bar-text');

  const prompts = [
    'Senyum selebar mungkin!',
    'Tunjukkan pose paling percaya dirimu.',
    'Bentuk simbol hati dengan tangan.',
    'Lambaikan tangan seolah menyapa teman.',
    'Coba pose andalanmu!',
    'Tunjukkan ekspresi paling ceria.',
    'Beri satu jempol untuk hari ini.',
    'Ajak teman di sebelahmu ikut tersenyum.',
    'Tatap kamera dan tunjukkan semangatmu.',
    'Buat pose bebas yang menggambarkan dirimu.'
  ];

  let selectedFile = null;
  let previewUrl = null;
  let cameraStream = null;
  let isUploading = false;
  let deviceId = localStorage.getItem('mdb_device_id');
  if (!deviceId) {
    deviceId = 'dev_' + Math.random().toString(36).substr(2, 12) + Date.now().toString(36);
    localStorage.setItem('mdb_device_id', deviceId);
  }

  let myPhotoId = null;
  let queueData = [];
  let lastPromptIndex = -1;

  const MAX_LONG_SIDE = 1600;
  const MAX_FILE_SIZE = 5 * 1024 * 1024;
  const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

  socket.on('queue:update', (data) => {
    queueData = data.queue || [];
    updateQueueBar(data.count, data.max);

    if (myPhotoId) {
      const myEntry = queueData.find(entry => entry.id === myPhotoId);
      updateMyStatus(myEntry ? myEntry.status : 'done', queueData);
    }

    if (data.count < data.max && queueFullMsg.classList.contains('visible')) {
      queueFullMsg.classList.remove('visible');
      syncPhotoUi();
    }
  });

  function updateQueueBar(count, max) {
    const dots = queueBarDots.children;
    for (let i = 0; i < dots.length; i++) {
      dots[i].classList.toggle('filled', i < count);
    }
    queueBarText.textContent = `Antrean: ${count} / ${max}`;
  }

  function syncPhotoUi() {
    const hasPhoto = Boolean(selectedFile);
    sourceControls.hidden = hasPhoto;
    previewContainer.classList.toggle('visible', hasPhoto);
    guestForm.hidden = !hasPhoto;
    if (cameraPanel.hidden) cameraError.textContent = '';
    updateSubmitButton();
  }

  function updateSubmitButton() {
    uploadBtn.disabled = isUploading || !selectedFile || !guestForm.checkValidity();
  }

  uploadZone.addEventListener('click', () => fileInput.click());
  uploadZone.addEventListener('dragover', (event) => {
    event.preventDefault();
    uploadZone.classList.add('dragover');
  });
  uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('dragover'));
  uploadZone.addEventListener('drop', (event) => {
    event.preventDefault();
    uploadZone.classList.remove('dragover');
    if (event.dataTransfer.files.length) handleFile(event.dataTransfer.files[0]);
  });
  fileInput.addEventListener('change', () => {
    if (fileInput.files.length) handleFile(fileInput.files[0]);
  });

  guestForm.addEventListener('input', updateSubmitButton);
  guestForm.addEventListener('change', updateSubmitButton);
  guestForm.addEventListener('submit', (event) => {
    event.preventDefault();
    startUpload();
  });
  previewRemove.addEventListener('click', clearSelection);

  function handleFile(file) {
    if (!ALLOWED_TYPES.includes(file.type)) {
      alert('Tipe file tidak didukung. Gunakan JPG, PNG, atau WEBP.');
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      alert('File terlalu besar. Maksimal 5 MB.');
      return;
    }

    stopCamera();
    selectedFile = file;
    setPreview(file);
  }

  function setPreview(file) {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = URL.createObjectURL(file);
    previewImg.src = previewUrl;
    previewName.textContent = file.name;
    previewSize.textContent = formatSize(file.size);
    syncPhotoUi();
  }

  function clearSelection() {
    selectedFile = null;
    fileInput.value = '';
    guestForm.reset();
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null;
    previewImg.removeAttribute('src');
    syncPhotoUi();
  }

  function formatSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function setRandomPrompt() {
    if (prompts.length < 2) {
      cameraPrompt.textContent = prompts[0];
      return;
    }
    let nextIndex = Math.floor(Math.random() * prompts.length);
    while (nextIndex === lastPromptIndex) {
      nextIndex = Math.floor(Math.random() * prompts.length);
    }
    lastPromptIndex = nextIndex;
    cameraPrompt.textContent = prompts[nextIndex];
  }

  cameraOpenBtn.addEventListener('click', openCamera);
  cameraPromptRefresh.addEventListener('click', setRandomPrompt);
  cameraCancelBtn.addEventListener('click', closeCamera);

  async function openCamera() {
    cameraError.textContent = '';
    setRandomPrompt();
    cameraPanel.hidden = false;
    sourceControls.hidden = true;

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      cameraError.textContent = 'Browser ini tidak mendukung kamera. Pilih foto dari perangkatmu.';
      return;
    }

    try {
      cameraStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 960 } }
      });
      cameraVideo.srcObject = cameraStream;
      await cameraVideo.play();
      cameraCaptureBtn.disabled = false;
    } catch (error) {
      console.error('Camera access failed:', error);
      cameraError.textContent = error.name === 'NotAllowedError'
        ? 'Izin kamera belum diberikan. Izinkan akses kamera di browser lalu coba lagi.'
        : 'Kamera tidak dapat dibuka. Coba pilih foto dari perangkatmu.';
      stopCamera();
    }
  }

  function stopCamera() {
    if (cameraStream) {
      cameraStream.getTracks().forEach(track => track.stop());
      cameraStream = null;
    }
    cameraVideo.pause();
    cameraVideo.srcObject = null;
    cameraCaptureBtn.disabled = true;
  }

  function closeCamera() {
    stopCamera();
    cameraPanel.hidden = true;
    sourceControls.hidden = false;
    cameraError.textContent = '';
  }

  cameraCaptureBtn.addEventListener('click', capturePhoto);

  function capturePhoto() {
    if (!cameraStream || !cameraVideo.videoWidth) return;

    const ratio = Math.min(1, MAX_LONG_SIDE / Math.max(cameraVideo.videoWidth, cameraVideo.videoHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(cameraVideo.videoWidth * ratio);
    canvas.height = Math.round(cameraVideo.videoHeight * ratio);
    const context = canvas.getContext('2d');
    if (!context) {
      cameraError.textContent = 'Foto tidak dapat diproses. Coba lagi atau pilih foto dari perangkatmu.';
      return;
    }

    context.drawImage(cameraVideo, 0, 0, canvas.width, canvas.height);
    cameraCaptureBtn.disabled = true;
    canvas.toBlob((blob) => {
      canvas.width = 0;
      canvas.height = 0;
      if (!blob) {
        cameraError.textContent = 'Foto gagal diambil. Silakan coba lagi.';
        cameraCaptureBtn.disabled = false;
        return;
      }

      closeCamera();
      const file = new File([blob], `momen-${Date.now()}.jpg`, { type: 'image/jpeg' });
      selectedFile = file;
      setPreview(file);
    }, 'image/jpeg', 0.88);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && !cameraPanel.hidden) closeCamera();
  });
  window.addEventListener('pagehide', () => {
    stopCamera();
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  });

  function compressImage(file) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      const sourceUrl = URL.createObjectURL(file);
      image.onload = () => {
        let { width, height } = image;
        const longSide = Math.max(width, height);
        if (longSide > MAX_LONG_SIDE) {
          const ratio = MAX_LONG_SIDE / longSide;
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');
        if (!context) {
          URL.revokeObjectURL(sourceUrl);
          reject(new Error('Foto tidak dapat diproses di perangkat ini.'));
          return;
        }
        context.drawImage(image, 0, 0, width, height);
        image.onload = null;
        image.onerror = null;
        URL.revokeObjectURL(sourceUrl);

        canvas.toBlob((blob) => {
          canvas.width = 0;
          canvas.height = 0;
          if (blob) resolve(blob);
          else reject(new Error('Kompresi foto gagal.'));
        }, 'image/jpeg', 0.85);
      };
      image.onerror = () => {
        URL.revokeObjectURL(sourceUrl);
        reject(new Error('Foto tidak dapat dibuka.'));
      };
      image.src = sourceUrl;
    });
  }

  async function startUpload() {
    if (!selectedFile || !guestForm.reportValidity() || isUploading) return;

    isUploading = true;
    updateSubmitButton();
    uploadProgress.classList.add('visible');
    uploadActions.style.display = 'none';
    progressText.textContent = 'Menyiapkan foto untuk galeri...';
    progressFill.style.width = '20%';

    try {
      const compressedBlob = await compressImage(selectedFile);
      progressFill.style.width = '50%';
      progressText.textContent = 'Mengirim foto dan ceritamu...';

      const formData = new FormData(guestForm);
      formData.append('photo', compressedBlob, 'photo.jpg');
      formData.append('deviceId', deviceId);

      const response = await fetch('/api/upload', { method: 'POST', body: formData });
      const data = await response.json();

      if (!response.ok) {
        progressFill.style.width = '0%';
        uploadProgress.classList.remove('visible');
        uploadActions.style.display = '';
        isUploading = false;

        if (response.status === 429) {
          if (data.existingId) {
            myPhotoId = data.existingId;
            clearSelection();
            showStatusCard(data.queueNumber);
            return;
          }
          showQueueFull();
          return;
        }

        alert(data.error || 'Upload gagal.');
        updateSubmitButton();
        return;
      }

      progressFill.style.width = '100%';
      progressText.textContent = 'Momenmu berhasil masuk antrean!';
      myPhotoId = data.id;
      isUploading = false;
      clearSelection();

      setTimeout(() => showStatusCard(data.queueNumber), 500);
    } catch (error) {
      console.error('Upload error:', error);
      alert(error.message || 'Gagal mengunggah. Coba lagi.');
      uploadProgress.classList.remove('visible');
      uploadActions.style.display = '';
      isUploading = false;
      updateSubmitButton();
    }
  }

  function showStatusCard(queueNumber) {
    uploadCard.style.display = 'none';
    statusCard.classList.add('visible');
    statusNumber.textContent = `#${queueNumber}`;
    const myEntry = queueData.find(entry => entry.id === myPhotoId);
    updateMyStatus(myEntry ? myEntry.status : 'waiting', queueData);
  }

  function updateMyStatus(status, queue) {
    if (!statusCard.classList.contains('visible')) return;

    statusBadge.className = 'status-badge';
    statusSpinner.style.display = 'none';

    switch (status) {
      case 'waiting':
        statusBadge.classList.add('status-waiting');
        statusText.textContent = 'Menunggu giliran tampil';
        statusSpinner.style.display = '';
        break;
      case 'displaying':
        statusBadge.classList.add('status-displaying');
        statusText.textContent = 'Momenmu sedang tampil!';
        break;
      case 'done':
        statusBadge.classList.add('status-done');
        statusText.textContent = 'Momenmu sudah selesai ditampilkan';
        uploadAnotherBtn.style.display = '';
        myPhotoId = null;
        break;
      default:
        return;
    }

    if (queue && status !== 'done') {
      const activeQueue = queue.filter(entry => entry.status !== 'done');
      const index = activeQueue.findIndex(entry => entry.id === myPhotoId);
      if (index >= 0) {
        statusPosition.textContent = `Posisi ${index + 1} dari ${activeQueue.length} dalam antrean`;
      }
    } else if (status === 'done') {
      statusPosition.textContent = 'Foto dan data ceritamu telah dihapus dari server.';
    }
  }

  uploadAnotherBtn.addEventListener('click', () => {
    statusCard.classList.remove('visible');
    uploadCard.style.display = '';
    uploadProgress.classList.remove('visible');
    uploadActions.style.display = '';
    uploadAnotherBtn.style.display = 'none';
    clearSelection();
  });

  function showQueueFull() {
    sourceControls.hidden = true;
    cameraPanel.hidden = true;
    previewContainer.classList.remove('visible');
    guestForm.hidden = true;
    queueFullMsg.classList.add('visible');
  }

  retryBtn.addEventListener('click', () => {
    queueFullMsg.classList.remove('visible');
    syncPhotoUi();
  });
})();
