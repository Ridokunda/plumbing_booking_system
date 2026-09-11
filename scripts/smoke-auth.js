const request = require('supertest');

process.env.SESSION_SECRET =
  process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 32
    ? process.env.SESSION_SECRET
    : 'local-smoke-test-secret-with-at-least-32-characters';
process.env.COOKIE_SECURE = 'false';

const app = require('../app');
const database = require('../database/connection');

async function csrfToken(agent) {
  const response = await agent.get('/login').expect(200);
  const cookie = response.headers['set-cookie']?.find((value) => value.startsWith('csrfToken='));
  if (!cookie) throw new Error('CSRF cookie was not issued');
  return decodeURIComponent(cookie.split(';')[0].split('=').slice(1).join('='));
}

async function verifyRole(email, password, paths) {
  const agent = request.agent(app);
  const token = await csrfToken(agent);
  const login = await agent
    .post('/login/log')
    .set('X-CSRF-Token', token)
    .send({ email, password })
    .expect(200);
  if (!login.body.success) throw new Error(`Login failed for ${email}`);
  for (const path of paths) await agent.get(path).expect(200);
  console.info(`Verified ${email}: ${paths.join(', ')}`);
}

async function smoke() {
  const password = process.env.DEMO_PASSWORD || 'PortfolioDemo!2026';
  await verifyRole('customer@wefixit.local', password, [
    '/booking/mybookings',
    '/payment/history',
    '/profile',
    '/support',
  ]);
  await verifyRole('plumber@wefixit.local', password, [
    '/plumber/my-bookings',
    '/plumber/availability',
    '/profile',
  ]);
  await verifyRole('admin@wefixit.local', password, [
    '/admin',
    '/admin/stats',
    '/admin/bookings',
    '/admin/managecustomers',
    '/admin/manageplumbers',
    '/admin/contacts',
    '/support',
  ]);
}

smoke()
  .then(() => database.end())
  .catch((error) => {
    console.error('Authenticated smoke test failed:', error.message);
    database.end();
    process.exitCode = 1;
  });
