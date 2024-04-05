var express = require('express');
var router = express.Router();

//get register customer page
router.get('/registerCustomer', function(req,res,next) {
    res.render('registerCustomer');
});

module.exports = router;


