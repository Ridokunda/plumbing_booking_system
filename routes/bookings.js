var express = require('express');
var router = express.Router();
const connection = require('../database/connection');

router.get('/', function(req,res,next){
    res.render('bookings', {title:'Bookings'});
})

module.exports = router;