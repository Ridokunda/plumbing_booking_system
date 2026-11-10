const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const bcrypt = require('bcrypt');

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'test-session-secret-that-is-at-least-32-characters';
process.env.COOKIE_SECURE = 'false';

const app = require('../app');
const database = require('../database/connection');

test('public pages share the branded header and identify the current destination', async () => {
  for (const [url, activeLink] of [
    ['/', '/'],
    ['/index/about', '/index/about'],
    ['/index/service', '/index/service'],
    ['/index/contact', '/index/contact'],
    ['/about', '/index/about'],
    ['/login', '/login'],
    ['/register/register', null],
    ['/register/plumber', null],
    ['/account/forgot-password', null],
  ]) {
    const page = await request(app).get(url).expect(200);
    const header = page.text.match(/<header class="site-header">[\s\S]*?<\/header>/)?.[0];
    assert.ok(header, `Missing shared header on ${url}`);
    assert.match(header, /aria-label="WeFixIt home">WeFixIt<\/a>/);
    assert.equal((page.text.match(/class="site-header"/g) || []).length, 1);
    assert.match(page.text, /<head>[\s\S]*\/stylesheets\/site-header.css[\s\S]*<\/head>/);
    assert.match(page.text, /src="\/javascripts\/site-header.js" defer/);
    assert.doesNotMatch(header, /action="\/login\/logout"/);
    const active = header.match(/href="([^"]+)" aria-current="page"/g) || [];
    assert.deepEqual(active, activeLink ? [`href="${activeLink}" aria-current="page"`] : []);
  }
});

async function checkSharedHeader(agent, role) {
  const destination = { 1: '/booking/mybookings', 2: '/admin', 3: '/plumber/my-bookings' }[role];
  for (const url of ['/', '/notifications']) {
    const page = await agent.get(url).expect(200);
    const header = page.text.match(/<header class="site-header">[\s\S]*?<\/header>/)[0];
    assert.match(header, new RegExp(`href="${destination}"`));
    assert.match(header, /action="\/login\/logout" method="post"/);
    assert.match(header, /name="_csrf" value="[a-f0-9]{64}"/);
    assert.match(header, /id="notification-count"/);
    assert.match(header, /aria-controls="site-navigation" aria-expanded="false" hidden/);
    assert.match(header, new RegExp(`href="${url}" aria-current="page"`));
    assert.equal((header.match(/aria-current="page"/g) || []).length, 1);
  }
}

async function signIn(t, usertype, form = false, availability = []) {
  const password = 'Navigation-test-password';
  const passwordHash = await bcrypt.hash(password, 4);
  t.mock.method(database, 'query', (sql, params, callback) => {
    assert.equal(sql, 'SELECT * FROM users WHERE email = ?');
    assert.deepEqual(params, ['navigation@example.com']);
    callback(null, [
      {
        idusers: 42,
        email: 'navigation@example.com',
        name: 'Navigation test',
        usertype,
        account_status: 'ACTIVE',
        email_verified_at: new Date(),
        password: passwordHash,
      },
    ]);
  });
  const query = t.mock.fn(async (sql) => {
    if (sql.includes('COUNT(*) AS unreadCount')) return [[{ unreadCount: 0 }]];
    if (sql.includes('FROM notifications')) return [[]];
    if (sql.includes('FROM plumber_availability')) return [availability];
    if (sql.includes('INSERT INTO plumber_availability')) return [{ insertId: 7 }];
    if (sql.includes('INSERT INTO audit_events')) return [{}];
    throw new Error(`Unexpected database query: ${sql}`);
  });
  t.mock.method(database, 'promise', () => ({ query }));

  const agent = request.agent(app);
  const page = await agent.get('/login').expect(200);
  const cookie = page.headers['set-cookie'].find((value) => value.startsWith('csrfToken='));
  const token = decodeURIComponent(cookie.split(';')[0].slice('csrfToken='.length));
  let login = agent.post('/login/log').set('X-CSRF-Token', token);
  if (form) login = login.type('form');
  const response = await login
    .send({ email: 'navigation@example.com', password })
    .expect(form ? 303 : 200);
  return { agent, response, query };
}

for (const usertype of [2, '2']) {
  test(`admin login opens the dashboard with a ${typeof usertype} role`, async (t) => {
    const { agent, response } = await signIn(t, usertype);
    assert.equal(response.body.redirectUrl, '/admin');
    assert.equal(response.body.usertype, 2);
    await checkSharedHeader(agent, 2);
    const dashboard = await agent.get(response.body.redirectUrl).expect(200);
    assert.match(dashboard.text, /class="sidebar"/);
    assert.match(dashboard.text, /data-page="stats"/);
    const login = await agent.get('/login').expect(302);
    assert.equal(login.headers.location, '/admin');
  });
}

test('form login redirects an admin after saving the authenticated session', async (t) => {
  const { agent, response } = await signIn(t, 2, true);
  assert.equal(response.headers.location, '/admin');
  await agent.get('/admin').expect(200);
});

test('logout form redirects home, clears cookies, and revokes the previous session', async (t) => {
  const { agent, response: login } = await signIn(t, 2);
  const sessionName = process.env.SESSION_NAME || 'connect.sid';
  const previousSession = login.headers['set-cookie']
    .find((cookie) => cookie.startsWith(`${sessionName}=`))
    .split(';')[0];
  const dashboard = await agent.get('/admin').expect(200);
  const csrfCookie = dashboard.headers['set-cookie'].find((cookie) =>
    cookie.startsWith('csrfToken='),
  );
  const token = decodeURIComponent(csrfCookie.split(';')[0].slice('csrfToken='.length));
  const logout = await agent
    .post('/login/logout')
    .type('form')
    .set('Accept', 'text/html')
    .send({ _csrf: token })
    .expect(303);
  assert.equal(logout.headers.location, '/');
  for (const cookieName of [sessionName, 'csrfToken']) {
    assert.ok(
      logout.headers['set-cookie'].some(
        (cookie) => cookie.startsWith(`${cookieName}=;`) && cookie.includes('Expires='),
      ),
    );
  }
  const home = await agent.get(logout.headers.location).expect(200);
  assert.match(home.text, /href="\/login"/);
  assert.doesNotMatch(home.text, /action="\/login\/logout"/);
  const protectedPage = await agent.get('/admin').expect(302);
  assert.equal(protectedPage.headers.location, '/login');
  const replay = await request(app).get('/admin').set('Cookie', previousSession).expect(302);
  assert.equal(replay.headers.location, '/login');
});

test('dispatch renders within the admin sidebar and preserves section navigation', async (t) => {
  const { agent } = await signIn(t, 2);
  const dispatch = await agent
    .get('/admin/dispatch?date=2026-11-07&view=week&booking_id=5')
    .expect(200);
  assert.match(dispatch.text, /class="admin-container"/);
  assert.match(dispatch.text, /class="sidebar"/);
  assert.match(dispatch.text, /href="\/admin\/dispatch" aria-current="page"/);
  assert.match(
    dispatch.text,
    /class="content admin-dispatch-content"[\s\S]*id="dispatch-calendar"/,
  );
  assert.match(dispatch.text, /id="dispatch-dialog"/);
  assert.match(dispatch.text, /src="\/javascripts\/dispatch.js"/);
  assert.doesNotMatch(dispatch.text, /admin-dashboard.js|navbarSupportedContent/);
  assert.equal((dispatch.text.match(/<!DOCTYPE html>/g) || []).length, 1);

  for (const section of ['stats', 'users', 'bookings']) {
    assert.match(dispatch.text, new RegExp(`href="/admin\\?section=${section}"`));
    const page = await agent.get(`/admin?section=${section}`).expect(200);
    assert.match(page.text, new RegExp(`data-page="${section}"`));
    assert.match(page.text, /src="\/javascripts\/admin-dashboard.js"/);
    assert.doesNotMatch(page.text, /src="\/javascripts\/dispatch.js"/);
  }
  const invalid = await agent.get('/admin?section=unknown').expect(200);
  assert.match(invalid.text, /data-page="stats"/);

  const home = await agent.get('/').expect(200);
  assert.match(home.text, /href="\/admin"/);
  assert.doesNotMatch(home.text, /href="\/admin\/dispatch"/);
});

test('admin working-hours lookup covers SAST dates and the following night', async (t) => {
  const availability = [
    {
      id: 7,
      starts_at: '2030-11-07T20:00:00.000Z',
      ends_at: '2030-11-08T01:00:00.000Z',
      availability_type: 'AVAILABLE',
    },
  ];
  const { agent, query } = await signIn(t, 2, false, availability);
  const result = await agent.get('/admin/plumbers/43/availability?date=2030-11-07').expect(200);
  assert.deepEqual(result.body.availability, availability);
  assert.equal(result.headers['cache-control'], 'no-store');
  const lookup = query.mock.calls.find((call) =>
    call.arguments[0].includes('FROM plumber_availability'),
  );
  assert.equal(lookup.arguments[1][0], 43);
  assert.equal(lookup.arguments[1][1].toISOString(), '2030-11-08T22:00:00.000Z');
  assert.equal(lookup.arguments[1][2].toISOString(), '2030-11-06T22:00:00.000Z');
  await agent.get('/admin/plumbers/43/availability?date=2030-02-30').expect(400);
  await agent.get('/admin/plumbers/invalid/availability?date=2030-11-07').expect(400);
});

test('plumber availability form stores entered wall times in SAST', async (t) => {
  const { agent, query } = await signIn(t, 3);
  const page = await agent.get('/plumber/availability').expect(200);
  assert.match(page.text, /Starts · SAST/);
  assert.match(page.text, /My availability/);
  const cookie = page.headers['set-cookie'].find((value) => value.startsWith('csrfToken='));
  const token = decodeURIComponent(cookie.split(';')[0].slice('csrfToken='.length));
  await agent
    .post('/plumber/availability')
    .set('X-CSRF-Token', token)
    .send({
      starts_at: '2030-11-07T12:30',
      ends_at: '2030-11-07T13:30',
      availability_type: 'AVAILABLE',
    })
    .expect(201);
  const insert = query.mock.calls.find((call) =>
    call.arguments[0].includes('INSERT INTO plumber_availability'),
  );
  assert.equal(insert.arguments[1][0], 42);
  assert.equal(insert.arguments[1][1].toISOString(), '2030-11-07T10:30:00.000Z');
  assert.equal(insert.arguments[1][2].toISOString(), '2030-11-07T11:30:00.000Z');
});

for (const [usertype, destination] of [
  [1, '/'],
  [3, '/plumber'],
]) {
  test(`role ${usertype} keeps its destination and cannot access admin pages`, async (t) => {
    const { agent, response } = await signIn(t, usertype);
    assert.equal(response.body.redirectUrl, destination);
    await checkSharedHeader(agent, usertype);
    await agent.get('/admin').expect(403);
    await agent.get('/admin/dispatch').expect(403);
    await agent.get('/admin/plumbers/43/availability?date=2030-11-07').expect(403);
    const login = await agent.get('/login').expect(302);
    assert.equal(login.headers.location, destination);
  });
}
