const express = require('express');
const router = express.Router();
const connection = require('../database/connection');
const { verifyToken } = require('../middleware/auth');
const { USER_ROLES } = require('../config/domain');
const { cleanText } = require('../utils/validation');
const { recordAuditEvent } = require('../utils/audit');
const { streamJobCard } = require('../utils/pdfDocuments');

router.use(verifyToken);

async function findAuthorizedBooking(bookingId, user) {
  const [rows] = await connection.promise().query(
    `SELECT b.*, c.name AS customer_name, c.surname AS customer_surname,
        p.name AS plumber_name, p.surname AS plumber_surname
     FROM bookings b JOIN users c ON c.idusers = b.idUser
     LEFT JOIN users p ON p.idusers = b.idPlumber
     WHERE b.idbookings = ? AND (b.idUser = ? OR b.idPlumber = ? OR ? = 2)`,
    [bookingId, user.idusers, user.idusers, user.usertype],
  );
  return rows[0] || null;
}

router.get('/:bookingId/pdf', async (req, res, next) => {
  try {
    const booking = await findAuthorizedBooking(Number(req.params.bookingId), req.user);
    if (!booking) return res.status(404).send('Job not found');
    const visibility =
      req.user.usertype === USER_ROLES.CUSTOMER ? "AND n.visibility = 'CUSTOMER'" : '';
    const [[notes], [photos]] = await Promise.all([
      connection.promise().query(
        `SELECT n.*, u.name AS author_name FROM job_notes n
         JOIN users u ON u.idusers = n.author_id
         WHERE n.booking_id = ? ${visibility} ORDER BY n.created_at`,
        [booking.idbookings],
      ),
      connection
        .promise()
        .query(
          'SELECT photo_type, file_path, caption, created_at FROM booking_photos WHERE booking_id = ? ORDER BY created_at',
          [booking.idbookings],
        ),
    ]);
    streamJobCard(res, booking, notes, photos);
  } catch (error) {
    next(error);
  }
});

router.get('/:bookingId', async (req, res, next) => {
  try {
    const booking = await findAuthorizedBooking(Number(req.params.bookingId), req.user);
    if (!booking) return res.status(404).send('Job not found');
    const noteVisibility =
      req.user.usertype === USER_ROLES.CUSTOMER ? "AND visibility = 'CUSTOMER'" : '';
    const [[notes], [photos], [confirmations]] = await Promise.all([
      connection
        .promise()
        .query(
          `SELECT n.*, u.name AS author_name FROM job_notes n JOIN users u ON u.idusers = n.author_id WHERE booking_id = ? ${noteVisibility} ORDER BY n.created_at`,
          [booking.idbookings],
        ),
      connection
        .promise()
        .query('SELECT * FROM booking_photos WHERE booking_id = ? ORDER BY created_at', [
          booking.idbookings,
        ]),
      connection
        .promise()
        .query('SELECT * FROM completion_confirmations WHERE booking_id = ?', [booking.idbookings]),
    ]);
    res.render('job', {
      title: `Job #${booking.idbookings}`,
      booking,
      notes,
      photos,
      confirmation: confirmations[0] || null,
    });
  } catch (error) {
    next(error);
  }
});

router.post('/:bookingId/notes', async (req, res, next) => {
  try {
    const booking = await findAuthorizedBooking(Number(req.params.bookingId), req.user);
    if (!booking) return res.status(404).json({ message: 'Job not found.' });
    const note = cleanText(req.body.note, { min: 2, max: 5000 });
    const requestedVisibility = String(req.body.visibility || 'CUSTOMER').toUpperCase();
    const visibility =
      req.user.usertype === USER_ROLES.CUSTOMER
        ? 'CUSTOMER'
        : requestedVisibility === 'INTERNAL'
          ? 'INTERNAL'
          : 'CUSTOMER';
    if (!note)
      return res.status(400).json({ message: 'Enter a note between 2 and 5000 characters.' });
    const [result] = await connection
      .promise()
      .query(
        'INSERT INTO job_notes (booking_id, author_id, visibility, note) VALUES (?, ?, ?, ?)',
        [booking.idbookings, req.user.idusers, visibility, note],
      );
    recordAuditEvent({
      actorId: req.user.idusers,
      action: 'JOB_NOTE_ADDED',
      entityType: 'job_note',
      entityId: result.insertId,
      metadata: { bookingId: booking.idbookings, visibility },
      ipAddress: req.ip,
    });
    res.status(201).json({ success: true, id: result.insertId });
  } catch (error) {
    next(error);
  }
});

router.post('/:bookingId/confirm', async (req, res, next) => {
  if (req.user.usertype !== USER_ROLES.CUSTOMER)
    return res.status(403).json({ message: 'Only the customer can confirm completion.' });
  const signatureName = cleanText(req.body.signature_name, { min: 2, max: 200 });
  if (!signatureName)
    return res.status(400).json({ message: 'Enter the customer name as confirmation.' });
  try {
    const [result] = await connection.promise().query(
      `INSERT INTO completion_confirmations (booking_id, customer_id, signature_name)
       SELECT idbookings, idUser, ? FROM bookings WHERE idbookings = ? AND idUser = ? AND status = 'COMPLETED'
       ON DUPLICATE KEY UPDATE signature_name = VALUES(signature_name), confirmed_at = NOW()`,
      [signatureName, Number(req.params.bookingId), req.user.idusers],
    );
    if (!result.affectedRows)
      return res.status(409).json({ message: 'Only a completed booking can be confirmed.' });
    recordAuditEvent({
      actorId: req.user.idusers,
      action: 'COMPLETION_CONFIRMED',
      entityType: 'booking',
      entityId: req.params.bookingId,
      ipAddress: req.ip,
    });
    res.json({ success: true, message: 'Completion confirmed.' });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
