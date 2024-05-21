var express = require('express');
var router = express.Router();

const connection = require("../database/connection");



/* GET home page. */
router.get('/', function(req, res, next) {
  res.render('index', { title: 'WeFixIt | Home' });
});







module.exports = router;
