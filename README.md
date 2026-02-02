# Fogo Validator Explorer

A desktop application for exploring and analyzing validators on the **Fogo blockchain** (mainnet). Built with a clean, Apple-inspired UI.

![Fogo Validator Explorer](https://img.shields.io/badge/Fogo-Validator%20Explorer-ff6b35?style=for-the-badge)
![Platform](https://img.shields.io/badge/platform-Windows-blue?style=for-the-badge)
![License](https://img.shields.io/badge/license-MIT-green?style=for-the-badge)

## Features

- **Validator Overview** — View all active and delinquent validators with rank, stake, commission, and share percentage
- **Validator Metadata** — Names, icons, descriptions, and websites fetched directly from on-chain config accounts
- **Stake Summary** — Total FOGO deposited, activated stake, and delegator breakdown per validator
- **Transaction History** — Full transaction scan with streaming progress, paginated results, and cumulative amount totals
- **Performance Stats** — Epoch credits, last vote slot, root slot, and vote account details
- **Search** — Filter validators by name or public key
- **Smart Caching** — Server-side transaction scan cache with resume capability across page reloads
- **URL Routing** — Hash-based routing so refreshing the page stays on the current validator

## Getting Started

### Option 1: Desktop App (Recommended)

Download the latest release from the [Releases](../../releases) page, extract the zip, and run `Fogo Validator Explorer.exe`. No installation required.

### Option 2: Run from Source

**Prerequisites:** [Node.js](https://nodejs.org/) v18+

```bash
# Clone the repository
git clone https://github.com/YOUR_USERNAME/fogo-explorer.git
cd fogo-explorer

# Install dependencies
npm install

# Start the web server
npm start
# Open http://localhost:3000 in your browser

# Or run as Electron desktop app
npm run electron
```

### Build Desktop App

```bash
npm run dist
```

The built app will be in `dist/win-unpacked/`.

## Architecture

```
fogo-explorer/
  electron.js        # Electron main process (desktop wrapper)
  server.js          # Express backend (RPC proxy, caching, SSE streaming)
  public/
    index.html       # Single-page frontend app
  package.json
```

- **Backend** (`server.js`) — Express server that proxies requests to the Fogo RPC (`https://mainnet.fogo.io`), parses on-chain validator metadata from the Config program, and provides transaction scanning via Server-Sent Events with server-side caching
- **Frontend** (`public/index.html`) — Vanilla JS single-page app with Apple-style CSS, hash-based routing, paginated transaction tables, and real-time scan progress
- **Desktop** (`electron.js`) — Electron wrapper that embeds the Express server and opens the app in a native window

## Tech Stack

- **Fogo Blockchain** — SVM-based (Solana Virtual Machine compatible), standard Solana RPC methods
- **Express.js** — Backend API and static file server
- **Electron** — Desktop app packaging
- **Vanilla JS/CSS** — Zero frontend framework dependencies

## Screenshots

### Validator List
Clean overview with network stats, search, and all validators ranked by stake.

### Validator Detail
Complete validator information with stake summary, performance metrics, delegators tab, and full transaction history.

---

Developed by **Nuno Rebelo** for **Fogees Hub**
