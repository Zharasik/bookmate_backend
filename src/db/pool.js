const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30000,
  // Neon / pooler: first connection after sleep can exceed default TCP timing
  connectionTimeoutMillis: 25_000,
});

pool.on('error', (err) => console.error('Pool error:', err));

module.exports = pool;
