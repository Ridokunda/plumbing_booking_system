const express = require('express');
const bcrypt = require('bcrypt');
const router = express.Router();
const connection = require('../database/connection');
const { normalizeEmail, validatePassword } = require('../utils/validation');
const { hashToken, createAccountToken } = require('../utils/accountTokens');
const { sendEmail } = require('../utils/mailer');
const { createRateLimiter } = require('../middleware/security');

const limiter = createRateLimiter({ max: 6 });

router.get('/verify', async (req, res, next) => {
  try {
    const tokenHash = hashToken(String(req.query.token || ''));
    const [result] = await connection.promise().query(
      `UPDATE users u JOIN account_tokens t ON t.user_id = u.idusers
       SET u.email_verified_at = NOW(), t.used_at = NOW()
       WHERE t.token_hash = ? AND t.purpose = 'VERIFY_EMAIL' AND t.used_at IS NULL AND t.expires_at > NOW()`,
      [tokenHash],
    );
    res.render('account-message', {
      title: 'Verify email',
      message: result.affectedRows
        ? 'Your email has been verified. You can now sign in.'
        : 'This verification link is invalid or expired.',
      success: result.affectedRows > 0,
    });
  } catch (error) {
    next(error);
  }
});

router.get('/forgot-password', (req, res) =>
  res.render('forgot-password', { title: 'Forgot password', message: null }),
);

router.post('/forgot-password', limiter, async (req, res, next) => {
  const email = normalizeEmail(req.body.email);
  const generic = 'If that account exists, a reset link has been sent.';
  if (!email) return res.render('forgot-password', { title: 'Forgot password', message: generic });
  try {
    const [users] = await connection
      .promise()
      .query("SELECT idusers, email FROM users WHERE email = ? AND account_status = 'ACTIVE'", [
        email,
      ]);
    if (users.length) {
      const token = await createAccountToken(users[0].idusers, 'RESET_PASSWORD', 30);
      const url = `${process.env.APP_URL || `${req.protocol}://${req.get('host')}`}/account/reset-password?token=${token}`;
      await sendEmail({
        to: email,
        subject: 'Reset your WeFixIt password',
        html: `<p>Use this link within 30 minutes:</p><p><a href="${url}">Reset password</a></p>`,
      });
    }
    res.render('forgot-password', { title: 'Forgot password', message: generic });
  } catch (error) {
    next(error);
  }
});

router.get('/reset-password', (req, res) => {
  res.render('reset-password', {
    title: 'Reset password',
    token: String(req.query.token || ''),
    message: null,
  });
});

router.post('/reset-password', limiter, async (req, res, next) => {
  const token = String(req.body.token || '');
  const password = req.body.password;
  if (!token || !validatePassword(password))
    return res.status(400).render('reset-password', {
      title: 'Reset password',
      token,
      message: 'Use a valid link and a password of at least 10 characters.',
    });
  let db;
  try {
    db = await connection.promise().getConnection();
    await db.beginTransaction();
    const [tokens] = await db.query(
      "SELECT id, user_id FROM account_tokens WHERE token_hash = ? AND purpose = 'RESET_PASSWORD' AND used_at IS NULL AND expires_at > NOW() FOR UPDATE",
      [hashToken(token)],
    );
    if (!tokens.length) {
      await db.rollback();
      return res.status(400).render('reset-password', {
        title: 'Reset password',
        token: '',
        message: 'This reset link is invalid or expired.',
      });
    }
    const hash = await bcrypt.hash(password, Number(process.env.BCRYPT_ROUNDS) || 10);
    await db.query('UPDATE users SET password = ? WHERE idusers = ?', [hash, tokens[0].user_id]);
    await db.query('UPDATE account_tokens SET used_at = NOW() WHERE id = ?', [tokens[0].id]);
    await db.commit();
    res.render('account-message', {
      title: 'Password changed',
      message: 'Your password was changed. You can now sign in.',
      success: true,
    });
  } catch (error) {
    if (db) await db.rollback();
    next(error);
  } finally {
    if (db) db.release();
  }
});

module.exports = router;
