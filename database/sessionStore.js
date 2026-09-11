const session = require('express-session');

class MySqlSessionStore extends session.Store {
  constructor(pool) {
    super();
    this.pool = pool;
  }

  get(sid, callback) {
    this.pool.query(
      'SELECT data FROM app_sessions WHERE session_id = ? AND expires_at > NOW()',
      [sid],
      (error, rows) => {
        if (error) return callback(error);
        if (!rows.length) return callback(null, null);
        try {
          callback(null, JSON.parse(rows[0].data));
        } catch (parseError) {
          callback(parseError);
        }
      },
    );
  }

  set(sid, value, callback = () => {}) {
    const maxAge = value.cookie?.maxAge || 24 * 60 * 60 * 1000;
    const expiresAt = new Date(Date.now() + maxAge);
    this.pool.query(
      `INSERT INTO app_sessions (session_id, data, expires_at) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE data = VALUES(data), expires_at = VALUES(expires_at)`,
      [sid, JSON.stringify(value), expiresAt],
      callback,
    );
  }

  destroy(sid, callback = () => {}) {
    this.pool.query('DELETE FROM app_sessions WHERE session_id = ?', [sid], callback);
  }

  touch(sid, value, callback = () => {}) {
    const maxAge = value.cookie?.maxAge || 24 * 60 * 60 * 1000;
    this.pool.query(
      'UPDATE app_sessions SET expires_at = ? WHERE session_id = ?',
      [new Date(Date.now() + maxAge), sid],
      callback,
    );
  }
}

module.exports = MySqlSessionStore;
