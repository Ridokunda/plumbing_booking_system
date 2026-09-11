const express = require('express');
const router = express.Router();
const connection = require('../database/connection');
const { verifyToken, isCustomer } = require('../middleware/auth');
const { createNotifications, createNotification } = require('../utils/notifications');
const { getBookingLifecycle } = require('../utils/bookingLifecycle');
const {
  cleanText,
  normalizeBookingDates,
  isValidService,
  canTransition,
  normalizePagination,
} = require('../utils/validation');
const { recordAuditEvent } = require('../utils/audit');

router.use(verifyToken);
router.use(isCustomer);

router.get('/', (req, res) => res.render('booking', { title: 'Book Us' }));

router.post('/book', async (req, res, next) => {
  const service = req.body.service;
  const description = cleanText(req.body.description, { min: 10, max: 2000 });
  const location = cleanText(req.body.location, { min: 3, max: 500 });
  const dates = normalizeBookingDates(req.body.date_start);
  if (!isValidService(service) || !description || !location || !dates) {
    return res.status(400).json({
      success: false,
      message:
        'Provide a valid service, location, future dates, and a description of 10-2000 characters.',
    });
  }

  let db;
  try {
    db = await connection.promise().getConnection();
    await db.beginTransaction();
    const [result] = await db.query(
      "INSERT INTO bookings (idUser, type, description, location, status, date_start) VALUES (?, ?, ?, ?, 'NEW', ?)",
      [req.user.idusers, service, description, location, dates[0]],
    );
    const bookingId = result.insertId;
    await db.query('INSERT INTO booking_dates (booking_id, date_start) VALUES ?', [
      dates.map((date) => [bookingId, date]),
    ]);
    await db.query(
      'INSERT INTO booking_status_history (booking_id, from_status, to_status, changed_by, note) VALUES (?, NULL, ?, ?, ?)',
      [bookingId, 'NEW', req.user.idusers, 'Booking requested by customer'],
    );
    await db.commit();
    recordAuditEvent({
      actorId: req.user.idusers,
      action: 'BOOKING_CREATED',
      entityType: 'booking',
      entityId: bookingId,
      metadata: { service, location, dates },
      ipAddress: req.ip,
    });

    const [admins] = await connection
      .promise()
      .query("SELECT idusers FROM users WHERE usertype = 2 AND account_status = 'ACTIVE'");
    createNotification({
      userId: req.user.idusers,
      bookingId,
      type: 'booking_created',
      title: 'Booking submitted',
      message: 'Your service request is awaiting review.',
    });
    createNotifications(
      admins.map((admin) => admin.idusers),
      {
        bookingId,
        type: 'booking_created',
        title: 'New booking to review',
        message: 'A new service request needs scheduling.',
      },
    );
    res.status(201).json({ success: true, bookingId, message: 'Booking added successfully!' });
  } catch (error) {
    if (db) await db.rollback();
    next(error);
  } finally {
    if (db) db.release();
  }
});

router.get('/mybookings', async (req, res, next) => {
  const { page, pageSize, offset } = normalizePagination(req.query);
  try {
    const [[rows], [countRows]] = await Promise.all([
      connection.promise().query(
        `SELECT b.*, GROUP_CONCAT(d.date_start ORDER BY d.date_start SEPARATOR ',') AS dates,
          MIN(d.date_start) AS first_date
         FROM bookings b LEFT JOIN booking_dates d ON d.booking_id = b.idbookings
         WHERE b.idUser = ? GROUP BY b.idbookings ORDER BY b.created_at DESC LIMIT ? OFFSET ?`,
        [req.user.idusers, pageSize, offset],
      ),
      connection
        .promise()
        .query('SELECT COUNT(*) AS total FROM bookings WHERE idUser = ?', [req.user.idusers]),
    ]);
    const bookings = rows.map((row) => ({
      ...row,
      datesArray: row.dates ? row.dates.split(',') : [row.date_start].filter(Boolean),
      date_start: row.first_date || row.date_start,
      lifecycle: getBookingLifecycle('customer', row.status),
    }));
    res.render('mybookings', {
      bookings,
      title: 'My Bookings',
      pagination: {
        page,
        pageSize,
        total: countRows[0].total,
        pages: Math.ceil(countRows[0].total / pageSize),
      },
    });
  } catch (error) {
    next(error);
  }
});

router.post('/cancel-booking', async (req, res, next) => {
  const bookingId = Number(req.body.booking_id);
  const reason = cleanText(req.body.reason, { min: 5, max: 500 });
  if (!Number.isInteger(bookingId) || !reason) {
    return res
      .status(400)
      .json({ success: false, message: 'Provide a brief cancellation reason.' });
  }
  let db;
  try {
    db = await connection.promise().getConnection();
    await db.beginTransaction();
    const [rows] = await db.query(
      'SELECT status FROM bookings WHERE idbookings = ? AND idUser = ? FOR UPDATE',
      [bookingId, req.user.idusers],
    );
    if (!rows.length) {
      await db.rollback();
      return res.status(404).json({ success: false, message: 'Booking not found.' });
    }
    if (!canTransition('customer', rows[0].status, 'CANCELLED')) {
      await db.rollback();
      return res
        .status(409)
        .json({ success: false, message: `A ${rows[0].status} booking cannot be cancelled.` });
    }
    await db.query(
      "UPDATE bookings SET status = 'CANCELLED', cancellation_reason = ? WHERE idbookings = ?",
      [reason, bookingId],
    );
    await db.query(
      'INSERT INTO booking_status_history (booking_id, from_status, to_status, changed_by, note) VALUES (?, ?, ?, ?, ?)',
      [bookingId, rows[0].status, 'CANCELLED', req.user.idusers, reason],
    );
    await db.commit();
    recordAuditEvent({
      actorId: req.user.idusers,
      action: 'BOOKING_CANCELLED',
      entityType: 'booking',
      entityId: bookingId,
      metadata: { reason },
      ipAddress: req.ip,
    });
    createNotification({
      userId: req.user.idusers,
      bookingId,
      type: 'booking_cancelled',
      title: 'Booking cancelled',
      message: 'Your booking has been cancelled.',
    });
    res.json({ success: true, message: 'Booking cancelled successfully.' });
  } catch (error) {
    if (db) await db.rollback();
    next(error);
  } finally {
    if (db) db.release();
  }
});

router.post('/edit-booking', async (req, res, next) => {
  const bookingId = Number(req.body.booking_id);
  const service = req.body.service;
  const description = cleanText(req.body.description, { min: 10, max: 2000 });
  const dates = normalizeBookingDates(req.body.date_start);
  if (!Number.isInteger(bookingId) || !isValidService(service) || !description || !dates) {
    return res
      .status(400)
      .json({ success: false, message: 'Provide a valid booking details and future dates.' });
  }

  let db;
  try {
    db = await connection.promise().getConnection();
    await db.beginTransaction();
    const [result] = await db.query(
      `UPDATE bookings SET type = ?, description = ?, date_start = ?
      WHERE idbookings = ? AND idUser = ? AND status IN ('NEW','PENDING')`,
      [service, description, dates[0], bookingId, req.user.idusers],
    );
    if (!result.affectedRows) {
      await db.rollback();
      return res
        .status(409)
        .json({ success: false, message: 'Only a new booking owned by you can be edited.' });
    }
    await db.query('DELETE FROM booking_dates WHERE booking_id = ?', [bookingId]);
    await db.query('INSERT INTO booking_dates (booking_id, date_start) VALUES ?', [
      dates.map((date) => [bookingId, date]),
    ]);
    await db.commit();
    createNotification({
      userId: req.user.idusers,
      bookingId,
      type: 'booking_updated',
      title: 'Booking updated',
      message: 'Your booking details were updated.',
    });
    res.json({ success: true, message: 'Booking updated successfully.' });
  } catch (error) {
    if (db) await db.rollback();
    next(error);
  } finally {
    if (db) db.release();
  }
});

module.exports = router;
