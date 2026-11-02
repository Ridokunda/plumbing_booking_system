const express = require('express');
const database = require('../database/connection');
const { verifyToken } = require('../middleware/auth');
const { cleanText, normalizeMoney, normalizeSchedule } = require('../utils/validation');
const { createNotification, createNotifications } = require('../utils/notifications');
const { recordAuditEvent } = require('../utils/audit');
const {
  SchedulingError,
  beginSchedulingTransaction,
  lockBooking,
  validateSlot,
  saveSchedule,
  notifySchedule,
} = require('../utils/scheduling');
const stripe = process.env.STRIPE_SECRET_KEY
  ? require('stripe')(process.env.STRIPE_SECRET_KEY)
  : null;

const router = express.Router();
router.use(verifyToken);

async function notifyAdmins(payload) {
  const [admins] = await database
    .promise()
    .query("SELECT idusers FROM users WHERE usertype = 2 AND account_status = 'ACTIVE'");
  createNotifications(
    admins.map((admin) => admin.idusers),
    payload,
  );
}

function requireCustomer(req, res, next) {
  if (req.user.usertype !== 1) {
    return res.status(403).json({ success: false, message: 'Customer access required.' });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (req.user.usertype !== 2) {
    return res.status(403).json({ success: false, message: 'Administrator access required.' });
  }
  next();
}

router.post('/disputes', requireCustomer, async (req, res, next) => {
  const bookingId = Number(req.body.booking_id);
  const category = String(req.body.category || '').toUpperCase();
  const description = cleanText(req.body.description, { min: 20, max: 2000 });
  if (
    !Number.isInteger(bookingId) ||
    !['QUALITY', 'DAMAGE', 'BILLING', 'CONDUCT', 'OTHER'].includes(category) ||
    !description
  ) {
    return res
      .status(400)
      .json({ success: false, message: 'Provide a valid booking, category, and description.' });
  }
  try {
    const [result] = await database.promise().query(
      `INSERT INTO disputes (booking_id, opened_by, category, description)
       SELECT idbookings, ?, ?, ? FROM bookings
       WHERE idbookings = ? AND idUser = ? AND status IN ('IN_PROGRESS','COMPLETED','PAID')`,
      [req.user.idusers, category, description, bookingId, req.user.idusers],
    );
    if (!result.affectedRows)
      return res.status(404).json({ success: false, message: 'Eligible booking not found.' });
    await notifyAdmins({
      bookingId,
      type: 'dispute_opened',
      title: 'New customer dispute',
      message: `A ${category.toLowerCase()} dispute needs review.`,
    });
    recordAuditEvent({
      actorId: req.user.idusers,
      action: 'DISPUTE_OPENED',
      entityType: 'dispute',
      entityId: result.insertId,
      ipAddress: req.ip,
    });
    return res
      .status(201)
      .json({ success: true, id: result.insertId, message: 'Your case has been opened.' });
  } catch (error) {
    next(error);
  }
});

router.post('/refunds', requireCustomer, async (req, res, next) => {
  const bookingId = Number(req.body.booking_id);
  const amount = normalizeMoney(req.body.amount);
  const reason = cleanText(req.body.reason, { min: 10, max: 1000 });
  if (!Number.isInteger(bookingId) || amount === null || amount <= 0 || !reason) {
    return res
      .status(400)
      .json({ success: false, message: 'Provide a valid paid booking, amount, and reason.' });
  }
  try {
    const [result] = await database.promise().query(
      `INSERT INTO refunds (booking_id, requested_by, amount, reason)
       SELECT b.idbookings, ?, ?, ? FROM bookings b
       WHERE b.idbookings = ? AND b.idUser = ? AND b.status = 'PAID' AND ? <= b.amount
       AND NOT EXISTS (SELECT 1 FROM refunds r WHERE r.booking_id = b.idbookings
         AND r.status IN ('REQUESTED','APPROVED','PROCESSING','REFUNDED'))`,
      [req.user.idusers, amount, reason, bookingId, req.user.idusers, amount],
    );
    if (!result.affectedRows)
      return res
        .status(409)
        .json({ success: false, message: 'That refund request is not eligible.' });
    await notifyAdmins({
      bookingId,
      type: 'refund_requested',
      title: 'Refund requested',
      message: `A customer requested a refund of R${amount.toFixed(2)}.`,
    });
    recordAuditEvent({
      actorId: req.user.idusers,
      action: 'REFUND_REQUESTED',
      entityType: 'refund',
      entityId: result.insertId,
      metadata: { amount },
      ipAddress: req.ip,
    });
    return res.status(201).json({
      success: true,
      id: result.insertId,
      message: 'Refund request submitted for review.',
    });
  } catch (error) {
    next(error);
  }
});

router.post('/reschedules', requireCustomer, async (req, res, next) => {
  const bookingId = Number(req.body.booking_id);
  const schedule = normalizeSchedule(req.body.starts_at, req.body.ends_at);
  const reason = cleanText(req.body.reason, { min: 5, max: 500 });
  if (!Number.isInteger(bookingId) || bookingId <= 0 || !schedule || !reason) {
    return res
      .status(400)
      .json({ success: false, message: 'Provide a valid future schedule and reason.' });
  }
  let db;
  let requestId;
  try {
    db = await database.promise().getConnection();
    await beginSchedulingTransaction(db);
    const { booking, requests } = await lockBooking(db, bookingId);
    if (booking.idUser !== req.user.idusers || booking.status !== 'ASSIGNED' || requests.length) {
      throw new SchedulingError(
        'This booking cannot be rescheduled or already has a pending request.',
      );
    }
    const [result] = await db.query(
      `INSERT INTO reschedule_requests
      (booking_id, requested_by, proposed_start, proposed_end, reason) VALUES (?, ?, ?, ?, ?)`,
      [bookingId, req.user.idusers, schedule.start, schedule.end, reason],
    );
    requestId = result.insertId;
    await db.commit();
  } catch (error) {
    if (db) await db.rollback();
    return next(error);
  } finally {
    if (db) db.release();
  }
  await notifyAdmins({
    bookingId,
    type: 'reschedule_requested',
    title: 'Reschedule requested',
    message: 'A customer proposed a new visit time.',
  });
  await recordAuditEvent({
    actorId: req.user.idusers,
    action: 'RESCHEDULE_REQUESTED',
    entityType: 'reschedule_request',
    entityId: requestId,
    ipAddress: req.ip,
  });
  return res.status(201).json({ success: true, message: 'Reschedule request submitted.' });
});
router.post('/disputes/:id/status', requireAdmin, async (req, res, next) => {
  const id = Number(req.params.id);
  const status = String(req.body.status || '').toUpperCase();
  const resolution = cleanText(req.body.resolution, { min: 0, max: 2000 });
  if (!Number.isInteger(id) || !['INVESTIGATING', 'RESOLVED', 'CLOSED'].includes(status)) {
    return res.status(400).json({ success: false, message: 'Invalid dispute status.' });
  }
  try {
    const [result] = await database.promise().query(
      `UPDATE disputes SET status = ?, resolution = ?, handled_by = ?,
       resolved_at = CASE WHEN ? IN ('RESOLVED','CLOSED') THEN NOW() ELSE NULL END WHERE id = ?`,
      [status, resolution, req.user.idusers, status, id],
    );
    if (!result.affectedRows)
      return res.status(404).json({ success: false, message: 'Dispute not found.' });
    const [[dispute]] = await database
      .promise()
      .query('SELECT opened_by, booking_id FROM disputes WHERE id = ?', [id]);
    createNotification({
      userId: dispute.opened_by,
      bookingId: dispute.booking_id,
      type: 'dispute_updated',
      title: `Dispute ${status.toLowerCase()}`,
      message: resolution || `Your dispute is now ${status.toLowerCase()}.`,
    });
    recordAuditEvent({
      actorId: req.user.idusers,
      action: 'DISPUTE_STATUS_CHANGED',
      entityType: 'dispute',
      entityId: id,
      metadata: { status },
      ipAddress: req.ip,
    });
    return res.json({ success: true, message: 'Dispute updated.' });
  } catch (error) {
    next(error);
  }
});

router.post('/refunds/:id/status', requireAdmin, async (req, res, next) => {
  const id = Number(req.params.id);
  const status = String(req.body.status || '').toUpperCase();
  const note = cleanText(req.body.note, { min: 0, max: 1000 });
  if (!Number.isInteger(id) || !['APPROVED', 'REJECTED'].includes(status)) {
    return res.status(400).json({ success: false, message: 'Invalid refund decision.' });
  }
  try {
    const [result] = await database
      .promise()
      .query(
        "UPDATE refunds SET status = ?, response_note = ?, processed_by = ? WHERE id = ? AND status = 'REQUESTED'",
        [status, note, req.user.idusers, id],
      );
    if (!result.affectedRows)
      return res
        .status(409)
        .json({ success: false, message: 'Refund request is no longer pending.' });
    const [[refund]] = await database
      .promise()
      .query('SELECT requested_by, booking_id FROM refunds WHERE id = ?', [id]);
    createNotification({
      userId: refund.requested_by,
      bookingId: refund.booking_id,
      type: 'refund_decided',
      title: `Refund ${status.toLowerCase()}`,
      message: note || `Your refund request was ${status.toLowerCase()}.`,
    });
    recordAuditEvent({
      actorId: req.user.idusers,
      action: 'REFUND_DECIDED',
      entityType: 'refund',
      entityId: id,
      metadata: { status },
      ipAddress: req.ip,
    });
    return res.json({ success: true, message: `Refund ${status.toLowerCase()}.` });
  } catch (error) {
    next(error);
  }
});

router.post('/refunds/:id/process', requireAdmin, async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id))
    return res.status(400).json({ success: false, message: 'Invalid refund.' });
  let db;
  try {
    db = await database.promise().getConnection();
    await db.beginTransaction();
    const [rows] = await db.query(
      `SELECT r.*, pr.provider, pr.provider_payment_id, pr.currency
       FROM refunds r JOIN payment_receipts pr ON pr.booking_id = r.booking_id
       WHERE r.id = ? AND r.status = 'APPROVED' FOR UPDATE`,
      [id],
    );
    if (!rows.length) {
      await db.rollback();
      return res
        .status(409)
        .json({ success: false, message: 'Only an approved refund can be processed.' });
    }
    const refund = rows[0];
    let providerRefundId = null;
    if (refund.provider === 'STRIPE') {
      if (!stripe || !refund.provider_payment_id) {
        await db.rollback();
        return res
          .status(503)
          .json({ success: false, message: 'Stripe refund processing is not configured.' });
      }
      await db.query("UPDATE refunds SET status = 'PROCESSING' WHERE id = ?", [id]);
      const providerRefund = await stripe.refunds.create(
        {
          payment_intent: refund.provider_payment_id,
          amount: Math.round(Number(refund.amount) * 100),
        },
        { idempotencyKey: `wefixit-refund-${id}` },
      );
      providerRefundId = providerRefund.id;
    }
    await db.query(
      "UPDATE refunds SET status = 'REFUNDED', provider_refund_id = ?, processed_by = ?, processed_at = NOW() WHERE id = ?",
      [providerRefundId || `SIMULATED-${id}`, req.user.idusers, id],
    );
    await db.commit();
    createNotification({
      userId: refund.requested_by,
      bookingId: refund.booking_id,
      type: 'refund_completed',
      title: 'Refund completed',
      message: `Your refund of R${Number(refund.amount).toFixed(2)} has been processed.`,
    });
    recordAuditEvent({
      actorId: req.user.idusers,
      action: 'REFUND_PROCESSED',
      entityType: 'refund',
      entityId: id,
      metadata: { provider: refund.provider, providerRefundId },
      ipAddress: req.ip,
    });
    return res.json({ success: true, message: 'Refund processed.' });
  } catch (error) {
    if (db) await db.rollback();
    next(error);
  } finally {
    if (db) db.release();
  }
});

router.post('/reschedules/:id/respond', requireAdmin, async (req, res, next) => {
  const id = Number(req.params.id);
  const decision = String(req.body.decision || '').toUpperCase();
  const responseNote = cleanText(req.body.note, { min: 0, max: 500 });
  if (!Number.isInteger(id) || id <= 0 || !['APPROVED', 'REJECTED'].includes(decision)) {
    return res.status(400).json({ success: false, message: 'Invalid reschedule decision.' });
  }
  let db;
  let request;
  let change;
  try {
    db = await database.promise().getConnection();
    await beginSchedulingTransaction(db);
    const [[lookup]] = await db.query('SELECT booking_id FROM reschedule_requests WHERE id = ?', [
      id,
    ]);
    if (!lookup) throw new SchedulingError('Reschedule request not found.', 404);
    const { booking, requests } = await lockBooking(db, lookup.booking_id);
    request = requests.find((row) => row.id === id);
    if (!request) throw new SchedulingError('Reschedule request is no longer pending.');
    if (decision === 'APPROVED') {
      const schedule = normalizeSchedule(request.proposed_start, request.proposed_end);
      if (booking.status !== 'ASSIGNED' || !booking.idPlumber || !schedule) {
        throw new SchedulingError(
          'Only an assigned booking with a future proposal can be rescheduled.',
        );
      }
      await validateSlot(db, booking.idbookings, booking.idPlumber, schedule.start, schedule.end);
      change = await saveSchedule(
        db,
        booking,
        booking.idPlumber,
        schedule.start,
        schedule.end,
        req.user.idusers,
        req.ip,
      );
    }
    await db.query(
      'UPDATE reschedule_requests SET status = ?, reviewed_by = ?, response_note = ?, responded_at = NOW() WHERE id = ?',
      [decision, req.user.idusers, responseNote, id],
    );
    await db.query(
      `INSERT INTO audit_events (actor_id, action, entity_type, entity_id, metadata, ip_address)
      VALUES (?, 'RESCHEDULE_DECIDED', 'reschedule_request', ?, ?, ?)`,
      [req.user.idusers, String(id), JSON.stringify({ decision }), req.ip || null],
    );
    await db.commit();
  } catch (error) {
    if (db) await db.rollback();
    return next(error);
  } finally {
    if (db) db.release();
  }
  await notifySchedule(change);
  await createNotification({
    userId: request.requested_by,
    bookingId: request.booking_id,
    type: 'reschedule_response',
    title: `Reschedule ${decision.toLowerCase()}`,
    message: responseNote || `Your reschedule request was ${decision.toLowerCase()}.`,
  });
  return res.json({ success: true, message: `Reschedule request ${decision.toLowerCase()}.` });
});
router.get('/', async (req, res, next) => {
  try {
    if (![1, 2].includes(req.user.usertype))
      return res.status(403).send('Customer or administrator access required.');
    const isAdmin = req.user.usertype === 2;
    const ownerClause = isAdmin ? '' : 'AND b.idUser = ?';
    const params = isAdmin ? [] : [req.user.idusers];
    const [disputes, refunds, reschedules, bookings] = await Promise.all([
      database
        .promise()
        .query(
          `SELECT d.*, b.type FROM disputes d JOIN bookings b ON b.idbookings = d.booking_id WHERE 1=1 ${ownerClause} ORDER BY d.created_at DESC LIMIT 100`,
          params,
        ),
      database
        .promise()
        .query(
          `SELECT r.*, b.type FROM refunds r JOIN bookings b ON b.idbookings = r.booking_id WHERE 1=1 ${ownerClause} ORDER BY r.created_at DESC LIMIT 100`,
          params,
        ),
      database
        .promise()
        .query(
          `SELECT rr.*, b.type FROM reschedule_requests rr JOIN bookings b ON b.idbookings = rr.booking_id WHERE 1=1 ${ownerClause} ORDER BY rr.created_at DESC LIMIT 100`,
          params,
        ),
      isAdmin
        ? Promise.resolve([[]])
        : database
            .promise()
            .query(
              "SELECT idbookings, type, status, amount FROM bookings WHERE idUser = ? AND status IN ('ASSIGNED','IN_PROGRESS','COMPLETED','PAID') ORDER BY created_at DESC",
              params,
            ),
    ]);
    res.render('support', {
      title: isAdmin ? 'Operations cases' : 'Help with a booking',
      isAdmin,
      disputes: disputes[0],
      refunds: refunds[0],
      reschedules: reschedules[0],
      bookings: bookings[0],
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
