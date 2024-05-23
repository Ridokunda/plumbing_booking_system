var express = require('express');
var router = express.Router();

const connection = require("../database/connection");

/* GET home page. */
router.get('/', function(req, res, next) {
  res.render('booking', { title: 'Book a Trip' });
});




module.exports = router;