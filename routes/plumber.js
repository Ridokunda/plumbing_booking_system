var express = require('express');
var router = express.Router();
const connection = require('../database/connection');
const { verifyToken, isPlumber } = require('../middleware/auth');
const multer = require('multer');
const path = require('path');

// configure multer storage for booking photos
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, path.join(__dirname, '..', 'uploads', 'booking_photos'));
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname);
    const filename = `${Date.now()}-${Math.round(Math.random()*1e9)}${ext}`;
    cb(null, filename);
  }
});
const upload = multer({ storage });


// Apply JWT verification and plumber check to all plumber routes
router.use(verifyToken);
router.use(isPlumber);

router.get('/', function(req,res,next){
    res.render('plumber', {title:'Plumber Dashboard'});
});

/* GET assigned bookings for the logged-in plumber */
router.get('/my-bookings', function(req, res, next){
    const plumberId = req.user.idusers;
    
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
            b.amount,
            b.before_photo,
            b.after_photo,
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
        console.log("trying the query");
        if (err) {
            console.log("trying the query");
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
    const plumberId = req.user.idusers;

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

/* POST update booking amount by plumber */
router.post('/update-amount', function(req, res, next){
    const { booking_id, amount } = req.body;
    const plumberId = req.user.idusers;

    if (!booking_id || amount === undefined) {
        return res.status(400).json({ message: 'Booking ID and amount are required.' });
    }
    if (!plumberId) {
        return res.status(401).json({ message: 'Plumber not authenticated.' });
    }

    // Ensure the booking is assigned to this plumber
    const checkQuery = 'SELECT plumberid FROM bookings WHERE idbookings = ?';
    connection.query(checkQuery, [booking_id], (err, results) => {
        if (err) {
            console.error('Error checking booking:', err);
            return res.status(500).json({ message: 'Internal server error.' });
        }
        if (results.length === 0 || results[0].plumberid !== plumberId) {
            return res.status(403).json({ message: 'You are not authorized to update this booking.' });
        }

        const updateQuery = 'UPDATE bookings SET amount = ? WHERE idbookings = ? AND plumberid = ?';
        connection.query(updateQuery, [amount, booking_id, plumberId], function(err, result){
            if(err){
                console.error('Error updating amount:', err);
                return res.status(500).json({ message:'Internal server error' });
            }
            if (result.affectedRows === 0) {
                return res.status(404).json({ message: 'Booking not found.' });
            }
            res.json({ message: 'Amount updated successfully!' });
        });
    });
});


// Endpoint for uploading before/after photos
router.post('/upload-photo', upload.single('photo'), (req, res, next) => {
    const plumberId = req.user.idusers;
    const { booking_id, type } = req.body; // type should be 'before' or 'after'

    if (!booking_id || !type || !req.file) {
        return res.status(400).json({ success: false, message: 'Booking ID, type and photo file are required.' });
    }
    if (!['before','after'].includes(type)) {
        return res.status(400).json({ success: false, message: 'Type must be before or after.' });
    }
    // check plumber assignment
    const checkQuery = 'SELECT plumberid FROM bookings WHERE idbookings = ?';
    connection.query(checkQuery, [booking_id], (err, results) => {
        if (err) {
            console.error('Error checking booking for photo upload', err);
            return res.status(500).json({ success: false, message: 'Internal server error' });
        }
        if (results.length === 0 || results[0].plumberid !== plumberId) {
            return res.status(403).json({ success: false, message: 'Not authorized to upload photos for this booking.' });
        }
        const column = type === 'before' ? 'before_photo' : 'after_photo';
        const filePath = `/uploads/booking_photos/${req.file.filename}`;
        const updateQuery = `UPDATE bookings SET ${column} = ? WHERE idbookings = ?`;
        connection.query(updateQuery, [filePath, booking_id], (updErr) => {
            if (updErr) {
                console.error('Error saving photo path in database', updErr);
                return res.status(500).json({ success: false, message: 'Internal server error' });
            }
            res.json({ success: true, message: 'Photo uploaded successfully!', path: filePath });
        });
    });
});

module.exports = router;
