# Student Face Verification System

A secure, GDPR-compliant student verification system built with Svelte 5, TypeScript, and MariaDB. Features facial recognition, QR code scanning, and encrypted biometric data storage.

## 🎨 Design System

Built with **Motherduc Design System**:
- Monospace typography (JetBrains Mono)
- Bold 2px borders
- Monochromatic palette with accent colors
- Clean, professional interface

## 🔒 Security Features

- **AES-256-GCM Encryption** for all biometric data
- **GDPR Compliant** with consent management
- **Input Sanitization** and validation
- **Rate Limiting** (3 attempts per 10 seconds)
- **Encrypted IndexedDB** for local storage
- **MariaDB** for persistent database storage
- **90-day data retention** policy

## 📋 Prerequisites

- Node.js 18+ and npm
- MariaDB Server (Host: localhost, User: localhost, Password: 1234)
- Modern web browser with camera access

## 🚀 Quick Start

### 1. Install Dependencies

```sh
npm install
```

### 2. Initialize Database

```sh
npm run init-db
```

### 3. Download Face Models

Download models to `static/models/` from: https://github.com/vladmandic/face-api/tree/master/model

Required:
- tiny_face_detector_model files
- face_recognition_model files

### 4. Start Development Server

```sh
npm run dev
```

Visit: http://localhost:5173

## 📁 Project Structure

```
src/
├── lib/
│   ├── components/     # Svelte components
│   ├── stores/         # State management
│   ├── services/       # Core services (DB, Face, QR, Crypto)
│   └── utils/          # Utilities
└── routes/
    ├── +page.svelte           # Main verification
    └── admin/+page.svelte     # Admin panel
```

## 🎯 Features

- QR Code scanning for student identification
- Live face detection and matching
- GDPR consent management
- Encrypted biometric data storage
- Admin panel for student management
- Real-time verification with confidence scores

## 🔧 Configuration

Database: `src/lib/services/mariadb.ts`
Face threshold: `src/lib/services/face.ts` (default: 0.6)

## Building

```sh
npm run build
npm run preview
```

**⚠️ Important**: HTTPS required for camera access in production.

---

Built with Svelte 5, TypeScript, @vladmandic/face-api, and Motherduc Design System
