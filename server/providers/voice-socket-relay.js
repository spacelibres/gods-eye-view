import { WebSocketServer, WebSocket } from 'ws';

/**
 * Relay a browser WebSocket to a vendor that authenticates with headers.
 *
 * The browser's WebSocket constructor takes `(url, protocols)` and nothing
 * else: passing `{ headers }` — which Node's `ws` accepts — makes the browser
 * throw `The subprotocol '[object Object]' is invalid`. Volcengine signs its
 * socket with `X-Api-*` headers, so the page cannot open it directly.
 *
 * This relay is that missing hop. The browser connects to a same-origin path,
 * this server opens the vendor socket with the account credential, and frames
 * pass through untouched in both directions. Audio is binary and the vendor
 * protocol is opaque here — the relay never parses a frame, so a protocol
 * change on either side cannot silently corrupt the stream.
 */

/**
 * @param {object} options
 * @param {import('node:http').Server} options.server The HTTP server to attach to.
 * @param {string} [options.path] Same-origin mount.
 * @param {() => object|null} options.upstreamHeaders Headers for the vendor
 *   socket, or null when the deployment holds no credential.
 * @param {string} options.upstreamUrl
 * @param {Function} [options.WebSocketImpl]
 */
export function attachVoiceSocketRelay({
  server,
  path = '/api/doubao/socket',
  upstreamUrl = 'wss://openspeech.bytedance.com/api/v3/realtime/dialogue',
  upstreamHeaders,
  WebSocketImpl = WebSocket,
}) {
  if (!upstreamUrl) throw new TypeError('A relay needs an upstream URL');
  if (typeof upstreamHeaders !== 'function')
    throw new TypeError('A relay needs an upstreamHeaders function');
  const relay = new WebSocketServer({ noServer: true });

  const onUpgrade = (request, socket, head) => {
    const pathname = String(request.url || '').split('?')[0];
    if (pathname !== path) return;

    const headers = upstreamHeaders?.();
    if (!headers) {
      // Refuse before upgrading, so the page sees a failed connect rather than
      // a socket that opens and immediately dies.
      socket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n');
      socket.destroy();
      return;
    }

    // Same-origin only: a foreign page must not borrow this relay to spend the
    // account's quota.
    const origin = String(request.headers.origin || '').trim();
    const host = String(request.headers.host || '').trim();
    if (origin && host) {
      let sameOrigin = false;
      try {
        sameOrigin = new URL(origin).host === host;
      } catch {
        sameOrigin = false;
      }
      if (!sameOrigin) {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        socket.destroy();
        return;
      }
    }

    relay.handleUpgrade(request, socket, head, (client) => {
      const upstream = new WebSocketImpl(upstreamUrl, { headers });
      upstream.binaryType = 'arraybuffer';

      // The page sends its first frame as soon as its own socket opens, which
      // is routinely before the upstream handshake finishes. Dropping those
      // frames left the vendor waiting for a StartConnection it never received,
      // and the session then timed out with no error to show for it.
      const pending = [];

      const closeBoth = () => {
        try {
          if (client.readyState === WebSocket.OPEN) client.close();
        } catch {
          /* already gone */
        }
        try {
          if (upstream.readyState === WebSocket.OPEN) upstream.close();
        } catch {
          /* already gone */
        }
      };

      // Frames are forwarded verbatim, including binary ones.
      // Frames are forwarded verbatim, and always as binary. The flag must be
      // forced in both directions: `ws` sends a Buffer as a text frame by
      // default, and the vendor then receives a 41-byte "JSON" it cannot
      // decode and never answers.
      client.on('message', (data) => {
        if (upstream.readyState === WebSocket.OPEN) {
          upstream.send(data, { binary: true });
        } else if (upstream.readyState === WebSocket.CONNECTING) {
          pending.push(data);
        }
      });
      upstream.on('open', () => {
        // Anything the page sent during the handshake, in order.
        for (const frame of pending.splice(0)) {
          if (upstream.readyState !== WebSocket.OPEN) break;
          upstream.send(frame, { binary: true });
        }
      });
      upstream.on(
        'message',
        (data) =>
          client.readyState === WebSocket.OPEN &&
          client.send(data, { binary: true }),
      );

      client.on('close', closeBoth);
      client.on('error', closeBoth);
      upstream.on('close', closeBoth);
      upstream.on('error', closeBoth);
    });
  };

  server.on('upgrade', onUpgrade);

  return {
    close() {
      server.off('upgrade', onUpgrade);
      relay.close();
    },
  };
}
