const database = require('../database/connection');
const { time, travelGapMinutes, timezone } = require('../config/dispatch');
const { SchedulingError, snapshot, windowsConflict } = require('./scheduling');

const fields = `b.*, c.name AS customer_name, c.surname AS customer_surname,
  EXISTS(SELECT 1 FROM reschedule_requests rr WHERE rr.booking_id = b.idbookings AND rr.status = 'PENDING') AS pending_reschedule`;
const join = 'FROM bookings b JOIN users c ON c.idusers = b.idUser';
const unassigned =
  "(b.status IN ('NEW','PENDING') OR (b.status = 'ASSIGNED' AND (b.idPlumber IS NULL OR b.scheduled_start IS NULL OR b.scheduled_end IS NULL)))";
const overdue = "b.status IN ('ASSIGNED','IN_PROGRESS') AND b.scheduled_end < ?";

function positive(value, fallback) {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) < 1)
    throw new SchedulingError('Invalid identifier or queue page.', 400);
  return Number(value);
}
function normalize(row) {
  return {
    ...row,
    date_start:
      row.date_start instanceof Date ? row.date_start.toISOString().slice(0, 10) : row.date_start,
    scheduled_start: row.scheduled_start ? new Date(row.scheduled_start).toISOString() : null,
    scheduled_end: row.scheduled_end ? new Date(row.scheduled_end).toISOString() : null,
    pending_reschedule: Boolean(row.pending_reschedule),
    expected_schedule: snapshot(row),
    editable: ['NEW', 'PENDING', 'ASSIGNED'].includes(row.status) && !row.pending_reschedule,
  };
}
async function queue(db, where, params, requestedPage) {
  const [[{ total }]] = await db.query(`SELECT COUNT(*) AS total ${join} WHERE ${where}`, params);
  const pages = Math.max(1, Math.ceil(total / 20));
  const page = Math.min(requestedPage, pages);
  const [items] = await db.query(
    `SELECT ${fields} ${join} WHERE ${where} ORDER BY b.created_at, b.idbookings LIMIT 20 OFFSET ?`,
    [...params, (page - 1) * 20],
  );
  return { items: items.map(normalize), total, page, pages };
}
async function getDispatchData(query) {
  const date = query.date ?? time.dateKey();
  const view = query.view ?? 'day';
  let range;
  try {
    range = time.range(date, view);
  } catch (error) {
    throw new SchedulingError(error.message, 400);
  }
  const plumberId = positive(query.plumber_id, null);
  const bookingId = positive(query.booking_id, null);
  const unassignedPage = positive(query.unassigned_page, 1);
  const overduePage = positive(query.overdue_page, 1);
  const db = database.promise();
  const now = new Date();
  const filter = plumberId ? ' AND b.idPlumber = ?' : '';
  const filterParams = plumberId ? [plumberId] : [];
  const padding = travelGapMinutes * 60000;
  const [[plumbers], [availability], [visits], waiting, late] = await Promise.all([
    db.query(`SELECT u.idusers, u.name, u.surname, u.account_status, pp.verification_status,
      (u.account_status = 'ACTIVE' AND pp.verification_status = 'APPROVED') AS assignable
      FROM users u LEFT JOIN plumber_profiles pp ON pp.user_id = u.idusers WHERE u.usertype = 3 AND
      ((u.account_status = 'ACTIVE' AND pp.verification_status = 'APPROVED') OR EXISTS
       (SELECT 1 FROM bookings b WHERE b.idPlumber = u.idusers AND b.status IN ('ASSIGNED','IN_PROGRESS','COMPLETED','PAID')))
      ORDER BY u.name, u.surname, u.idusers`),
    db.query(
      `SELECT * FROM plumber_availability WHERE starts_at < ? AND ends_at > ?${plumberId ? ' AND plumber_id = ?' : ''}`,
      [range.end, range.start, ...filterParams],
    ),
    db.query(
      `SELECT ${fields} ${join} WHERE b.status IN ('ASSIGNED','IN_PROGRESS','COMPLETED','PAID')
      AND b.scheduled_start < ? AND b.scheduled_end > ?${filter} ORDER BY b.scheduled_start, b.idbookings`,
      [
        new Date(range.end.getTime() + padding),
        new Date(range.start.getTime() - padding),
        ...filterParams,
      ],
    ),
    queue(db, unassigned, [], unassignedPage),
    queue(db, overdue + filter, [now, ...filterParams], overduePage),
  ]);
  if (plumberId && !plumbers.some((p) => p.idusers === plumberId))
    throw new SchedulingError('Plumber not found in dispatch.', 404);
  const bookings = visits.map(normalize);
  // Include neighbours outside the display range so boundary warnings are accurate.
  const previousByPlumber = new Map();
  for (const booking of bookings) {
    booking.travel_conflict = false;
    const previous = previousByPlumber.get(booking.idPlumber);
    if (
      previous &&
      windowsConflict(
        booking.scheduled_start,
        booking.scheduled_end,
        previous.scheduled_start,
        previous.scheduled_end,
      )
    ) {
      booking.travel_conflict = true;
      previous.travel_conflict = true;
    }
    if (!previous || new Date(booking.scheduled_end) > new Date(previous.scheduled_end))
      previousByPlumber.set(booking.idPlumber, booking);
  }
  let selectedBooking = null;
  if (bookingId) {
    const [[row]] = await db.query(`SELECT ${fields} ${join} WHERE b.idbookings = ?`, [bookingId]);
    if (!row) throw new SchedulingError('Booking not found.', 404);
    selectedBooking = normalize(row);
  }
  const all = [
    ...bookings,
    ...waiting.items,
    ...late.items,
    ...(selectedBooking ? [selectedBooking] : []),
  ];
  const ids = [...new Set(all.map((b) => b.idbookings))];
  const preferred = new Map();
  if (ids.length) {
    const [dates] = await db.query(
      "SELECT booking_id, DATE_FORMAT(date_start, '%Y-%m-%d') AS date FROM booking_dates WHERE booking_id IN (?) ORDER BY date_start",
      [ids],
    );
    for (const row of dates)
      preferred.set(row.booking_id, [...(preferred.get(row.booking_id) || []), row.date]);
  }
  for (const booking of all)
    booking.preferred_dates = preferred.get(booking.idbookings) || [booking.date_start];
  return {
    success: true,
    date,
    view,
    range: {
      from: range.first,
      to: range.last,
      start: range.start.toISOString(),
      end: range.end.toISOString(),
    },
    timezone,
    travel_gap_minutes: travelGapMinutes,
    server_now: now.toISOString(),
    plumbers: plumbers.map((p) => ({ ...p, assignable: Boolean(p.assignable) })),
    availability,
    bookings,
    unassigned: waiting,
    overdue: late,
    selected_booking: selectedBooking,
  };
}
module.exports = { getDispatchData };
