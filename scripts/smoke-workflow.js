const request = require('supertest');

process.env.SESSION_SECRET = 'workflow-smoke-secret-with-at-least-32-characters';
process.env.COOKIE_SECURE = 'false';
process.env.ENABLE_SIMULATED_PAYMENTS = 'true';

const app = require('../app');
const database = require('../database/connection');

async function token(agent, path) {
  const response = await agent.get(path).expect(200);
  const cookie = response.headers['set-cookie']?.find((value) => value.startsWith('csrfToken='));
  if (!cookie) throw new Error(`No CSRF token returned by ${path}`);
  return decodeURIComponent(cookie.split(';')[0].split('=').slice(1).join('='));
}

async function login(email, password) {
  const agent = request.agent(app);
  const csrf = await token(agent, '/login');
  await agent.post('/login/log').set('X-CSRF-Token', csrf).send({ email, password }).expect(200);
  return agent;
}

async function post(agent, refreshPath, path, body, expected = 200) {
  const csrf = await token(agent, refreshPath);
  return agent.post(path).set('X-CSRF-Token', csrf).send(body).expect(expected);
}

async function cleanup(bookingId, availabilityId, auditEntities) {
  const db = database.promise();
  const tables = [
    'payment_receipts',
    'invoices',
    'completion_confirmations',
    'reviews',
    'refunds',
    'disputes',
    'reschedule_requests',
    'job_notes',
    'booking_photos',
    'notifications',
    'booking_status_history',
    'booking_dates',
    'quotes',
  ];
  for (const table of tables) {
    await db.query(`DELETE FROM ${table} WHERE booking_id = ?`, [bookingId]);
  }
  await db.query("DELETE FROM audit_events WHERE entity_type = 'booking' AND entity_id = ?", [
    String(bookingId),
  ]);
  for (const [entityType, entityId] of auditEntities) {
    if (entityId) {
      await db.query('DELETE FROM audit_events WHERE entity_type = ? AND entity_id = ?', [
        entityType,
        String(entityId),
      ]);
    }
  }
  await db.query('DELETE FROM bookings WHERE idbookings = ?', [bookingId]);
  if (availabilityId) {
    await db.query('DELETE FROM plumber_availability WHERE id = ?', [availabilityId]);
  }
}

async function smoke() {
  const password = process.env.DEMO_PASSWORD || 'PortfolioDemo!2026';
  const [customer, plumber, admin] = await Promise.all([
    login('customer@wefixit.local', password),
    login('plumber@wefixit.local', password),
    login('admin@wefixit.local', password),
  ]);
  const [plumberRows] = await database
    .promise()
    .query("SELECT idusers FROM users WHERE email = 'plumber@wefixit.local'");
  const start = new Date(Date.now() + 72 * 60 * 60 * 1000);
  start.setMinutes(0, 0, 0);
  const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
  const isoStart = start.toISOString();
  const isoEnd = end.toISOString();
  let bookingId;
  let availabilityId;
  const auditEntities = [];

  try {
    const availability = await post(
      plumber,
      '/plumber/availability',
      '/plumber/availability',
      {
        starts_at: isoStart,
        ends_at: isoEnd,
        availability_type: 'AVAILABLE',
      },
      201,
    );
    availabilityId = availability.body.id;
    auditEntities.push(['plumber_availability', availabilityId]);

    const booking = await post(
      customer,
      '/booking',
      '/booking/book',
      {
        service: 'Plumbing_Fix',
        description: 'Workflow smoke test booking for a leaking kitchen tap.',
        location: '1 Portfolio Street, Johannesburg',
        date_start: start.toISOString().slice(0, 10),
      },
      201,
    );
    bookingId = booking.body.bookingId;

    await post(admin, '/admin', '/admin/schedule', {
      booking_id: bookingId,
      plumber_id: plumberRows[0].idusers,
      starts_at: isoStart,
      ends_at: isoEnd,
    });

    const quote = await post(
      plumber,
      `/quotes/booking/${bookingId}`,
      `/quotes/booking/${bookingId}`,
      {
        items: [
          { description: 'Call-out and diagnosis', quantity: 1, unitPrice: 350 },
          { description: 'Replacement tap washer', quantity: 2, unitPrice: 75 },
        ],
      },
      201,
    );
    auditEntities.push(['quote', quote.body.quoteId]);
    await post(customer, `/quotes/booking/${bookingId}`, `/quotes/${quote.body.quoteId}/respond`, {
      decision: 'APPROVED',
    });
    await post(plumber, '/plumber/my-bookings', '/plumber/update-booking-status', {
      booking_id: bookingId,
      status: 'IN_PROGRESS',
    });
    await post(plumber, '/plumber/my-bookings', '/plumber/update-booking-status', {
      booking_id: bookingId,
      status: 'COMPLETED',
    });
    await post(customer, `/jobs/${bookingId}`, `/jobs/${bookingId}/confirm`, {
      signature_name: 'Demo Customer',
    });
    await customer
      .get(`/jobs/${bookingId}/pdf`)
      .expect('Content-Type', /application\/pdf/)
      .expect(200);
    const payment = await post(customer, `/payment?booking_id=${bookingId}`, '/payment/process', {
      booking_id: bookingId,
    });
    if (!payment.body.receiptNumber) throw new Error('Payment did not create a receipt');
    await customer.get(`/payment/receipt/${bookingId}`).expect(200);
    await customer
      .get(`/payment/receipt/${bookingId}/pdf`)
      .expect('Content-Type', /application\/pdf/)
      .expect(200);
    const dispute = await post(
      customer,
      '/support',
      '/support/disputes',
      {
        booking_id: bookingId,
        category: 'QUALITY',
        description: 'Workflow verification dispute with enough detail for operations review.',
      },
      201,
    );
    auditEntities.push(['dispute', dispute.body.id]);
    await post(admin, '/support', `/support/disputes/${dispute.body.id || 0}/status`, {
      status: 'RESOLVED',
      resolution: 'Workflow verification case resolved.',
    });
    const refund = await post(
      customer,
      '/support',
      '/support/refunds',
      {
        booking_id: bookingId,
        amount: 50,
        reason: 'Workflow verification refund request.',
      },
      201,
    );
    auditEntities.push(['refund', refund.body.id]);
    await post(admin, '/support', `/support/refunds/${refund.body.id || 0}/status`, {
      status: 'APPROVED',
      note: 'Approved by workflow verification.',
    });
    await post(admin, '/support', `/support/refunds/${refund.body.id || 0}/process`, {});
    console.info(`Verified complete booking lifecycle for booking ${bookingId}.`);
  } finally {
    if (bookingId) await cleanup(bookingId, availabilityId, auditEntities);
    await database.promise().end();
  }
}

smoke().catch((error) => {
  console.error('Workflow smoke test failed:', error.message);
  process.exitCode = 1;
});
