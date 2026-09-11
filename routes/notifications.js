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

router.get('/', async (req, res, next) => {
  const userId = req.user.idusers;
  try {
    const [notifications, unreadCount] = await Promise.all([
      getNotificationsForUser(userId, 100),
      getUnreadCount(userId),
    ]);
    res.render('notifications', { title: 'Notifications', notifications, unreadCount });
  } catch (error) {
    next(error);
  }
});

router.get('/stream', (req, res) => {
  res.set({
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'Content-Type': 'text/event-stream',
  });
  res.flushHeaders();

  let closed = false;
  const sendCount = async () => {
    try {
      const unreadCount = await getUnreadCount(req.user.idusers);
      if (!closed) res.write(`event: unread\ndata: ${JSON.stringify({ unreadCount })}\n\n`);
    } catch (_error) {
      if (!closed)
        res.write(
          `event: error\ndata: ${JSON.stringify({ message: 'Temporarily unavailable' })}\n\n`,
        );
    }
  };

  sendCount();
  const timer = setInterval(sendCount, 15000);
  req.on('close', () => {
    closed = true;
    clearInterval(timer);
  });
});

router.post('/mark-all-read', async (req, res, next) => {
  try {
    const updatedCount = await markAllNotificationsRead(req.user.idusers);
    res.json({ success: true, updatedCount });
  } catch (error) {
    next(error);
  }
});

router.post('/:id/read', async (req, res, next) => {
  try {
    const updated = await markNotificationRead(req.params.id, req.user.idusers);
    res.json({ success: updated });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
