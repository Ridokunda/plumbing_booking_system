require('dotenv').config();
const fs = require('fs');
const path = require('path');
const connection = require('../database/connection');

async function migrate() {
  const db = connection.promise();
  await db.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    filename VARCHAR(255) NOT NULL PRIMARY KEY,
    applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB`);

  const directory = path.join(__dirname, '..', 'database', 'migrations');
  const files = fs
    .readdirSync(directory)
    .filter((file) => file.endsWith('.sql') || file.endsWith('.js'))
    .sort();
  const [rows] = await db.query('SELECT filename FROM schema_migrations');
  const applied = new Set(rows.map((row) => row.filename));

  for (const filename of files) {
    if (applied.has(filename)) continue;
    const migrationPath = path.join(directory, filename);
    if (filename.endsWith('.js')) {
      const migration = require(migrationPath);
      await migration.up(db);
    } else {
      const sql = fs.readFileSync(migrationPath, 'utf8');
      const statements = sql
        .split(';')
        .map((statement) => statement.trim())
        .filter(Boolean);
      for (const statement of statements) await db.query(statement);
    }
    await db.query('INSERT INTO schema_migrations (filename) VALUES (?)', [filename]);
    console.log(`Applied ${filename}`);
  }
}

migrate()
  .then(() => connection.end())
  .catch((error) => {
    console.error('Migration failed:', error.message);
    connection.end();
    process.exitCode = 1;
  });
