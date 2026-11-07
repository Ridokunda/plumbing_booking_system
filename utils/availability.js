const { time } = require('../config/dispatch');
const { normalizeSchedule } = require('./validation');

function normalizeAvailability(startsAt, endsAt, now = new Date()) {
  const parse = (value) => {
    if (typeof value !== 'string') return null;
    // datetime-local values are South African wall time; API clients may send an offset.
    return /(?:Z|[+-]\d{2}:\d{2})$/i.test(value) ? value : time.parseInput(value);
  };
  const start = parse(startsAt);
  const end = parse(endsAt);
  return start && end ? normalizeSchedule(start, end, now) : null;
}

module.exports = { normalizeAvailability };
