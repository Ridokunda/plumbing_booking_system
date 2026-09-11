async function hasColumn(connection, table, column) {
  const [rows] = await connection.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
    [table, column],
  );
  return rows.length > 0;
}

async function up(connection) {
  if (!(await hasColumn(connection, 'refunds', 'provider_refund_id'))) {
    await connection.query(
      'ALTER TABLE refunds ADD COLUMN provider_refund_id VARCHAR(255) NULL AFTER processed_by',
    );
  }
}

module.exports = { up };
