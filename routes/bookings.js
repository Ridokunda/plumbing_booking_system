var express = require('express');
var router = express.Router();
const connection = require('../database/connection');

router.get('/', function(req,res,next){
    
    res.setHeader('Cache-Control', 'no-store');
    connection.query('SELECT * FROM bookings', (err, results) => {
        if (err) {
            console.error('Error executing MySQL query: ' + err.stack);
            res.status(500).send('Error fetching bookings');
            return;
        }
        console.log('bookings found');
        res.render('bookings', { bookings: results , title : 'Bookings' });
    });
    
    
});

module.exports = router;