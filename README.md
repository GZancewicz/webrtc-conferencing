# Web Conference

A simple, self-hosted video conferencing application built with WebRTC and Socket.io.

## Features

- **HD Video & Audio** - Peer-to-peer WebRTC connections for low-latency streaming
- **Room-based Meetings** - Create or join rooms with unique IDs
- **Screen Sharing** - Share your screen with meeting participants
- **Live Chat** - In-meeting text chat
- **Media Controls** - Mute/unmute audio, enable/disable video
- **Participant List** - See who's in the meeting
- **Invite Links** - One-click copy invite link to share

## WebRTC Primer

WebRTC (Web Real-Time Communication) enables browsers to exchange audio, video, and data directly without plugins or intermediary servers carrying the media.

### Key Concepts

**Peer-to-peer connections** - Once established, media flows directly between browsers. The server is only needed for the initial handshake (signaling), not for carrying audio/video data.

**Signaling** - Before peers can connect, they must exchange connection metadata via a signaling server (this app uses Socket.IO). This involves:
- **SDP Offer/Answer** - Each peer describes its media capabilities (codecs, resolutions, etc.) using Session Description Protocol. One peer creates an "offer", the other responds with an "answer".
- **ICE Candidates** - Each peer discovers its own network addresses (local IP, public IP via STUN, relay address via TURN) and shares them with the other peer.

**NAT Traversal** - Most devices sit behind NATs/firewalls that block unsolicited inbound connections. WebRTC uses two mechanisms to solve this:
- **STUN** (Session Traversal Utilities for NAT) - A lightweight server that tells your browser its public IP address and port. The browser uses this to create "server-reflexive" candidates that peers can reach. Works when both sides have compatible NAT types (~80-90% of cases).
- **TURN** (Traversal Using Relays around NAT) - A relay server that forwards media when direct peer-to-peer fails (symmetric NATs, strict firewalls). All traffic routes through the TURN server, adding latency and bandwidth cost. Required for ~10-20% of real-world connections.

**ICE** (Interactive Connectivity Establishment) - The framework that orchestrates NAT traversal. ICE gathers all possible connection paths (candidates), tests them in priority order, and selects the best working path. Candidate types:
- `host` - Direct local network address
- `srflx` (server-reflexive) - Public address discovered via STUN
- `relay` - Address on a TURN server

**Media Security** - All WebRTC media is encrypted:
- **DTLS** (Datagram TLS) - Establishes an encrypted tunnel for the connection handshake
- **SRTP** (Secure Real-time Transport Protocol) - Encrypts the actual audio/video packets using keys derived from DTLS

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

Open http://localhost:3000 in your browser.

## Deploy to Render

1. Push this repository to GitHub
2. Create a new **Web Service** on [Render](https://render.com)
3. Connect your GitHub repository
4. Render will auto-detect the `render.yaml` configuration
5. Click **Deploy**

Your app will be live at `https://your-app-name.onrender.com`

## Project Structure

```
web-conference/
├── server/
│   └── index.js        # Express + Socket.io signaling server
├── public/
│   ├── index.html      # Landing page
│   ├── room.html       # Meeting room
│   ├── css/
│   │   └── style.css   # Styles
│   └── js/
│       ├── main.js     # Landing page logic
│       └── room.js     # WebRTC implementation
├── package.json
├── render.yaml         # Render deployment config
└── .gitignore
```

## How It Works

1. **Signaling Server** - Socket.io handles WebRTC signaling (offer/answer/ICE candidates)
2. **Peer Connections** - Once signaling completes, video/audio flows directly between browsers
3. **STUN Servers** - Google's public STUN servers handle NAT traversal

## Production Considerations

For production deployments behind strict firewalls, consider adding a TURN server for relay fallback. Free options include:

- [Metered TURN](https://www.metered.ca/tools/openrelay/)
- [Twilio Network Traversal](https://www.twilio.com/stun-turn)

## LaTeX Documents

LaTeX source files (`.tex`) can be compiled to PDF using:

```bash
/Library/TeX/texbin/pdflatex -interaction=nonstopmode <filename>.tex
```

Run twice for cross-references and hyperlink outlines to resolve correctly.

| Document | Description |
|---|---|
| `retrospective.tex` | Comparison of what the standards in `standards/` enabled in browsers in late 2021 vs March 2026 |

## License

MIT
