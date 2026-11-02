const test = require('node:test');
const assert = require('node:assert/strict');
const { time, parseTravelGap } = require('../config/dispatch');
const { windowsConflict, snapshot, matchesSnapshot } = require('../utils/scheduling');

test('Johannesburg calendar boundaries are independent of the host timezone', () => {
  assert.equal(time.dateKey('2026-11-01T22:30:00Z'), '2026-11-02');
  assert.equal(time.inputValue('2026-11-02T06:15:00Z'), '2026-11-02T08:15');
  assert.equal(time.parseInput('2026-11-02T08:15'), '2026-11-02T06:15:00.000Z');
  const week = time.range('2026-11-01', 'week');
  assert.equal(week.first, '2026-10-26');
  assert.equal(week.last, '2026-11-02');
  assert.equal(week.start.toISOString(), '2026-10-25T22:00:00.000Z');
  assert.equal(week.end.toISOString(), '2026-11-01T22:00:00.000Z');
  assert.equal(time.range('2026-11-02', 'day').end.toISOString(), '2026-11-02T22:00:00.000Z');
});

test('untouched calendar inputs retain existing seconds instead of silently rescheduling', () => {
  const original = '2026-11-02T06:15:37.000Z';
  assert.equal(time.parseInput('2026-11-02T08:15', original), original);
  assert.equal(time.parseInput('2026-11-02T08:16', original), '2026-11-02T06:16:00.000Z');
  assert.equal(time.parseInput('2026-11-02T08:15', null), '2026-11-02T06:15:00.000Z');
});

test('calendar inputs reject malformed dates and rollover times', () => {
  for (const value of [
    '2026-02-30T08:00',
    '2026-11-02T24:00',
    '2026-11-02T08:60',
    '',
    '2026-11-02T08:00Z',
  ])
    assert.equal(time.parseInput(value), null);
  assert.throws(() => time.range('2026-02-30', 'week'));
  assert.throws(() => time.range('2026-11-02', 'month'));
});

test('one travel gap is enforced on either side, including midnight', () => {
  const existingStart = '2026-11-02T22:00:00Z',
    existingEnd = '2026-11-02T23:00:00Z';
  assert.equal(
    windowsConflict('2026-11-02T21:00:00Z', '2026-11-02T21:30:00Z', existingStart, existingEnd, 30),
    false,
  );
  assert.equal(
    windowsConflict('2026-11-02T21:00:00Z', '2026-11-02T21:31:00Z', existingStart, existingEnd, 30),
    true,
  );
  assert.equal(
    windowsConflict('2026-11-02T23:29:00Z', '2026-11-03T00:30:00Z', existingStart, existingEnd, 30),
    true,
  );
  assert.equal(
    windowsConflict('2026-11-02T23:30:00Z', '2026-11-03T00:30:00Z', existingStart, existingEnd, 30),
    false,
  );
  assert.equal(windowsConflict(existingStart, existingEnd, existingStart, existingEnd, 0), true);
  assert.equal(
    windowsConflict(existingEnd, '2026-11-03T00:00:00Z', existingStart, existingEnd, 0),
    false,
  );
});

test('schedule snapshots detect changes to assignment, time, and lifecycle', () => {
  const booking = {
    status: 'ASSIGNED',
    idPlumber: 3,
    scheduled_start: new Date('2026-11-02T06:00Z'),
    scheduled_end: new Date('2026-11-02T07:00Z'),
  };
  const expected = snapshot(booking);
  assert.equal(matchesSnapshot(booking, expected), true);
  for (const key of Object.keys(expected))
    assert.equal(matchesSnapshot(booking, { ...expected, [key]: null }), false);
  assert.equal(matchesSnapshot(booking, {}), false);
  assert.deepEqual(snapshot({ status: 'NEW', idPlumber: null }), {
    status: 'NEW',
    plumber_id: null,
    starts_at: null,
    ends_at: null,
  });
});

test('travel setting defaults to 30 and rejects invalid configuration', () => {
  assert.equal(parseTravelGap(), 30);
  assert.equal(parseTravelGap('0'), 0);
  assert.equal(parseTravelGap('45'), 45);
  for (const raw of ['', '-1', '1.5', 'abc', 'Infinity', '9007199254740992'])
    assert.throws(() => parseTravelGap(raw));
});
