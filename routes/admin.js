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
    const query = 'SELECT * FROM users WHERE usertype = 3'

    connection.query(query, function(err,results){
        if(err){
            console.error('error while querying the database', err);
            return res.status(500).send('Internal server error');
        }
        res.render('manageplumbers', {title : 'Manage Plumbers', plumbers: results});
    });
    
});

module.exports = router;