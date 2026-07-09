const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth');
const {
  getNotificationsForUser,
  getUnreadCount,
  markAllNotificationsRead,
  markNotificationRead,
} = require('../utils/notifications');

router.use(verifyToken);

router.get('/', (req, res) => {
  const userId = req.user.idusers;
  const notifications = getNotificationsForUser(userId, 100);
  const unreadCount = getUnreadCount(userId);

  res.render('notifications', {
    title: 'Notifications',
    notifications,
    unreadCount,
  });
});

router.post('/mark-all-read', (req, res) => {
  const updatedCount = markAllNotificationsRead(req.user.idusers);
  res.json({ success: true, updatedCount });
});

router.post('/:id/read', (req, res) => {
  const updated = markNotificationRead(req.params.id, req.user.idusers);
  res.json({ success: updated });
});

module.exports = router;
