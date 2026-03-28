const pool = require('../db/pool');
const { broadcast } = require('./websocket');
const logger = require('../utils/logger');

async function notifyUser(userId, type, title, message) {
  try {
    const { rows } = await pool.query(
      'INSERT INTO notifications (user_id, type, title, message) VALUES ($1,$2,$3,$4) RETURNING *',
      [userId, type, title, message]
    );
    broadcast('notification', { userId, notification: rows[0] });
    return rows[0];
  } catch (e) { logger.error('notifyUser failed', { error: e.message }); }
}

async function notifyAll(type, title, message) {
  try {
    const users = await pool.query('SELECT id FROM users');
    for (const u of users.rows) {
      await pool.query(
        'INSERT INTO notifications (user_id, type, title, message) VALUES ($1,$2,$3,$4)',
        [u.id, type, title, message]
      );
    }
    broadcast('notification', { global: true, title });
    return users.rows.length;
  } catch (e) { logger.error('notifyAll failed', { error: e.message }); return 0; }
}

async function notifyFavorites(venueId, type, title, message) {
  try {
    const { rows } = await pool.query(
      'SELECT user_id FROM favorites WHERE venue_id=$1', [venueId]
    );
    for (const r of rows) {
      await pool.query(
        'INSERT INTO notifications (user_id, type, title, message) VALUES ($1,$2,$3,$4)',
        [r.user_id, type, title, message]
      );
    }
    broadcast('notification', { venueId, title });
    return rows.length;
  } catch (e) { logger.error('notifyFavorites failed', { error: e.message }); return 0; }
}

module.exports = { notifyUser, notifyAll, notifyFavorites };
