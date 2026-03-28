const WebSocket = require('ws');
const logger = require('../utils/logger');

let wss = null;

function init(server) {
  wss = new WebSocket.Server({ server, path: '/ws' });
  wss.on('connection', (ws) => {
    logger.info('WS client connected', { total: wss.clients.size });
    ws.on('close', () => logger.info('WS client disconnected', { total: wss.clients.size }));
    ws.on('error', () => {});
  });
  logger.info('WebSocket server started on /ws');
}

function broadcast(event, data) {
  if (!wss) return;
  const msg = JSON.stringify({ event, data, ts: Date.now() });
  wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(msg); });
}

module.exports = { init, broadcast };
