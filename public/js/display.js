/**
 * Display Page Controller — Momen dalam Bingkai
 *
 * The example and QR screens each appear for five seconds between visitor
 * photos. Each visitor photo appears twice for nine seconds.
 */

(function () {
  'use strict';

  const socket = io();
  const sceneExample = document.getElementById('scene-example');
  const sceneQR = document.getElementById('scene-qr');
  const sceneVisitor = document.getElementById('scene-visitor');
  const qrImage = document.getElementById('qr-image');
  const visitorPhoto = document.getElementById('visitor-photo');
  const visitorName = document.getElementById('visitor-name');
  const visitorFeeling = document.getElementById('visitor-feeling');
  const visitorSocialField = document.getElementById('visitor-social-field');
  const visitorSocial = document.getElementById('visitor-social');
  const visitorWords = document.getElementById('visitor-words');
  const visitorQueueNum = document.getElementById('visitor-queue-num');
  const roundBadge = document.getElementById('round-badge');
  const progressBar = document.getElementById('progress-bar');
  const queueDots = document.getElementById('queue-dots');
  const queueCount = document.getElementById('queue-count');

  const EXAMPLE_DURATION = 5000;
  const QR_DURATION = 5000;
  const VISITOR_DURATION = 9000;
  const VISITOR_ROUNDS = 2;
  const FADE_GAP = 500;

  let queueData = [];
  let cycleTimer = null;
  let progressFrame = null;

  async function init() {
    try {
      const response = await fetch('/api/qr');
      if (!response.ok) throw new Error(`QR request failed: ${response.status}`);
      const data = await response.json();
      if (data.qr) qrImage.src = data.qr;
    } catch (error) {
      console.error('Failed to load QR:', error);
    }

    socket.on('queue:update', (data) => {
      queueData = data.queue || [];
      updateQueueIndicator(data.count, data.max);
    });

    runExampleCycle();
  }

  function updateQueueIndicator(count, max) {
    const dots = queueDots.children;
    for (let i = 0; i < dots.length; i++) {
      dots[i].classList.remove('filled', 'active');
      if (i < count) {
        const entry = queueData[i];
        dots[i].classList.add(entry && entry.status === 'displaying' ? 'active' : 'filled');
      }
    }
    queueCount.textContent = `${count} / ${max}`;
  }

  function showScene(scene) {
    [sceneExample, sceneQR, sceneVisitor].forEach((item) => item.classList.remove('active'));
    if (scene) scene.classList.add('active');
  }

  function startProgress(duration) {
    const startedAt = Date.now();
    progressBar.style.transition = 'none';
    progressBar.style.width = '0%';
    if (progressFrame) cancelAnimationFrame(progressFrame);

    function update() {
      const percentage = Math.min(100, ((Date.now() - startedAt) / duration) * 100);
      progressBar.style.width = `${percentage}%`;
      if (percentage < 100) progressFrame = requestAnimationFrame(update);
    }

    progressFrame = requestAnimationFrame(update);
  }

  function resetProgress() {
    if (progressFrame) cancelAnimationFrame(progressFrame);
    progressBar.style.width = '0%';
  }

  function runExampleCycle() {
    showScene(sceneExample);
    startProgress(EXAMPLE_DURATION);

    cycleTimer = setTimeout(() => {
      showScene(sceneQR);
      startProgress(QR_DURATION);
      cycleTimer = setTimeout(checkAndPlayNext, QR_DURATION);
    }, EXAMPLE_DURATION);
  }

  async function checkAndPlayNext() {
    try {
      const response = await fetch('/api/next-photo');
      if (!response.ok) throw new Error(`Next photo request failed: ${response.status}`);
      const photo = await response.json();

      if (photo.hasNext) {
        runVisitorCycle(photo, 1);
      } else {
        runExampleCycle();
      }
    } catch (error) {
      console.error('Error checking next photo:', error);
      runExampleCycle();
    }
  }

  function runVisitorCycle(photo, round) {
    visitorPhoto.onload = () => {
      visitorName.textContent = photo.guest.name;
      visitorFeeling.textContent = photo.guest.feeling;
      visitorSocial.textContent = photo.guest.socialMedia;
      visitorSocialField.hidden = !photo.guest.socialMedia;
      visitorWords.textContent = `“${photo.guest.words}”`;
      visitorQueueNum.textContent = `#${photo.queueNumber}`;
      roundBadge.textContent = `Putaran ${round} / ${VISITOR_ROUNDS}`;
      showScene(sceneVisitor);
      startProgress(VISITOR_DURATION);

      cycleTimer = setTimeout(() => {
        showScene(null);
        resetProgress();

        if (round < VISITOR_ROUNDS) {
          cycleTimer = setTimeout(() => runVisitorCycle(photo, round + 1), FADE_GAP);
        } else {
          cycleTimer = setTimeout(async () => {
            const deleted = await markPhotoDone(photo.id);
            if (deleted) clearVisitorDisplay();
            runExampleCycle();
          }, FADE_GAP);
        }
      }, VISITOR_DURATION);
    };

    visitorPhoto.onerror = () => {
      console.error('Failed to load visitor photo:', photo.url);
      markPhotoDone(photo.id).then((deleted) => {
        if (deleted) clearVisitorDisplay();
      });
      runExampleCycle();
    };

    visitorPhoto.src = photo.url;
  }

  async function markPhotoDone(id) {
    let lastError;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await fetch('/api/photo-done', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id })
        });
        if (response.ok) return true;
        lastError = new Error(`Photo deletion request failed: ${response.status}`);
      } catch (error) {
        lastError = error;
      }
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
    }
    console.error('Error marking photo done:', lastError || new Error('Photo could not be deleted after three attempts.'));
    return false;
  }

  function clearVisitorDisplay() {
    visitorPhoto.removeAttribute('src');
    visitorName.textContent = '—';
    visitorFeeling.textContent = '—';
    visitorSocial.textContent = '—';
    visitorSocialField.hidden = true;
    visitorWords.textContent = '—';
    visitorQueueNum.textContent = '—';
  }

  init();
})();
