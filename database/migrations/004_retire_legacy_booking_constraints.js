async function up(db) {
  const [rows] = await db.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bookings'`,
  );
  const columns = new Set(rows.map((row) => row.COLUMN_NAME));
  if (columns.has('des')) {
    await db.query('ALTER TABLE bookings MODIFY COLUMN des VARCHAR(255) NULL');
  }
}

module.exports = { up };
