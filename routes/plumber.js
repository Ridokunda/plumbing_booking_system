var express = require('express');
var router = express.Router();
const connection = require('../database/connection');

router.get('/', function(req,res,next){
    res.render('plumber', {title:'Plumber Dashboard'});
});

router.post('/select', function(req,res,next){
    
    const bookingid = req.body.bookingID;
    const userid = req.body.userID;
    //console.log(bookingid+" : "+userid);
    const query =`UPDATE bookings SET plumberid = ?, status = ? WHERE idbookings = ?`;

    connection.query(query, [userid, 'ASSIGNED', bookingid], function(err, result){
        if(err){
            console.error('error while updating bookings',err);
            res.status(500).send('Internal server error');
            return;
        }
        res.redirect('/admin');
        console.log('plumber selected');
    });
});

module.exports = router;