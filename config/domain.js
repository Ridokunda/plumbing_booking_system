const USER_ROLES = Object.freeze({
  CUSTOMER: 1,
  ADMIN: 2,
  PLUMBER: 3,
});

const SERVICES = Object.freeze([
  'Plumbing_Installation',
  'Plumbing_Fix',
  'Plumbing_Maintenance',
  'Electrical_Fix',
  'Electrical_Installation',
  'Electrical_Maintenance',
]);

const BOOKING_TRANSITIONS = Object.freeze({
  customer: Object.freeze({
    NEW: Object.freeze(['CANCELLED']),
    PENDING: Object.freeze(['CANCELLED']),
  }),
  plumber: Object.freeze({
    ASSIGNED: Object.freeze(['IN_PROGRESS']),
    IN_PROGRESS: Object.freeze(['COMPLETED']),
  }),
  admin: Object.freeze({
    NEW: Object.freeze(['ASSIGNED', 'DECLINED']),
    PENDING: Object.freeze(['ASSIGNED', 'DECLINED']),
  }),
});

module.exports = { USER_ROLES, SERVICES, BOOKING_TRANSITIONS };
