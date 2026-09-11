const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const database = require('../database/connection');
const { verifyToken, isPlumber } = require('../middleware/auth');
const { createNotification } = require('../utils/notifications');
const { getBookingLifecycle } = require('../utils/bookingLifecycle');
const { normalizeSchedule, canTransition } = require('../utils/validation');
const { recordAuditEvent } = require('../utils/audit');

const router = express.Router();
const uploadDirectory = path.join(__dirname, '..', 'uploads', 'booking_photos');

const storage = multer.diskStorage({
  destination(_req, _file, callback) {
    fs.mkdirSync(uploadDirectory, { recursive: true });
    callback(null, uploadDirectory);
  },
  filename(_req, file, callback) {
    const extension = path.extname(file.originalname).toLowerCase();
    callback(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${extension}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: Number(process.env.MAX_FILE_SIZE) || 5 * 1024 * 1024 },
  fileFilter(_req, file, callback) {
    const extension = path.extname(file.originalname).toLowerCase();
    const accepted =
      ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype) &&
      ['.jpg', '.jpeg', '.png', '.webp'].includes(extension);
    callback(accepted ? null : new Error('Only JPEG, PNG, and WebP images are allowed'), accepted);
  },
});

async function hasSupportedImageSignature(filePath) {
  const handle = await fs.promises.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(12);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead < 4) return false;
    const jpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    const png = buffer
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const webp =
      buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP';
    return jpeg || png || webp;
  } finally {
    await handle.close();
  }
}

router.use(verifyToken, isPlumber);

router.get('/', (_req, res) => res.redirect('/plumber/my-bookings'));

router.get('/availability', async (req, res, next) => {
  try {
    const [availability] = await database.promise().query(
      `SELECT id, starts_at, ends_at, availability_type
       FROM plumber_availability WHERE plumber_id = ? AND ends_at >= NOW()
       ORDER BY starts_at`,
      [req.user.idusers],
    );
    res.render('plumber-availability', { title: 'My availability', availability });
  } catch (error) {
    next(error);
  }
});

router.post('/availability', async (req, res, next) => {
  const schedule = normalizeSchedule(req.body.starts_at, req.body.ends_at);
  const type = String(req.body.availability_type || 'AVAILABLE').toUpperCase();
  if (!schedule || !['AVAILABLE', 'UNAVAILABLE'].includes(type)) {
    return res
      .status(400)
      .json({ success: false, message: 'Provide a valid future availability window.' });
  }
  try {
    const [result] = await database
      .promise()
      .query(
        'INSERT INTO plumber_availability (plumber_id, starts_at, ends_at, availability_type) VALUES (?, ?, ?, ?)',
        [req.user.idusers, schedule.start, schedule.end, type],
      );
    recordAuditEvent({
      actorId: req.user.idusers,
      action: 'AVAILABILITY_CREATED',
      entityType: 'plumber_availability',
      entityId: result.insertId,
      metadata: { type },
      ipAddress: req.ip,
    });
    return res.status(201).json({ success: true, id: result.insertId });
  } catch (error) {
    next(error);
  }
});

router.delete('/availability/:id', async (req, res, next) => {
  try {
    const [result] = await database
      .promise()
      .query('DELETE FROM plumber_availability WHERE id = ? AND plumber_id = ?', [
        Number(req.params.id),
        req.user.idusers,
      ]);
    if (!result.affectedRows)
      return res.status(404).json({ success: false, message: 'Availability entry not found.' });
    recordAuditEvent({
      actorId: req.user.idusers,
      action: 'AVAILABILITY_REMOVED',
      entityType: 'plumber_availability',
      entityId: req.params.id,
      ipAddress: req.ip,
    });
    return res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

router.get('/my-bookings', async (req, res, next) => {
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const pageSize = 20;
  try {
    const [[countRow], [bookings]] = await Promise.all([
      database
        .promise()
        .query('SELECT COUNT(*) AS total FROM bookings WHERE idPlumber = ?', [req.user.idusers]),
      database.promise().query(
        `SELECT b.idbookings, b.type AS service_type, b.date_start,
                b.scheduled_start, b.scheduled_end, b.location, b.description,
                b.status, b.amount, b.before_photo, b.after_photo,
                c.name AS customer_name, c.surname AS customer_surname,
                c.email AS customer_email
         FROM bookings b JOIN users c ON c.idusers = b.idUser
         WHERE b.idPlumber = ? ORDER BY b.created_at DESC LIMIT ? OFFSET ?`,
        [req.user.idusers, pageSize, (page - 1) * pageSize],
      ),
    ]);
    res.render('plumber_bookings', {
      title: 'My Assigned Bookings',
      bookings: bookings.map((booking) => ({
        ...booking,
        lifecycle: getBookingLifecycle('plumber', booking.status),
      })),
      pagination: {
        page,
        pageSize,
        total: countRow[0].total,
        pages: Math.ceil(countRow[0].total / pageSize),
      },
    });
  } catch (error) {
    next(error);
  }
});

router.post('/update-booking-status', async (req, res, next) => {
  const bookingId = Number(req.body.booking_id);
  const nextStatus = String(req.body.status || '').toUpperCase();
  if (!Number.isInteger(bookingId) || !['IN_PROGRESS', 'COMPLETED'].includes(nextStatus)) {
    return res.status(400).json({ success: false, message: 'Provide a valid booking and status.' });
  }

  let connection;
  try {
    connection = await database.promise().getConnection();
    await connection.beginTransaction();
    const [rows] = await connection.query(
      'SELECT idUser, status FROM bookings WHERE idbookings = ? AND idPlumber = ? FOR UPDATE',
      [bookingId, req.user.idusers],
    );
    if (!rows.length) {
      await connection.rollback();
      return res.status(404).json({ success: false, message: 'Assigned booking not found.' });
    }
    const booking = rows[0];
    if (!canTransition('plumber', booking.status, nextStatus)) {
      await connection.rollback();
      return res.status(409).json({
        success: false,
        message: `Cannot move a booking from ${booking.status} to ${nextStatus}.`,
      });
    }
    await connection.query(
      'UPDATE bookings SET status = ? WHERE idbookings = ? AND idPlumber = ? AND status = ?',
      [nextStatus, bookingId, req.user.idusers, booking.status],
    );
    await connection.query(
      'INSERT INTO booking_status_history (booking_id, from_status, to_status, changed_by, note) VALUES (?, ?, ?, ?, ?)',
      [bookingId, booking.status, nextStatus, req.user.idusers, 'Updated by assigned plumber'],
    );
    await connection.commit();
    createNotification({
      userId: booking.idUser,
      bookingId,
      type: `booking_${nextStatus.toLowerCase()}`,
      title: 'Booking progress updated',
      message: `Your booking is now ${nextStatus.replace('_', ' ').toLowerCase()}.`,
    });
    recordAuditEvent({
      actorId: req.user.idusers,
      action: 'BOOKING_STATUS_CHANGED',
      entityType: 'booking',
      entityId: bookingId,
      metadata: { from: booking.status, to: nextStatus },
      ipAddress: req.ip,
    });
    return res.json({ success: true, message: `Booking status updated to ${nextStatus}.` });
  } catch (error) {
    if (connection) await connection.rollback();
    next(error);
  } finally {
    if (connection) connection.release();
  }
});

router.post('/upload-photo', upload.single('photo'), async (req, res, next) => {
  const bookingId = Number(req.body.booking_id);
  const photoType = String(req.body.type || '').toUpperCase();
  if (!Number.isInteger(bookingId) || !['BEFORE', 'AFTER'].includes(photoType) || !req.file) {
    if (req.file) fs.rm(req.file.path, { force: true }, () => {});
    return res
      .status(400)
      .json({ success: false, message: 'Provide a booking, photo type, and valid image.' });
  }
  try {
    if (!(await hasSupportedImageSignature(req.file.path))) {
      fs.rm(req.file.path, { force: true }, () => {});
      return res.status(400).json({
        success: false,
        message: 'The uploaded file is not a valid JPEG, PNG, or WebP image.',
      });
    }
    const [bookings] = await database
      .promise()
      .query('SELECT idUser FROM bookings WHERE idbookings = ? AND idPlumber = ?', [
        bookingId,
        req.user.idusers,
      ]);
    if (!bookings.length) {
      fs.rm(req.file.path, { force: true }, () => {});
      return res
        .status(403)
        .json({ success: false, message: 'You are not assigned to this booking.' });
    }
    const filePath = `/uploads/booking_photos/${req.file.filename}`;
    const column = photoType === 'BEFORE' ? 'before_photo' : 'after_photo';
    await database
      .promise()
      .query(`UPDATE bookings SET ${column} = ? WHERE idbookings = ?`, [filePath, bookingId]);
    await database
      .promise()
      .query(
        'INSERT INTO booking_photos (booking_id, uploaded_by, photo_type, file_path) VALUES (?, ?, ?, ?)',
        [bookingId, req.user.idusers, photoType, filePath],
      );
    createNotification({
      userId: bookings[0].idUser,
      bookingId,
      type: 'booking_photo_uploaded',
      title: `${photoType.toLowerCase()} photo uploaded`,
      message: `The plumber added a ${photoType.toLowerCase()} photo to your job record.`,
    });
    recordAuditEvent({
      actorId: req.user.idusers,
      action: 'BOOKING_PHOTO_UPLOADED',
      entityType: 'booking',
      entityId: bookingId,
      metadata: { photoType },
      ipAddress: req.ip,
    });
    return res.json({ success: true, message: 'Photo uploaded successfully.', path: filePath });
  } catch (error) {
    fs.rm(req.file.path, { force: true }, () => {});
    next(error);
  }
});

module.exports = router;
