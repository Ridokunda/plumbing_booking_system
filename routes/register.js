var express = require('express');
var router = express.Router();
var bcrypt = require('bcrypt');
const connection = require('../database/connection');
const { verifyToken, isAdmin } = require('../middleware/auth');
const { USER_ROLES } = require('../config/domain');
const { cleanText, normalizeEmail, validatePassword } = require('../utils/validation');
const { createRateLimiter } = require('../middleware/security');
const { createAccountToken } = require('../utils/accountTokens');
const { sendEmail } = require('../utils/mailer');
const registrationLimiter = createRateLimiter({ max: 8 });

// GET registeruser page
router.get('/registeruser', verifyToken, isAdmin, function (req, res) {
  res.render('registeruser', { title: 'Register Page', message: null });
});
// GET registerCustomer page
router.get('/register', function (req, res) {
  res.render('registerCustomer', { title: 'Register Page', message: null });
});

router.get('/plumber', function (req, res) {
  res.render('register-plumber', { title: 'Plumber application', message: null });
});

router.post('/plumber', registrationLimiter, async (req, res) => {
  const name = cleanText(req.body.name, { max: 100 });
  const surname = cleanText(req.body.surname, { max: 100 });
  const email = normalizeEmail(req.body.email);
  const phone = cleanText(req.body.phone, { min: 0, max: 30 }) || null;
  const license = cleanText(req.body.license_number, { max: 100 });
  const serviceArea = cleanText(req.body.service_area, { max: 255 });
  const experience = Number(req.body.years_experience);
  const password = req.body.password;
  if (
    !name ||
    !surname ||
    !email ||
    !license ||
    !serviceArea ||
    !Number.isInteger(experience) ||
    experience < 0 ||
    experience > 80 ||
    !validatePassword(password)
  ) {
    return res.status(400).render('register-plumber', {
      title: 'Plumber application',
      message:
        'Complete every field with valid information. Passwords require at least 10 characters.',
    });
  }

  let db;
  try {
    db = await connection.promise().getConnection();
    await db.beginTransaction();
    const hash = await bcrypt.hash(password, Number(process.env.BCRYPT_ROUNDS) || 10);
    const [result] = await db.query(
      `INSERT INTO users (name, surname, email, phone, password, usertype, account_status)
       VALUES (?, ?, ?, ?, ?, ?, 'PENDING')`,
      [name, surname, email, phone, hash, USER_ROLES.PLUMBER],
    );
    await db.query(
      'INSERT INTO plumber_profiles (user_id, license_number, years_experience, service_area, verification_status) VALUES (?, ?, ?, ?, ?)',
      [result.insertId, license, experience, serviceArea, 'PENDING'],
    );
    await db.commit();
    const verificationToken = await createAccountToken(result.insertId, 'VERIFY_EMAIL', 1440);
    const verificationUrl = `${process.env.APP_URL || `${req.protocol}://${req.get('host')}`}/account/verify?token=${verificationToken}`;
    await sendEmail({
      to: email,
      subject: 'Verify your WeFixIt email',
      html: `<p>Verify your email within 24 hours:</p><p><a href="${verificationUrl}">Verify email</a></p>`,
    });
    return res.status(201).render('register-plumber', {
      title: 'Plumber application',
      message: 'Application submitted successfully. An administrator will review it.',
    });
  } catch (error) {
    if (db) await db.rollback();
    const message =
      error.code === 'ER_DUP_ENTRY'
        ? 'That email or license number is already registered.'
        : 'Unable to submit the application.';
    return res
      .status(error.code === 'ER_DUP_ENTRY' ? 409 : 500)
      .render('register-plumber', { title: 'Plumber application', message });
  } finally {
    if (db) db.release();
  }
});

/* POST add a user*/
router.post('/register', registrationLimiter, async (req, res) => {
  const { name, surname, address, email, phone, password } = req.body;
  const safeName = cleanText(name, { max: 100 });
  const safeSurname = cleanText(surname, { max: 100 });
  const safeEmail = normalizeEmail(email);
  const safeAddress = cleanText(address, { min: 0, max: 500 }) || null;
  const safePhone = cleanText(phone, { min: 0, max: 30 }) || null;
  if (!safeName || !safeSurname || !safeEmail || !validatePassword(password)) {
    return res.status(400).render('registerCustomer', {
      title: 'Register Page',
      message: 'Enter valid details and your password must contain at least 10 characters.',
    });
  }
  const query1 =
    'INSERT INTO users (name,surname,address,email,phone,password,usertype) VALUES (?,?,?,?,?,?,?)';

  const query2 = 'SELECT idusers FROM users WHERE email = ? LIMIT 1';
  try {
    const hash = await bcrypt.hash(password, 10);
    connection.query(query2, [safeEmail], (checkErr, existing) => {
      if (checkErr) {
        console.error('Error while checking existing user email', checkErr);
        return res.status(500).send('internal server error');
      }

      if (existing.length > 0) {
        return res.status(409).render('registerCustomer', {
          title: 'Register Page',
          message: 'Email already registered',
        });
      }

      connection.query(
        query1,
        [safeName, safeSurname, safeAddress, safeEmail, safePhone, hash, USER_ROLES.CUSTOMER],
        async (err, result) => {
          if (err) {
            console.error('Error while inserting user in the database', err);
            return res.status(500).send('internal server error');
          }

          try {
            const verificationToken = await createAccountToken(
              result.insertId,
              'VERIFY_EMAIL',
              1440,
            );
            const verificationUrl = `${process.env.APP_URL || `${req.protocol}://${req.get('host')}`}/account/verify?token=${verificationToken}`;
            await sendEmail({
              to: safeEmail,
              subject: 'Verify your WeFixIt email',
              html: `<p>Verify your email within 24 hours:</p><p><a href="${verificationUrl}">Verify email</a></p>`,
            });
            res.render('registerCustomer', {
              title: 'Register Page',
              message: 'Registration successful. Check your email to verify your account.',
            });
          } catch (notificationError) {
            console.error('Unable to send verification email', notificationError);
            res.render('registerCustomer', {
              title: 'Register Page',
              message:
                'Registration successful. Contact support if your verification email does not arrive.',
            });
          }
        },
      );
    });
  } catch (err) {
    console.error('error hashing password', err);
    return res.status(500).send('error with hashing');
  }
});
/* POST add a user*/
router.post('/registeruser', verifyToken, isAdmin, async (req, res) => {
  const { name, surname, usertype, email, password } = req.body;
  const safeName = cleanText(name, { max: 100 });
  const safeSurname = cleanText(surname, { max: 100 });
  const safeEmail = normalizeEmail(email);
  const safeRole = Number(usertype);
  if (!safeName || !safeSurname || !safeEmail || !validatePassword(password)) {
    return res
      .status(400)
      .send('Valid name, surname, email, and a password of at least 10 characters are required');
  }
  if (![USER_ROLES.CUSTOMER, USER_ROLES.PLUMBER].includes(safeRole)) {
    return res.status(400).send('Administrators can only create customer or plumber accounts here');
  }
  const query1 =
    "INSERT INTO users (name,surname,usertype,email,password,email_verified_at,account_status) VALUES (?,?,?,?,?,NOW(),'ACTIVE')";

  const query2 = 'SELECT idusers FROM users WHERE email = ? LIMIT 1';
  try {
    const hash = await bcrypt.hash(password, 10);
    connection.query(query2, [safeEmail], (checkErr, existing) => {
      if (checkErr) {
        console.error('Error while checking existing user email', checkErr);
        return res.status(500).send('internal server error');
      }

      if (existing.length > 0) {
        return res.status(409).send('Email already registered');
      }

      connection.query(
        query1,
        [safeName, safeSurname, safeRole, safeEmail, hash],
        (err, result) => {
          if (err) {
            console.error('Error while inserting user in the database', err);
            return res.status(500).send('internal server error');
          }

          if (safeRole === USER_ROLES.PLUMBER) {
            const license = cleanText(req.body.plumber_license, { max: 100 });
            const experience = Number(req.body.experience);
            if (!license || !Number.isInteger(experience) || experience < 0 || experience > 80) {
              return connection.query(
                'DELETE FROM users WHERE idusers = ?',
                [result.insertId],
                () => res.status(400).send('A valid plumber license and experience are required'),
              );
            }
            return connection.query(
              "INSERT INTO plumber_profiles (user_id, license_number, years_experience, verification_status, verified_by, verified_at) VALUES (?, ?, ?, 'APPROVED', ?, NOW())",
              [result.insertId, license, experience, req.user.idusers],
              (profileError) => {
                if (profileError) return res.status(500).send('Unable to create plumber profile');
                res.status(201).send('User successfully registered');
              },
            );
          }
          res.status(201).send('User successfully registered');
        },
      );
    });
  } catch (err) {
    console.error('error hashing password', err);
    return res.status(500).send('error with hashing');
  }
});
module.exports = router;
