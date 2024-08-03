var express = require('express');
var router = express.Router();
const connection = require('../database/connection');

router.get('/', function(req,res,next){
    res.render('admin', {title:'Admin Dashboard'});
});

router.get('/manageusers', function(req, res, next){
    res.render('manageusers', {title : 'Manage Users'});
});

router.get('/managecustomers', function(req, res, next){
    res.render('managecustomers', {title : 'Manage Customers'});
});

router.get('/manageplumbers', function(req, res, next){
    res.render('manageplumbers', {title : 'Manage Plumbers'});
});

module.exports = router;