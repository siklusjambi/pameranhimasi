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
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const MAX_QUEUE = 5;
const UPLOAD_DIR = path.join(__dirname, 'uploads');

// Ensure uploads directory exists and clean it on startup
if (fs.existsSync(UPLOAD_DIR)) {
  fs.readdirSync(UPLOAD_DIR).forEach(f => {
    try { fs.unlinkSync(path.join(UPLOAD_DIR, f)); } catch {}
  });
} else {
  fs.mkdirSync(UPLOAD_DIR);
}

// --------------- Queue State ---------------
// Each entry: { id, filename, deviceId, status: 'waiting'|'displaying'|'done', queueNumber }
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
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOAD_DIR));

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
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
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
  if (!entry) return;
  const filepath = path.join(UPLOAD_DIR, entry.filename);
  try {
    if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
  } catch {}
}

function markDone(id) {
  const entry = queue.find(e => e.id === id);
  if (entry) {
    entry.status = 'done';
    deletePhotoFile(entry);
    // Clean done entries from queue
    queue = queue.filter(e => e.status !== 'done');
    broadcastQueue();
  }
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

    const deviceId = req.body.deviceId || 'unknown';

    // Check anti-spam: 1 active photo per device
    const existing = getActiveQueue().find(e => e.deviceId === deviceId);
    if (existing) {
      // Delete uploaded file
      try { fs.unlinkSync(req.file.path); } catch {}
      return res.status(429).json({ error: 'Kamu sudah memiliki foto aktif dalam antrian.', existingId: existing.id, queueNumber: existing.queueNumber });
    }

    // Check queue capacity
    if (getActiveQueue().length >= MAX_QUEUE) {
      try { fs.unlinkSync(req.file.path); } catch {}
      return res.status(429).json({ error: 'Antrian penuh, coba lagi sebentar.' });
    }

    globalQueueCounter++;
    const entry = {
      id: uuidv4(),
      filename: req.file.filename,
      deviceId,
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
    queueNumber: entry.queueNumber
  });
});

// Mark photo as done displaying
app.post('/api/photo-done', (req, res) => {
  const { id } = req.body;
  markDone(id);
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
  deletePhotoFile(entry);
  queue = queue.filter(e => e.id !== req.params.id);
  broadcastQueue();
  res.json({ success: true });
});

app.delete('/api/admin/queue', adminAuth, (req, res) => {
  queue.forEach(e => deletePhotoFile(e));
  queue = [];
  broadcastQueue();
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
