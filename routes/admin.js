var express = require('express');
var router = express.Router();
const connection = require('../database/connection');
const { verifyToken, isAdmin } = require('../middleware/auth');
const { createNotifications, createNotification } = require('../utils/notifications');
const { getBookingLifecycle } = require('../utils/bookingLifecycle');
const {
  cleanText,
  normalizeSchedule,
  normalizePagination,
  canTransition,
} = require('../utils/validation');
const { recordAuditEvent } = require('../utils/audit');

// Protect all administrator routes with the server-side session.
router.use(verifyToken);
router.use(isAdmin);

router.get('/', function (req, res) {
  res.render('admindashboard', { title: 'Admin Dashboard' });
});

router.get('/manageusers', function (req, res) {
  const customerQuery = 'SELECT COUNT(*) AS customerCount FROM users WHERE usertype = 1';
  const plumbersQuery = 'SELECT COUNT(*) AS plumberCount FROM users WHERE usertype = 3';

  connection.query(customerQuery, function (err, customerResult) {
    if (err) {
      console.error('error while querying customer count:', err);
      return res.status(500).send('Internal server error');
    }
    connection.query(plumbersQuery, function (err, plumberResult) {
      if (err) {
        console.error('error while querying plumber count:', err);
        return res.status(500).send('Internal server error');
      }
      res.render('manageusers', {
        title: 'Manage Users',
        customerCount: customerResult[0].customerCount,
        plumberCount: plumberResult[0].plumberCount,
      });
    });
  });
});

/* GET managecustomers page */
router.get('/managecustomers', async function (req, res, next) {
  const { page, pageSize, offset } = normalizePagination(req.query);
  const query = `SELECT u.idusers, u.name, u.surname, u.email, u.address, u.account_status,
      COUNT(b.idbookings) AS active_jobs FROM users u
      LEFT JOIN bookings b ON b.idUser = u.idusers AND b.status IN ('NEW','PENDING','ASSIGNED','IN_PROGRESS')
      WHERE u.usertype = 1 GROUP BY u.idusers, u.name, u.surname, u.email, u.address, u.account_status
      ORDER BY u.created_at DESC`;
  try {
    const [[results], [[count]]] = await Promise.all([
      connection.promise().query(`${query} LIMIT ? OFFSET ?`, [pageSize, offset]),
      connection.promise().query('SELECT COUNT(*) AS total FROM users WHERE usertype = 1'),
    ]);
    res.render('managecustomers', {
      title: 'Manage Customers',
      customers: results,
      pagination: { page, pages: Math.max(1, Math.ceil(count.total / pageSize)) },
    });
  } catch (error) {
    next(error);
  }
});

/* GET manageplumbers */
router.get('/manageplumbers', async function (req, res, next) {
  const { page, pageSize, offset } = normalizePagination(req.query);
  const query = `SELECT u.idusers, u.name, u.surname, u.email, u.account_status,
      pp.license_number, pp.years_experience, pp.service_area, pp.verification_status,
      COUNT(b.idbookings) AS active_jobs
      FROM users u LEFT JOIN plumber_profiles pp ON pp.user_id = u.idusers
      LEFT JOIN bookings b ON b.idPlumber = u.idusers AND b.status IN ('ASSIGNED','IN_PROGRESS')
      WHERE u.usertype = 3
      GROUP BY u.idusers, u.name, u.surname, u.email, u.account_status,
        pp.license_number, pp.years_experience, pp.service_area, pp.verification_status
      ORDER BY FIELD(pp.verification_status, 'PENDING','APPROVED','REJECTED'), u.created_at DESC`;
  try {
    const [[results], [[count]]] = await Promise.all([
      connection.promise().query(`${query} LIMIT ? OFFSET ?`, [pageSize, offset]),
      connection.promise().query('SELECT COUNT(*) AS total FROM users WHERE usertype = 3'),
    ]);
    res.render('manageplumbers', {
      title: 'Manage Plumbers',
      plumbers: results,
      pagination: { page, pages: Math.max(1, Math.ceil(count.total / pageSize)) },
    });
  } catch (error) {
    next(error);
  }
});

router.post('/users/:id/status', function (req, res, next) {
  const userId = Number(req.params.id);
  const status = String(req.body.status || '').toUpperCase();
  if (!Number.isInteger(userId) || !['ACTIVE', 'SUSPENDED', 'DEACTIVATED'].includes(status)) {
    return res.status(400).json({ message: 'A valid user and account status are required.' });
  }
  if (userId === Number(req.user.idusers) && status !== 'ACTIVE') {
    return res.status(400).json({ message: 'You cannot suspend or deactivate your own account.' });
  }
  connection.query(
    'UPDATE users SET account_status = ? WHERE idusers = ?',
    [status, userId],
    (error, result) => {
      if (error) return next(error);
      if (!result.affectedRows) return res.status(404).json({ message: 'User not found.' });
      recordAuditEvent({
        actorId: req.user.idusers,
        action: 'USER_STATUS_CHANGED',
        entityType: 'user',
        entityId: userId,
        metadata: { status },
        ipAddress: req.ip,
      });
      res.json({ success: true, message: `Account marked ${status.toLowerCase()}.` });
    },
  );
});

router.post('/plumbers/:id/verification', function (req, res, next) {
  const plumberId = Number(req.params.id);
  const status = String(req.body.status || '').toUpperCase();
  if (!Number.isInteger(plumberId) || !['APPROVED', 'REJECTED'].includes(status)) {
    return res
      .status(400)
      .json({ message: 'A valid plumber and verification status are required.' });
  }
  const query = `UPDATE plumber_profiles pp
        JOIN users u ON u.idusers = pp.user_id AND u.usertype = 3
        SET pp.verification_status = ?, pp.verified_by = ?, pp.verified_at = NOW(),
            u.account_status = ?
        WHERE pp.user_id = ?`;
  connection.query(
    query,
    [status, req.user.idusers, status === 'APPROVED' ? 'ACTIVE' : 'SUSPENDED', plumberId],
    (error, result) => {
      if (error) return next(error);
      if (!result.affectedRows)
        return res.status(404).json({ message: 'Plumber application not found.' });
      recordAuditEvent({
        actorId: req.user.idusers,
        action: 'PLUMBER_VERIFICATION_CHANGED',
        entityType: 'plumber_profile',
        entityId: plumberId,
        metadata: { status },
        ipAddress: req.ip,
      });
      res.json({ success: true, message: `Plumber application ${status.toLowerCase()}.` });
    },
  );
});

router.get('/contacts', async function (req, res, next) {
  const { page, pageSize, offset } = normalizePagination(req.query);
  try {
    const [[messages], [[count]]] = await Promise.all([
      connection
        .promise()
        .query('SELECT * FROM contact_messages ORDER BY created_at DESC LIMIT ? OFFSET ?', [
          pageSize,
          offset,
        ]),
      connection.promise().query('SELECT COUNT(*) AS total FROM contact_messages'),
    ]);
    res.render('admin-contacts', {
      title: 'Contact messages',
      messages,
      pagination: { page, pages: Math.max(1, Math.ceil(count.total / pageSize)) },
    });
  } catch (error) {
    next(error);
  }
});

router.post('/contacts/:id/status', function (req, res, next) {
  const id = Number(req.params.id);
  const status = String(req.body.status || '').toUpperCase();
  if (!Number.isInteger(id) || !['NEW', 'IN_PROGRESS', 'RESOLVED', 'SPAM'].includes(status)) {
    return res.status(400).json({ message: 'Invalid contact-message status.' });
  }
  connection.query(
    'UPDATE contact_messages SET status = ? WHERE id = ?',
    [status, id],
    (error, result) => {
      if (error) return next(error);
      if (!result.affectedRows) return res.status(404).json({ message: 'Message not found.' });
      recordAuditEvent({
        actorId: req.user.idusers,
        action: 'CONTACT_STATUS_CHANGED',
        entityType: 'contact_message',
        entityId: id,
        metadata: { status },
        ipAddress: req.ip,
      });
      res.json({ success: true });
    },
  );
});

/* GET all bookings for admin view */
router.get('/bookings', async function (req, res, next) {
  const { page, pageSize, offset } = normalizePagination(req.query);
  // Get all bookings with customer name, ordered by newest first
  const bookingsQuery = `
    SELECT bookings.*, users.name AS customer_name 
    FROM bookings 
    JOIN users ON bookings.idUser = users.idusers 
    ORDER BY bookings.idbookings DESC LIMIT ? OFFSET ?
  `;
  const plumbersQuery = `SELECT u.* FROM users u
      JOIN plumber_profiles pp ON pp.user_id = u.idusers
      WHERE u.usertype = 3 AND u.account_status = 'ACTIVE' AND pp.verification_status = 'APPROVED'`;
  try {
    const [[results], [plumbers], [[count]]] = await Promise.all([
      connection.promise().query(bookingsQuery, [pageSize, offset]),
      connection.promise().query(plumbersQuery),
      connection.promise().query('SELECT COUNT(*) AS total FROM bookings'),
    ]);
    res.render('bookings', {
      bookings: results.map((booking) => ({
        ...booking,
        lifecycle: getBookingLifecycle('admin', booking.status),
      })),
      plumbers,
      title: 'Bookings',
      pagination: { page, pages: Math.max(1, Math.ceil(count.total / pageSize)) },
    });
  } catch (error) {
    next(error);
  }
});

// Dashboard analytics stats page
router.get('/stats', async function (req, res, next) {
  try {
    const [[bookingRows], [userRows], [statusBreakdown], [monthlyTrend]] = await Promise.all([
      connection.promise().query(`SELECT COUNT(*) AS totalBookings,
              SUM(status IN ('COMPLETED','PAID')) AS completedBookings,
              SUM(status = 'PAID') AS paidBookings,
              COALESCE(SUM(CASE WHEN status = 'PAID' THEN amount ELSE 0 END), 0) AS revenue,
              ROUND(AVG(CASE WHEN status IN ('COMPLETED','PAID') THEN TIMESTAMPDIFF(HOUR, created_at, updated_at) END), 1) AS averageTurnaroundHours
              FROM bookings`),
      connection.promise().query(`SELECT SUM(usertype = 1) AS totalCustomers,
              SUM(usertype = 3) AS totalPlumbers FROM users`),
      connection
        .promise()
        .query(
          'SELECT status, COUNT(*) AS total FROM bookings GROUP BY status ORDER BY total DESC',
        ),
      connection.promise().query(`SELECT DATE_FORMAT(created_at, '%Y-%m') AS month,
              COUNT(*) AS bookings, COALESCE(SUM(CASE WHEN status = 'PAID' THEN amount ELSE 0 END), 0) AS revenue
              FROM bookings WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 5 MONTH)
              GROUP BY DATE_FORMAT(created_at, '%Y-%m') ORDER BY month`),
    ]);
    res.render('stats', {
      title: 'Dashboard Analytics',
      stats: { ...bookingRows[0], ...userRows[0] },
      statusBreakdown,
      monthlyTrend,
    });
  } catch (error) {
    next(error);
  }
});

router.get('/schedule', function (req, res, next) {
  const from = req.query.from || new Date().toISOString().slice(0, 10);
  const query = `SELECT b.idbookings, b.type, b.status, b.location, b.scheduled_start, b.scheduled_end,
        c.name AS customer_name, c.surname AS customer_surname,
        p.name AS plumber_name, p.surname AS plumber_surname
        FROM bookings b
        JOIN users c ON c.idusers = b.idUser
        LEFT JOIN users p ON p.idusers = b.idPlumber
        WHERE b.scheduled_start >= ? ORDER BY b.scheduled_start LIMIT 500`;
  connection.query(query, [from], (error, bookings) => {
    if (error) return next(error);
    res.json({ success: true, bookings });
  });
});

router.post('/schedule', async function (req, res, next) {
  const bookingId = Number(req.body.booking_id);
  const plumberId = Number(req.body.plumber_id);
  const schedule = normalizeSchedule(req.body.starts_at, req.body.ends_at);
  if (!Number.isInteger(bookingId) || !Number.isInteger(plumberId) || !schedule) {
    return res.status(400).json({
      message: 'Provide a booking, plumber, and valid future time window of no more than 12 hours.',
    });
  }

  let db;
  try {
    db = await connection.promise().getConnection();
    await db.beginTransaction();
    const [plumbers] = await db.query(
      `SELECT u.idusers FROM users u
             JOIN plumber_profiles pp ON pp.user_id = u.idusers
             WHERE u.idusers = ? AND u.usertype = 3 AND u.account_status = 'ACTIVE'
             AND pp.verification_status = 'APPROVED' FOR UPDATE`,
      [plumberId],
    );
    if (!plumbers.length) {
      await db.rollback();
      return res
        .status(400)
        .json({ message: 'Only an approved, active plumber can be scheduled.' });
    }

    const [bookings] = await db.query(
      'SELECT idUser, status FROM bookings WHERE idbookings = ? FOR UPDATE',
      [bookingId],
    );
    if (!bookings.length || !['NEW', 'PENDING', 'ASSIGNED'].includes(bookings[0].status)) {
      await db.rollback();
      return res.status(409).json({ message: 'This booking cannot be scheduled.' });
    }

    const [conflicts] = await db.query(
      `SELECT idbookings FROM bookings
             WHERE idPlumber = ? AND idbookings <> ? AND status IN ('ASSIGNED','IN_PROGRESS')
             AND scheduled_start < ? AND scheduled_end > ? LIMIT 1`,
      [plumberId, bookingId, schedule.end, schedule.start],
    );
    if (conflicts.length) {
      await db.rollback();
      return res.status(409).json({ message: 'That plumber already has a job during this time.' });
    }

    const [availability] = await db.query(
      `SELECT
               EXISTS(SELECT 1 FROM plumber_availability WHERE plumber_id = ? AND availability_type = 'AVAILABLE' AND starts_at <= ? AND ends_at >= ?) AS isAvailable,
               EXISTS(SELECT 1 FROM plumber_availability WHERE plumber_id = ? AND availability_type = 'UNAVAILABLE' AND starts_at < ? AND ends_at > ?) AS isBlocked`,
      [plumberId, schedule.start, schedule.end, plumberId, schedule.end, schedule.start],
    );
    if (!availability[0].isAvailable || availability[0].isBlocked) {
      await db.rollback();
      return res
        .status(409)
        .json({ message: 'That plumber is not available for the full selected time.' });
    }

    await db.query(
      `UPDATE bookings SET idPlumber = ?, scheduled_start = ?, scheduled_end = ?, status = 'ASSIGNED'
             WHERE idbookings = ?`,
      [plumberId, schedule.start, schedule.end, bookingId],
    );
    await db.query(
      'INSERT INTO booking_status_history (booking_id, from_status, to_status, changed_by, note) VALUES (?, ?, ?, ?, ?)',
      [
        bookingId,
        bookings[0].status,
        'ASSIGNED',
        req.user.idusers,
        'Visit scheduled by administrator',
      ],
    );
    await db.commit();
    recordAuditEvent({
      actorId: req.user.idusers,
      action: 'BOOKING_SCHEDULED',
      entityType: 'booking',
      entityId: bookingId,
      metadata: { plumberId, startsAt: schedule.start, endsAt: schedule.end },
      ipAddress: req.ip,
    });
    createNotifications([bookings[0].idUser, plumberId], {
      bookingId,
      type: 'booking_scheduled',
      title: 'Visit scheduled',
      message: `The visit is scheduled for ${schedule.start.toLocaleString('en-ZA')}.`,
    });
    res.json({ success: true, message: 'Booking scheduled successfully.' });
  } catch (error) {
    if (db) await db.rollback();
    next(error);
  } finally {
    if (db) db.release();
  }
});

/* POST decline booking*/
router.post('/declinebooking', function (req, res) {
  const { booking_id } = req.body;
  const reason = cleanText(req.body.reason, { min: 5, max: 500 });

  if (!booking_id || !reason) {
    return res.status(400).json({ message: 'Booking ID and a brief decline reason are required.' });
  }

  const query = 'SELECT idUser, status FROM bookings WHERE idbookings = ?';
  connection.query(query, [booking_id], function (err, rows) {
    if (err) {
      console.error('error while querying the database', err);
      return res.status(500).json({ message: 'Internal server error' });
    }
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Booking not found.' });
    }
    if (!canTransition('admin', rows[0].status, 'DECLINED')) {
      return res.status(409).json({ message: `A ${rows[0].status} booking cannot be declined.` });
    }

    const customerId = rows[0].idUser;
    const updateQuery =
      'UPDATE bookings SET status = ?, decline_reason = ? WHERE idbookings = ? AND status = ?';
    connection.query(
      updateQuery,
      ['DECLINED', reason, booking_id, rows[0].status],
      function (err, result) {
        if (err) {
          console.error('error while querying the database', err);
          return res.status(500).json({ message: 'Internal server error' });
        }
        if (result.affectedRows === 0) {
          return res.status(404).json({ message: 'Booking not found or already declined.' });
        }
        createNotification({
          userId: customerId,
          role: 'customer',
          bookingId: booking_id,
          type: 'booking_declined',
          title: 'Booking declined',
          message: `Your booking request was declined: ${reason}`,
        });
        connection.query(
          'INSERT INTO booking_status_history (booking_id, from_status, to_status, changed_by, note) VALUES (?, ?, ?, ?, ?)',
          [booking_id, rows[0].status, 'DECLINED', req.user.idusers, reason],
        );
        recordAuditEvent({
          actorId: req.user.idusers,
          action: 'BOOKING_DECLINED',
          entityType: 'booking',
          entityId: booking_id,
          metadata: { reason },
          ipAddress: req.ip,
        });
        res.json({ message: 'Booking declined' });
      },
    );
  });
});

module.exports = router;
