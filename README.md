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

## License

MIT
