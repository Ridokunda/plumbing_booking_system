var express = require('express');
var router = express.Router();
const connection = require('../database/connection');

// Middleware to check if the user is an admin (usertype = 2)

function isAdmin(req, res, next) {
    if (req.session.user) {
        connection.query('SELECT usertype FROM users WHERE idusers = ?', [req.session.user.idusers], function(err, results) {
            if (err) {
                console.error('Error querying user type:', err);
                return res.status(500).send('Internal server error');
            }
            if (results.length > 0 && results[0].usertype === 2) { // Assuming usertype 2 is admin
                next(); // User is admin, proceed
            } else {
                res.status(403).send('Access Denied: Not an Admin');
            }
        });
    } else {
        res.redirect('/login'); // Not logged in
    }
}

// Apply admin middleware to all admin routes
router.use(isAdmin);

router.get('/', function(req,res,next){
    res.render('admindashboard', {title:'Admin Dashboard'});
});

router.get('/manageusers', function(req, res, next){
    const customerQuery = 'SELECT COUNT(*) AS customerCount FROM users WHERE usertype = 1';
    const plumbersQuery = 'SELECT COUNT(*) AS plumberCount FROM users WHERE usertype = 3';
    
    connection.query(customerQuery, function(err, customerResult){
        if(err){
            console.error('error while querying customer count:', err);
            return res.status(500).send('Internal server error');
        }
        connection.query(plumbersQuery, function(err, plumberResult){
            if(err){
                console.error('error while querying plumber count:', err);
                return res.status(500).send('Internal server error');
            }
            res.render('manageusers', {
                title : 'Manage Users',
                customerCount: customerResult[0].customerCount,
                plumberCount: plumberResult[0].plumberCount
            });
        });
    });
});

/* GET managecustomers page */
router.get('/managecustomers', function(req, res, next){
    const query = 'SELECT * FROM users WHERE usertype = 1';
    connection.query(query, function(err, results){
        if(err){
            console.error('error while querying the database', err);
            return res.status(500).send('Internal server error');
        }
        res.render('managecustomers', {title : 'Manage Customers', customers: results});
    });
});

/* GET manageplumbers */
router.get('/manageplumbers', function(req, res, next){
    const query = 'SELECT * FROM users WHERE usertype = 3';
    connection.query(query, function(err,results){
        if(err){
            console.error('error while querying the database', err);
            return res.status(500).send('Internal server error');
        }
        res.render('manageplumbers', {title : 'Manage Plumbers', plumbers: results});
    });
});

/* GET all bookings for admin view */
router.get('/bookings', function(req, res, next) {
  // Get bookings with customer name
  const bookingsQuery = `
    SELECT bookings.*, users.name AS customer_name 
    FROM bookings 
    JOIN users ON bookings.idUser = users.idusers 
    WHERE bookings.status = 'NEW'
  `;

  connection.query(bookingsQuery, (err, results) => {
    if (err) {
      console.error('Error executing MySQL query: ' + err.stack);
      res.status(500).send('Error fetching bookings');
      return;
    }
    console.log('bookings found');

    // Get plumbers
    const plumbersQuery = "SELECT * FROM fixit_db.users WHERE status = 'AVAILABLE' AND usertype = 3";
    console.log('retrieving plumbers');
    connection.query(plumbersQuery, (error, result) => {
      if (error) {
        console.error('error while querying the database');
        res.status(500).send('Error fetching plumbers');
        return;
      }

      res.render('bookings', {
        bookings: results,
        plumbers: result,
        title: 'Bookings'
      });
    });
  });
});

// Dashboard analytics stats page
router.get('/stats', function(req, res, next) {
    // Query for analytics
    const stats = {};
    connection.query('SELECT COUNT(*) AS totalBookings FROM bookings', (err, bookingsResult) => {
        if (err) return res.status(500).send('Error fetching bookings count');
        stats.totalBookings = bookingsResult[0].totalBookings;
        connection.query('SELECT COUNT(*) AS totalCustomers FROM users WHERE usertype = 1', (err, customersResult) => {
            if (err) return res.status(500).send('Error fetching customers count');
            stats.totalCustomers = customersResult[0].totalCustomers;
            connection.query('SELECT COUNT(*) AS totalPlumbers FROM users WHERE usertype = 3', (err, plumbersResult) => {
                if (err) return res.status(500).send('Error fetching plumbers count');
                stats.totalPlumbers = plumbersResult[0].totalPlumbers;
                connection.query("SELECT COUNT(*) AS completedBookings FROM bookings WHERE status = 'COMPLETED'", (err, completedResult) => {
                    if (err) return res.status(500).send('Error fetching completed bookings count');
                    stats.completedBookings = completedResult[0].completedBookings;
                    res.render('stats', { title: 'Dashboard Analytics', stats });
                });
            });
        });
    });
});


/* POST to assign a plumber to a booking */
router.post('/assign-booking', function(req, res, next){
    const { booking_id, plumber_id } = req.body;

    if (!booking_id || !plumber_id) {
        return res.status(400).json({ message: 'Booking ID and Plumber ID are required.' });
    }

    // Check if the booking exists and is not already assigned/declined
    const checkBookingQuery = 'SELECT status FROM bookings WHERE idbookings = ?';
    connection.query(checkBookingQuery, [booking_id], (err, bookingResults) => {
        if (err) {
            console.error('Error checking booking status:', err);
            return res.status(500).json({ message: 'Internal server error.' });
        }
        if (bookingResults.length === 0) {
            return res.status(404).json({ message: 'Booking not found.' });
        }
        if (bookingResults[0].status !== 'NEW' && bookingResults[0].status !== 'PENDING') { // Assuming 'NEW' or 'PENDING' are assignable states
            return res.status(400).json({ message: `Booking is already ${bookingResults[0].status}. Cannot assign.` });
        }

        // Proceed with assignment
        const assignQuery = 'UPDATE bookings SET plumberid = ?, status = ? WHERE idbookings = ?';
        connection.query(assignQuery, [plumber_id, 'ASSIGNED', booking_id], function(err, result){
            if(err){
                console.error('Error while assigning plumber to booking:', err);
                return res.status(500).json({ message:'Internal server error' });
            }
            if (result.affectedRows === 0) {
                return res.status(404).json({ message: 'Booking not found or not updated.' });
            }
            res.json({ message: 'Plumber assigned successfully!' });
        });
    });
});

/* POST decline booking*/
router.post('/declinebooking', function(req, res, next){
    const { booking_id } = req.body;

    if (!booking_id) {
        return res.status(400).json({ message: 'Booking ID is required.' });
    }

    const query = 'UPDATE bookings SET status = ? WHERE idbookings = ?';
    connection.query(query, ['DECLINED', booking_id], function(err, result){
        if(err){
            console.error('error while querying the database', err);
            return res.status(500).json({message:'Internal server error'});
        }
        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Booking not found or already declined.' });
        }
        res.json({message:'Booking declined'});
    });
});

module.exports = router;
