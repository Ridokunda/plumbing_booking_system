var express = require('express');
var router = express.Router();



/* GET Login page. */
router.get('/', function(req, res, next) {
  res.render('login',{ title: 'WeFixIt | Log in'});
});

module.exports = router;
