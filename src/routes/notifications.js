const { Router } = require('express');
const pool = require('../db/pool');
const auth = require('../middleware/auth');

const router = Router();

router.get('/', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50', [req.userId]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

router.patch('/:id/read', auth, async (req, res) => {
  try {
    await pool.query('UPDATE notifications SET read=true WHERE id=$1 AND user_id=$2', [req.params.id, req.userId]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

router.patch('/read-all', auth, async (req, res) => {
  try {
    await pool.query('UPDATE notifications SET read=true WHERE user_id=$1', [req.userId]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

module.exports = router;
