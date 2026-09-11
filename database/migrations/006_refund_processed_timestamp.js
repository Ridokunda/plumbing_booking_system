async function up(connection) {
  const [rows] = await connection.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = 'refunds' AND column_name = 'processed_at'`,
  );
  if (!rows.length) {
    await connection.query(
      'ALTER TABLE refunds ADD COLUMN processed_at DATETIME NULL AFTER provider_refund_id',
    );
  }
}

module.exports = { up };
