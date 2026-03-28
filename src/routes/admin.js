const { Router } = require('express');
const pool = require('../db/pool');
const adminAuth = require('../middleware/adminAuth');
const { broadcast } = require('../services/websocket');
const { notifyAll, notifyFavorites } = require('../services/notifications');
const logger = require('../utils/logger');

const router = Router();
router.use(adminAuth);

// Helper: owner filter
function ownerWhere(req, alias = '') {
  const pre = alias ? alias + '.' : '';
  if (req.userRole === 'admin') return { sql: '', params: [] };
  return { sql: ` AND ${pre}owner_id=$`, params: [req.userId] };
}
function venueFilter(req, alias = 'v') {
  if (req.userRole === 'admin') return { sql: '', params: [], idx: 0 };
  return { sql: ` AND ${alias}.owner_id=$1`, params: [req.userId], idx: 1 };
}

// ── STATS ────────────────────────────────────────────
router.get('/stats', async (req, res) => {
  try {
    const isAdmin = req.userRole === 'admin';
    const vFilter = isAdmin ? '' : ' WHERE owner_id=$1';
    const vParams = isAdmin ? [] : [req.userId];

    const venueIds = isAdmin
      ? null
      : (await pool.query('SELECT id FROM venues WHERE owner_id=$1', [req.userId])).rows.map(r => r.id);

    const inClause = venueIds && venueIds.length ? `venue_id = ANY($1)` : '1=1';
    const inParams = venueIds && venueIds.length ? [venueIds] : [];

    const [venues, users, bookings, reviews, services, masters] = await Promise.all([
      pool.query(`SELECT count(*) FROM venues${vFilter}`, vParams),
      isAdmin ? pool.query('SELECT count(*) FROM users') : Promise.resolve({ rows: [{ count: 0 }] }),
      pool.query(`SELECT count(*) FROM bookings WHERE ${inClause}`, inParams),
      pool.query(`SELECT count(*) FROM reviews WHERE ${inClause}`, inParams),
      pool.query(`SELECT count(*) FROM services WHERE ${inClause}`, inParams),
      pool.query(`SELECT count(*) FROM masters WHERE ${inClause}`, inParams),
    ]);

    let recentSql = `SELECT b.*, v.name AS venue_name, u.name AS user_name, u.email AS user_email
      FROM bookings b JOIN venues v ON v.id=b.venue_id JOIN users u ON u.id=b.user_id`;
    let recentParams = [];
    if (!isAdmin && venueIds?.length) {
      recentSql += ` WHERE b.venue_id = ANY($1)`;
      recentParams = [venueIds];
    }
    recentSql += ' ORDER BY b.created_at DESC LIMIT 10';
    const recent = await pool.query(recentSql, recentParams);

    res.json({
      venues: +venues.rows[0].count, users: +users.rows[0].count,
      bookings: +bookings.rows[0].count, reviews: +reviews.rows[0].count,
      services: +services.rows[0].count, masters: +masters.rows[0].count,
      recentBookings: recent.rows,
    });
  } catch (e) {
    logger.error('Stats error', { error: logger.errorDetail(e), stack: e.stack });
    res.status(500).json({ error: 'Ошибка' });
  }
});

// ── VENUES CRUD ──────────────────────────────────────
router.get('/venues', async (req, res) => {
  try {
    const isAdmin = req.userRole === 'admin';
    const sql = isAdmin
      ? 'SELECT * FROM venues ORDER BY created_at DESC'
      : 'SELECT * FROM venues WHERE owner_id=$1 ORDER BY created_at DESC';
    const params = isAdmin ? [] : [req.userId];
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

router.post('/venues', async (req, res) => {
  try {
    const { name, category, location, description, image_url, price_range, latitude, longitude, amenities, open_time, close_time, phone } = req.body;
    const ownerId = req.userRole === 'owner' ? req.userId : (req.body.owner_id || req.userId);
    const { rows } = await pool.query(
      `INSERT INTO venues (owner_id, name, category, location, description, image_url, price_range, latitude, longitude, amenities, open_time, close_time, phone)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [ownerId, name, category, location, description, image_url, price_range, latitude||0, longitude||0, amenities||[], open_time||'10:00', close_time||'02:00', phone]
    );
    await notifyAll('venue', 'Новое заведение!', `${name} теперь в BookMate!`);
    broadcast('venue_created', rows[0]);
    res.status(201).json(rows[0]);
  } catch (e) { logger.error('Create venue error', { error: e.message }); res.status(500).json({ error: 'Ошибка' }); }
});

router.put('/venues/:id', async (req, res) => {
  try {
    // Owner check
    if (req.userRole === 'owner') {
      const v = await pool.query('SELECT owner_id FROM venues WHERE id=$1', [req.params.id]);
      if (!v.rows.length || v.rows[0].owner_id !== req.userId) return res.status(403).json({ error: 'Нет доступа' });
    }
    const { name, category, location, description, image_url, price_range, latitude, longitude, amenities, open_time, close_time, phone, is_active } = req.body;
    const { rows } = await pool.query(
      `UPDATE venues SET name=COALESCE($1,name), category=COALESCE($2,category), location=COALESCE($3,location),
       description=COALESCE($4,description), image_url=COALESCE($5,image_url), price_range=COALESCE($6,price_range),
       latitude=COALESCE($7,latitude), longitude=COALESCE($8,longitude), amenities=COALESCE($9,amenities),
       open_time=COALESCE($10,open_time), close_time=COALESCE($11,close_time), phone=COALESCE($12,phone), is_active=COALESCE($13,is_active)
       WHERE id=$14 RETURNING *`,
      [name, category, location, description, image_url, price_range, latitude, longitude, amenities, open_time, close_time, phone, is_active, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Не найдено' });
    broadcast('venue_updated', rows[0]);
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

router.delete('/venues/:id', async (req, res) => {
  try {
    if (req.userRole === 'owner') {
      const v = await pool.query('SELECT owner_id FROM venues WHERE id=$1', [req.params.id]);
      if (!v.rows.length || v.rows[0].owner_id !== req.userId) return res.status(403).json({ error: 'Нет доступа' });
    }
    await pool.query('DELETE FROM venues WHERE id=$1', [req.params.id]);
    broadcast('venue_deleted', { id: req.params.id });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

// ── GENERIC CRUD for venue-linked tables ─────────────
function venueCRUD(table, fields) {
  const r = Router();

  r.get('/', async (req, res) => {
    try {
      const { venue_id } = req.query;
      let sql = `SELECT t.*, v.name AS venue_name FROM ${table} t JOIN venues v ON v.id=t.venue_id WHERE 1=1`;
      const p = [];
      if (req.userRole === 'owner') { p.push(req.userId); sql += ` AND v.owner_id=$${p.length}`; }
      if (venue_id) { p.push(venue_id); sql += ` AND t.venue_id=$${p.length}`; }
      sql += ' ORDER BY t.created_at DESC';
      const { rows } = await pool.query(sql, p);
      res.json(rows);
    } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
  });

  r.post('/', async (req, res) => {
    try {
      // Verify owner has access to this venue
      if (req.userRole === 'owner' && req.body.venue_id) {
        const v = await pool.query('SELECT owner_id FROM venues WHERE id=$1', [req.body.venue_id]);
        if (!v.rows.length || v.rows[0].owner_id !== req.userId) return res.status(403).json({ error: 'Нет доступа' });
      }
      const cols = ['venue_id', ...fields];
      const vals = cols.map(c => req.body[c] ?? null);
      const placeholders = cols.map((_, i) => `$${i + 1}`);
      const { rows } = await pool.query(
        `INSERT INTO ${table} (${cols.join(',')}) VALUES (${placeholders.join(',')}) RETURNING *`, vals
      );
      broadcast(`${table}_created`, rows[0]);
      res.status(201).json(rows[0]);
    } catch (e) { logger.error(`Create ${table} error`, { error: e.message }); res.status(500).json({ error: 'Ошибка' }); }
  });

  r.put('/:id', async (req, res) => {
    try {
      if (req.userRole === 'owner') {
        const check = await pool.query(`SELECT t.venue_id, v.owner_id FROM ${table} t JOIN venues v ON v.id=t.venue_id WHERE t.id=$1`, [req.params.id]);
        if (!check.rows.length || check.rows[0].owner_id !== req.userId) return res.status(403).json({ error: 'Нет доступа' });
      }
      const sets = fields.map((f, i) => `${f}=COALESCE($${i + 1},${f})`);
      const vals = fields.map(f => req.body[f] ?? null);
      vals.push(req.params.id);
      const { rows } = await pool.query(
        `UPDATE ${table} SET ${sets.join(',')} WHERE id=$${vals.length} RETURNING *`, vals
      );
      if (!rows.length) return res.status(404).json({ error: 'Не найдено' });
      broadcast(`${table}_updated`, rows[0]);
      res.json(rows[0]);
    } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
  });

  r.delete('/:id', async (req, res) => {
    try {
      if (req.userRole === 'owner') {
        const check = await pool.query(`SELECT t.venue_id, v.owner_id FROM ${table} t JOIN venues v ON v.id=t.venue_id WHERE t.id=$1`, [req.params.id]);
        if (!check.rows.length || check.rows[0].owner_id !== req.userId) return res.status(403).json({ error: 'Нет доступа' });
      }
      await pool.query(`DELETE FROM ${table} WHERE id=$1`, [req.params.id]);
      broadcast(`${table}_deleted`, { id: req.params.id });
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
  });

  return r;
}

router.use('/services', venueCRUD('services', ['name', 'description', 'price', 'duration', 'is_active']));
router.use('/masters', venueCRUD('masters', ['name', 'role', 'bio', 'avatar_url', 'phone', 'is_active']));

// ── PROMOTIONS (with notifications to favorites) ─────
router.get('/promotions', async (req, res) => {
  try {
    let sql = 'SELECT p.*, v.name AS venue_name FROM promotions p JOIN venues v ON v.id=p.venue_id WHERE 1=1';
    const p = [];
    if (req.userRole === 'owner') { p.push(req.userId); sql += ` AND v.owner_id=$${p.length}`; }
    if (req.query.venue_id) { p.push(req.query.venue_id); sql += ` AND p.venue_id=$${p.length}`; }
    sql += ' ORDER BY p.created_at DESC';
    const { rows } = await pool.query(sql, p);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

router.post('/promotions', async (req, res) => {
  try {
    const { venue_id, title, description, discount, start_date, end_date } = req.body;
    if (req.userRole === 'owner') {
      const v = await pool.query('SELECT owner_id FROM venues WHERE id=$1', [venue_id]);
      if (!v.rows.length || v.rows[0].owner_id !== req.userId) return res.status(403).json({ error: 'Нет доступа' });
    }
    const { rows } = await pool.query(
      `INSERT INTO promotions (venue_id, title, description, discount, start_date, end_date)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [venue_id, title, description, discount || 0, start_date, end_date]
    );
    // Notify only users who favorited this venue
    await notifyFavorites(venue_id, 'offer', title, `${description || ''} — скидка ${discount}%!`);
    broadcast('promotion_created', rows[0]);
    res.status(201).json(rows[0]);
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

router.put('/promotions/:id', async (req, res) => {
  try {
    if (req.userRole === 'owner') {
      const check = await pool.query('SELECT p.venue_id, v.owner_id FROM promotions p JOIN venues v ON v.id=p.venue_id WHERE p.id=$1', [req.params.id]);
      if (!check.rows.length || check.rows[0].owner_id !== req.userId) return res.status(403).json({ error: 'Нет доступа' });
    }
    const { title, description, discount, start_date, end_date, is_active } = req.body;
    const { rows } = await pool.query(
      `UPDATE promotions SET title=COALESCE($1,title), description=COALESCE($2,description), discount=COALESCE($3,discount),
       start_date=COALESCE($4,start_date), end_date=COALESCE($5,end_date), is_active=COALESCE($6,is_active)
       WHERE id=$7 RETURNING *`,
      [title, description, discount, start_date, end_date, is_active, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Не найдено' });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

router.delete('/promotions/:id', async (req, res) => {
  try {
    if (req.userRole === 'owner') {
      const check = await pool.query('SELECT p.venue_id, v.owner_id FROM promotions p JOIN venues v ON v.id=p.venue_id WHERE p.id=$1', [req.params.id]);
      if (!check.rows.length || check.rows[0].owner_id !== req.userId) return res.status(403).json({ error: 'Нет доступа' });
    }
    await pool.query('DELETE FROM promotions WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

// ── PHOTOS ───────────────────────────────────────────
router.get('/photos', async (req, res) => {
  try {
    let sql = 'SELECT p.*, v.name AS venue_name FROM venue_photos p JOIN venues v ON v.id=p.venue_id WHERE 1=1';
    const params = [];
    if (req.userRole === 'owner') { params.push(req.userId); sql += ` AND v.owner_id=$${params.length}`; }
    if (req.query.venue_id) { params.push(req.query.venue_id); sql += ` AND p.venue_id=$${params.length}`; }
    sql += ' ORDER BY p.created_at DESC';
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

router.delete('/photos/:id', async (req, res) => {
  try {
    if (req.userRole === 'owner') {
      const check = await pool.query('SELECT p.venue_id, v.owner_id FROM venue_photos p JOIN venues v ON v.id=p.venue_id WHERE p.id=$1', [req.params.id]);
      if (!check.rows.length || check.rows[0].owner_id !== req.userId) return res.status(403).json({ error: 'Нет доступа' });
    }
    await pool.query('DELETE FROM venue_photos WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

// ── BOOKINGS MGMT ────────────────────────────────────
router.get('/bookings', async (req, res) => {
  try {
    let sql = `SELECT b.*, v.name AS venue_name, u.name AS user_name, u.email AS user_email
       FROM bookings b JOIN venues v ON v.id=b.venue_id JOIN users u ON u.id=b.user_id WHERE 1=1`;
    const p = [];
    if (req.userRole === 'owner') { p.push(req.userId); sql += ` AND v.owner_id=$${p.length}`; }
    if (req.query.status) { p.push(req.query.status); sql += ` AND b.status=$${p.length}`; }
    if (req.query.venue_id) { p.push(req.query.venue_id); sql += ` AND b.venue_id=$${p.length}`; }
    sql += ' ORDER BY b.created_at DESC';
    const { rows } = await pool.query(sql, p);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

router.patch('/bookings/:id', async (req, res) => {
  try {
    const { status } = req.body;
    const { rows } = await pool.query('UPDATE bookings SET status=$1 WHERE id=$2 RETURNING *', [status, req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Не найдено' });
    broadcast('booking_updated', rows[0]);
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

// ── REVIEWS MGMT ─────────────────────────────────────
router.get('/reviews', async (req, res) => {
  try {
    let sql = `SELECT r.*, v.name AS venue_name, u.name AS user_name FROM reviews r JOIN venues v ON v.id=r.venue_id JOIN users u ON u.id=r.user_id WHERE 1=1`;
    const p = [];
    if (req.userRole === 'owner') { p.push(req.userId); sql += ` AND v.owner_id=$${p.length}`; }
    sql += ' ORDER BY r.created_at DESC';
    const { rows } = await pool.query(sql, p);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

router.delete('/reviews/:id', async (req, res) => {
  try {
    const review = await pool.query('SELECT venue_id FROM reviews WHERE id=$1', [req.params.id]);
    await pool.query('DELETE FROM reviews WHERE id=$1', [req.params.id]);
    if (review.rows[0]) {
      const vid = review.rows[0].venue_id;
      await pool.query(
        `UPDATE venues SET rating=COALESCE((SELECT ROUND(AVG(rating)::numeric,1) FROM reviews WHERE venue_id=$1),0),
         review_count=(SELECT COUNT(*) FROM reviews WHERE venue_id=$1) WHERE id=$1`, [vid]
      );
    }
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

// ── USERS (admin only) ──────────────────────────────
router.get('/users', async (req, res) => {
  if (req.userRole !== 'admin') return res.status(403).json({ error: 'Только для admin' });
  try {
    const { rows } = await pool.query('SELECT id, email, name, avatar_url, phone, role, created_at FROM users ORDER BY created_at DESC');
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

router.patch('/users/:id/role', async (req, res) => {
  if (req.userRole !== 'admin') return res.status(403).json({ error: 'Только для admin' });
  try {
    const { role } = req.body;
    if (!['user', 'admin', 'owner'].includes(role)) return res.status(400).json({ error: 'Роль: user, admin, owner' });
    const { rows } = await pool.query('UPDATE users SET role=$1 WHERE id=$2 RETURNING id, email, name, role', [role, req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Не найдено' });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

// ── NOTIFY ──────────────────────────────────────────
router.post('/notify-all', async (req, res) => {
  try {
    const { type, title, message } = req.body;
    const sent = await notifyAll(type || 'offer', title, message);
    res.json({ sent });
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

module.exports = router;
