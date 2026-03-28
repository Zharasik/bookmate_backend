require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const http = require('http');
const logger = require('./utils/logger');
const ws = require('./services/websocket');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

const uploadsDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(uploadsDir));

// Request logging
app.use((req, _res, next) => {
  if (req.path !== '/' && !req.path.startsWith('/admin')) logger.info(`${req.method} ${req.path}`);
  next();
});

// Public API
app.use('/api/auth', require('./routes/auth'));
app.use('/api/venues', require('./routes/venues'));
app.use('/api/bookings', require('./routes/bookings'));
app.use('/api/reviews', require('./routes/reviews'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/favorites', require('./routes/favorites'));
app.use('/api/photos', require('./routes/photos'));
const { services, masters, promotions } = require('./routes/public');
app.use('/api/services', services);
app.use('/api/masters', masters);
app.use('/api/promotions', promotions);

// Admin/CRM API
app.use('/api/admin', require('./routes/admin'));

// Admin Panel
app.use('/admin', express.static(path.join(__dirname, '..', 'public', 'admin')));

// Health
app.get('/', (_req, res) => res.json({ status: 'ok', service: 'BookMate API', version: '2.0.0' }));

// Error handler
app.use((err, _req, res, _next) => {
  logger.error('Unhandled error', { error: err.message });
  res.status(500).json({ error: 'Ошибка сервера' });
});

// Start with WebSocket
ws.init(server);
server.listen(PORT, () => {
  logger.info(`BookMate API running on port ${PORT}`);
  logger.info(`Admin panel: http://localhost:${PORT}/admin`);
  logger.info(`WebSocket: ws://localhost:${PORT}/ws`);
});
