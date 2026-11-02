require('dotenv').config();
const assert = require('node:assert/strict');
const request = require('supertest');
const bcrypt = require('bcrypt');

// This suite creates its own users and bookings. Never point it at a working database.
if (process.env.NODE_ENV !== 'test' || !process.env.DB_NAME?.endsWith('_test')) {
  throw new Error(
    'Dispatch integration tests require NODE_ENV=test and a disposable database ending in _test.',
  );
}
process.env.SESSION_SECRET = 'dispatch-test-secret-with-at-least-32-characters';
process.env.COOKIE_SECURE = 'false';
process.env.EMAIL_NOTIFICATIONS = 'false';
const app = require('../app');
const database = require('../database/connection');
const { time, travelGapMinutes } = require('../config/dispatch');
const db = database.promise();
const users = [],
  bookings = [];
const password = 'DispatchTest!2026';
const suffix = Date.now();
const day = (offset) => time.shiftDate(time.dateKey(), offset);
const at = (offset, clock) => new Date(`${day(offset)}T${clock}:00+02:00`);
let customerId, adminId, plumberId, secondId, inactiveId;
let checks = 0;

async function csrf(agent, path = '/admin/dispatch') {
  const response = await agent.get(path).expect(200);
  const cookie = response.headers['set-cookie'].find((value) => value.startsWith('csrfToken='));
  return decodeURIComponent(cookie.split(';')[0].split('=').slice(1).join('='));
}
async function login(email) {
  const agent = request.agent(app);
  const token = await csrf(agent, '/login');
  await agent.post('/login/log').set('X-CSRF-Token', token).send({ email, password }).expect(200);
  return agent;
}
async function post(agent, path, body, expected = 200, refresh = '/admin/dispatch') {
  const token = await csrf(agent, refresh);
  return agent
    .post(path)
    .set('Accept', 'application/json')
    .set('X-CSRF-Token', token)
    .send(body)
    .expect(expected);
}
async function user(label, role, active = true) {
  const hash = await bcrypt.hash(password, 4);
  const email = `dispatch-${label}-${suffix}@example.test`;
  const [result] = await db.query(
    `INSERT INTO users (name,surname,email,password,usertype,account_status,email_verified_at)
    VALUES (?,?,?,?,?,?,NOW())`,
    [label, 'Dispatch', email, hash, role, active ? 'ACTIVE' : 'SUSPENDED'],
  );
  users.push(result.insertId);
  if (role === 3)
    await db.query(
      `INSERT INTO plumber_profiles (user_id,verification_status,service_area) VALUES (?,'APPROVED','Johannesburg')`,
      [result.insertId],
    );
  return { id: result.insertId, email };
}
async function booking(overrides = {}) {
  const value = {
    idPlumber: null,
    status: 'NEW',
    start: null,
    end: null,
    description: 'Dispatch integration request',
    ...overrides,
  };
  const [result] = await db.query(
    `INSERT INTO bookings (idUser,idPlumber,type,description,location,date_start,scheduled_start,scheduled_end,status)
    VALUES (?,?,'Plumbing_Fix',?,'17 Test Street, Johannesburg',?,?,?,?)`,
    [customerId, value.idPlumber, value.description, day(2), value.start, value.end, value.status],
  );
  bookings.push(result.insertId);
  await db.query('INSERT INTO booking_dates (booking_id,date_start) VALUES (?,?)', [
    result.insertId,
    day(2),
  ]);
  return result.insertId;
}
async function feed(admin, id = null, extra = {}) {
  const response = await admin
    .get('/admin/dispatch/data')
    .query({ date: day(2), view: 'day', ...(id ? { booking_id: id } : {}), ...extra })
    .set('Accept', 'application/json')
    .expect(200);
  return response.body;
}
async function schedule(admin, id, plumber, start, end, status = 200, expected) {
  return post(
    admin,
    '/admin/schedule',
    {
      booking_id: id,
      plumber_id: plumber,
      starts_at: start.toISOString(),
      ends_at: end.toISOString(),
      ...(expected ? { expected_schedule: expected } : {}),
    },
    status,
  );
}
async function check(label, action) {
  await action();
  checks++;
  console.log(`PASS ${label}`);
}
async function counts(id) {
  const [[history]] = await db.query(
    'SELECT COUNT(*) AS n FROM booking_status_history WHERE booking_id=?',
    [id],
  );
  const [[audit]] = await db.query(
    "SELECT COUNT(*) AS n FROM audit_events WHERE entity_type='booking' AND entity_id=?",
    [String(id)],
  );
  const [[notifications]] = await db.query(
    'SELECT COUNT(*) AS n FROM notifications WHERE booking_id=?',
    [id],
  );
  return [history.n, audit.n, notifications.n];
}
async function cleanup() {
  if (bookings.length) {
    await db.query(
      "DELETE FROM audit_events WHERE (entity_type='booking' AND entity_id IN (?)) OR (entity_type='reschedule_request' AND entity_id IN (SELECT CAST(id AS CHAR) FROM reschedule_requests WHERE booking_id IN (?)))",
      [bookings.map(String), bookings],
    );
    for (const table of [
      'notifications',
      'booking_status_history',
      'booking_dates',
      'reschedule_requests',
    ])
      await db.query(`DELETE FROM ${table} WHERE booking_id IN (?)`, [bookings]);
    await db.query('DELETE FROM bookings WHERE idbookings IN (?)', [bookings]);
  }
  if (users.length) {
    await db.query('DELETE FROM notifications WHERE user_id IN (?)', [users]);
    await db.query('DELETE FROM audit_events WHERE actor_id IN (?)', [users]);
    await db.query('DELETE FROM plumber_availability WHERE plumber_id IN (?)', [users]);
    await db.query('DELETE FROM plumber_profiles WHERE user_id IN (?)', [users]);
    await db.query('DELETE FROM users WHERE idusers IN (?)', [users]);
  }
}

async function run() {
  assert.equal(travelGapMinutes, 30, 'This suite expects the default 30-minute gap.');
  const customer = await user('Customer', 1),
    admin = await user('Admin', 2),
    plumber = await user('Thabo', 3),
    second = await user('Lerato', 3),
    inactive = await user('Inactive', 3, false);
  customerId = customer.id;
  adminId = admin.id;
  plumberId = plumber.id;
  secondId = second.id;
  inactiveId = inactive.id;
  for (const id of [plumberId, secondId])
    for (let d = 1; d <= 12; d++)
      await db.query(
        "INSERT INTO plumber_availability (plumber_id,starts_at,ends_at,availability_type) VALUES (?,?,?,'AVAILABLE')",
        [id, at(d, '08:00'), at(d, '18:00')],
      );
  const adminAgent = await login(admin.email),
    customerAgent = await login(customer.email),
    plumberAgent = await login(plumber.email);
  const a = await booking(),
    b = await booking(),
    c = await booking();
  await check('admin access, browser redirect, and CSRF boundaries', async () => {
    const page = await adminAgent.get('/admin/dispatch').expect(200);
    assert.match(page.text, /id="dispatch-calendar"/);
    assert.match(page.text, /id="dispatch-dialog"/);
    for (const asset of [
      '/javascripts/dispatch.js',
      '/javascripts/dispatch-time.js',
      '/stylesheets/dispatch.css',
    ])
      await adminAgent.get(asset).expect(200);
    await request(app).get('/admin/dispatch').expect(302);
    await request(app).get('/admin/dispatch/data').set('Accept', 'application/json').expect(401);
    for (const agent of [customerAgent, plumberAgent]) {
      await agent.get('/admin/dispatch').expect(403);
      await agent.get('/admin/dispatch/data').set('Accept', 'application/json').expect(403);
      await post(
        agent,
        '/admin/schedule',
        {
          booking_id: a,
          plumber_id: plumberId,
          starts_at: at(2, '10:00'),
          ends_at: at(2, '11:00'),
        },
        403,
        agent === customerAgent ? '/booking' : '/plumber/availability',
      );
    }
    await adminAgent.post('/admin/schedule').send({ booking_id: a }).expect(403);
    await adminAgent
      .get('/admin/dispatch/data?date=2026-02-30')
      .set('Accept', 'application/json')
      .expect(400);
    await adminAgent
      .get('/admin/dispatch/data?plumber_id=-1')
      .set('Accept', 'application/json')
      .expect(400);
  });
  await check('assignments, exact one-gap boundaries, and both neighbours', async () => {
    const original = (await feed(adminAgent, a)).selected_booking.expected_schedule;
    await schedule(adminAgent, a, plumberId, at(2, '10:00'), at(2, '11:00'), 200, original);
    await schedule(adminAgent, b, plumberId, at(2, '10:30'), at(2, '11:30'), 409);
    await schedule(adminAgent, b, plumberId, at(2, '09:00'), at(2, '09:31'), 409);
    await schedule(adminAgent, b, plumberId, at(2, '09:00'), at(2, '09:30'));
    await schedule(adminAgent, c, plumberId, at(2, '11:29'), at(2, '12:30'), 409);
    await schedule(adminAgent, c, plumberId, at(2, '11:30'), at(2, '12:30'));
    await schedule(adminAgent, a, secondId, at(2, '14:00'), at(2, '15:00'), 409, original);
  });
  await check('idempotent saves, reassignment, audit history, and notifications', async () => {
    let current = (await feed(adminAgent, a)).selected_booking.expected_schedule;
    const before = await counts(a);
    await schedule(adminAgent, a, plumberId, at(2, '10:00'), at(2, '11:00'), 200, current);
    assert.deepEqual(await counts(a), before);
    await schedule(adminAgent, a, secondId, at(2, '14:00'), at(2, '15:00'), 200, current);
    const [[row]] = await db.query(
      "SELECT metadata FROM audit_events WHERE entity_type='booking' AND entity_id=? ORDER BY id DESC LIMIT 1",
      [String(a)],
    );
    const metadata = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata;
    assert.equal(metadata.previous.plumber_id, plumberId);
    assert.equal(metadata.next.plumber_id, secondId);
    const [notices] = await db.query('SELECT user_id,type FROM notifications WHERE booking_id=?', [
      a,
    ]);
    assert.ok(notices.some((n) => n.user_id === plumberId && n.type === 'booking_reassigned'));
    assert.ok(notices.some((n) => n.user_id === secondId));
    assert.ok(notices.some((n) => n.user_id === customerId));
    current = (await feed(adminAgent, a)).selected_booking.expected_schedule;
    assert.equal(current.plumber_id, secondId);
  });
  await check('availability, unavailable periods, and inactive plumbers', async () => {
    const id = await booking();
    await schedule(adminAgent, id, plumberId, at(3, '10:00'), at(3, '10:00'), 400);
    await schedule(adminAgent, id, plumberId, at(3, '04:00'), at(3, '17:00'), 400);
    await schedule(adminAgent, id, plumberId, at(-1, '10:00'), at(-1, '11:00'), 400);
    await schedule(adminAgent, id, plumberId, at(3, '07:00'), at(3, '08:00'), 409);
    await db.query(
      "INSERT INTO plumber_availability (plumber_id,starts_at,ends_at,availability_type) VALUES (?,?,?,'UNAVAILABLE')",
      [plumberId, at(3, '15:00'), at(3, '16:00')],
    );
    await schedule(adminAgent, id, plumberId, at(3, '14:30'), at(3, '15:30'), 409);
    await schedule(adminAgent, id, inactiveId, at(3, '10:00'), at(3, '11:00'), 400);
  });
  await check(
    'concurrent requests cannot double-book a plumber or overwrite a stale booking',
    async () => {
      const one = await booking(),
        two = await booking();
      const token = await csrf(adminAgent);
      const body = (id, p, snapshot) => ({
        booking_id: id,
        plumber_id: p,
        starts_at: at(4, '10:00').toISOString(),
        ends_at: at(4, '11:00').toISOString(),
        ...(snapshot ? { expected_schedule: snapshot } : {}),
      });
      const send = (payload) =>
        adminAgent
          .post('/admin/schedule')
          .set('X-CSRF-Token', token)
          .set('Accept', 'application/json')
          .send(payload);
      let responses = await Promise.all([send(body(one, plumberId)), send(body(two, plumberId))]);
      assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
      const id = await booking();
      const expected = (await feed(adminAgent, id)).selected_booking.expected_schedule;
      responses = await Promise.all([
        send({
          ...body(id, plumberId, expected),
          starts_at: at(4, '13:00'),
          ends_at: at(4, '14:00'),
        }),
        send({
          ...body(id, secondId, expected),
          starts_at: at(4, '13:00'),
          ends_at: at(4, '14:00'),
        }),
      ]);
      assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
    },
  );
  await check('independent plumbers can receive simultaneous assignments', async () => {
    const first = await booking(),
      second = await booking();
    await Promise.all([
      schedule(adminAgent, first, plumberId, at(7, '10:00'), at(7, '11:00')),
      schedule(adminAgent, second, secondId, at(7, '10:00'), at(7, '11:00')),
    ]);
  });
  await check(
    'pending reschedule blocks editing and approval enforces the same travel gap',
    async () => {
      await booking({
        idPlumber: secondId,
        status: 'ASSIGNED',
        start: at(5, '10:15'),
        end: at(5, '11:15'),
      });
      const body = {
        booking_id: a,
        starts_at: at(5, '09:00'),
        ends_at: at(5, '10:00'),
        reason: 'Please arrange another visit time',
      };
      const token = await csrf(customerAgent, '/support');
      const responses = await Promise.all(
        [1, 2].map(() =>
          customerAgent
            .post('/support/reschedules')
            .set('X-CSRF-Token', token)
            .set('Accept', 'application/json')
            .send(body),
        ),
      );
      assert.deepEqual(responses.map((r) => r.status).sort(), [201, 409]);
      let [[pending]] = await db.query(
        "SELECT id FROM reschedule_requests WHERE booking_id=? AND status='PENDING'",
        [a],
      );
      await schedule(adminAgent, a, secondId, at(5, '08:00'), at(5, '09:00'), 409);
      const before = await counts(a);
      await post(
        adminAgent,
        `/support/reschedules/${pending.id}/respond`,
        { decision: 'APPROVED' },
        409,
      );
      assert.deepEqual(await counts(a), before);
      await post(adminAgent, `/support/reschedules/${pending.id}/respond`, {
        decision: 'REJECTED',
      });
      await post(
        customerAgent,
        '/support/reschedules',
        { ...body, starts_at: at(5, '08:30'), ends_at: at(5, '09:30') },
        201,
        '/support',
      );
      [[pending]] = await db.query(
        "SELECT id FROM reschedule_requests WHERE booking_id=? AND status='PENDING'",
        [a],
      );
      await post(adminAgent, `/support/reschedules/${pending.id}/respond`, {
        decision: 'APPROVED',
      });
      const selected = (await feed(adminAgent, a)).selected_booking;
      assert.equal(selected.pending_reschedule, false);
      assert.equal(selected.scheduled_start, at(5, '08:30').toISOString());
      await post(
        adminAgent,
        `/support/reschedules/${pending.id}/respond`,
        { decision: 'APPROVED' },
        409,
      );
    },
  );
  await check(
    'finished jobs remain visible and reserve their planned time; cancelled jobs do not',
    async () => {
      for (const status of ['IN_PROGRESS', 'COMPLETED', 'PAID']) {
        const id = await booking({
          idPlumber: plumberId,
          status,
          start: at(6, '10:00'),
          end: at(6, '11:00'),
        });
        await schedule(adminAgent, id, plumberId, at(6, '13:00'), at(6, '14:00'), 409);
        const selected = (await feed(adminAgent, id)).selected_booking;
        assert.equal(selected.editable, false);
        const waiting = await booking();
        await schedule(adminAgent, waiting, plumberId, at(6, '11:15'), at(6, '12:15'), 409);
        await db.query("UPDATE bookings SET status='CANCELLED' WHERE idbookings=?", [id]);
      }
      const id = await booking();
      await schedule(adminAgent, id, plumberId, at(6, '10:00'), at(6, '11:00'));
    },
  );
  await check('travel gaps cross midnight and the calendar range boundary', async () => {
    await db.query(
      "INSERT INTO plumber_availability (plumber_id,starts_at,ends_at,availability_type) VALUES (?,?,?,'AVAILABLE')",
      [plumberId, at(8, '22:00'), at(9, '03:00')],
    );
    await booking({
      idPlumber: plumberId,
      status: 'ASSIGNED',
      start: at(8, '22:45'),
      end: at(8, '23:45'),
    });
    const id = await booking();
    await schedule(adminAgent, id, plumberId, at(9, '00:14'), at(9, '01:14'), 409);
    await schedule(adminAgent, id, plumberId, at(9, '00:15'), at(9, '01:15'));
  });
  await check(
    'global queues, overdue definition, incomplete assignments, and pagination',
    async () => {
      const old = await booking({
        idPlumber: plumberId,
        status: 'IN_PROGRESS',
        start: at(-1, '08:00'),
        end: at(-1, '09:00'),
      });
      const finished = await booking({
        idPlumber: plumberId,
        status: 'COMPLETED',
        start: at(-2, '08:00'),
        end: at(-2, '09:00'),
      });
      const lateStart = await booking({
        idPlumber: plumberId,
        status: 'ASSIGNED',
        start: new Date(Date.now() - 60000),
        end: new Date(Date.now() + 3600000),
      });
      const incomplete = await booking({ status: 'ASSIGNED' });
      await booking({
        idPlumber: inactiveId,
        status: 'ASSIGNED',
        start: at(2, '08:00'),
        end: at(2, '09:00'),
      });
      for (let i = 0; i < 23; i++)
        await booking({ description: `Unassigned queue fixture ${i + 1}` });
      const data = await feed(adminAgent, null, { date: day(10), view: 'week' });
      assert.equal(data.timezone, 'Africa/Johannesburg');
      assert.equal(data.travel_gap_minutes, 30);
      assert.ok(data.plumbers.some((p) => p.idusers === inactiveId && !p.assignable));
      assert.ok(data.overdue.items.some((b) => b.idbookings === old));
      assert.ok(!data.overdue.items.some((b) => [finished, lateStart].includes(b.idbookings)));
      assert.equal(data.unassigned.items.length, 20);
      assert.ok(data.unassigned.pages >= 2);
      const secondPage = await feed(adminAgent, null, { unassigned_page: 2 });
      assert.ok(secondPage.unassigned.items.length > 0);
      assert.ok(
        !data.unassigned.items.some(
          (b) => b.idbookings === secondPage.unassigned.items[0].idbookings,
        ),
      );
      assert.equal((await feed(adminAgent, incomplete)).selected_booking.editable, true);
      const monday = time.range(day(10), 'week');
      assert.equal(data.range.start, monday.start.toISOString());
      const legacy = await adminAgent
        .get('/admin/schedule')
        .query({ from: day(1) })
        .expect(200);
      assert.ok(Array.isArray(legacy.body.bookings));
    },
  );
  console.log(
    `Dispatch integration: ${checks} scenario groups passed. Preview admin: ${admin.email}; date: ${day(2)}; admin id: ${adminId}.`,
  );
}

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      if (process.env.KEEP_DISPATCH_FIXTURES !== 'true') await cleanup();
    } finally {
      await db.end();
    }
  });
