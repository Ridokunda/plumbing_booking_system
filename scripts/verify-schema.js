require('dotenv').config();
const database = require('../database/connection');

const requiredColumns = {
  users: ['idusers', 'email', 'password', 'usertype', 'email_verified_at', 'account_status'],
  bookings: [
    'idbookings',
    'idUser',
    'idPlumber',
    'description',
    'location',
    'scheduled_start',
    'scheduled_end',
    'status',
    'amount',
  ],
  plumber_profiles: ['user_id', 'verification_status'],
  quotes: ['idquote', 'booking_id', 'status', 'total_amount'],
  invoices: ['idinvoice', 'booking_id', 'status', 'total_amount'],
  payment_receipts: ['idreceipt', 'booking_id', 'provider_payment_id'],
  reviews: ['idreview', 'booking_id', 'rating'],
  disputes: ['id', 'booking_id', 'status'],
  refunds: ['id', 'booking_id', 'status', 'provider_refund_id', 'processed_at'],
  reschedule_requests: ['id', 'booking_id', 'status'],
  audit_events: ['id', 'action', 'entity_type'],
};

async function verify() {
  const db = database.promise();
  const [rows] = await db.query(
    `SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()`,
  );
  const schema = new Map();
  for (const row of rows) {
    if (!schema.has(row.TABLE_NAME)) schema.set(row.TABLE_NAME, new Set());
    schema.get(row.TABLE_NAME).add(row.COLUMN_NAME);
  }

  const missing = [];
  for (const [table, columns] of Object.entries(requiredColumns)) {
    if (!schema.has(table)) {
      missing.push(`table ${table}`);
      continue;
    }
    for (const column of columns) {
      if (!schema.get(table).has(column)) missing.push(`${table}.${column}`);
    }
  }
  if (missing.length) throw new Error(`Missing schema objects: ${missing.join(', ')}`);
  console.info(`Schema verified: ${Object.keys(requiredColumns).length} core tables.`);
}

verify()
  .then(() => database.end())
  .catch((error) => {
    console.error(error.message);
    database.end();
    process.exitCode = 1;
  });
