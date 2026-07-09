const fs = require('fs');
const path = require('path');

const storePath = path.join(__dirname, '..', 'data', 'notifications.json');

function ensureStore() {
  const directory = path.dirname(storePath);
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, { recursive: true });
  }

  if (!fs.existsSync(storePath)) {
    fs.writeFileSync(storePath, '[]', 'utf8');
  }
}

function readNotifications() {
  try {
    ensureStore();
    const raw = fs.readFileSync(storePath, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

function writeNotifications(notifications) {
  ensureStore();
  fs.writeFileSync(storePath, JSON.stringify(notifications, null, 2), 'utf8');
}

function createNotification({ userId, role, bookingId = null, type, title, message }) {
  if (!userId || !type || !title || !message) {
    return null;
  }

  const notifications = readNotifications();
  const notification = {
    id: `${Date.now()}-${Math.round(Math.random() * 1e9)}`,
    userId: String(userId),
    role: role || null,
    bookingId: bookingId === null || bookingId === undefined ? null : String(bookingId),
    type,
    title,
    message,
    isRead: false,
    createdAt: new Date().toISOString()
  };

  notifications.push(notification);
  writeNotifications(notifications);
  return notification;
}

function createNotifications(userIds, payload) {
  if (!Array.isArray(userIds)) {
    return [];
  }

  return userIds
    .filter(Boolean)
    .map(userId => createNotification({ userId, ...payload }))
    .filter(Boolean);
}

function getNotificationsForUser(userId, limit = 10) {
  if (!userId) {
    return [];
  }

  return readNotifications()
    .filter(notification => String(notification.userId) === String(userId))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, limit);
}

function getUnreadCount(userId) {
  if (!userId) {
    return 0;
  }

  return readNotifications().filter(notification => String(notification.userId) === String(userId) && !notification.isRead).length;
}

function markAllNotificationsRead(userId) {
  if (!userId) {
    return 0;
  }

  const notifications = readNotifications();
  let updatedCount = 0;

  const updated = notifications.map(notification => {
    if (String(notification.userId) === String(userId) && !notification.isRead) {
      updatedCount += 1;
      return { ...notification, isRead: true };
    }

    return notification;
  });

  writeNotifications(updated);
  return updatedCount;
}

function markNotificationRead(notificationId, userId) {
  if (!notificationId || !userId) {
    return false;
  }

  const notifications = readNotifications();
  let updated = false;

  const nextNotifications = notifications.map(notification => {
    if (notification.id === notificationId && String(notification.userId) === String(userId)) {
      updated = true;
      return { ...notification, isRead: true };
    }

    return notification;
  });

  if (updated) {
    writeNotifications(nextNotifications);
  }

  return updated;
}

module.exports = {
  createNotification,
  createNotifications,
  getNotificationsForUser,
  getUnreadCount,
  markAllNotificationsRead,
  markNotificationRead,
};
