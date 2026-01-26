const express = require('express');
const router = express.Router();
const connection = require('../database/connection');
// Remove Stripe require and env variable

/* GET Payment page. */
router.get('/', (req, res) => {
    const bookingId = req.query.booking_id;
    if (!bookingId) return res.status(400).send('Booking ID required');
    
    // Fetch booking details
    const query = 'SELECT * FROM bookings WHERE idbookings = ? AND status = "COMPLETED"';
    connection.query(query, [bookingId], (err, results) => {
        if (err || results.length === 0) return res.status(404).send('Booking not found or not completed');
        const booking = results[0]; 
        res.render('payment', { title: 'Payment', booking });
    });
});

/* POST /payment/process - Simulate payment */
router.post('/process', (req, res) => {
    const { booking_id } = req.body;
    
    const updateQuery = 'UPDATE bookings SET status = "PAID" WHERE idbookings = ?';
    connection.query(updateQuery, [booking_id], (err) => {
        if (err) throw err;
        res.json({ success: true, message: 'Payment simulated successfully' });
    });
   
});

// GET /payment/success - Confirmation page
router.get('/success', (req, res) => {
    res.render('payment-success', { title: 'Payment Success', booking_id: req.query.booking_id });
});

module.exports = router;