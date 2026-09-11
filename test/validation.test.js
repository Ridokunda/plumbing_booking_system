const test = require('node:test');
const assert = require('node:assert/strict');
const {
  cleanText,
  normalizeEmail,
  validatePassword,
  normalizeBookingDates,
  normalizeMoney,
  normalizeSchedule,
  isValidService,
  canTransition,
  normalizePagination,
} = require('../utils/validation');

test('normalizes and validates user input', () => {
  assert.equal(cleanText('  Jane  '), 'Jane');
  assert.equal(normalizeEmail(' Jane@Example.COM '), 'jane@example.com');
  assert.equal(normalizeEmail('not-an-email'), null);
  assert.equal(validatePassword('long-enough-password'), true);
  assert.equal(validatePassword('short'), false);
});

test('bounds pagination input', () => {
  assert.deepEqual(normalizePagination({ page: '3', page_size: '25' }), {
    page: 3,
    pageSize: 25,
    offset: 50,
  });
  assert.deepEqual(normalizePagination({ page: '-4', page_size: '500' }), {
    page: 1,
    pageSize: 50,
    offset: 0,
  });
});

test('accepts future booking dates and rejects past or malformed dates', () => {
  const now = new Date('2026-09-09T12:00:00Z');
  assert.deepEqual(normalizeBookingDates(['2026-09-11', '2026-09-10'], now), [
    '2026-09-10',
    '2026-09-11',
  ]);
  assert.equal(normalizeBookingDates(['2026-09-08'], now), null);
  assert.equal(normalizeBookingDates(['tomorrow'], now), null);
  assert.equal(normalizeBookingDates(['2027-02-30'], now), null);
});

test('validates services, money, and role-specific transitions', () => {
  assert.equal(isValidService('Plumbing_Fix'), true);
  assert.equal(isValidService('Anything'), false);
  assert.equal(normalizeMoney('199.999'), 200);
  assert.equal(normalizeMoney(-1), null);
  assert.deepEqual(
    normalizeSchedule(
      '2026-09-10T08:00:00Z',
      '2026-09-10T10:00:00Z',
      new Date('2026-09-09T12:00:00Z'),
    ),
    {
      start: new Date('2026-09-10T08:00:00Z'),
      end: new Date('2026-09-10T10:00:00Z'),
    },
  );
  assert.equal(normalizeSchedule('2026-09-10T10:00:00Z', '2026-09-10T08:00:00Z'), null);
  assert.equal(canTransition('plumber', 'ASSIGNED', 'IN_PROGRESS'), true);
  assert.equal(canTransition('plumber', 'ASSIGNED', 'COMPLETED'), false);
  assert.equal(canTransition('customer', 'COMPLETED', 'CANCELLED'), false);
});
