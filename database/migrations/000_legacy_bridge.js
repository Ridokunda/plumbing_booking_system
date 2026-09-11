async function getColumns(db, tableName) {
  const [rows] = await db.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [tableName],
  );
  return new Set(rows.map((row) => row.COLUMN_NAME));
}

async function addMissingColumns(db, tableName, definitions) {
  const columns = await getColumns(db, tableName);
  if (columns.size === 0) return columns;
  for (const [name, definition] of Object.entries(definitions)) {
    if (!columns.has(name)) {
      await db.query(`ALTER TABLE \`${tableName}\` ADD COLUMN \`${name}\` ${definition}`);
      columns.add(name);
    }
  }
  return columns;
}

async function up(db) {
  const userColumns = await addMissingColumns(db, 'users', {
    email_verified_at: 'DATETIME NULL',
    account_status: "ENUM('PENDING','ACTIVE','SUSPENDED','DEACTIVATED') NOT NULL DEFAULT 'ACTIVE'",
    created_at: 'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP',
    updated_at: 'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP',
  });
  if (userColumns.size > 0) {
    await db.query(
      "UPDATE users SET email_verified_at = COALESCE(email_verified_at, NOW()), account_status = COALESCE(account_status, 'ACTIVE')",
    );
  }

  const bookingColumns = await addMissingColumns(db, 'bookings', {
    idPlumber: 'INT NULL',
    description: 'TEXT NULL',
    location: "VARCHAR(500) NOT NULL DEFAULT 'Address to confirm'",
    scheduled_start: 'DATETIME NULL',
    scheduled_end: 'DATETIME NULL',
    currency: "CHAR(3) NOT NULL DEFAULT 'ZAR'",
    cancellation_reason: 'VARCHAR(500) NULL',
    decline_reason: 'VARCHAR(500) NULL',
    created_at: 'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP',
    updated_at: 'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP',
  });
  if (bookingColumns.size > 0) {
    if (bookingColumns.has('plumberid')) {
      await db.query('UPDATE bookings SET idPlumber = COALESCE(idPlumber, plumberid)');
    }
    if (bookingColumns.has('des')) {
      await db.query("UPDATE bookings SET description = COALESCE(description, des, '')");
    }
    if (bookingColumns.has('booking_date')) {
      await db.query('UPDATE bookings SET created_at = COALESCE(booking_date, created_at)');
    }
    await db.query('ALTER TABLE bookings MODIFY COLUMN amount DECIMAL(12,2) NULL');
  }
}

module.exports = { up };
