'use strict';

const { WebSocketServer } = require('ws');
const { db } = require('./db');
const { userFromRequest, canEdit } = require('./auth');

/** caseId -> Set<WebSocket> */
const rooms = new Map();

function send(ws, msg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function broadcast(caseId, msg, except = null) {
  const room = rooms.get(Number(caseId));
  if (!room) return;
  const data = JSON.stringify(msg);
  for (const ws of room) if (ws !== except && ws.readyState === ws.OPEN) ws.send(data);
}

function presence(caseId) {
  const room = rooms.get(caseId);
  const seen = new Map();
  for (const ws of room || []) seen.set(ws.user.id, { id: ws.user.id, name: ws.user.display_name });
  broadcast(caseId, { t: 'presence', users: [...seen.values()] });
}

function setup(server) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 8 * 1024 });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://localhost');
    const reject = (code) => { socket.write(`HTTP/1.1 ${code}\r\n\r\n`); socket.destroy(); };
    if (url.pathname !== '/ws') return reject('404 Not Found');

    // Refuse cross-site connections (the session cookie would otherwise be sent along).
    const origin = req.headers.origin;
    if (origin) {
      try { if (new URL(origin).host !== req.headers.host) return reject('403 Forbidden'); }
      catch { return reject('403 Forbidden'); }
    }

    const user = userFromRequest(req);
    if (!user) return reject('401 Unauthorized');
    const caseId = Number(url.searchParams.get('case'));
    if (!db.prepare('SELECT 1 FROM cases WHERE id = ?').get(caseId)) return reject('404 Not Found');

    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.user = user;
      ws.caseId = caseId;
      ws.alive = true;
      if (!rooms.has(caseId)) rooms.set(caseId, new Set());
      rooms.get(caseId).add(ws);
      presence(caseId);

      ws.on('pong', () => { ws.alive = true; });
      ws.on('message', (raw) => {
        let msg;
        try { msg = JSON.parse(raw); } catch { return; }
        // Live drag preview: relayed to the other viewers, persisted later via the REST API.
        if (msg && msg.t === 'moving' && canEdit(user) && Array.isArray(msg.items)) {
          const items = msg.items.slice(0, 200)
            .filter((it) => Number.isInteger(it.id) && Number.isFinite(it.x) && Number.isFinite(it.y))
            .map(({ id, x, y }) => ({ id, x, y }));
          broadcast(caseId, { t: 'moving', items, user: user.display_name }, ws);
        }
      });
      ws.on('close', () => {
        const room = rooms.get(caseId);
        room.delete(ws);
        if (room.size === 0) rooms.delete(caseId);
        else presence(caseId);
      });
    });
  });

  const heartbeat = setInterval(() => {
    for (const room of rooms.values()) {
      for (const ws of room) {
        if (!ws.alive) { ws.terminate(); continue; }
        ws.alive = false;
        ws.ping();
      }
    }
  }, 30000);
  heartbeat.unref();
  wss.on('close', () => clearInterval(heartbeat));
  return wss;
}

/** Closes every socket of a deleted case. */
function closeRoom(caseId) {
  for (const ws of rooms.get(Number(caseId)) || []) {
    send(ws, { t: 'case:del' });
    ws.close();
  }
}

module.exports = { setup, broadcast, closeRoom };
