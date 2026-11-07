const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeAvailability } = require('../utils/availability');
const { validateSlot } = require('../utils/scheduling');

test('availability wall times use SAST independently of the host timezone', () => {
  const now = new Date('2026-11-06T00:00:00Z');
  for (const suffix of ['', ':00+02:00']) {
    const schedule = normalizeAvailability(
      `2026-11-07T12:30${suffix}`,
      `2026-11-07T13:30${suffix}`,
      now,
    );
    assert.equal(schedule.start.toISOString(), '2026-11-07T10:30:00.000Z');
    assert.equal(schedule.end.toISOString(), '2026-11-07T11:30:00.000Z');
  }
  const utc = normalizeAvailability('2026-11-07T10:30:00Z', '2026-11-07T11:30:00Z', now);
  assert.equal(utc.start.toISOString(), '2026-11-07T10:30:00.000Z');
  assert.equal(normalizeAvailability('2026-02-30T12:30', '2026-11-07T13:30', now), null);
  assert.equal(normalizeAvailability('2026-11-07T13:30', '2026-11-07T12:30', now), null);
  assert.equal(normalizeAvailability(null, '2026-11-07T13:30', now), null);
});

function slotDb(availability) {
  return {
    query: async (sql) => {
      if (sql.includes('JOIN plumber_profiles')) return [[{ idusers: 18 }]];
      if (sql.includes('FROM bookings')) return [[]];
      if (sql.includes('FROM plumber_availability')) return [availability];
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
}

const start = new Date('2026-11-07T10:30:00Z');
const end = new Date('2026-11-07T11:30:00Z');
const available = { starts_at: start, ends_at: end, availability_type: 'AVAILABLE' };

test('scheduling with no working hours explains how to resolve the missing setup', async () => {
  await assert.rejects(
    validateSlot(slotDb([]), 31, 18, start, end),
    /add a covering window under My availability/,
  );
});

test('a full covering availability window permits the visit, including equal boundaries', async () => {
  await validateSlot(slotDb([available]), 31, 18, start, end);
});

test('partially covered and blocked visits remain rejected', async () => {
  const partial = { ...available, ends_at: new Date('2026-11-07T11:00:00Z') };
  await assert.rejects(
    validateSlot(slotDb([partial]), 31, 18, start, end),
    /No available working hours cover/,
  );
  const blocked = { ...partial, availability_type: 'UNAVAILABLE' };
  await assert.rejects(
    validateSlot(slotDb([available, blocked]), 31, 18, start, end),
    /marked unavailable/,
  );
});
