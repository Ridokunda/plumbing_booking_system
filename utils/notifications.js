const connection = require('../database/connection');
const { sendEmail } = require('./mailer');

function escapeHtml(value) {
  return String(value).replace(
    /[&<>"]/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
      })[character],
  );
}

function normalize(row) {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    bookingId: row.booking_id === null ? null : String(row.booking_id),
    type: row.type,
    title: row.title,
    message: row.message,
    isRead: Boolean(row.read_at),
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  };
}

async function createNotification({ userId, bookingId = null, type, title, message }) {
  if (!userId || !type || !title || !message) return null;
  try {
    const [result] = await connection
      .promise()
      .query(
        'INSERT INTO notifications (user_id, booking_id, type, title, message) VALUES (?, ?, ?, ?, ?)',
        [userId, bookingId, type, title, message],
      );
    if (process.env.EMAIL_NOTIFICATIONS === 'true') {
      const [[user]] = await connection
        .promise()
        .query('SELECT email, name FROM users WHERE idusers = ? AND account_status = ?', [
          userId,
          'ACTIVE',
        ]);
      if (user) {
        await sendEmail({
          to: user.email,
          subject: title,
          html: `<p>Hello ${escapeHtml(user.name)},</p><p>${escapeHtml(message)}</p>`,
        });
      }
    }
    return {
      id: String(result.insertId),
      userId: String(userId),
      bookingId,
      type,
      title,
      message,
      isRead: false,
      createdAt: new Date().toISOString(),
    };
  } catch (error) {
    console.error('Unable to create notification', error.message);
    return null;
  }
}

async function createNotifications(userIds, payload) {
  if (!Array.isArray(userIds)) return [];
  return Promise.all(
    userIds.filter(Boolean).map((userId) => createNotification({ userId, ...payload })),
  );
}

async function getNotificationsForUser(userId, limit = 10) {
  if (!userId) return [];
  const safeLimit = Math.min(Math.max(Number(limit) || 10, 1), 100);
  const [rows] = await connection.promise().query(
    `SELECT id, user_id, booking_id, type, title, message, read_at, created_at
     FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
    [userId, safeLimit],
  );
  return rows.map(normalize);
}

async function getUnreadCount(userId) {
  if (!userId) return 0;
  const [rows] = await connection
    .promise()
    .query(
      'SELECT COUNT(*) AS unreadCount FROM notifications WHERE user_id = ? AND read_at IS NULL',
      [userId],
    );
  return Number(rows[0].unreadCount);
}

async function markAllNotificationsRead(userId) {
  const [result] = await connection
    .promise()
    .query(
      'UPDATE notifications SET read_at = COALESCE(read_at, NOW()) WHERE user_id = ? AND read_at IS NULL',
      [userId],
    );
  return result.affectedRows;
}

async function markNotificationRead(notificationId, userId) {
  const [result] = await connection
    .promise()
    .query(
      'UPDATE notifications SET read_at = COALESCE(read_at, NOW()) WHERE id = ? AND user_id = ?',
      [notificationId, userId],
    );
  return result.affectedRows > 0;
}

module.exports = {
  createNotification,
  createNotifications,
  getNotificationsForUser,
  getUnreadCount,
  markAllNotificationsRead,
  markNotificationRead,
};
