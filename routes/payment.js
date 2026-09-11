const express = require('express');
const router = express.Router();
const connection = require('../database/connection');
const { verifyToken, isCustomer } = require('../middleware/auth');
const { createNotification } = require('../utils/notifications');
const stripe = process.env.STRIPE_SECRET_KEY
  ? require('stripe')(process.env.STRIPE_SECRET_KEY)
  : null;
const { streamReceipt } = require('../utils/pdfDocuments');
const { recordAuditEvent } = require('../utils/audit');
const { normalizePagination } = require('../utils/validation');

router.use(verifyToken);
router.use(isCustomer);

function toMoney(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function buildInvoiceNumber(bookingId) {
  return `INV-${String(bookingId).padStart(6, '0')}`;
}

function buildReceiptNumber(bookingId) {
  const stamp = new Date()
    .toISOString()
    .replace(/[-:.TZ]/g, '')
    .slice(0, 14);
  return `RCPT-${String(bookingId).padStart(6, '0')}-${stamp}`;
}

function normalizeDbReceipt(row, fallback = {}) {
  if (!row) {
    return null;
  }

  return {
    id: String(row.idreceipt),
    receiptNumber: row.receipt_number,
    bookingId: String(row.booking_id),
    userId: String(row.customer_id),
    plumberId:
      row.plumber_id === null || row.plumber_id === undefined ? null : String(row.plumber_id),
    amount: toMoney(row.amount_paid),
    serviceType: row.service_type || fallback.serviceType || null,
    description: row.description || fallback.description || null,
    paymentMethod: row.payment_method || 'SIMULATED',
    paidAt:
      row.paid_at instanceof Date ? row.paid_at.toISOString() : new Date(row.paid_at).toISOString(),
    invoiceNumber: row.invoice_number || fallback.invoiceNumber || null,
  };
}

function getPersistentReceiptForBooking(bookingId, userId, callback) {
  const query = `
        SELECT r.idreceipt, r.receipt_number, r.booking_id, r.customer_id, r.plumber_id,
               r.payment_method, r.amount_paid, r.paid_at,
               i.invoice_number
        FROM payment_receipts r
        JOIN invoices i ON i.idinvoice = r.invoice_id
        WHERE r.booking_id = ? AND r.customer_id = ?
        LIMIT 1
    `;

  connection.query(query, [bookingId, userId], (err, rows) => {
    if (err) {
      return callback(err);
    }
    if (!rows || rows.length === 0) {
      return callback(null, null);
    }
    callback(null, normalizeDbReceipt(rows[0]));
  });
}

/* GET Payment page. */
router.get('/', (req, res) => {
  const bookingId = req.query.booking_id;
  if (!bookingId) return res.status(400).send('Booking ID required');

  // Fetch booking details
  const query =
    'SELECT * FROM bookings WHERE idbookings = ? AND idUser = ? AND status IN ("COMPLETED", "PAID")';
  connection.query(query, [bookingId, req.user.idusers], (err, results) => {
    if (err || results.length === 0)
      return res.status(404).send('Booking not found or not completed');
    const booking = results[0];
    getPersistentReceiptForBooking(booking.idbookings, req.user.idusers, (_, receipt) => {
      res.render('payment', {
        title: 'Payment',
        booking,
        receipt,
        stripeEnabled: Boolean(stripe),
        simulatedEnabled: process.env.ENABLE_SIMULATED_PAYMENTS === 'true',
      });
    });
  });
});

router.post('/checkout', async (req, res, next) => {
  if (!stripe)
    return res.status(503).json({ success: false, message: 'Online payments are not configured.' });
  try {
    const bookingId = Number(req.body.booking_id);
    const [rows] = await connection.promise().query(
      `SELECT b.idbookings, b.idUser, b.type, b.amount, b.currency
             FROM bookings b JOIN completion_confirmations cc ON cc.booking_id = b.idbookings
             JOIN quotes q ON q.booking_id = b.idbookings AND q.status = 'APPROVED'
             WHERE b.idbookings = ? AND b.idUser = ? AND b.status = 'COMPLETED' AND b.amount > 0
             ORDER BY q.idquote DESC LIMIT 1`,
      [bookingId, req.user.idusers],
    );
    if (!rows.length)
      return res.status(409).json({
        success: false,
        message: 'Approve the quote and confirm completion before paying.',
      });
    const booking = rows[0];
    const baseUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
    const checkout = await stripe.checkout.sessions.create(
      {
        mode: 'payment',
        client_reference_id: String(booking.idbookings),
        line_items: [
          {
            price_data: {
              currency: String(booking.currency || 'ZAR').toLowerCase(),
              product_data: { name: booking.type.replace(/_/g, ' ') },
              unit_amount: Math.round(Number(booking.amount) * 100),
            },
            quantity: 1,
          },
        ],
        success_url: `${baseUrl}/payment/success?booking_id=${booking.idbookings}`,
        cancel_url: `${baseUrl}/payment?booking_id=${booking.idbookings}`,
        customer_email: req.user.email,
        metadata: { bookingId: String(booking.idbookings), customerId: String(booking.idUser) },
      },
      { idempotencyKey: `wefixit-checkout-${booking.idbookings}` },
    );
    res.json({ success: true, url: checkout.url });
  } catch (error) {
    next(error);
  }
});

/* POST /payment/process - Simulate payment */
router.post('/process', async (req, res, next) => {
  if (process.env.ENABLE_SIMULATED_PAYMENTS !== 'true') {
    return res.status(403).json({ success: false, message: 'Simulated payments are disabled.' });
  }
  const bookingId = Number(req.body.booking_id);
  if (!Number.isInteger(bookingId)) {
    return res.status(400).json({ success: false, message: 'booking_id is required' });
  }
  let db;
  try {
    db = await connection.promise().getConnection();
    await db.beginTransaction();
    const [bookings] = await db.query(
      `SELECT b.idbookings, b.idUser, b.idPlumber, b.amount, b.currency, b.type, b.description
             FROM bookings b
             WHERE b.idbookings = ? AND b.idUser = ? AND b.status = 'COMPLETED' AND b.amount > 0
               AND EXISTS (SELECT 1 FROM completion_confirmations cc WHERE cc.booking_id = b.idbookings)
               AND EXISTS (SELECT 1 FROM quotes q WHERE q.booking_id = b.idbookings AND q.status = 'APPROVED')
             FOR UPDATE`,
      [bookingId, req.user.idusers],
    );
    if (!bookings.length) {
      await db.rollback();
      return res.status(409).json({
        success: false,
        message: 'Approve the quote and confirm completed work before paying.',
      });
    }
    const booking = bookings[0];
    await db.query("UPDATE bookings SET status = 'PAID' WHERE idbookings = ?", [bookingId]);
    const invoiceNumber = buildInvoiceNumber(bookingId);
    await db.query(
      `INSERT INTO invoices (invoice_number, booking_id, customer_id, plumber_id, service_type, description,
              subtotal, tax_amount, total_amount, currency, status, issued_at, paid_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 'PAID', NOW(), NOW())
             ON DUPLICATE KEY UPDATE status = 'PAID', paid_at = COALESCE(paid_at, NOW())`,
      [
        invoiceNumber,
        bookingId,
        booking.idUser,
        booking.idPlumber,
        booking.type,
        booking.description,
        booking.amount,
        booking.amount,
        booking.currency || 'ZAR',
      ],
    );
    const [[invoice]] = await db.query('SELECT idinvoice FROM invoices WHERE booking_id = ?', [
      bookingId,
    ]);
    const receiptNumber = buildReceiptNumber(bookingId);
    await db.query(
      `INSERT INTO payment_receipts (receipt_number, invoice_id, booking_id, customer_id, plumber_id,
              provider, payment_method, amount_paid, currency, paid_at, notes)
             VALUES (?, ?, ?, ?, ?, 'SIMULATED', 'SIMULATED', ?, ?, NOW(), 'Development-only simulated payment')
             ON DUPLICATE KEY UPDATE invoice_id = VALUES(invoice_id), amount_paid = VALUES(amount_paid)`,
      [
        receiptNumber,
        invoice.idinvoice,
        bookingId,
        booking.idUser,
        booking.idPlumber,
        booking.amount,
        booking.currency || 'ZAR',
      ],
    );
    const [[receiptRow]] = await db.query(
      `SELECT r.idreceipt, r.receipt_number, r.booking_id, r.customer_id, r.plumber_id,
              r.payment_method, r.amount_paid, r.paid_at, i.invoice_number
             FROM payment_receipts r JOIN invoices i ON i.idinvoice = r.invoice_id WHERE r.booking_id = ?`,
      [bookingId],
    );
    await db.commit();
    const receipt = normalizeDbReceipt(receiptRow, {
      serviceType: booking.type,
      description: booking.description,
    });
    createNotification({
      userId: booking.idUser,
      role: 'customer',
      bookingId,
      type: 'booking_paid',
      title: 'Payment completed',
      message: 'Your payment was processed successfully.',
    });
    if (booking.idPlumber)
      createNotification({
        userId: booking.idPlumber,
        role: 'plumber',
        bookingId,
        type: 'booking_paid',
        title: 'Customer payment received',
        message: 'A customer has paid for a completed booking.',
      });
    recordAuditEvent({
      actorId: req.user.idusers,
      action: 'PAYMENT_COMPLETED',
      entityType: 'booking',
      entityId: bookingId,
      metadata: { provider: 'SIMULATED', amount: booking.amount },
      ipAddress: req.ip,
    });
    return res.json({
      success: true,
      message: 'Payment simulated successfully',
      receiptNumber: receipt.receiptNumber,
    });
  } catch (error) {
    if (db) await db.rollback();
    return next(error);
  } finally {
    if (db) db.release();
  }
});

// GET /payment/success - Confirmation page
router.get('/success', (req, res) => {
  const bookingId = req.query.booking_id;
  if (!bookingId) return res.status(400).send('Booking ID required');

  const query =
    'SELECT idbookings FROM bookings WHERE idbookings = ? AND idUser = ? AND status = "PAID"';
  connection.query(query, [bookingId, req.user.idusers], (err, results) => {
    if (err || results.length === 0) return res.status(404).send('Payment record not found');
    getPersistentReceiptForBooking(bookingId, req.user.idusers, (_, receipt) => {
      res.render('payment-success', { title: 'Payment Success', booking_id: bookingId, receipt });
    });
  });
});

// GET /payment/history - Paid receipts and completed invoices
router.get('/history', async (req, res, next) => {
  const { page, pageSize, offset } = normalizePagination(req.query);
  try {
    const [[rows], [[count]]] = await Promise.all([
      connection.promise().query(
        `SELECT b.idbookings, b.type, b.amount, b.status, b.date_start, b.description,
          r.idreceipt, r.receipt_number, r.booking_id, r.customer_id, r.plumber_id,
          r.payment_method, r.amount_paid, r.paid_at, i.invoice_number
         FROM bookings b
         LEFT JOIN payment_receipts r ON r.booking_id = b.idbookings
         LEFT JOIN invoices i ON i.idinvoice = r.invoice_id
         WHERE b.idUser = ? AND b.status IN ('COMPLETED', 'PAID')
         ORDER BY b.idbookings DESC LIMIT ? OFFSET ?`,
        [req.user.idusers, pageSize, offset],
      ),
      connection
        .promise()
        .query(
          "SELECT COUNT(*) AS total FROM bookings WHERE idUser = ? AND status IN ('COMPLETED','PAID')",
          [req.user.idusers],
        ),
    ]);
    const history = rows.map((row) => {
      const receipt = row.idreceipt
        ? normalizeDbReceipt(row, { serviceType: row.type, description: row.description })
        : null;
      return {
        ...row,
        amount: toMoney(row.amount),
        receipt,
        invoiceNumber: receipt?.invoiceNumber || buildInvoiceNumber(row.idbookings),
        isPaid: row.status === 'PAID' && Boolean(receipt),
      };
    });
    res.render('payment-history', {
      title: 'Invoices & Receipts',
      history,
      pagination: { page, pages: Math.max(1, Math.ceil(count.total / pageSize)) },
    });
  } catch (error) {
    next(error);
  }
});

// GET /payment/receipt/:bookingId - Render a single receipt page
router.get('/receipt/:bookingId', (req, res) => {
  const bookingId = req.params.bookingId;

  const query =
    'SELECT idbookings, idUser, type, amount, status FROM bookings WHERE idbookings = ? AND idUser = ?';
  connection.query(query, [bookingId, req.user.idusers], (err, results) => {
    if (err || results.length === 0) {
      return res.status(404).send('Receipt not found');
    }

    const booking = results[0];
    getPersistentReceiptForBooking(bookingId, req.user.idusers, (_, receipt) => {
      if (!receipt || booking.status !== 'PAID') {
        return res.status(404).send('Receipt not found for this booking');
      }

      res.render('receipt', {
        title: 'Payment Receipt',
        booking,
        receipt,
      });
    });
  });
});

router.get('/receipt/:bookingId/pdf', (req, res) => {
  const bookingId = Number(req.params.bookingId);
  connection.query(
    "SELECT idbookings, type, amount, status FROM bookings WHERE idbookings = ? AND idUser = ? AND status = 'PAID'",
    [bookingId, req.user.idusers],
    (error, bookings) => {
      if (error || !bookings.length) return res.status(404).send('Receipt not found');
      getPersistentReceiptForBooking(bookingId, req.user.idusers, (receiptError, receipt) => {
        if (receiptError || !receipt) return res.status(404).send('Receipt not found');
        streamReceipt(res, bookings[0], receipt);
      });
    },
  );
});

module.exports = router;

router.stripeWebhookHandler = async function stripeWebhookHandler(req, res) {
  if (!stripe || !process.env.STRIPE_WEBHOOK_SECRET)
    return res.status(503).send('Stripe webhook is not configured');
  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      req.headers['stripe-signature'],
      process.env.STRIPE_WEBHOOK_SECRET,
    );
  } catch (error) {
    return res.status(400).send(`Webhook error: ${error.message}`);
  }
  if (event.type !== 'checkout.session.completed') return res.json({ received: true });

  const checkout = event.data.object;
  const bookingId = Number(checkout.metadata?.bookingId);
  const customerId = Number(checkout.metadata?.customerId);
  if (
    !Number.isInteger(bookingId) ||
    !Number.isInteger(customerId) ||
    checkout.payment_status !== 'paid'
  ) {
    return res.status(400).send('Invalid or unpaid Checkout session');
  }
  let db;
  let newlyPaid = false;
  let paidBooking;
  try {
    db = await connection.promise().getConnection();
    await db.beginTransaction();
    const [bookings] = await db.query(
      `SELECT idbookings, idUser, idPlumber, type, description, amount, currency, status
             FROM bookings WHERE idbookings = ? AND idUser = ? FOR UPDATE`,
      [bookingId, customerId],
    );
    if (!bookings.length) throw new Error('Payment booking not found');
    const booking = bookings[0];
    paidBooking = booking;
    if (!['COMPLETED', 'PAID'].includes(booking.status)) {
      throw new Error(`Booking ${bookingId} is not payable from status ${booking.status}`);
    }
    const expectedAmount = Math.round(Number(booking.amount) * 100);
    if (
      checkout.amount_total !== expectedAmount ||
      String(checkout.currency).toUpperCase() !== String(booking.currency || 'ZAR').toUpperCase()
    ) {
      throw new Error(`Checkout amount or currency does not match booking ${bookingId}`);
    }
    if (booking.status !== 'PAID') {
      const [statusUpdate] = await db.query(
        "UPDATE bookings SET status = 'PAID' WHERE idbookings = ? AND status = 'COMPLETED'",
        [bookingId],
      );
      if (!statusUpdate.affectedRows) throw new Error('Concurrent payment state change detected');
      newlyPaid = true;
      const invoiceNumber = buildInvoiceNumber(bookingId);
      await db.query(
        `INSERT INTO invoices (invoice_number, booking_id, customer_id, plumber_id, service_type, description, subtotal, tax_amount, total_amount, currency, status, issued_at, paid_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 'PAID', NOW(), NOW())
                 ON DUPLICATE KEY UPDATE status = 'PAID', paid_at = NOW()`,
        [
          invoiceNumber,
          bookingId,
          customerId,
          booking.idPlumber,
          booking.type,
          booking.description,
          booking.amount,
          booking.amount,
          booking.currency,
        ],
      );
      const [invoices] = await db.query('SELECT idinvoice FROM invoices WHERE booking_id = ?', [
        bookingId,
      ]);
      await db.query(
        `INSERT INTO payment_receipts (receipt_number, invoice_id, booking_id, customer_id, plumber_id, provider, provider_payment_id, payment_method, amount_paid, currency, paid_at)
                 VALUES (?, ?, ?, ?, ?, 'STRIPE', ?, 'CARD', ?, ?, NOW())
                 ON DUPLICATE KEY UPDATE provider_payment_id = VALUES(provider_payment_id)`,
        [
          buildReceiptNumber(bookingId),
          invoices[0].idinvoice,
          bookingId,
          customerId,
          booking.idPlumber,
          checkout.payment_intent,
          booking.amount,
          booking.currency,
        ],
      );
    }
    await db.commit();
    if (newlyPaid) {
      createNotification({
        userId: customerId,
        bookingId,
        type: 'booking_paid',
        title: 'Payment completed',
        message: 'Your secure card payment was received.',
      });
      if (paidBooking.idPlumber)
        createNotification({
          userId: paidBooking.idPlumber,
          bookingId,
          type: 'booking_paid',
          title: 'Customer payment received',
          message: 'A customer has paid securely for a completed booking.',
        });
      recordAuditEvent({
        actorId: customerId,
        action: 'PAYMENT_COMPLETED',
        entityType: 'booking',
        entityId: bookingId,
        metadata: {
          provider: 'STRIPE',
          paymentIntent: checkout.payment_intent,
          amount: paidBooking.amount,
        },
      });
    }
    res.json({ received: true });
  } catch (error) {
    if (db) await db.rollback();
    console.error('Stripe webhook processing failed', error);
    res.status(500).send('Webhook processing failed');
  } finally {
    if (db) db.release();
  }
};
