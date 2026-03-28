const { Router } = require('express');
const pool = require('../db/pool');

const services = Router();
services.get('/venue/:venueId', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM services WHERE venue_id=$1 AND is_active=true ORDER BY price', [req.params.venueId]);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

const masters = Router();
masters.get('/venue/:venueId', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM masters WHERE venue_id=$1 AND is_active=true ORDER BY name', [req.params.venueId]);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

const promotions = Router();
promotions.get('/venue/:venueId', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM promotions WHERE venue_id=$1 AND is_active=true AND (end_date IS NULL OR end_date>=CURRENT_DATE) ORDER BY discount DESC`,
      [req.params.venueId]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});
promotions.get('/', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT p.*, v.name AS venue_name, v.image_url AS venue_image FROM promotions p JOIN venues v ON v.id=p.venue_id
       WHERE p.is_active=true AND (p.end_date IS NULL OR p.end_date>=CURRENT_DATE) ORDER BY p.discount DESC LIMIT 20`
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

module.exports = { services, masters, promotions };
