const crypto = require('crypto');
const connection = require('../database/connection');

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function createAccountToken(userId, purpose, lifetimeMinutes) {
  const token = crypto.randomBytes(32).toString('hex');
  await connection
    .promise()
    .query(
      'UPDATE account_tokens SET used_at = NOW() WHERE user_id = ? AND purpose = ? AND used_at IS NULL',
      [userId, purpose],
    );
  await connection
    .promise()
    .query(
      'INSERT INTO account_tokens (user_id, purpose, token_hash, expires_at) VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL ? MINUTE))',
      [userId, purpose, hashToken(token), lifetimeMinutes],
    );
  return token;
}

module.exports = { hashToken, createAccountToken };
