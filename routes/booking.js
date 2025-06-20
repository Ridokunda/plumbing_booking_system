var express = require('express');
var router = express.Router();

const connection = require("../database/connection");

/* GET home page. */
router.get('/', function(req, res, next) {
  if(!req.session.userid){
    return res.redirect('/login');
  }
  res.render('booking', { title: 'Book Us' });
});

router.post('/book', (req,res, next) => {
  if(!req.session.userid){
    return res.redirect('/login');
  }
   
  var service = req.body.service;
  var date_start = req.body.date_start;
  var des = req.body.description;

  // Basic validation
  if (!service || !date_start || !des) {
      return res.status(400).send('Please provide service type, date, and description.');
  }

  const query = 'INSERT INTO bookings (idUser,type,date_start,des,status) VALUES(?,?,?,?,?)';

  connection.query(query, [req.session.userid,service,date_start,des,'NEW'], (err, result) =>{
    if(err){
      console.error('Error inserting booking in the database', err);
      return res.status(500).send('Internal server error');
    }
    console.log('booking added');
    res.status(200).send('Booking added successfully!'); // Send a success status and message
  });
});


/* GET customer bookings page*/
router.get('/mybookings', function(req, res, next){
  const userid = req.session.userid;

  if (!userid) {
      return res.redirect('/login'); // Redirect if user is not logged in
  }

  // Retrieve bookings made by the current customer
  connection.query("SELECT * FROM bookings WHERE idUser = ? ORDER BY date_start DESC", [userid], (err, results) => {
      if (err) {
          console.error('Error executing MySQL query to fetch customer bookings: ' + err.stack);
          return res.status(500).send('Error fetching your bookings');
      }
      res.render('mybookings', { bookings: results, title : 'My Bookings' });
  });
});

module.exports = router;
