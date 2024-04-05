var express = require('express');
var router = express.Router();



// GET registerCustomer page
router.get('/registerCustomer', function(req, res, next) {
  res.render('registerCustomer', { title: 'Register Page' });
});
/* GET home page. */
router.get('/login', function(req, res, next) {
  res.render('login',{ title: 'Log in'});
});
/* GET home page. */
router.get('/', function(req, res, next) {
  res.render('index', { title: 'Express' });
});


module.exports = router;
