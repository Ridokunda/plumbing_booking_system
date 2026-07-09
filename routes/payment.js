const express = require('express');
const router = express.Router();
const connection = require('../database/connection');
const { verifyToken } = require('../middleware/auth');
// Remove Stripe require and env variable

router.use(verifyToken);

/* GET Payment page. */
router.get('/', (req, res) => {
    const bookingId = req.query.booking_id;
    if (!bookingId) return res.status(400).send('Booking ID required');

    // Fetch booking details
    const query = 'SELECT * FROM bookings WHERE idbookings = ? AND idUser = ? AND status = "COMPLETED"';
    connection.query(query, [bookingId, req.user.idusers], (err, results) => {
        if (err || results.length === 0) return res.status(404).send('Booking not found or not completed');
        const booking = results[0];
        res.render('payment', { title: 'Payment', booking });
    });
});

/* POST /payment/process - Simulate payment */
router.post('/process', (req, res) => {
    const { booking_id } = req.body;

    if (!booking_id) {
        return res.status(400).json({ success: false, message: 'booking_id is required' });
    }

    const updateQuery = 'UPDATE bookings SET status = "PAID" WHERE idbookings = ? AND idUser = ? AND status = "COMPLETED"';
    connection.query(updateQuery, [booking_id, req.user.idusers], (err, result) => {
        if (err) {
            console.error('Error processing payment', err);
            return res.status(500).json({ success: false, message: 'Internal server error' });
        }

        if (!result || result.affectedRows === 0) {
            return res.status(404).json({ success: false, message: 'Booking not found, not owned by user, or not payable' });
        }

        res.json({ success: true, message: 'Payment simulated successfully' });
    });
});

// GET /payment/success - Confirmation page
router.get('/success', (req, res) => {
    const bookingId = req.query.booking_id;
    if (!bookingId) return res.status(400).send('Booking ID required');

    const query = 'SELECT idbookings FROM bookings WHERE idbookings = ? AND idUser = ? AND status = "PAID"';
    connection.query(query, [bookingId, req.user.idusers], (err, results) => {
        if (err || results.length === 0) return res.status(404).send('Payment record not found');
        res.render('payment-success', { title: 'Payment Success', booking_id: bookingId });
    });
});

module.exports = router;