const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const bcrypt = require('bcrypt');

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'test-session-secret-that-is-at-least-32-characters';
process.env.COOKIE_SECURE = 'false';

const app = require('../app');
const database = require('../database/connection');

async function signIn(t, usertype, form = false) {
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
  t.mock.method(database, 'promise', () => ({
    query: async (sql) => {
      if (sql.includes('COUNT(*) AS unreadCount')) return [[{ unreadCount: 0 }]];
      if (sql.includes('FROM notifications')) return [[]];
      throw new Error(`Unexpected database query: ${sql}`);
    },
  }));

  const agent = request.agent(app);
  const page = await agent.get('/login').expect(200);
  const cookie = page.headers['set-cookie'].find((value) => value.startsWith('csrfToken='));
  const token = decodeURIComponent(cookie.split(';')[0].slice('csrfToken='.length));
  let login = agent.post('/login/log').set('X-CSRF-Token', token);
  if (form) login = login.type('form');
  const response = await login
    .send({ email: 'navigation@example.com', password })
    .expect(form ? 303 : 200);
  return { agent, response };
}

for (const usertype of [2, '2']) {
  test(`admin login opens the dashboard with a ${typeof usertype} role`, async (t) => {
    const { agent, response } = await signIn(t, usertype);
    assert.equal(response.body.redirectUrl, '/admin');
    assert.equal(response.body.usertype, 2);
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

for (const [usertype, destination] of [
  [1, '/'],
  [3, '/plumber'],
]) {
  test(`role ${usertype} keeps its destination and cannot access admin pages`, async (t) => {
    const { agent, response } = await signIn(t, usertype);
    assert.equal(response.body.redirectUrl, destination);
    await agent.get('/admin').expect(403);
    await agent.get('/admin/dispatch').expect(403);
    const login = await agent.get('/login').expect(302);
    assert.equal(login.headers.location, destination);
  });
}
