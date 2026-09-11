require('dotenv').config();

const bcrypt = require('bcrypt');
const database = require('../database/connection');

const demoUsers = [
  ['Demo', 'Customer', 'customer@wefixit.local', 1, '0710000001'],
  ['Demo', 'Admin', 'admin@wefixit.local', 2, '0710000002'],
  ['Demo', 'Plumber', 'plumber@wefixit.local', 3, '0710000003'],
];

async function seed() {
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DEMO_SEED !== 'true') {
    throw new Error('Refusing to seed production without ALLOW_DEMO_SEED=true');
  }

  const password = process.env.DEMO_PASSWORD || 'PortfolioDemo!2026';
  const passwordHash = await bcrypt.hash(password, Number(process.env.BCRYPT_ROUNDS || 10));
  const connection = await database.promise().getConnection();

  try {
    await connection.beginTransaction();

    for (const [name, surname, email, usertype, phone] of demoUsers) {
      await connection.query(
        `INSERT INTO users
          (name, surname, email, password, usertype, phone, email_verified_at, account_status)
         VALUES (?, ?, ?, ?, ?, ?, NOW(), 'ACTIVE')
         ON DUPLICATE KEY UPDATE
          name = VALUES(name), surname = VALUES(surname), password = VALUES(password),
          usertype = VALUES(usertype), phone = VALUES(phone), email_verified_at = NOW(),
          account_status = 'ACTIVE'`,
        [name, surname, email, passwordHash, usertype, phone],
      );
    }

    const [users] = await connection.query(
      'SELECT idusers, email FROM users WHERE email IN (?, ?, ?)',
      demoUsers.map((user) => user[2]),
    );
    const ids = Object.fromEntries(users.map((user) => [user.email, user.idusers]));

    await connection.query(
      `INSERT INTO plumber_profiles
        (user_id, license_number, years_experience, service_area, skills,
         verification_status, verified_by, verified_at)
       VALUES (?, 'DEMO-PLUMBER-001', 8, 'Johannesburg', ?, 'APPROVED', ?, NOW())
       ON DUPLICATE KEY UPDATE
        years_experience = VALUES(years_experience), service_area = VALUES(service_area),
        skills = VALUES(skills), verification_status = 'APPROVED',
        verified_by = VALUES(verified_by), verified_at = NOW()`,
      [
        ids['plumber@wefixit.local'],
        JSON.stringify(['Plumbing Fix', 'Plumbing Maintenance']),
        ids['admin@wefixit.local'],
      ],
    );

    const [existingBookings] = await connection.query(
      "SELECT idbookings FROM bookings WHERE idUser = ? AND description = 'Demo leaking kitchen tap' LIMIT 1",
      [ids['customer@wefixit.local']],
    );
    if (existingBookings.length === 0) {
      const [booking] = await connection.query(
        `INSERT INTO bookings
          (idUser, idPlumber, type, description, location, date_start,
           scheduled_start, scheduled_end, status, amount)
         VALUES (?, ?, 'Plumbing Fix', 'Demo leaking kitchen tap',
                 'Johannesburg, Gauteng', DATE_ADD(CURDATE(), INTERVAL 2 DAY),
                 DATE_ADD(NOW(), INTERVAL 2 DAY), DATE_ADD(NOW(), INTERVAL 50 HOUR),
                 'ASSIGNED', 850.00)`,
        [ids['customer@wefixit.local'], ids['plumber@wefixit.local']],
      );
      await connection.query(
        `INSERT INTO booking_status_history
          (booking_id, from_status, to_status, changed_by, note)
         VALUES (?, NULL, 'ASSIGNED', ?, 'Created by the portfolio demo seed')`,
        [booking.insertId, ids['admin@wefixit.local']],
      );
    }

    await connection.commit();
    console.info('Demo data is ready.');
    console.info('Accounts: customer@wefixit.local, admin@wefixit.local, plumber@wefixit.local');
    console.info('Password: use DEMO_PASSWORD, or PortfolioDemo!2026 when unset.');
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
    await database.promise().end();
  }
}

seed().catch((error) => {
  console.error('Seed failed:', error.message);
  process.exitCode = 1;
});
