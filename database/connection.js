require('dotenv').config();
const mysql = require('mysql2');

const required = ['DB_HOST', 'DB_NAME', 'DB_USER'];
const missing = required.filter((name) => !process.env[name]);
if (missing.length > 0) {
  throw new Error(`Missing required database configuration: ${missing.join(', ')}`);
}

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  port: Number(process.env.DB_PORT) || 3306,
  waitForConnections: true,
  connectionLimit: Number(process.env.DB_POOL_SIZE) || 10,
  queueLimit: 0,
  decimalNumbers: true,
  timezone: 'Z',
});

module.exports = pool;
