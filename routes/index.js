var express = require('express');
var router = express.Router();

const connection = require('../database/connection');
const { cleanText, normalizeEmail } = require('../utils/validation');
const { createRateLimiter } = require('../middleware/security');

/* GET home page. */
router.get('/', function (req, res) {
  res.render('index', { title: 'Home', session: req.session });
});
/* GET about page. */
router.get('/about', function (req, res) {
  res.render('about', { title: 'About' });
});
/* GET service page. */
router.get('/service', function (req, res) {
  res.render('service', { title: 'Service' });
});
/* GET contact page. */
router.get('/contact', function (req, res) {
  res.render('contact', { title: 'Contact', sent: req.query.sent === '1', error: null });
});

router.post('/contact', createRateLimiter({ max: 5 }), function (req, res, next) {
  const name = cleanText(req.body.name, { max: 160 });
  const phone = cleanText(req.body.phone, { min: 0, max: 30 }) || null;
  const email = normalizeEmail(req.body.email);
  const message = cleanText(req.body.message, { min: 10, max: 2000 });
  if (!name || !email || !message) {
    return res.status(400).render('contact', {
      title: 'Contact',
      sent: false,
      error: 'Enter a valid name, email, and message of at least 10 characters.',
    });
  }
  connection.query(
    'INSERT INTO contact_messages (name, phone, email, message) VALUES (?, ?, ?, ?)',
    [name, phone, email, message],
    (error) => {
      if (error) return next(error);
      res.redirect('/index/contact?sent=1');
    },
  );
});

module.exports = router;
