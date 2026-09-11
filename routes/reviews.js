const express = require('express');
const router = express.Router();
const connection = require('../database/connection');
const { verifyToken, isCustomer } = require('../middleware/auth');
const { cleanText } = require('../utils/validation');
const { createNotification } = require('../utils/notifications');
const { recordAuditEvent } = require('../utils/audit');

router.get('/plumber/:plumberId', async (req, res, next) => {
  try {
    const plumberId = Number(req.params.plumberId);
    const [plumbers] = await connection.promise().query(
      `SELECT u.idusers, u.name, u.surname, pp.service_area,
        ROUND(AVG(r.rating), 1) AS average_rating, COUNT(r.idreview) AS review_count
       FROM users u LEFT JOIN plumber_profiles pp ON pp.user_id = u.idusers
       LEFT JOIN reviews r ON r.plumber_id = u.idusers
       WHERE u.idusers = ? AND u.usertype = 3 AND u.account_status = 'ACTIVE'
         AND pp.verification_status = 'APPROVED'
       GROUP BY u.idusers, u.name, u.surname, pp.service_area`,
      [plumberId],
    );
    if (!plumbers.length) return res.status(404).send('Plumber not found');
    const [reviews] = await connection.promise().query(
      `SELECT r.rating, r.comment, r.created_at, u.name AS customer_name
       FROM reviews r JOIN users u ON u.idusers = r.customer_id
       WHERE r.plumber_id = ? ORDER BY r.created_at DESC LIMIT 100`,
      [plumberId],
    );
    res.render('plumber-reviews', { title: 'Plumber reviews', plumber: plumbers[0], reviews });
  } catch (error) {
    next(error);
  }
});

router.get('/booking/:bookingId', verifyToken, isCustomer, async (req, res, next) => {
  try {
    const [bookings] = await connection.promise().query(
      `SELECT b.idbookings, b.type, b.idPlumber, p.name AS plumber_name, p.surname AS plumber_surname,
        r.rating, r.comment FROM bookings b JOIN users p ON p.idusers = b.idPlumber
        LEFT JOIN reviews r ON r.booking_id = b.idbookings
        WHERE b.idbookings = ? AND b.idUser = ? AND b.status = 'PAID'`,
      [Number(req.params.bookingId), req.user.idusers],
    );
    if (!bookings.length)
      return res.status(404).send('A paid booking is required before leaving a review');
    res.render('review', { title: 'Review your service', booking: bookings[0] });
  } catch (error) {
    next(error);
  }
});

router.post('/booking/:bookingId', verifyToken, isCustomer, async (req, res, next) => {
  const rating = Number(req.body.rating);
  const comment = cleanText(req.body.comment, { min: 0, max: 1500 });
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return res.status(400).json({ message: 'Choose a rating from 1 to 5.' });
  }
  try {
    const [result] = await connection.promise().query(
      `INSERT INTO reviews (booking_id, customer_id, plumber_id, rating, comment)
       SELECT idbookings, idUser, idPlumber, ?, ? FROM bookings
       WHERE idbookings = ? AND idUser = ? AND idPlumber IS NOT NULL AND status = 'PAID'`,
      [rating, comment, Number(req.params.bookingId), req.user.idusers],
    );
    if (!result.affectedRows)
      return res.status(409).json({ message: 'This booking cannot be reviewed.' });
    const [[booking]] = await connection
      .promise()
      .query('SELECT idPlumber FROM bookings WHERE idbookings = ?', [Number(req.params.bookingId)]);
    createNotification({
      userId: booking.idPlumber,
      bookingId: Number(req.params.bookingId),
      type: 'review_received',
      title: 'New customer review',
      message: `A customer left a ${rating}-star review.`,
    });
    recordAuditEvent({
      actorId: req.user.idusers,
      action: 'REVIEW_CREATED',
      entityType: 'review',
      entityId: result.insertId,
      metadata: { bookingId: Number(req.params.bookingId), rating },
      ipAddress: req.ip,
    });
    res.status(201).json({ success: true, message: 'Thank you for your review.' });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY')
      return res.status(409).json({ message: 'This booking has already been reviewed.' });
    next(error);
  }
});

module.exports = router;
