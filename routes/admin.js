var express = require('express');
var router = express.Router();
const connection = require('../database/connection');
const { verifyToken, isAdmin } = require('../middleware/auth');
const { createNotification } = require('../utils/notifications');
const { getBookingLifecycle } = require('../utils/bookingLifecycle');
const { cleanText, normalizePagination, canTransition } = require('../utils/validation');
const { recordAuditEvent } = require('../utils/audit');
const { assignVisit } = require('../utils/scheduling');
const { getDispatchData } = require('../utils/dispatchData');
const { time } = require('../config/dispatch');

// Protect all administrator routes with the server-side session.
router.use(verifyToken);
router.use(isAdmin);

router.get('/', function (req, res) {
  const adminPage = ['stats', 'users', 'bookings'].includes(req.query.section)
    ? req.query.section
    : 'stats';
  res.render('admindashboard', { title: 'Admin Dashboard', adminPage });
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
  try {
    const [[results], [[count]]] = await Promise.all([
      connection.promise().query(bookingsQuery, [pageSize, offset]),
      connection.promise().query('SELECT COUNT(*) AS total FROM bookings'),
    ]);
    res.render('bookings', {
      bookings: results.map((booking) => ({
        ...booking,
        lifecycle: getBookingLifecycle('admin', booking.status),
      })),
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

router.get('/dispatch', (_req, res) => {
  res.render('admindashboard', { title: 'Dispatch calendar', adminPage: 'dispatch' });
});

router.get('/plumbers/:id/availability', async (req, res, next) => {
  const plumberId = Number(req.params.id);
  const date = req.query.date;
  if (!Number.isSafeInteger(plumberId) || plumberId < 1 || !time.validDate(date)) {
    return res.status(400).json({ success: false, message: 'Choose a plumber and valid date.' });
  }
  // Include the next day so a visit spanning midnight also sees every blocked period.
  const start = time.range(date, 'day').start;
  const end = time.range(time.shiftDate(date, 1), 'day').end;
  try {
    const [availability] = await connection.promise().query(
      `SELECT id, starts_at, ends_at, availability_type FROM plumber_availability
       WHERE plumber_id = ? AND starts_at < ? AND ends_at > ? ORDER BY starts_at`,
      [plumberId, end, start],
    );
    res.set('Cache-Control', 'no-store');
    res.json({ success: true, availability });
  } catch (error) {
    next(error);
  }
});

router.get('/dispatch/data', async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json(await getDispatchData(req.query));
  } catch (error) {
    next(error);
  }
});

router.post('/schedule', async (req, res, next) => {
  try {
    await assignVisit({
      bookingId: Number(req.body.booking_id),
      plumberId: Number(req.body.plumber_id),
      startsAt: req.body.starts_at,
      endsAt: req.body.ends_at,
      expected: req.body.expected_schedule,
      actorId: req.user.idusers,
      ipAddress: req.ip,
    });
    res.json({ success: true, message: 'Booking scheduled successfully.' });
  } catch (error) {
    next(error);
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
