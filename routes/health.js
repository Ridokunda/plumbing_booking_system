const express = require('express');
const database = require('../database/connection');

const router = express.Router();

router.get('/live', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ status: 'ok' });
});

router.get('/ready', async (_req, res) => {
  try {
    await database.promise().query('SELECT 1');
    res.set('Cache-Control', 'no-store');
    return res.json({ status: 'ok', database: 'ready' });
  } catch (_error) {
    return res.status(503).json({ status: 'unavailable', database: 'unavailable' });
  }
});

module.exports = router;
