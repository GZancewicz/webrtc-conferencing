# WebRTC Peer-to-Peer

A self-hosted, peer-to-peer video conferencing application built with WebRTC and Socket.IO. Media flows directly between browsers after signaling — the server never touches your audio or video.

## Features

### Core
- **HD Video & Audio** — Peer-to-peer WebRTC connections with configurable resolution (360p–1080p)
- **Room-based Meetings** — Create or join rooms with unique IDs and optional password protection
- **Screen Sharing** — Share your screen with participants; seamlessly switches back to camera when stopped
- **Live Chat** — In-meeting text chat with timestamps and system messages for join/leave events
- **Media Controls** — Mute/unmute audio, enable/disable video
- **Participant List** — See who's in the meeting with real-time media status indicators
- **Invite Links** — One-click copy to share the room URL

### Media Settings
- Choose preferred video codec (AV1, VP9, H.264, VP8) and audio codec (Opus, G.722, PCMU, etc.)
- Codecs enumerated dynamically from browser capabilities via `RTCRtpSender.getCapabilities()`
- Preferences exchanged between peers via DataChannel and applied during SDP negotiation

### Telemetry Panel
Real-time connection quality metrics collected every 2 seconds via `RTCPeerConnection.getStats()`:
- RTT, jitter, packet loss
- Send/receive bitrate and FPS
- Video resolution
- MOS (Mean Opinion Score) for audio quality
- ICE candidate types and connection state

### Analytics Dashboard
- Historical sparkline graphs of all telemetry metrics
- Per-peer and aggregate statistics
- Connection timeline with live indicator

### Network Topology Visualization
- SVG diagram of peer connections, STUN/TURN server involvement, and ICE candidate paths
- Connection timing and candidate type annotations
- Configuration viewer popup with peer details

### AI Assistant (Optional)
Requires an OpenAI API key (`OPENAI_API_KEY` environment variable):
- **Speech-to-Text** — Browser-native Web Speech API captures voice input
- **ChatGPT** — Sends messages with conversation context to OpenAI
- **Text-to-Speech** — AI responses spoken aloud via OpenAI TTS API

### Security
- DTLS-encrypted handshake, SRTP-encrypted media
- SHA-256 password hashing for room protection
- Configurable CORS allowed origins
- No media data passes through the server

## Quick Start

### Prerequisites

- Node.js 18+

### Installation

```bash
npm install
```

### Run Locally

```bash
npm start
```

Open http://localhost:3000. Enter a username and room ID (or leave blank to auto-generate one). Open a second browser window to the same room to test.

### Environment Variables

Copy `.env.example` to `.env` and configure as needed:

| Variable | Required | Description |
|---|---|---|
| `OPENAI_API_KEY` | No | Enables AI assistant features |
| `TURN_URL` | No | TURN server URL (e.g. `turn:server:3478`) |
| `TURNS_URL` | No | TURN over TLS URL (e.g. `turns:server:5349`) |
| `TURN_USERNAME` | No | TURN server username |
| `TURN_CREDENTIAL` | No | TURN server password |
| `ALLOWED_ORIGINS` | No | Comma-separated CORS origins (defaults to `*` in development) |
| `PORT` | No | Server port (default: 3000) |

## Deploy to Render

1. Push this repository to GitHub
2. Create a new **Web Service** on [Render](https://render.com)
3. Connect your GitHub repository
4. Render will auto-detect the `render.yaml` configuration
5. Set `OPENAI_API_KEY` in the Render dashboard if you want AI features
6. Click **Deploy**

Your app will be live at `https://your-app-name.onrender.com`

## Architecture

### Server

**Express + Socket.IO** ([server/index.js](server/index.js))

- Serves static files and the Socket.IO client
- WebRTC signaling: relays SDP offers/answers and ICE candidates between peers
- Room management: creation, participant tracking, password validation
- REST endpoints for ICE server config, AI chat, text-to-speech, and server network info
- Rooms and participants stored in memory

### Client

**Vanilla ES6 modules** — no framework dependencies. ~4,600 lines across 13 files in [public/js/](public/js/).

| File | Purpose |
|---|---|
| [room.js](public/js/room.js) | Main `WebConference` class — orchestrates everything |
| [webrtc.js](public/js/webrtc.js) | Peer connection lifecycle, SDP, ICE, DataChannels |
| [media.js](public/js/media.js) | Camera/mic access, screen sharing, media controls |
| [telemetry.js](public/js/telemetry.js) | Stats collection and DataChannel exchange |
| [dashboard.js](public/js/dashboard.js) | Analytics visualization and sparkline rendering |
| [topology.js](public/js/topology.js) | Network topology SVG diagram |
| [settings.js](public/js/settings.js) | Codec/resolution preferences |
| [ai.js](public/js/ai.js) | Speech recognition, ChatGPT, TTS |
| [chat.js](public/js/chat.js) | Chat messaging and participant list |
| [stats.js](public/js/stats.js) | Stats collection helper |
| [configurations.js](public/js/configurations.js) | Configuration display helpers |
| [ui.js](public/js/ui.js) | UI utilities |
| [main.js](public/js/main.js) | Landing page logic |

## WebRTC Primer

WebRTC enables browsers to exchange audio, video, and data directly without plugins or intermediary servers carrying the media.

### Signaling

Before peers can connect, they exchange connection metadata via the signaling server (Socket.IO):
- **SDP Offer/Answer** — Each peer describes its media capabilities (codecs, resolutions) using Session Description Protocol. One peer creates an offer, the other responds with an answer.
- **ICE Candidates** — Each peer discovers its network addresses (local IP, public IP via STUN, relay via TURN) and shares them with the other peer.

### NAT Traversal

Most devices sit behind NATs/firewalls that block unsolicited inbound connections. WebRTC uses two mechanisms:
- **STUN** (Session Traversal Utilities for NAT) — A lightweight server that tells your browser its public IP and port, producing "server-reflexive" candidates. Works for ~80–90% of connections.
- **TURN** (Traversal Using Relays around NAT) — A relay server that forwards media when direct peer-to-peer fails (symmetric NATs, strict firewalls). Adds latency but is required for ~10–20% of real-world connections.

**ICE** (Interactive Connectivity Establishment) orchestrates NAT traversal: it gathers all candidate paths, tests them in priority order, and selects the best working path. Candidate types: `host` (local), `srflx` (public via STUN), `relay` (via TURN).

### Connection Flow

```
Browser A                    Signaling Server                    Browser B
    |                              |                                |
    |-- 1. Create Room ---------->|                                |
    |                              |<--------- 2. Join Room -------|
    |                              |                                |
    |<-- 3. "user-joined" --------|                                |
    |                              |                                |
    |-- 4. SDP Offer ------------>|--------- 5. SDP Offer ------->|
    |                              |                                |
    |                              |<-------- 6. SDP Answer -------|
    |<-- 7. SDP Answer -----------|                                |
    |                              |                                |
    |-- 8. ICE Candidates ------->|--- 9. ICE Candidates -------->|
    |                              |<-- 10. ICE Candidates --------|
    |<-- 11. ICE Candidates ------|                                |
    |                              |                                |
    |============= 12. Direct P2P Media (SRTP encrypted) =========|
```

After step 12, the signaling server is no longer in the media path. Audio and video flow directly between browsers (or via TURN relay if direct connection failed).

## Project Structure

```
web-conference/
├── server/
│   └── index.js              # Express + Socket.IO signaling server
├── public/
│   ├── index.html            # Landing page
│   ├── room.html             # Meeting room UI
│   ├── css/
│   │   └── style.css         # Dark theme styles
│   ├── js/                   # Client modules (13 files)
│   │   ├── room.js           # Main WebConference class
│   │   ├── webrtc.js         # Peer connections & signaling
│   │   ├── media.js          # Camera, mic, screen sharing
│   │   ├── telemetry.js      # Connection quality metrics
│   │   ├── dashboard.js      # Analytics & sparklines
│   │   ├── topology.js       # Network topology diagram
│   │   ├── settings.js       # Codec & resolution prefs
│   │   ├── ai.js             # AI assistant (optional)
│   │   ├── chat.js           # Chat & participant list
│   │   ├── main.js           # Landing page logic
│   │   ├── stats.js          # Stats helper
│   │   ├── configurations.js # Config display
│   │   └── ui.js             # UI utilities
│   └── images/               # Visual assets
├── doc/
│   ├── compliance-reports/   # RFC/W3C compliance analysis & remediation
│   ├── retrospective/        # Standards evolution: 2021 vs 2026
│   └── standards-latex/      # LaTeX reference docs for WebRTC, QUIC, HTTP/3, WebTransport
├── package.json
├── render.yaml               # Render.com deployment config
├── .env.example              # Environment variable template
└── .gitignore
```

## Production Considerations

- **TURN server** — Strongly recommended for production. Without one, ~10–20% of users behind symmetric NATs or strict firewalls won't be able to connect. Free options include [Metered TURN](https://www.metered.ca/tools/openrelay/) and [Twilio Network Traversal](https://www.twilio.com/stun-turn).
- **Scaling** — Rooms and participants are stored in memory on a single Node.js process. For multi-server deployments, add a Socket.IO Redis adapter and external state store.
- **CORS** — Set `ALLOWED_ORIGINS` to your domain(s) in production rather than relying on the default wildcard.

## Documentation

The [doc/](doc/) directory contains technical reference material:

| Directory | Contents |
|---|---|
| `compliance-reports/` | Compliance analysis of the codebase against RFC and W3C standards, plus a remediation plan |
| `retrospective/` | What the standards enabled in browsers in late 2021 vs 2026 |
| `standards-latex/` | LaTeX source for WebRTC (RTP, SRTP, ICE, JSEP, DTLS, Security), QUIC, HTTP/3, and WebTransport RFCs |

LaTeX files can be compiled with:

```bash
/Library/TeX/texbin/pdflatex -interaction=nonstopmode <filename>.tex
```

Run twice for cross-references and hyperlink outlines to resolve.

## License

MIT
