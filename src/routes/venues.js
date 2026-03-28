const { Router } = require('express');
const pool = require('../db/pool');

const router = Router();

router.get('/', async (req, res) => {
  try {
    const { category, search } = req.query;
    let sql = 'SELECT * FROM venues WHERE is_active=true';
    const p = [];
    if (category && category !== 'All') { p.push(category); sql += ` AND category=$${p.length}`; }
    if (search) { p.push(`%${search}%`); sql += ` AND (name ILIKE $${p.length} OR category ILIKE $${p.length} OR location ILIKE $${p.length})`; }
    sql += ' ORDER BY rating DESC';
    const { rows } = await pool.query(sql, p);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

router.get('/meta/categories', async (_req, res) => {
  try {
    const { rows } = await pool.query('SELECT DISTINCT category FROM venues WHERE is_active=true ORDER BY category');
    res.json(['All', ...rows.map(r => r.category)]);
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM venues WHERE id=$1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Не найдено' });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

router.get('/:id/photos', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM venue_photos WHERE venue_id=$1 ORDER BY created_at DESC', [req.params.id]);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

module.exports = router;
