require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const QRCode = require('qrcode');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const railwayPublicDomain = process.env.RAILWAY_PUBLIC_DOMAIN;
const configuredBaseUrl = process.env.BASE_URL;
const isLocalBaseUrl = configuredBaseUrl && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/i.test(configuredBaseUrl);
const BASE_URL = (railwayPublicDomain && (!configuredBaseUrl || isLocalBaseUrl)
  ? `https://${railwayPublicDomain}`
  : configuredBaseUrl || `http://localhost:${PORT}`).replace(/\/+$/, '');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const MAX_QUEUE = 5;
const UPLOAD_DIR = path.join(__dirname, 'uploads');

// Ensure uploads directory exists and clean it on startup
if (fs.existsSync(UPLOAD_DIR)) {
  fs.readdirSync(UPLOAD_DIR).forEach(f => {
    try {
      fs.unlinkSync(path.join(UPLOAD_DIR, f));
    } catch (error) {
      console.error(`Failed to remove old upload ${f}:`, error);
    }
  });
} else {
  fs.mkdirSync(UPLOAD_DIR);
}

// --------------- Queue State ---------------
// Guest details stay in process memory and are discarded with their queue entry.
let queue = [];
let globalQueueCounter = 0;
let qrDataUrl = null;

// Generate QR code
(async () => {
  const uploadUrl = `${BASE_URL}/upload.html`;
  qrDataUrl = await QRCode.toDataURL(uploadUrl, {
    width: 600,
    margin: 2,
    color: { dark: '#0A1F44', light: '#E0F2FE' }
  });
  console.log(`QR code generated for: ${uploadUrl}`);
})();

// --------------- Middleware ---------------
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.get('/', (req, res) => res.redirect('/display.html'));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOAD_DIR, {
  etag: false,
  lastModified: false,
  maxAge: 0,
  setHeaders: res => res.setHeader('Cache-Control', 'no-store')
}));

// Multer config
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${uuidv4()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024, fields: 5, fieldSize: 1024 }, // 5 MB, five small metadata fields
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Tipe file tidak didukung. Gunakan JPG, PNG, atau WEBP.'));
    }
  }
});

// --------------- Helper Functions ---------------
function getActiveQueue() {
  return queue.filter(e => e.status !== 'done');
}

function broadcastQueue() {
  const active = getActiveQueue();
  io.emit('queue:update', {
    queue: active.map(e => ({
      id: e.id,
      queueNumber: e.queueNumber,
      status: e.status,
      deviceId: e.deviceId
    })),
    count: active.length,
    max: MAX_QUEUE
  });
}

function deletePhotoFile(entry) {
  if (!entry) return true;
  const filepath = path.join(UPLOAD_DIR, entry.filename);
  try {
    if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
    return true;
  } catch (error) {
    console.error(`Failed to delete upload ${entry.filename}:`, error);
    return false;
  }
}

function deleteRejectedUpload(filepath) {
  try {
    fs.unlinkSync(filepath);
    return true;
  } catch (error) {
    console.error(`Failed to remove rejected upload ${path.basename(filepath)}:`, error);
    return false;
  }
}

function markDone(id) {
  const entry = queue.find(e => e.id === id);
  if (!entry) return true;
  if (!deletePhotoFile(entry)) return false;

  entry.status = 'done';
  queue = queue.filter(e => e.status !== 'done');
  broadcastQueue();
  return true;
}

// --------------- API Routes ---------------

// Upload photo
app.post('/api/upload', (req, res) => {
  upload.single('photo')(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'File terlalu besar. Maksimal 5 MB.' });
      }
      return res.status(400).json({ error: err.message || 'Upload gagal.' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'Tidak ada file yang diunggah.' });
    }

    const guest = {
      name: typeof req.body.name === 'string' ? req.body.name.trim() : '',
      feeling: typeof req.body.feeling === 'string' ? req.body.feeling.trim() : '',
      socialMedia: typeof req.body.socialMedia === 'string' ? req.body.socialMedia.trim() : '',
      words: typeof req.body.words === 'string' ? req.body.words.trim() : ''
    };
    if (!guest.name || guest.name.length > 60 ||
        !guest.feeling || guest.feeling.length > 80 ||
        guest.socialMedia.length > 80 ||
        !guest.words || guest.words.length > 180) {
      if (!deleteRejectedUpload(req.file.path)) {
        return res.status(500).json({ error: 'Foto gagal dibersihkan. Hubungi operator.' });
      }
      return res.status(400).json({ error: 'Lengkapi nama, perasaan hari ini, dan kata-kata hari ini. Periksa batas panjang setiap kolom.' });
    }

    const deviceId = req.body.deviceId || 'unknown';

    // Check anti-spam: 1 active photo per device
    const existing = getActiveQueue().find(e => e.deviceId === deviceId);
    if (existing) {
      if (!deleteRejectedUpload(req.file.path)) {
        return res.status(500).json({ error: 'Foto gagal dibersihkan. Hubungi operator.' });
      }
      return res.status(429).json({ error: 'Kamu sudah memiliki foto aktif dalam antrian.', existingId: existing.id, queueNumber: existing.queueNumber });
    }

    // Check queue capacity
    if (getActiveQueue().length >= MAX_QUEUE) {
      if (!deleteRejectedUpload(req.file.path)) {
        return res.status(500).json({ error: 'Foto gagal dibersihkan. Hubungi operator.' });
      }
      return res.status(429).json({ error: 'Antrian penuh, coba lagi sebentar.' });
    }

    globalQueueCounter++;
    const entry = {
      id: uuidv4(),
      filename: req.file.filename,
      deviceId,
      guest,
      status: 'waiting',
      queueNumber: globalQueueCounter,
      uploadedAt: Date.now()
    };

    queue.push(entry);
    broadcastQueue();

    res.json({
      success: true,
      id: entry.id,
      queueNumber: entry.queueNumber,
      position: getActiveQueue().length
    });
  });
});

// Get queue status
app.get('/api/queue', (req, res) => {
  const active = getActiveQueue();
  res.json({
    queue: active.map(e => ({
      id: e.id,
      queueNumber: e.queueNumber,
      status: e.status,
      deviceId: e.deviceId
    })),
    count: active.length,
    max: MAX_QUEUE
  });
});

// Get QR code data URL
app.get('/api/qr', (req, res) => {
  res.json({ qr: qrDataUrl, uploadUrl: `${BASE_URL}/upload.html` });
});

// Get next photo for display
app.get('/api/next-photo', (req, res) => {
  const entry = queue.find(e => e.status === 'waiting');
  if (!entry) {
    return res.json({ hasNext: false });
  }
  entry.status = 'displaying';
  broadcastQueue();
  res.json({
    hasNext: true,
    id: entry.id,
    url: `/uploads/${entry.filename}`,
    queueNumber: entry.queueNumber,
    guest: entry.guest
  });
});

// Mark photo as done displaying
app.post('/api/photo-done', (req, res) => {
  const { id } = req.body;
  if (!id) return res.status(400).json({ error: 'ID foto diperlukan.' });
  if (!markDone(id)) return res.status(500).json({ error: 'Foto belum dapat dihapus. Coba lagi atau hapus melalui panel operator.' });
  res.json({ success: true });
});

// --------------- Admin Routes ---------------
function adminAuth(req, res, next) {
  const password = req.headers['x-admin-password'] || req.body.password || req.query.password;
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Password salah.' });
  }
  next();
}

app.get('/api/admin/queue', adminAuth, (req, res) => {
  res.json({
    queue: queue.map(e => ({
      id: e.id,
      queueNumber: e.queueNumber,
      status: e.status,
      deviceId: e.deviceId,
      filename: e.filename,
      uploadedAt: e.uploadedAt
    })),
    count: getActiveQueue().length,
    max: MAX_QUEUE
  });
});

app.delete('/api/admin/photo/:id', adminAuth, (req, res) => {
  const entry = queue.find(e => e.id === req.params.id);
  if (!entry) return res.status(404).json({ error: 'Foto tidak ditemukan.' });
  if (!deletePhotoFile(entry)) return res.status(500).json({ error: 'File foto gagal dihapus.' });
  queue = queue.filter(e => e.id !== req.params.id);
  broadcastQueue();
  res.json({ success: true });
});

app.delete('/api/admin/queue', adminAuth, (req, res) => {
  const retained = queue.filter(e => !deletePhotoFile(e));
  queue = retained;
  broadcastQueue();
  if (retained.length) return res.status(500).json({ error: 'Sebagian file gagal dihapus. Periksa log server.' });
  res.json({ success: true });
});

// --------------- Socket.io ---------------
io.on('connection', (socket) => {
  // Send current queue state on connect
  const active = getActiveQueue();
  socket.emit('queue:update', {
    queue: active.map(e => ({
      id: e.id,
      queueNumber: e.queueNumber,
      status: e.status,
      deviceId: e.deviceId
    })),
    count: active.length,
    max: MAX_QUEUE
  });

  socket.on('display:photo-done', (data) => {
    if (data && data.id) {
      markDone(data.id);
    }
  });
});

// --------------- Start ---------------
server.listen(PORT, () => {
  console.log(`\n  ✨ Momen dalam Bingkai ✨`);
  console.log(`  Server berjalan di http://localhost:${PORT}`);
  console.log(`  Display:  http://localhost:${PORT}/display.html`);
  console.log(`  Upload:   http://localhost:${PORT}/upload.html`);
  console.log(`  Admin:    http://localhost:${PORT}/admin.html`);
  console.log(`  BASE_URL: ${BASE_URL}\n`);
});
