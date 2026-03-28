const { Router } = require('express');
const pool = require('../db/pool');
const auth = require('../middleware/auth');
const { broadcast } = require('../services/websocket');
const { requireFields } = require('../utils/validate');

const router = Router();

router.get('/venue/:venueId', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT r.*, u.name AS user_name, u.avatar_url AS user_avatar
       FROM reviews r JOIN users u ON u.id=r.user_id
       WHERE r.venue_id=$1 ORDER BY r.created_at DESC`, [req.params.venueId]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

router.post('/', auth, async (req, res) => {
  try {
    const err = requireFields(req.body, ['venue_id', 'rating']);
    if (err) return res.status(400).json({ error: err });
    const { venue_id, rating, comment } = req.body;
    if (rating < 1 || rating > 5) return res.status(400).json({ error: 'Рейтинг от 1 до 5' });

    // One review per user per venue (upsert)
    const { rows } = await pool.query(
      `INSERT INTO reviews (user_id, venue_id, rating, comment) VALUES ($1,$2,$3,$4)
       ON CONFLICT (user_id, venue_id) DO UPDATE SET rating=$3, comment=$4, created_at=now()
       RETURNING *`,
      [req.userId, venue_id, rating, comment || '']
    );

    // Recalc real rating
    await pool.query(
      `UPDATE venues SET
         rating = COALESCE((SELECT ROUND(AVG(rating)::numeric,1) FROM reviews WHERE venue_id=$1), 0),
         review_count = (SELECT COUNT(*) FROM reviews WHERE venue_id=$1)
       WHERE id=$1`, [venue_id]
    );

    broadcast('review_added', { venue_id });
    res.status(201).json(rows[0]);
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

module.exports = router;
