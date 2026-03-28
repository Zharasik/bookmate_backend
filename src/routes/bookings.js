const { Router } = require('express');
const pool = require('../db/pool');
const auth = require('../middleware/auth');
const { notifyUser } = require('../services/notifications');
const { broadcast } = require('../services/websocket');
const { requireFields } = require('../utils/validate');

const router = Router();

router.get('/', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT b.*, v.name AS venue_name, v.image_url AS venue_image, v.location AS venue_location
       FROM bookings b JOIN venues v ON v.id=b.venue_id
       WHERE b.user_id=$1 ORDER BY b.date DESC, b.time DESC`, [req.userId]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

// Get booked slots for a venue on a date (public — so users see what's taken)
router.get('/slots/:venueId/:date', async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT time FROM bookings WHERE venue_id=$1 AND date=$2 AND status='upcoming'",
      [req.params.venueId, req.params.date]
    );
    res.json(rows.map(r => r.time));
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

router.post('/', auth, async (req, res) => {
  try {
    const err = requireFields(req.body, ['venue_id', 'date', 'time']);
    if (err) return res.status(400).json({ error: err });
    const { venue_id, date, time, guests } = req.body;

    // Check slot availability
    const conflict = await pool.query(
      "SELECT id FROM bookings WHERE venue_id=$1 AND date=$2 AND time=$3 AND status='upcoming'",
      [venue_id, date, time]
    );
    if (conflict.rows.length) {
      return res.status(409).json({ error: 'Это время уже занято. Выберите другое.' });
    }

    const { rows } = await pool.query(
      'INSERT INTO bookings (user_id, venue_id, date, time, guests) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [req.userId, venue_id, date, time, guests || 1]
    );

    const venue = await pool.query('SELECT name FROM venues WHERE id=$1', [venue_id]);
    const vName = venue.rows[0]?.name || 'Заведение';
    await notifyUser(req.userId, 'booking', 'Бронь подтверждена', `${vName} на ${date} в ${time}.`);
    broadcast('booking_created', { venue_id, date, time });

    res.status(201).json(rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Это время уже занято' });
    res.status(500).json({ error: 'Ошибка' });
  }
});

router.patch('/:id/cancel', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "UPDATE bookings SET status='cancelled' WHERE id=$1 AND user_id=$2 AND status='upcoming' RETURNING *",
      [req.params.id, req.userId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Бронь не найдена' });
    broadcast('booking_cancelled', { id: req.params.id, venue_id: rows[0].venue_id });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

module.exports = router;
