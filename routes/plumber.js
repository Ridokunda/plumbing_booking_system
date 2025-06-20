var express = require('express');
var router = express.Router();
const connection = require('../database/connection');

// Middleware to check if the user is a plumber (usertype = 3)
function isPlumber(req, res, next) {
    if (req.session.userid) {
        connection.query('SELECT usertype FROM users WHERE idusers = ?', [req.session.userid], function(err, results) {
            if (err) {
                console.error('Error querying user type:', err);
                return res.status(500).send('Internal server error');
            }
            if (results.length > 0 && results[0].usertype === 3) { // Assuming usertype 3 is plumber
                next(); // User is plumber, proceed
            } else {
                res.status(403).send('Access Denied: Not a Plumber');
            }
        });
    } else {
        res.redirect('/login'); // Not logged in
    }
}

// Apply plumber middleware to all plumber routes
router.use(isPlumber);

router.get('/', function(req,res,next){
    res.render('plumber', {title:'Plumber Dashboard'});
});

/* GET assigned bookings for the logged-in plumber */
router.get('/my-bookings', function(req, res, next){
    const plumberId = req.session.userid;

    if (!plumberId) {
        return res.status(401).send('Plumber not authenticated.');
    }

    const query = `
        SELECT
            b.idbookings,
            b.type AS service_type,
            b.date_start,
            b.des AS description,
            b.status,
            c.name AS customer_name,
            c.surname AS customer_surname,
            c.email AS customer_email
        FROM
            bookings AS b
        JOIN
            users AS c ON b.idUser = c.idusers
        WHERE
            b.plumberid = ?
        ORDER BY b.date_start DESC;
    `;

    connection.query(query, [plumberId], (err, results) => {
        if (err) {
            console.error('Error fetching assigned bookings for plumber:', err.stack);
            return res.status(500).send('Error fetching assigned bookings');
        }
        res.render('plumber_bookings', {
            title: 'My Assigned Bookings',
            bookings: results
        });
    });
});

/* POST to update the status of an assigned booking by the plumber */
router.post('/update-booking-status', function(req, res, next){
    const { booking_id, status } = req.body;
    const plumberId = req.session.userid;

    if (!booking_id || !status) {
        return res.status(400).json({ message: 'Booking ID and Status are required.' });
    }
    if (!plumberId) {
        return res.status(401).send('Plumber not authenticated.');
    }

    // Define allowed status transitions for plumbers
    const allowedStatuses = ['IN_PROGRESS', 'COMPLETED', 'CANCELLED']; // Example statuses
    if (!allowedStatuses.includes(status)) {
        return res.status(400).json({ message: 'Invalid status provided.' });
    }

    // Ensure the booking is assigned to this plumber before updating
    const checkAssignmentQuery = 'SELECT plumberid FROM bookings WHERE idbookings = ?';
    connection.query(checkAssignmentQuery, [booking_id], (err, bookingResults) => {
        if (err) {
            console.error('Error checking booking assignment:', err);
            return res.status(500).json({ message: 'Internal server error.' });
        }
        if (bookingResults.length === 0) {
            return res.status(404).json({ message: 'Booking not found.' });
        }
        if (bookingResults[0].plumberid !== plumberId) {
            return res.status(403).json({ message: 'You are not authorized to update this booking.' });
        }

        const updateQuery = 'UPDATE bookings SET status = ? WHERE idbookings = ? AND plumberid = ?';
        connection.query(updateQuery, [status, booking_id, plumberId], function(err, result){
            if(err){
                console.error('Error while updating booking status:', err);
                return res.status(500).json({ message:'Internal server error' });
            }
            if (result.affectedRows === 0) {
                return res.status(404).json({ message: 'Booking not found or not updated.' });
            }
            res.json({ message: `Booking status updated to ${status}!` });
        });
    });
});

module.exports = router;
