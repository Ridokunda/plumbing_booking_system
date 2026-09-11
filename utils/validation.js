const { SERVICES, BOOKING_TRANSITIONS } = require('../config/domain');

function cleanText(value, { min = 1, max = 255 } = {}) {
  if (typeof value !== 'string') return null;
  const cleaned = value.trim();
  if (cleaned.length < min || cleaned.length > max) return null;
  return cleaned;
}

function normalizeEmail(value) {
  const email = cleanText(value, { min: 3, max: 254 });
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email.toLowerCase();
}

function validatePassword(value) {
  return typeof value === 'string' && value.length >= 10 && value.length <= 128;
}

function normalizeBookingDates(value, now = new Date()) {
  let supplied = value;
  if (typeof supplied === 'string') {
    try {
      const parsed = JSON.parse(supplied);
      supplied = Array.isArray(parsed) ? parsed : [supplied];
    } catch (_) {
      supplied = [supplied];
    }
  }

  if (!Array.isArray(supplied)) return null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const unique = [...new Set(supplied.filter(Boolean))];
  if (unique.length === 0 || unique.length > 5) return null;

  for (const raw of unique) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
    const [year, month, day] = raw.split('-').map(Number);
    const parsed = new Date(year, month - 1, day);
    if (
      Number.isNaN(parsed.getTime()) ||
      parsed.getFullYear() !== year ||
      parsed.getMonth() !== month - 1 ||
      parsed.getDate() !== day ||
      parsed < today
    )
      return null;
  }
  return unique.sort();
}

function normalizeMoney(value) {
  if (value === '' || value === null || value === undefined) return null;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0 || amount > 1000000) return null;
  return Math.round(amount * 100) / 100;
}

function normalizeSchedule(startValue, endValue, now = new Date()) {
  const start = new Date(startValue);
  const end = new Date(endValue);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  if (start <= now || end <= start) return null;
  if (end.getTime() - start.getTime() > 12 * 60 * 60 * 1000) return null;
  return { start, end };
}

function isValidService(value) {
  return SERVICES.includes(value);
}

function canTransition(role, from, to) {
  const transitions = BOOKING_TRANSITIONS[String(role || '').toLowerCase()];
  if (!transitions) return false;
  const allowed = transitions[String(from || '').toUpperCase()];
  return Array.isArray(allowed) && allowed.includes(String(to || '').toUpperCase());
}

function normalizePagination(query = {}, defaultPageSize = 20) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const pageSize = Math.min(
    50,
    Math.max(1, Number.parseInt(query.page_size, 10) || defaultPageSize),
  );
  return { page, pageSize, offset: (page - 1) * pageSize };
}

module.exports = {
  cleanText,
  normalizeEmail,
  validatePassword,
  normalizeBookingDates,
  normalizeMoney,
  normalizeSchedule,
  isValidService,
  canTransition,
  normalizePagination,
};
