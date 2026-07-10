const WebSocket = require('ws');
const http = require('http');
const url = require('url');

const PORT = process.env.PORT || 9786;
const MAX_SESSION_AGE_MS = 30 * 60 * 1000; // 30 minutes

const sessions = new Map();
const sessionTimers = new Map();

function cleanupSession(sessionId) {
  const pair = sessions.get(sessionId);
  if (pair) {
    pair.forEach(ws => {
      try { ws.close(1000, 'Session closed'); } catch {}
    });
  }
  sessions.delete(sessionId);
  const timer = sessionTimers.get(sessionId);
  if (timer) clearTimeout(timer);
  sessionTimers.delete(sessionId);
}

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('PrintEx Relay Server');
});

const wss = new WebSocket.Server({ server });

wss.on('connection', (ws, req) => {
  const parsed = url.parse(req.url, true);
  const sessionId = parsed.query.session;
  const role = parsed.query.role || 'browser'; // 'browser' or 'connector'

  if (!sessionId || typeof sessionId !== 'string') {
    ws.close(4000, 'Missing session parameter');
    return;
  }

  let pair = sessions.get(sessionId);
  if (!pair) {
    pair = { browser: null, connector: null, pending: [] };
    sessions.set(sessionId, pair);
  }

  if (role === 'connector') {
    pair.connector = ws;
  } else {
    pair.browser = ws;
  }

  const peer = role === 'connector' ? pair.browser : pair.connector;

  if (peer && peer.readyState === WebSocket.OPEN) {
    peer.send(JSON.stringify({ type: 'relay:connected' }));
    ws.send(JSON.stringify({ type: 'relay:connected' }));
  } else if (!pair.browser || !pair.connector) {
    ws.send(JSON.stringify({ type: 'relay:waiting', message: 'Waiting for peer to connect...' }));
  }

  ws.on('message', (data) => {
    try {
      const text = data.toString();
      if (text.startsWith('{')) {
        const msg = JSON.parse(text);
        if (msg.type === 'relay:ping') {
          ws.send(JSON.stringify({ type: 'relay:pong' }));
          return;
        }
      }
    } catch {}

    const target = role === 'connector' ? pair.browser : pair.connector;
    if (target && target.readyState === WebSocket.OPEN) {
      target.send(data);
    }
  });

  ws.on('close', () => {
    if (role === 'connector') pair.connector = null;
    else pair.browser = null;

    if (!pair.browser && !pair.connector) {
      sessions.delete(sessionId);
      const timer = sessionTimers.get(sessionId);
      if (timer) clearTimeout(timer);
      sessionTimers.delete(sessionId);
    } else {
      const survivor = pair.browser || pair.connector;
      if (survivor && survivor.readyState === WebSocket.OPEN) {
        survivor.send(JSON.stringify({ type: 'relay:peer_disconnected' }));
      }
      const timer = setTimeout(() => cleanupSession(sessionId), MAX_SESSION_AGE_MS);
      sessionTimers.set(sessionId, timer);
    }
  });

  ws.on('error', () => {});

  const timer = setTimeout(() => cleanupSession(sessionId), MAX_SESSION_AGE_MS);
  sessionTimers.set(sessionId, timer);
});

server.listen(PORT, () => {
  console.log(`PrintEx Relay running on port ${PORT}`);
  console.log(`Connect via: ws://localhost:${PORT}?session=YOUR_SESSION_ID&role=browser|connector`);
});
