const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'test-session-secret-that-is-at-least-32-characters';
process.env.COOKIE_SECURE = 'false';

const app = require('../app');

test('liveness endpoint is public and hardened', async () => {
  const response = await request(app).get('/health/live').expect(200);
  assert.equal(response.body.status, 'ok');
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
  assert.equal(response.headers['x-frame-options'], 'DENY');
  assert.match(response.headers['content-security-policy'], /frame-ancestors 'none'/);
  assert.equal(response.headers['x-powered-by'], undefined);
});

test('protected browser routes redirect anonymous users', async () => {
  const response = await request(app).get('/admin').set('Accept', 'text/html').expect(302);
  assert.equal(response.headers.location, '/login');
});

test('requests without a CSRF token are rejected', async () => {
  const response = await request(app)
    .post('/login/log')
    .set('Accept', 'application/json')
    .send({ email: 'person@example.com', password: 'not-a-real-password' })
    .expect(403);
  assert.equal(response.body.success, false);
});

test('unknown routes return a safe 404 page', async () => {
  const response = await request(app).get('/definitely-not-a-route').expect(404);
  assert.match(response.text, /Page not found/i);
});
