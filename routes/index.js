var express = require('express');
var router = express.Router();

const connection = require("../database/connection");



/* GET home page. */
router.get('/', function(req, res, next) {
  res.render('index', { title: 'Home2', session: req.session });
});
/* GET about page. */
router.get('/about', function(req, res, next) {
  res.render('about', { title: 'About' });
});
/* GET service page. */
router.get('/service', function(req, res, next) {
  res.render('service', { title: 'Service' });
});
/* GET contact page. */
router.get('/contact', function(req, res, next) {
  res.render('contact', { title: 'Contact' });
});



module.exports = router;
