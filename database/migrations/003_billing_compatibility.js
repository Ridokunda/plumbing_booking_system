async function columnsFor(db, tableName) {
  const [rows] = await db.query(
    'SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?',
    [tableName],
  );
  return new Set(rows.map((row) => row.COLUMN_NAME));
}

async function up(db) {
  const invoiceColumns = await columnsFor(db, 'invoices');
  if (invoiceColumns.size > 0 && !invoiceColumns.has('currency')) {
    await db.query(
      "ALTER TABLE invoices ADD COLUMN currency CHAR(3) NOT NULL DEFAULT 'ZAR' AFTER total_amount",
    );
  }
  if (invoiceColumns.size > 0) {
    await db.query(
      "ALTER TABLE invoices MODIFY COLUMN status ENUM('PENDING','PAID','VOID','REFUNDED') NOT NULL DEFAULT 'PENDING'",
    );
  }

  const receiptColumns = await columnsFor(db, 'payment_receipts');
  if (receiptColumns.size > 0 && !receiptColumns.has('provider')) {
    await db.query(
      "ALTER TABLE payment_receipts ADD COLUMN provider VARCHAR(40) NOT NULL DEFAULT 'SIMULATED' AFTER plumber_id",
    );
  }
  if (receiptColumns.size > 0 && !receiptColumns.has('provider_payment_id')) {
    await db.query(
      'ALTER TABLE payment_receipts ADD COLUMN provider_payment_id VARCHAR(255) NULL AFTER provider',
    );
  }
}

module.exports = { up };
