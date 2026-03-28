const { Router } = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('../db/pool');
const auth = require('../middleware/auth');
const { requireFields, isValidEmail } = require('../utils/validate');
const logger = require('../utils/logger');

const router = Router();

function signToken(userId, role) {
  return jwt.sign({ userId, role }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });
}

// ─── REGISTER (user) ─────────────────────────────────
router.post('/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email и пароль обязательны' });
    if (!isValidEmail(email)) return res.status(400).json({ error: 'Неверный формат email' });
    if (password.length < 4) return res.status(400).json({ error: 'Минимум 4 символа' });

    const exists = await pool.query('SELECT id FROM users WHERE email=$1', [email.toLowerCase()]);
    if (exists.rows.length) return res.status(409).json({ error: 'Email уже зарегистрирован' });

    const hash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      `INSERT INTO users (email, password_hash, name, role) VALUES ($1,$2,$3,'user')
       RETURNING id, email, name, avatar_url, phone, role, created_at`,
      [email.toLowerCase(), hash, name || '']
    );
    const user = rows[0];
    logger.info('User registered', { email: user.email });
    res.status(201).json({ token: signToken(user.id, user.role), user });
  } catch (e) {
    logger.error('Register error', { error: e.message });
    res.status(500).json({ error: 'Ошибка сервера: ' + e.message });
  }
});

// ─── REGISTER (business owner) ───────────────────────
router.post('/register-owner', async (req, res) => {
  try {
    const { email, password, name, business_name } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email и пароль обязательны' });
    if (!isValidEmail(email)) return res.status(400).json({ error: 'Неверный формат email' });
    if (password.length < 4) return res.status(400).json({ error: 'Минимум 4 символа' });

    const exists = await pool.query('SELECT id FROM users WHERE email=$1', [email.toLowerCase()]);
    if (exists.rows.length) return res.status(409).json({ error: 'Email уже зарегистрирован' });

    const hash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      `INSERT INTO users (email, password_hash, name, role) VALUES ($1,$2,$3,'owner')
       RETURNING id, email, name, avatar_url, phone, role, created_at`,
      [email.toLowerCase(), hash, name || business_name || '']
    );
    const user = rows[0];
    logger.info('Owner registered', { email: user.email });
    res.status(201).json({ token: signToken(user.id, user.role), user });
  } catch (e) {
    logger.error('Owner register error', { error: e.message });
    res.status(500).json({ error: 'Ошибка сервера: ' + e.message });
  }
});

// ─── LOGIN ───────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const err = requireFields(req.body, ['email', 'password']);
    if (err) return res.status(400).json({ error: err });
    const { email, password } = req.body;

    const { rows } = await pool.query(
      'SELECT id, email, name, avatar_url, phone, password_hash, role, created_at FROM users WHERE email=$1',
      [email.toLowerCase()]
    );
    if (!rows.length) return res.status(401).json({ error: 'Неверный email или пароль' });

    const user = rows[0];
    if (!(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: 'Неверный email или пароль' });
    }
    delete user.password_hash;
    logger.info('User logged in', { email: user.email });
    res.json({ token: signToken(user.id, user.role), user });
  } catch (e) { logger.error('Login error', { error: e.message }); res.status(500).json({ error: 'Ошибка сервера' }); }
});

// ─── GET ME ──────────────────────────────────────────
router.get('/me', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, email, name, avatar_url, phone, role, created_at FROM users WHERE id=$1', [req.userId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Не найден' });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: 'Ошибка сервера' }); }
});

// ─── UPDATE ME ───────────────────────────────────────
router.put('/me', auth, async (req, res) => {
  try {
    const { name, phone, avatar_url } = req.body;
    const { rows } = await pool.query(
      `UPDATE users SET name=COALESCE($1,name), phone=COALESCE($2,phone), avatar_url=COALESCE($3,avatar_url)
       WHERE id=$4 RETURNING id, email, name, avatar_url, phone, role, created_at`,
      [name, phone, avatar_url, req.userId]
    );
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: 'Ошибка сервера' }); }
});

module.exports = router;