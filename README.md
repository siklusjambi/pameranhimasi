# 🖼️ Momen dalam Bingkai

Interactive exhibition photo display — visitors scan a QR code, upload photos from their phone, and see them displayed on the big screen in a beautiful gallery frame.

## ✨ Features

- **Fullscreen Display** — Elegant gallery-style frame with smooth animations and glowing effects
- **QR Code Upload** — Visitors scan QR to open the upload page on their phone
- **Real-time Queue** — FIFO queue with max 5 photos, live status updates via Socket.io
- **Client-Side Compression** — Photos are compressed before upload (max 1600px longest side)
- **Anti-Spam** — 1 active photo per device
- **Auto Cleanup** — Photos are deleted from server after display; uploads cleared on restart
- **Admin Panel** — Password-protected panel to manage the queue
- **Deploy Ready** — Configured for Railway and Render

## 🚀 Quick Start (Local)

### Prerequisites
- Node.js 18+

### Setup

```bash
# 1. Install dependencies
npm install

# 2. Copy environment config
cp .env.example .env

# 3. Edit .env (optional — defaults work for local testing)
#    BASE_URL=http://localhost:3000
#    ADMIN_PASSWORD=admin123
#    PORT=3000

# 4. Start the server
npm start
```

### Open in Browser

| Page | URL | Purpose |
|------|-----|---------|
| Display | http://localhost:3000/display.html | Fullscreen display for the big screen |
| Upload | http://localhost:3000/upload.html | Mobile upload page (or scan QR) |
| Admin | http://localhost:3000/admin.html | Operator panel (password: `admin123`) |

### Testing Flow

1. Open `/display.html` in one browser tab (preferably fullscreen with F11)
2. Open `/upload.html` in another tab or on your phone
3. Upload a photo from the upload page
4. Watch it appear in the display after the current example cycle completes
5. Check the admin panel at `/admin.html` (password: `admin123`)

> **Tip**: To test from your phone on the same network, set `BASE_URL` in `.env` to your computer's local IP (e.g., `http://192.168.1.100:3000`). The QR code on the display will link to this URL.

## ☁️ Deploy to Railway

1. Push code to a Git repository
2. Connect the repo on [Railway](https://railway.app)
3. Set environment variables:
   - `BASE_URL` = your Railway app URL (e.g., `https://your-app.up.railway.app`)
   - `ADMIN_PASSWORD` = a secure password
4. Deploy — Railway auto-detects the `railway.json` config

## ☁️ Deploy to Render

1. Push code to a Git repository
2. Create a new **Web Service** on [Render](https://render.com)
3. Connect the repo — Render auto-detects `render.yaml`
4. Set environment variables:
   - `BASE_URL` = your Render app URL (e.g., `https://your-app.onrender.com`)
   - `ADMIN_PASSWORD` = a secure password
5. Deploy

> **Important**: Use a **Web Service** (always-on), not a serverless function. Socket.io requires a persistent connection.

## 🎨 Design

- **Palette**: Navy (#0A1F44, #0F2E63) background, Sky Blue (#38BDF8, #7DD3FC, #E0F2FE) accents
- **Typography**: Playfair Display (serif) for titles, Inter (sans) for body
- **Frame**: 3:4 aspect ratio with gradient border and sky-blue glow
- **Animations**: Smooth fade + subtle zoom transitions, animated background orbs

## 📁 Project Structure

```
├── server.js           # Express + Socket.io server
├── package.json
├── .env.example        # Environment config template
├── .gitignore
├── railway.json        # Railway deploy config
├── render.yaml         # Render deploy config
├── Procfile            # Generic PaaS start command
├── uploads/            # Temporary photo storage (auto-cleaned)
└── public/
    ├── display.html    # Fullscreen display page
    ├── upload.html     # Mobile upload page
    ├── admin.html      # Operator admin panel
    ├── css/
    │   ├── common.css  # Shared styles
    │   ├── display.css # Display page styles
    │   ├── upload.css  # Upload page styles
    │   └── admin.css   # Admin page styles
    └── js/
        ├── display.js  # Display cycle controller
        ├── upload.js   # Upload & status controller
        └── admin.js    # Admin panel controller
```

## 🔧 Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `BASE_URL` | `http://localhost:3000` | Public URL for QR code |
| `ADMIN_PASSWORD` | `admin123` | Admin panel password |

## License

MIT
