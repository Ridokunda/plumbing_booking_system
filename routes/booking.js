var express = require('express');
var router = express.Router();

const connection = require("../database/connection");

/* GET home page. */
router.get('/', function(req, res, next) {
  if(!req.session.user){
    return res.redirect('/login');
  }
  res.render('booking', { title: 'Book Us' });
});

router.post('/book', (req,res, next) => {
  if(!req.session.user){
    return res.status(401).json({ success: false, message: 'Not logged in' });
  }
   
  var service = req.body.service;
  var date_start = req.body.date_start;
  var des = req.body.description;

  // Basic validation
  if (!service || !date_start || !des) {
      return res.status(400).json({ success: false, message: 'Please provide service type, date, and description.' });
  }

  const query = 'INSERT INTO bookings (idUser,type,date_start,des,status) VALUES(?,?,?,?,?)';

  connection.query(query, [req.session.user.idusers,service,date_start,des,'NEW'], (err, result) =>{
    if(err){
      console.error('Error inserting booking in the database', err);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
    console.log('booking added');
    res.status(200).json({ success: true, message: 'Booking added successfully!' });
  });
});


/* GET customer bookings page*/
router.get('/mybookings', function(req, res, next){
  const user = req.session.user;

  if (!user) {
      return res.redirect('/login'); // Redirect if user is not logged in
  }

  // Retrieve bookings made by the current customer
  connection.query("SELECT * FROM bookings WHERE idUser = ? ORDER BY date_start DESC", [user.idusers], (err, results) => {
      if (err) {
          console.error('Error executing MySQL query to fetch customer bookings: ' + err.stack);
          return res.status(500).send('Error fetching your bookings');
      }
      res.render('mybookings', { bookings: results, title : 'My Bookings' });
  });
});

// Cancel a booking (customer)
router.post('/cancel-booking', function(req, res, next) {
  const user = req.session.user;
  const { booking_id } = req.body;

  if (!user) {
    return res.status(401).json({ success: false, message: 'Not logged in' });
  }
  if (!booking_id) {
    return res.status(400).json({ success: false, message: 'Booking ID is required.' });
  }

  // Check if the booking belongs to the user and is cancellable
  const checkQuery = 'SELECT * FROM bookings WHERE idbookings = ? AND idUser = ?';
  connection.query(checkQuery, [booking_id, user.idusers], (err, results) => {
    if (err) {
      console.error('Error checking booking:', err);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
    if (results.length === 0) {
      return res.status(404).json({ success: false, message: 'Booking not found or not yours.' });
    }
    const booking = results[0];
    if (booking.status === 'CANCELLED' || booking.status === 'COMPLETED') {
      return res.status(400).json({ success: false, message: 'Booking cannot be cancelled.' });
    }
    // Update status to CANCELLED
    const updateQuery = 'UPDATE bookings SET status = ? WHERE idbookings = ?';
    connection.query(updateQuery, ['CANCELLED', booking_id], (err, result) => {
      if (err) {
        console.error('Error cancelling booking:', err);
        return res.status(500).json({ success: false, message: 'Internal server error' });
      }
      return res.json({ success: true, message: 'Booking cancelled successfully.' });
    });
  });
});

module.exports = router;
