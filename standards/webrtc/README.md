# WebRTC Specifications

WebRTC is defined by a stack of coordinated specifications from the W3C (browser API) and IETF (transport protocols).

## W3C Specification (Browser API)

| File | Source | Description |
|------|--------|-------------|
| `w3c-webrtc-1.0.html` | [W3C TR](https://www.w3.org/TR/webrtc/) | WebRTC 1.0: Real-Time Communication Between Browsers (official) |
| `w3c-webrtc-1.0-editors-draft.html` | [Editor's Draft](https://w3c.github.io/webrtc-pc/) | Most current working draft |

Defines: RTCPeerConnection, RTCDataChannel, MediaStream, JavaScript API surface, browser behavior.

## IETF Specifications (Transport Protocols)

| File | RFC | Topic |
|------|-----|-------|
| `rfc8829-jsep.txt` | [RFC 8829](https://www.rfc-editor.org/rfc/rfc8829) | JavaScript Session Establishment Protocol (JSEP) / SDP Signaling |
| `rfc8445-ice.txt` | [RFC 8445](https://www.rfc-editor.org/rfc/rfc8445) | ICE - Interactive Connectivity Establishment (NAT traversal) |
| `rfc8827-dtls-webrtc.txt` | [RFC 8827](https://www.rfc-editor.org/rfc/rfc8827) | WebRTC Security Architecture / DTLS |
| `rfc8826-webrtc-security.txt` | [RFC 8826](https://www.rfc-editor.org/rfc/rfc8826) | WebRTC Security |
| `rfc3711-srtp.txt` | [RFC 3711](https://www.rfc-editor.org/rfc/rfc3711) | SRTP - Secure Real-time Transport Protocol |
| `rfc3550-rtp.txt` | [RFC 3550](https://www.rfc-editor.org/rfc/rfc3550) | RTP - Real-time Transport Protocol |

## Protocol Stack

```
JavaScript API (W3C)
        |
  JSEP (RFC 8829)
        |
  ICE (RFC 8445)
        |
  DTLS (RFC 8827)
        |
  SRTP (RFC 3711)
        |
  RTP (RFC 3550)
```
