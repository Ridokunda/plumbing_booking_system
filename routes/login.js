var express = require('express');
var router = express.Router();
var bcrypt = require('bcrypt');
const connection = require('../database/connection');
const { createRateLimiter } = require('../middleware/security');
const { normalizeEmail } = require('../utils/validation');

/* GET Login page. */
router.get('/', function (req, res) {
  const error = req.query.error;
  res.render('login', { title: 'Log in', error });
});

/* POST login*/
router.post('/log', createRateLimiter({ max: 10 }), (req, res) => {
  const email = normalizeEmail(req.body.email);
  const password = req.body.password;
  if (!email || typeof password !== 'string') {
    return res.status(400).json({ success: false, message: 'Provide email and password' });
  }

  const query = 'SELECT * FROM users WHERE email = ?';

  connection.query(query, [email], async (err, result) => {
    if (err) {
      console.error('error querying the database', err);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }

    if (result.length === 0) {
      return res.status(401).json({ success: false, message: 'Invalid password or email' });
    }
    const user = result[0];

    if (user.account_status !== 'ACTIVE') {
      return res.status(403).json({
        success: false,
        message: 'This account is pending approval or has been suspended.',
      });
    }
    if (process.env.REQUIRE_EMAIL_VERIFICATION === 'true' && !user.email_verified_at) {
      return res
        .status(403)
        .json({ success: false, message: 'Verify your email before signing in.' });
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(401).json({ success: false, message: 'Invalid password or email' });
    }

    req.session.regenerate((sessionError) => {
      if (sessionError) {
        console.error('Unable to create login session', sessionError);
        return res.status(500).json({ success: false, message: 'Unable to sign in' });
      }
      req.session.user = {
        idusers: user.idusers,
        email: user.email,
        usertype: user.usertype,
        name: user.name,
      };
      let redirectUrl = '/';
      if (user.usertype === 2) redirectUrl = '/admin';
      if (user.usertype === 3) redirectUrl = '/plumber';
      req.session.save((saveError) => {
        if (saveError)
          return res.status(500).json({ success: false, message: 'Unable to sign in' });
        res.json({
          success: true,
          redirectUrl,
          usertype: user.usertype,
          message: 'Login successful',
        });
      });
    });
  });
});

function logoutHandler(req, res) {
  const finishLogout = () => {
    res.clearCookie(process.env.SESSION_NAME || 'connect.sid');
    res.clearCookie('csrfToken');
    if (req.method === 'POST') {
      return res.json({ success: true, message: 'Logged out successfully' });
    }

    return res.redirect('/');
  };

  if (!req.session) {
    return finishLogout();
  }

  req.session.destroy((err) => {
    if (err) {
      console.error('Error destroying session during logout', err);
    }

    return finishLogout();
  });
}

router.post('/logout', logoutHandler);

module.exports = router;
