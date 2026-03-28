const jwt = require('jsonwebtoken');

function auth(req, res, next) {
  const h = req.headers.authorization;
  if (!h || !h.startsWith('Bearer ')) return res.status(401).json({ error: 'Токен не предоставлен' });
  try {
    const p = jwt.verify(h.split(' ')[1], process.env.JWT_SECRET);
    req.userId = p.userId;
    req.userRole = p.role;
    next();
  } catch { return res.status(401).json({ error: 'Неверный токен' }); }
}

module.exports = auth;
