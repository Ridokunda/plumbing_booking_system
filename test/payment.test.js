const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const path = require('node:path');
const request = require('supertest');

process.env.NODE_ENV = 'test';
process.env.ENABLE_SIMULATED_PAYMENTS = 'true';
process.env.STRIPE_SECRET_KEY = '';
process.env.EMAIL_NOTIFICATIONS = 'false';

const paymentRouter = require('../routes/payment');
const database = require('../database/connection');
const { csrfProtection } = require('../middleware/security');
const csrf = 'a'.repeat(64);

function setup(t, { failReceipt = false } = {}) {
  const state = {
    booking: {
      idbookings: 16,
      idUser: 42,
      idPlumber: 43,
      type: 'Installation',
      description: 'Demo job',
      amount: 2645,
      currency: 'ZAR',
      status: 'COMPLETED',
    },
    approved: true,
    confirmed: true,
    invoice: null,
    receipt: null,
    events: [],
    writes: [],
    commits: 0,
    rollbacks: 0,
    releases: 0,
  };
  let snapshot;
  const db = {
    async beginTransaction() {
      snapshot = JSON.parse(
        JSON.stringify({
          booking: state.booking,
          invoice: state.invoice,
          receipt: state.receipt,
        }),
      );
    },
    async commit() {
      state.commits++;
    },
    async rollback() {
      Object.assign(state, snapshot);
      state.rollbacks++;
    },
    release() {
      state.releases++;
    },
    async query(sql, params) {
      if (sql.includes('FROM bookings b')) {
        assert.match(sql, /FOR UPDATE/);
        assert.match(sql, /EXISTS.*completion_confirmations/s);
        assert.match(sql, /EXISTS.*quotes.*APPROVED/s);
        const eligible =
          params[0] === 16 &&
          params[1] === 42 &&
          state.approved &&
          state.confirmed &&
          ['COMPLETED', 'PAID'].includes(state.booking.status) &&
          state.booking.amount > 0;
        return [eligible ? [{ ...state.booking }] : []];
      }
      if (sql.startsWith('UPDATE bookings')) {
        state.writes.push('booking');
        state.booking.status = 'PAID';
        return [{ affectedRows: 1 }];
      }
      if (sql.includes('INSERT INTO invoices')) {
        state.writes.push('invoice');
        state.invoice = { idinvoice: 11, invoice_number: params[0] };
        return [{ insertId: 11 }];
      }
      if (sql.startsWith('SELECT idinvoice')) return [[state.invoice]];
      if (sql.includes('INSERT INTO payment_receipts')) {
        if (failReceipt) throw new Error('Simulated receipt storage failure');
        state.writes.push('receipt');
        state.receipt = {
          idreceipt: 21,
          receipt_number: params[0],
          booking_id: params[2],
          customer_id: params[3],
          plumber_id: params[4],
          provider: 'SIMULATED',
          payment_method: 'SIMULATED',
          amount_paid: params[5],
          paid_at: new Date(),
          invoice_number: state.invoice.invoice_number,
        };
        return [{ insertId: 21 }];
      }
      if (sql.includes('FROM payment_receipts'))
        return [state.receipt ? [{ ...state.receipt }] : []];
      throw new Error(`Unexpected transaction query: ${sql}`);
    },
  };
  t.mock.method(database, 'promise', () => ({
    getConnection: async () => db,
    async query(sql, params) {
      if (sql.includes('INSERT INTO notifications') || sql.includes('INSERT INTO audit_events')) {
        state.events.push({ sql, params });
        return [{ insertId: state.events.length }];
      }
      if (sql.includes('COUNT(*) AS total')) return [[{ total: 1 }]];
      if (sql.includes('FROM bookings b')) return [[{ ...state.booking, ...state.receipt }]];
      throw new Error(`Unexpected pool query: ${sql}`);
    },
  }));
  t.mock.method(database, 'query', (sql, params, callback) => {
    const owner = Number(params[0]) === 16 && params[1] === 42;
    if (sql.includes('FROM bookings'))
      return callback(
        null,
        owner
          ? [
              {
                ...state.booking,
                quote_approved: Number(state.approved),
                completion_confirmed: Number(state.confirmed),
              },
            ]
          : [],
      );
    if (sql.includes('FROM payment_receipts'))
      return callback(null, owner && state.receipt ? [{ ...state.receipt }] : []);
    throw new Error(`Unexpected callback query: ${sql}`);
  });
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = { csrfToken: csrf };
    if (req.get('x-test-user') !== 'anonymous')
      req.session.user = {
        idusers: Number(req.get('x-test-user') || 42),
        usertype: Number(req.get('x-test-role') || 1),
      };
    Object.assign(res.locals, {
      session: req.session,
      currentPath: req.path,
      notificationCount: 0,
    });
    next();
  });
  app.use(csrfProtection);
  app.set('views', path.resolve(__dirname, '../views'));
  app.set('view engine', 'ejs');
  app.use('/payment', paymentRouter);
  app.use((_error, _req, res, _next) =>
    res.status(500).json({ success: false, message: 'Payment could not be recorded.' }),
  );
  return { app, state };
}

function pay(app, body = { booking_id: 16 }) {
  return request(app)
    .post('/payment/process')
    .set('X-CSRF-Token', csrf)
    .set('Accept', 'application/json')
    .send(body);
}

test('demo checkout shows outcomes, amount, shared navigation, and no real card inputs', async (t) => {
  const { app } = setup(t);
  const page = await request(app).get('/payment?booking_id=16').expect(200);
  assert.match(page.text, /This is a payment simulation/);
  assert.match(page.text, /value="success"/);
  assert.match(page.text, /value="declined"/);
  assert.match(page.text, /class="site-header"/);
  assert.match(page.text, /Simulate payment/);
  assert.doesNotMatch(page.text, /name="(?:card_number|cvv|cvc|expiry)"/);
});

test('successful simulation uses the stored amount and labels all customer records as demo', async (t) => {
  const { app, state } = setup(t);
  const result = await pay(app, { booking_id: 16, outcome: 'success', amount: 0.01 }).expect(200);
  assert.equal(state.booking.status, 'PAID');
  assert.equal(state.receipt.amount_paid, 2645);
  assert.equal(state.receipt.provider, 'SIMULATED');
  assert.equal(result.body.url, '/payment/success?booking_id=16');
  assert.equal(state.commits, 1);
  assert.equal(state.releases, 1);
  assert.ok(state.events.some((event) => event.params.includes('PAYMENT_SIMULATED')));
  const success = await request(app).get(result.body.url).expect(200);
  assert.match(success.text, /Demo payment successful/);
  assert.match(success.text, /No real money was charged/);
  const receipt = await request(app).get('/payment/receipt/16').expect(200);
  assert.match(receipt.text, /Demo Payment Receipt/);
  assert.match(receipt.text, /demonstration only/);
  const history = await request(app).get('/payment/history').expect(200);
  assert.match(history.text, /SIMULATED · PAID/);
});

test('declined simulation leaves the booking unpaid and creates no billing records', async (t) => {
  const { app, state } = setup(t);
  const result = await pay(app, { booking_id: 16, outcome: 'declined' }).expect(402);
  assert.equal(result.body.code, 'SIMULATED_DECLINE');
  assert.equal(state.booking.status, 'COMPLETED');
  assert.equal(state.invoice, null);
  assert.equal(state.receipt, null);
  assert.deepEqual(state.writes, []);
  assert.deepEqual(state.events, []);
  assert.equal(state.rollbacks, 1);
  assert.equal(state.releases, 1);
});

test('retrying a completed simulation returns one receipt without duplicate writes or notifications', async (t) => {
  const { app, state } = setup(t);
  const first = await pay(app).expect(200);
  const writes = [...state.writes];
  const events = state.events.length;
  const retry = await pay(app).expect(200);
  assert.equal(retry.body.alreadyPaid, true);
  assert.equal(retry.body.receiptNumber, first.body.receiptNumber);
  assert.deepEqual(state.writes, writes);
  assert.equal(state.events.length, events);
  assert.equal(state.commits, 1);
  assert.equal(state.releases, 2);
});

test('receipt failure rolls back the paid status and invoice', async (t) => {
  const { app, state } = setup(t, { failReceipt: true });
  await pay(app).expect(500);
  assert.equal(state.booking.status, 'COMPLETED');
  assert.equal(state.invoice, null);
  assert.equal(state.receipt, null);
  assert.equal(state.commits, 0);
  assert.equal(state.rollbacks, 1);
  assert.equal(state.releases, 1);
  assert.deepEqual(state.events, []);
});

test('simulation enforces ownership, approved quote, completion confirmation, amount and lifecycle', async (t) => {
  const { app, state } = setup(t);
  await pay(app).set('x-test-user', '99').expect(409);
  for (const field of ['approved', 'confirmed']) {
    state[field] = false;
    await pay(app).expect(409);
    state[field] = true;
  }
  state.booking.amount = 0;
  await pay(app).expect(409);
  state.booking.amount = 2645;
  state.booking.status = 'ASSIGNED';
  await pay(app).expect(409);
  assert.deepEqual(state.writes, []);
});

test('simulation requires a customer session, CSRF token, and explicit demo flag', async (t) => {
  const { app, state } = setup(t);
  await pay(app).set('x-test-user', 'anonymous').expect(401);
  await pay(app).set('x-test-role', '3').expect(403);
  await request(app).post('/payment/process').send({ booking_id: 16 }).expect(403);
  process.env.ENABLE_SIMULATED_PAYMENTS = 'false';
  t.after(() => {
    process.env.ENABLE_SIMULATED_PAYMENTS = 'true';
  });
  await pay(app).expect(403);
  const page = await request(app).get('/payment?booking_id=16').expect(200);
  assert.match(page.text, /Payments unavailable/);
  assert.doesNotMatch(page.text, /data-mode="simulation"/);
  assert.deepEqual(state.writes, []);
});

test('simulation rejects malformed IDs and outcomes without starting a transaction', async (t) => {
  const { app, state } = setup(t);
  for (const booking_id of [0, -1, 'invalid', 1.5]) await pay(app, { booking_id }).expect(400);
  await pay(app, { booking_id: 16, outcome: 'unknown' }).expect(400);
  assert.equal(state.releases, 0);
  assert.deepEqual(state.writes, []);
});
