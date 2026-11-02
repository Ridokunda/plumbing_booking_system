const database = require('../database/connection');
const { normalizeSchedule } = require('./validation');
const { createNotifications } = require('./notifications');
const { travelGapMinutes } = require('../config/dispatch');

class SchedulingError extends Error {
  constructor(message, status = 409) {
    super(message);
    this.status = status;
  }
}
const instant = (value) =>
  value === null || value === undefined ? null : new Date(value).toISOString();
function snapshot(booking) {
  return {
    status: booking.status,
    plumber_id:
      booking.idPlumber === null || booking.idPlumber === undefined
        ? null
        : Number(booking.idPlumber),
    starts_at: instant(booking.scheduled_start),
    ends_at: instant(booking.scheduled_end),
  };
}
function matchesSnapshot(booking, expected) {
  if (!expected || typeof expected !== 'object') return false;
  const actual = snapshot(booking);
  return Object.keys(actual).every((key) => actual[key] === expected[key]);
}
function windowsConflict(start, end, otherStart, otherEnd, gap = travelGapMinutes) {
  return (
    new Date(start).getTime() < new Date(otherEnd).getTime() + gap * 60000 &&
    new Date(end).getTime() > new Date(otherStart).getTime() - gap * 60000
  );
}

async function beginSchedulingTransaction(db) {
  // The plumber row is the scheduling mutex. READ COMMITTED avoids snapshot
  // staleness after waiting for it, and avoids locking empty schedule index gaps
  // belonging to independent plumbers.
  await db.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
  await db.beginTransaction();
}

// All scheduling writers acquire plumber rows in ascending order, then the booking,
// then its reschedule requests. Recheck the initial lookup after obtaining locks.
async function lockBooking(db, bookingId, targetPlumberId = null) {
  const [[initial]] = await db.query('SELECT idPlumber FROM bookings WHERE idbookings = ?', [
    bookingId,
  ]);
  if (!initial) throw new SchedulingError('Booking not found.', 404);
  const ids = [...new Set([initial.idPlumber, targetPlumberId].filter(Boolean).map(Number))].sort(
    (a, b) => a - b,
  );
  for (const id of ids)
    await db.query('SELECT idusers FROM users WHERE idusers = ? FOR UPDATE', [id]);
  const [[booking]] = await db.query('SELECT * FROM bookings WHERE idbookings = ? FOR UPDATE', [
    bookingId,
  ]);
  if (!booking || (booking.idPlumber && !ids.includes(Number(booking.idPlumber)))) {
    throw new SchedulingError('The assignment changed. Refresh the calendar and try again.');
  }
  const [requests] = await db.query(
    "SELECT * FROM reschedule_requests WHERE booking_id = ? AND status = 'PENDING' ORDER BY id FOR UPDATE",
    [bookingId],
  );
  return { booking, requests };
}

async function validateSlot(db, bookingId, plumberId, start, end) {
  const [[plumber]] = await db.query(
    `SELECT u.idusers FROM users u JOIN plumber_profiles pp ON pp.user_id = u.idusers
    WHERE u.idusers = ? AND u.usertype = 3 AND u.account_status = 'ACTIVE' AND pp.verification_status = 'APPROVED' FOR UPDATE`,
    [plumberId],
  );
  if (!plumber)
    throw new SchedulingError('Only an approved, active plumber can be scheduled.', 400);
  const gap = travelGapMinutes * 60000;
  // The plumber lock serializes schedule writers; READ COMMITTED sees the latest visit.
  const [conflicts] = await db.query(
    `SELECT idbookings FROM bookings WHERE idPlumber = ? AND idbookings <> ?
    AND status IN ('ASSIGNED','IN_PROGRESS','COMPLETED','PAID')
    AND scheduled_start < ? AND scheduled_end > ? LIMIT 1`,
    [plumberId, bookingId, new Date(end.getTime() + gap), new Date(start.getTime() - gap)],
  );
  if (conflicts.length)
    throw new SchedulingError(
      `Visit #${conflicts[0].idbookings} overlaps or leaves less than ${travelGapMinutes} minutes of travel time.`,
    );
  const [availability] = await db.query(
    `SELECT id, starts_at, ends_at, availability_type FROM plumber_availability
    WHERE plumber_id = ? AND starts_at < ? AND ends_at > ? FOR UPDATE`,
    [plumberId, end, start],
  );
  const available = availability.some(
    (slot) =>
      slot.availability_type === 'AVAILABLE' && slot.starts_at <= start && slot.ends_at >= end,
  );
  const blocked = availability.some((slot) => slot.availability_type === 'UNAVAILABLE');
  if (!available || blocked)
    throw new SchedulingError('That plumber is not available for the full selected time.');
}

async function saveSchedule(db, booking, plumberId, start, end, actorId, ipAddress) {
  const previous = snapshot(booking);
  const next = {
    status: 'ASSIGNED',
    plumber_id: plumberId,
    starts_at: instant(start),
    ends_at: instant(end),
  };
  if (Object.keys(next).every((key) => next[key] === previous[key])) return null;
  await db.query(
    "UPDATE bookings SET idPlumber = ?, scheduled_start = ?, scheduled_end = ?, status = 'ASSIGNED' WHERE idbookings = ?",
    [plumberId, start, end, booking.idbookings],
  );
  await db.query(
    'INSERT INTO booking_status_history (booking_id, from_status, to_status, changed_by, note) VALUES (?, ?, ?, ?, ?)',
    [
      booking.idbookings,
      booking.status,
      'ASSIGNED',
      actorId,
      booking.status === 'ASSIGNED'
        ? 'Visit rescheduled by administrator'
        : 'Visit scheduled by administrator',
    ],
  );
  await db.query(
    `INSERT INTO audit_events (actor_id, action, entity_type, entity_id, metadata, ip_address)
    VALUES (?, ?, 'booking', ?, ?, ?)`,
    [
      actorId,
      booking.status === 'ASSIGNED' ? 'BOOKING_RESCHEDULED' : 'BOOKING_SCHEDULED',
      String(booking.idbookings),
      JSON.stringify({ previous, next }),
      ipAddress || null,
    ],
  );
  return { bookingId: booking.idbookings, customerId: booking.idUser, previous, next };
}

async function notifySchedule(change) {
  if (!change) return;
  const { bookingId, customerId, previous, next } = change;
  const when = new Intl.DateTimeFormat('en-ZA', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Africa/Johannesburg',
  }).format(new Date(next.starts_at));
  await createNotifications([...new Set([customerId, next.plumber_id])], {
    bookingId,
    type: 'booking_scheduled',
    title: previous.status === 'ASSIGNED' ? 'Visit updated' : 'Visit scheduled',
    message: `Your visit is scheduled for ${when} SAST.`,
  });
  if (previous.plumber_id && previous.plumber_id !== next.plumber_id) {
    await createNotifications([previous.plumber_id], {
      bookingId,
      type: 'booking_reassigned',
      title: 'Visit reassigned',
      message: `Visit #${bookingId} is no longer assigned to you.`,
    });
  }
}

async function assignVisit({
  bookingId,
  plumberId,
  startsAt,
  endsAt,
  expected,
  actorId,
  ipAddress,
}) {
  const schedule = normalizeSchedule(startsAt, endsAt);
  if (
    !Number.isInteger(bookingId) ||
    bookingId <= 0 ||
    !Number.isInteger(plumberId) ||
    plumberId <= 0 ||
    !schedule
  ) {
    throw new SchedulingError(
      'Provide a booking, plumber, and valid future time window of no more than 12 hours.',
      400,
    );
  }
  const db = await database.promise().getConnection();
  let change;
  try {
    await beginSchedulingTransaction(db);
    const { booking, requests } = await lockBooking(db, bookingId, plumberId);
    if (!['NEW', 'PENDING', 'ASSIGNED'].includes(booking.status))
      throw new SchedulingError('Started or finished visits cannot be scheduled.');
    if (expected !== undefined && !matchesSnapshot(booking, expected))
      throw new SchedulingError(
        'This visit changed since you opened it. Refresh the calendar and reopen the form.',
      );
    if (requests.length)
      throw new SchedulingError(
        'Review the pending customer reschedule request in Operations cases first.',
      );
    const unchanged = matchesSnapshot(booking, {
      status: 'ASSIGNED',
      plumber_id: plumberId,
      starts_at: instant(schedule.start),
      ends_at: instant(schedule.end),
    });
    if (!unchanged) await validateSlot(db, bookingId, plumberId, schedule.start, schedule.end);
    change = await saveSchedule(
      db,
      booking,
      plumberId,
      schedule.start,
      schedule.end,
      actorId,
      ipAddress,
    );
    await db.commit();
  } catch (error) {
    await db.rollback();
    throw error;
  } finally {
    db.release();
  }
  await notifySchedule(change);
  return change;
}

module.exports = {
  SchedulingError,
  snapshot,
  matchesSnapshot,
  windowsConflict,
  beginSchedulingTransaction,
  lockBooking,
  validateSlot,
  saveSchedule,
  notifySchedule,
  assignVisit,
};
