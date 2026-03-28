const { Router } = require('express');
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const pool = require('../db/pool');
const auth = require('../middleware/auth');
const { broadcast } = require('../services/websocket');

const router = Router();

const storage = multer.diskStorage({
  destination: (_r, _f, cb) => cb(null, 'uploads/'),
  filename: (_r, file, cb) => cb(null, `${uuidv4()}${path.extname(file.originalname)}`),
});
const upload = multer({
  storage, limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_r, file, cb) => {
    const ok = /jpeg|jpg|png|webp/.test(path.extname(file.originalname).toLowerCase());
    cb(ok ? null : new Error('Only images'), ok);
  },
});

router.post('/venue/:venueId', auth, upload.single('photo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Файл не загружен' });
    const url = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
    const { rows } = await pool.query(
      'INSERT INTO venue_photos (venue_id, user_id, url) VALUES ($1,$2,$3) RETURNING *',
      [req.params.venueId, req.userId, url]
    );
    broadcast('photo_added', { venue_id: req.params.venueId });
    res.status(201).json(rows[0]);
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

// Upload main venue image (sets venue.image_url)
router.post('/venue-main/:venueId', auth, upload.single('photo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Файл не загружен' });
    const url = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
    const { rows } = await pool.query(
      'UPDATE venues SET image_url=$1 WHERE id=$2 RETURNING *',
      [url, req.params.venueId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Заведение не найдено' });
    broadcast('venue_updated', rows[0]);
    res.json({ image_url: url, venue: rows[0] });
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

router.post('/avatar', auth, upload.single('avatar'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Файл не загружен' });
    const url = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
    await pool.query('UPDATE users SET avatar_url=$1 WHERE id=$2', [url, req.userId]);
    res.json({ avatar_url: url });
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

module.exports = router;