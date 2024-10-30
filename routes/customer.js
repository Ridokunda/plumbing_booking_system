var express = require('express');
var router = express.Router();
const connection = require('../database/connection');
const { connect } = require('./users');

router.get('/', function(req,res,next){
    res.render('customer', {title:'Customer Dashboard'});
});









module.exports = router;