const jwt = require('jsonwebtoken');
const pool = require('../db/pool');

async function adminAuth(req, res, next) {
  const h = req.headers.authorization;
  if (!h || !h.startsWith('Bearer ')) return res.status(401).json({ error: 'Токен не предоставлен' });
  try {
    const p = jwt.verify(h.split(' ')[1], process.env.JWT_SECRET);
    req.userId = p.userId;
    const { rows } = await pool.query('SELECT role FROM users WHERE id=$1', [p.userId]);
    if (!rows.length || (rows[0].role !== 'admin' && rows[0].role !== 'owner')) {
      return res.status(403).json({ error: 'Нет доступа' });
    }
    req.userRole = rows[0].role;
    next();
  } catch { return res.status(401).json({ error: 'Неверный токен' }); }
}

module.exports = adminAuth;
