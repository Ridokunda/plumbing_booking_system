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
      return res.status(400).json({ success: false, message: 'Please provide service type, at least one date, and description.' });
  }

  // Normalize dates to an array
  let dates = [];
  if (Array.isArray(date_start)) {
    dates = date_start.filter(d => d);
  } else if (typeof date_start === 'string') {
    
    try {
      const parsed = JSON.parse(date_start);
      if (Array.isArray(parsed)) dates = parsed;
      else dates = [date_start];
    } catch (e) {
      dates = [date_start];
    }
  }

  if (dates.length === 0) {
    return res.status(400).json({ success: false, message: 'Please provide at least one valid date.' });
  }

  const insertBookingQuery = 'INSERT INTO bookings (idUser,type,des,status) VALUES(?,?,?,?)';
  connection.query(insertBookingQuery, [req.session.user.idusers, service, des, 'NEW'], (err, result) => {
    if (err) {
      console.error('Error inserting booking in the database', err);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
    const bookingId = result.insertId;
    // Prepare multi-row insert for booking_dates
    const values = dates.map(d => [bookingId, d]);
    const insertDatesQuery = 'INSERT INTO booking_dates (booking_id, date_start) VALUES ?';
    connection.query(insertDatesQuery, [values], (err2) => {
      if (err2) {
        console.error('Error inserting booking dates', err2);
        return res.status(500).json({ success: false, message: 'Internal server error' });
      }
      console.log('booking and dates added');
      res.status(200).json({ success: true, message: 'Booking added successfully!' });
    });
  });
});


/* GET customer bookings page*/
router.get('/mybookings', function(req, res, next){
  const user = req.session.user;

  if (!user) {
      return res.redirect('/login'); 
  }

  // Retrieve bookings made by the current customer
  const query = `SELECT b.*, GROUP_CONCAT(d.date_start ORDER BY d.date_start SEPARATOR ',') AS dates, MIN(d.date_start) AS first_date
                 FROM bookings b
                 LEFT JOIN booking_dates d ON b.idbookings = d.booking_id
                 WHERE b.idUser = ?
                 GROUP BY b.idbookings
                 ORDER BY first_date DESC`;
  connection.query(query, [user.idusers], (err, results) => {
      if (err) {
          console.error('Error executing MySQL query to fetch customer bookings: ' + err.stack);
          return res.status(500).send('Error fetching your bookings');
      }
      
      const processed = results.map(r => {
        r.datesArray = r.dates ? r.dates.split(',') : [];
        r.date_start = r.first_date || r.date_start; 
        return r;
      });
      res.render('mybookings', { bookings: processed, title : 'My Bookings' });
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

// Edit a booking (customer)
router.post('/edit-booking', function(req, res, next) {
  const user = req.session.user;
  const { booking_id, service, date_start, description } = req.body;

  if (!user) {
    return res.status(401).json({ success: false, message: 'Not logged in' });
  }
  if (!booking_id || !service || !date_start || !description) {
    return res.status(400).json({ success: false, message: 'All fields are required.' });
  }

  // Check if the booking belongs to the user and is editable
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
    if (booking.status === 'CANCELLED' || booking.status === 'COMPLETED' || booking.status === 'DECLINED') {
      return res.status(400).json({ success: false, message: 'Booking cannot be edited.' });
    }
    // Update the booking metadata (type, description). Dates are stored in booking_dates table.
    const updateQuery = 'UPDATE bookings SET type = ?, des = ? WHERE idbookings = ? AND idUser = ?';
    connection.query(updateQuery, [service, description, booking_id, user.idusers], (err, result) => {
      if (err) {
        console.error('Error updating booking:', err);
        return res.status(500).json({ success: false, message: 'Internal server error' });
      }
      if (result.affectedRows === 0) {
        return res.status(404).json({ success: false, message: 'Booking not found or not updated.' });
      }
      // Normalize incoming dates and replace existing booking_dates rows
      let dates = [];
      if (Array.isArray(date_start)) dates = date_start.filter(d => d);
      else if (typeof date_start === 'string') {
        try {
          const parsed = JSON.parse(date_start);
          if (Array.isArray(parsed)) dates = parsed;
          else dates = [date_start];
        } catch (e) {
          dates = [date_start];
        }
      }
      // Delete existing dates
      const deleteQuery = 'DELETE FROM booking_dates WHERE booking_id = ?';
      connection.query(deleteQuery, [booking_id], (delErr) => {
        if (delErr) {
          console.error('Error deleting old booking dates:', delErr);
          return res.status(500).json({ success: false, message: 'Internal server error' });
        }
        if (dates.length === 0) {
          return res.json({ success: true, message: 'Booking updated successfully.' });
        }
        const values = dates.map(d => [booking_id, d]);
        const insertDatesQuery = 'INSERT INTO booking_dates (booking_id, date_start) VALUES ?';
        connection.query(insertDatesQuery, [values], (insErr) => {
          if (insErr) {
            console.error('Error inserting updated booking dates:', insErr);
            return res.status(500).json({ success: false, message: 'Internal server error' });
          }
          return res.json({ success: true, message: 'Booking updated successfully.' });
        });
      });
    });
  });
});

module.exports = router;
