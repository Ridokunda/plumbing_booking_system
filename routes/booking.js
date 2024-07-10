var express = require('express');
var router = express.Router();

const connection = require("../database/connection");

/* GET home page. */
router.get('/', function(req, res, next) {
  if(!req.session.userid){
    return res.redirect('/login');
  }
  res.render('booking', { title: 'Book a Trip' });
});

router.post('/book', (req,res, next) => {
  if(!req.session.userid){
    return res.redirect('/login');
  }
   
  var service = req.body.service;
  var date_start = req.body.date_start;
  var des = req.body.description;

  
    
  const query = 'INSERT INTO bookings (idUser,type,date_start,des) VALUES(?,?,?,?)';

  connection.query(query, [req.session.userid,service,date_start,des], (err, result) =>{
    if(err){
      console.error('Error insert booking in the database', err);
      return res.status(500).send('Internal server error');
    }
    console.log('booking added');
    res.send('Booking added');
  })
});


router.get('/bookings', function(req,res,next){
  //get bookings
  connection.query('SELECT * FROM bookings', (err, results) => {
      if (err) {
          console.error('Error executing MySQL query: ' + err.stack);
          res.status(500).send('Error fetching bookings');
          return;
      }
      console.log('bookings found');

      //get plumbers
      const query = "SELECT * FROM fixit_db.users WHERE status = 'AVAILABLE' AND usertype = 3";
      console.log('retrieving plumbers');
      connection.query(query,(error,result) =>{
        if(error){
          console.error('error while querying the database');
          console.log('retrieving plumbers');
          res.status(500).send('Error fetching plumbers');
          return;
        }
        res.render('bookings', { bookings: results, plumbers: result, title : 'Bookings' });
      }); 
      
  });
});

module.exports = router;