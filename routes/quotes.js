const express = require('express');
const router = express.Router();
const connection = require('../database/connection');
const { verifyToken } = require('../middleware/auth');
const { USER_ROLES } = require('../config/domain');
const { cleanText, normalizeMoney } = require('../utils/validation');
const { createNotification } = require('../utils/notifications');
const { recordAuditEvent } = require('../utils/audit');

router.use(verifyToken);

function normalizeItems(raw) {
  let items = raw;
  if (typeof items === 'string') {
    try {
      items = JSON.parse(items);
    } catch (_) {
      return null;
    }
  }
  if (!Array.isArray(items) || items.length === 0 || items.length > 50) return null;
  const normalized = items.map((item) => {
    const description = cleanText(item.description, { max: 500 });
    const quantity = Number(item.quantity);
    const unitPrice = normalizeMoney(item.unitPrice ?? item.unit_price);
    if (
      !description ||
      !Number.isFinite(quantity) ||
      quantity <= 0 ||
      quantity > 1000 ||
      unitPrice === null
    )
      return null;
    return {
      description,
      quantity: Math.round(quantity * 100) / 100,
      unitPrice,
      lineTotal: Math.round(quantity * unitPrice * 100) / 100,
    };
  });
  return normalized.some((item) => !item) ? null : normalized;
}

router.get('/booking/:bookingId', async (req, res, next) => {
  try {
    const bookingId = Number(req.params.bookingId);
    const [bookings] = await connection.promise().query(
      `SELECT b.*, c.name AS customer_name, p.name AS plumber_name
       FROM bookings b JOIN users c ON c.idusers = b.idUser
       LEFT JOIN users p ON p.idusers = b.idPlumber
       WHERE b.idbookings = ? AND (b.idUser = ? OR b.idPlumber = ? OR ? = 2)`,
      [bookingId, req.user.idusers, req.user.idusers, req.user.usertype],
    );
    if (!bookings.length) return res.status(404).send('Booking not found');
    const [quotes] = await connection
      .promise()
      .query('SELECT * FROM quotes WHERE booking_id = ? ORDER BY idquote DESC LIMIT 1', [
        bookingId,
      ]);
    let items = [];
    if (quotes.length)
      [items] = await connection
        .promise()
        .query('SELECT * FROM quote_items WHERE quote_id = ? ORDER BY id', [quotes[0].idquote]);
    res.render('quote', {
      title: 'Job quote',
      booking: bookings[0],
      quote: quotes[0] || null,
      items,
    });
  } catch (error) {
    next(error);
  }
});

router.post('/booking/:bookingId', async (req, res, next) => {
  if (req.user.usertype !== USER_ROLES.PLUMBER)
    return res.status(403).json({ message: 'Only plumbers can prepare quotes.' });
  const bookingId = Number(req.params.bookingId);
  const items = normalizeItems(req.body.items);
  if (!Number.isInteger(bookingId) || !items)
    return res.status(400).json({ message: 'Provide a valid booking and itemized quote.' });

  let db;
  try {
    db = await connection.promise().getConnection();
    await db.beginTransaction();
    const [bookings] = await db.query(
      'SELECT idUser, status FROM bookings WHERE idbookings = ? AND idPlumber = ? FOR UPDATE',
      [bookingId, req.user.idusers],
    );
    if (!bookings.length || !['ASSIGNED', 'IN_PROGRESS'].includes(bookings[0].status)) {
      await db.rollback();
      return res
        .status(409)
        .json({ message: 'This booking is not assigned to you or cannot be quoted.' });
    }
    const subtotal = items.reduce((sum, item) => sum + item.lineTotal, 0);
    const taxRate = Number(process.env.TAX_RATE || 0.15);
    const tax = Math.round(subtotal * taxRate * 100) / 100;
    const total = Math.round((subtotal + tax) * 100) / 100;
    await db.query(
      "UPDATE quotes SET status = 'EXPIRED' WHERE booking_id = ? AND status IN ('DRAFT','SENT')",
      [bookingId],
    );
    const quoteNumber = `QT-${String(bookingId).padStart(6, '0')}-${Date.now().toString().slice(-6)}`;
    const [result] = await db.query(
      `INSERT INTO quotes (quote_number, booking_id, created_by, status, subtotal, tax_amount, total_amount, expires_at)
       VALUES (?, ?, ?, 'SENT', ?, ?, ?, DATE_ADD(NOW(), INTERVAL 7 DAY))`,
      [quoteNumber, bookingId, req.user.idusers, subtotal, tax, total],
    );
    await db.query(
      'INSERT INTO quote_items (quote_id, description, quantity, unit_price, line_total) VALUES ?',
      [
        items.map((item) => [
          result.insertId,
          item.description,
          item.quantity,
          item.unitPrice,
          item.lineTotal,
        ]),
      ],
    );
    await db.commit();
    recordAuditEvent({
      actorId: req.user.idusers,
      action: 'QUOTE_SENT',
      entityType: 'quote',
      entityId: result.insertId,
      metadata: { bookingId, total },
      ipAddress: req.ip,
    });
    createNotification({
      userId: bookings[0].idUser,
      bookingId,
      type: 'quote_sent',
      title: 'Quote ready for approval',
      message: `Your itemized quote ${quoteNumber} is ready to review.`,
    });
    res.status(201).json({ success: true, quoteId: result.insertId, quoteNumber, total });
  } catch (error) {
    if (db) await db.rollback();
    next(error);
  } finally {
    if (db) db.release();
  }
});

router.post('/:quoteId/respond', async (req, res, next) => {
  if (req.user.usertype !== USER_ROLES.CUSTOMER)
    return res.status(403).json({ message: 'Only customers can respond to quotes.' });
  const decision = String(req.body.decision || '').toUpperCase();
  if (!['APPROVED', 'REJECTED'].includes(decision))
    return res.status(400).json({ message: 'Decision must be APPROVED or REJECTED.' });
  try {
    const [result] = await connection.promise().query(
      `UPDATE quotes q JOIN bookings b ON b.idbookings = q.booking_id
       SET q.status = ?, q.customer_responded_at = NOW(), b.amount = IF(? = 'APPROVED', q.total_amount, b.amount)
       WHERE q.idquote = ? AND b.idUser = ? AND q.status = 'SENT' AND (q.expires_at IS NULL OR q.expires_at > NOW())`,
      [decision, decision, Number(req.params.quoteId), req.user.idusers],
    );
    if (!result.affectedRows)
      return res.status(409).json({ message: 'This quote cannot be updated.' });
    const [[quote]] = await connection
      .promise()
      .query('SELECT q.booking_id, q.created_by FROM quotes q WHERE q.idquote = ?', [
        Number(req.params.quoteId),
      ]);
    createNotification({
      userId: quote.created_by,
      bookingId: quote.booking_id,
      type: 'quote_response',
      title: `Quote ${decision.toLowerCase()}`,
      message: `The customer ${decision.toLowerCase()} your quote.`,
    });
    recordAuditEvent({
      actorId: req.user.idusers,
      action: 'QUOTE_RESPONDED',
      entityType: 'quote',
      entityId: req.params.quoteId,
      metadata: { decision },
      ipAddress: req.ip,
    });
    res.json({ success: true, message: `Quote ${decision.toLowerCase()}.` });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
