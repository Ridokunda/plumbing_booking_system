var express = require('express');
var router = express.Router();
const connection = require('../database/connection');
const { connect } = require('./users');

router.get('/', function(req,res,next){
    res.render('admin', {title:'Admin Dashboard'});
});

router.get('/manageusers', function(req, res, next){
    const customerQuery = 'SELECT COUNT(*) FROM users WHERE usertype = 1'
    const plumbersQuery = 'SELECT COUNT(*) FROM users WHERE usertype = 3'
    connection.query(customerQuery, function(err, result){
        if(err){
            console.error('error while querying the database', err);
            return res.status(500).send('Internal server error');
        }
        connection.query(plumbersQuery, function(err, results){
            if(err){
                console.error('error while querying the database', err);
                return res.status(500).send('Internal server error');
            }
            res.render('manageusers', {title : 'Manage Users', customerCount: result[0]['COUNT(*)'], plumberCount: results[0]['COUNT(*)']});
        })
        
    })
    
});

router.get('/managecustomers', function(req, res, next){
    const query = 'SELECT * FROM users WHERE usertype = 1'

    connection.query(query, function(err, results){
        if(err){
            console.error('error while querying the database', err);
            return res.status(500).send('Internal server error');
        }
        res.render('managecustomers', {title : 'Manage Customers', customers: results});
    });
    
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