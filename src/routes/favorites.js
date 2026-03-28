const { Router } = require('express');
const pool = require('../db/pool');
const auth = require('../middleware/auth');

const router = Router();

router.get('/', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT v.* FROM favorites f JOIN venues v ON v.id=f.venue_id WHERE f.user_id=$1', [req.userId]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

router.post('/toggle', auth, async (req, res) => {
  try {
    const { venue_id } = req.body;
    if (!venue_id) return res.status(400).json({ error: 'venue_id обязателен' });

    const ex = await pool.query('SELECT id FROM favorites WHERE user_id=$1 AND venue_id=$2', [req.userId, venue_id]);
    if (ex.rows.length) {
      await pool.query('DELETE FROM favorites WHERE user_id=$1 AND venue_id=$2', [req.userId, venue_id]);
      return res.json({ favorited: false });
    }
    await pool.query('INSERT INTO favorites (user_id, venue_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [req.userId, venue_id]);
    res.json({ favorited: true });
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

router.get('/check/:venueId', auth, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT id FROM favorites WHERE user_id=$1 AND venue_id=$2', [req.userId, req.params.venueId]);
    res.json({ favorited: rows.length > 0 });
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

module.exports = router;
