const express = require('express');
const router = express.Router();
const connection = require('../database/connection');
const { verifyToken } = require('../middleware/auth');
const { createNotification } = require('../utils/notifications');
const {
    createReceipt: createFileReceipt,
    getReceiptForBooking: getFileReceiptForBooking
} = require('../utils/receipts');
// Remove Stripe require and env variable

router.use(verifyToken);

let billingTablesEnsured = false;

function toMoney(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

function buildInvoiceNumber(bookingId) {
    return `INV-${String(bookingId).padStart(6, '0')}`;
}

function buildReceiptNumber(bookingId) {
    const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
    return `RCPT-${String(bookingId).padStart(6, '0')}-${stamp}`;
}

function normalizeDbReceipt(row, fallback = {}) {
    if (!row) {
        return null;
    }

    return {
        id: String(row.idreceipt),
        receiptNumber: row.receipt_number,
        bookingId: String(row.booking_id),
        userId: String(row.customer_id),
        plumberId: row.plumber_id === null || row.plumber_id === undefined ? null : String(row.plumber_id),
        amount: toMoney(row.amount_paid),
        serviceType: row.service_type || fallback.serviceType || null,
        description: row.description || fallback.description || null,
        paymentMethod: row.payment_method || 'SIMULATED',
        paidAt: row.paid_at instanceof Date ? row.paid_at.toISOString() : new Date(row.paid_at).toISOString(),
        invoiceNumber: row.invoice_number || fallback.invoiceNumber || null
    };
}

function ensureBillingTables(callback) {
    if (billingTablesEnsured) {
        return callback(null);
    }

    const createInvoicesTable = `
        CREATE TABLE IF NOT EXISTS invoices (
            idinvoice INT UNSIGNED NOT NULL AUTO_INCREMENT,
            invoice_number VARCHAR(40) NOT NULL,
            booking_id INT NOT NULL,
            customer_id INT NOT NULL,
            plumber_id INT NULL,
            service_type VARCHAR(100) NULL,
            description TEXT NULL,
            subtotal DECIMAL(10,2) NOT NULL DEFAULT 0.00,
            tax_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
            total_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
            status ENUM('PENDING','PAID','VOID') NOT NULL DEFAULT 'PENDING',
            issued_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            paid_at DATETIME NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (idinvoice),
            UNIQUE KEY uq_invoices_invoice_number (invoice_number),
            UNIQUE KEY uq_invoices_booking (booking_id),
            KEY idx_invoices_customer_status_issued (customer_id, status, issued_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `;

    const createReceiptsTable = `
        CREATE TABLE IF NOT EXISTS payment_receipts (
            idreceipt INT UNSIGNED NOT NULL AUTO_INCREMENT,
            receipt_number VARCHAR(40) NOT NULL,
            invoice_id INT UNSIGNED NOT NULL,
            booking_id INT NOT NULL,
            customer_id INT NOT NULL,
            plumber_id INT NULL,
            payment_method ENUM('SIMULATED','CARD','CASH','BANK_TRANSFER','MOBILE_MONEY') NOT NULL DEFAULT 'SIMULATED',
            amount_paid DECIMAL(10,2) NOT NULL,
            currency CHAR(3) NOT NULL DEFAULT 'USD',
            paid_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            notes VARCHAR(255) NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (idreceipt),
            UNIQUE KEY uq_receipts_receipt_number (receipt_number),
            UNIQUE KEY uq_receipts_invoice (invoice_id),
            UNIQUE KEY uq_receipts_booking (booking_id),
            KEY idx_receipts_customer_paid_at (customer_id, paid_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `;

    connection.query(createInvoicesTable, (invoiceErr) => {
        if (invoiceErr) {
            return callback(invoiceErr);
        }
        connection.query(createReceiptsTable, (receiptErr) => {
            if (receiptErr) {
                return callback(receiptErr);
            }
            billingTablesEnsured = true;
            callback(null);
        });
    });
}

function upsertInvoice(booking, callback) {
    const amount = toMoney(booking.amount);
    const invoiceNumber = buildInvoiceNumber(booking.idbookings);
    const insertInvoiceQuery = `
        INSERT INTO invoices (
            invoice_number, booking_id, customer_id, plumber_id,
            service_type, description, subtotal, tax_amount, total_amount,
            status, issued_at, paid_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, 0.00, ?, 'PAID', NOW(), NOW())
        ON DUPLICATE KEY UPDATE
            customer_id = VALUES(customer_id),
            plumber_id = VALUES(plumber_id),
            service_type = VALUES(service_type),
            description = VALUES(description),
            subtotal = VALUES(subtotal),
            total_amount = VALUES(total_amount),
            status = 'PAID',
            paid_at = COALESCE(paid_at, NOW())
    `;

    const params = [
        invoiceNumber,
        booking.idbookings,
        booking.idUser,
        booking.assignedPlumber || null,
        booking.type || null,
        booking.description || null,
        amount,
        amount
    ];

    connection.query(insertInvoiceQuery, params, (insertErr) => {
        if (insertErr) {
            return callback(insertErr);
        }

        connection.query(
            'SELECT idinvoice, invoice_number, total_amount FROM invoices WHERE booking_id = ? LIMIT 1',
            [booking.idbookings],
            (selectErr, rows) => {
                if (selectErr) {
                    return callback(selectErr);
                }
                if (!rows || rows.length === 0) {
                    return callback(new Error('Invoice could not be retrieved after upsert'));
                }
                callback(null, rows[0]);
            }
        );
    });
}

function upsertReceipt(booking, invoice, callback) {
    const amount = toMoney(booking.amount);
    const receiptNumber = buildReceiptNumber(booking.idbookings);
    const insertReceiptQuery = `
        INSERT INTO payment_receipts (
            receipt_number, invoice_id, booking_id, customer_id, plumber_id,
            payment_method, amount_paid, currency, paid_at, notes
        )
        VALUES (?, ?, ?, ?, ?, 'SIMULATED', ?, 'USD', NOW(), 'Created from simulated payment flow')
        ON DUPLICATE KEY UPDATE
            invoice_id = VALUES(invoice_id),
            customer_id = VALUES(customer_id),
            plumber_id = VALUES(plumber_id),
            payment_method = VALUES(payment_method),
            amount_paid = VALUES(amount_paid),
            paid_at = COALESCE(paid_at, NOW())
    `;

    const params = [
        receiptNumber,
        invoice.idinvoice,
        booking.idbookings,
        booking.idUser,
        booking.assignedPlumber || null,
        amount
    ];

    connection.query(insertReceiptQuery, params, (insertErr) => {
        if (insertErr) {
            return callback(insertErr);
        }

        const selectReceiptQuery = `
            SELECT r.idreceipt, r.receipt_number, r.booking_id, r.customer_id, r.plumber_id,
                   r.payment_method, r.amount_paid, r.paid_at,
                   i.invoice_number
            FROM payment_receipts r
            JOIN invoices i ON i.idinvoice = r.invoice_id
            WHERE r.booking_id = ?
            LIMIT 1
        `;

        connection.query(selectReceiptQuery, [booking.idbookings], (selectErr, rows) => {
            if (selectErr) {
                return callback(selectErr);
            }
            if (!rows || rows.length === 0) {
                return callback(new Error('Receipt could not be retrieved after upsert'));
            }
            const normalized = normalizeDbReceipt(rows[0], {
                serviceType: booking.type,
                description: booking.description,
                invoiceNumber: invoice.invoice_number
            });
            callback(null, normalized);
        });
    });
}

function createOrGetPersistentReceipt(booking, callback) {
    ensureBillingTables((tableErr) => {
        if (tableErr) {
            console.warn('Falling back to file receipt storage (table setup failed)', tableErr.code || tableErr.message);
            const receipt = createFileReceipt({
                bookingId: booking.idbookings,
                userId: booking.idUser,
                plumberId: booking.assignedPlumber,
                amount: booking.amount,
                serviceType: booking.type,
                description: booking.description,
                paymentMethod: 'SIMULATED'
            });
            return callback(null, receipt);
        }

        upsertInvoice(booking, (invoiceErr, invoice) => {
            if (invoiceErr) {
                console.warn('Falling back to file receipt storage (invoice upsert failed)', invoiceErr.code || invoiceErr.message);
                const receipt = createFileReceipt({
                    bookingId: booking.idbookings,
                    userId: booking.idUser,
                    plumberId: booking.assignedPlumber,
                    amount: booking.amount,
                    serviceType: booking.type,
                    description: booking.description,
                    paymentMethod: 'SIMULATED'
                });
                return callback(null, receipt);
            }

            upsertReceipt(booking, invoice, (receiptErr, receipt) => {
                if (receiptErr) {
                    console.warn('Falling back to file receipt storage (receipt upsert failed)', receiptErr.code || receiptErr.message);
                    const fallbackReceipt = createFileReceipt({
                        bookingId: booking.idbookings,
                        userId: booking.idUser,
                        plumberId: booking.assignedPlumber,
                        amount: booking.amount,
                        serviceType: booking.type,
                        description: booking.description,
                        paymentMethod: 'SIMULATED'
                    });
                    return callback(null, fallbackReceipt);
                }

                callback(null, receipt);
            });
        });
    });
}

function getPersistentReceiptForBooking(bookingId, userId, callback) {
    ensureBillingTables((tableErr) => {
        if (tableErr) {
            return callback(null, getFileReceiptForBooking(bookingId, userId));
        }

        const query = `
            SELECT r.idreceipt, r.receipt_number, r.booking_id, r.customer_id, r.plumber_id,
                   r.payment_method, r.amount_paid, r.paid_at,
                   i.invoice_number
            FROM payment_receipts r
            JOIN invoices i ON i.idinvoice = r.invoice_id
            WHERE r.booking_id = ? AND r.customer_id = ?
            LIMIT 1
        `;

        connection.query(query, [bookingId, userId], (err, rows) => {
            if (err) {
                return callback(null, getFileReceiptForBooking(bookingId, userId));
            }
            if (!rows || rows.length === 0) {
                return callback(null, getFileReceiptForBooking(bookingId, userId));
            }
            callback(null, normalizeDbReceipt(rows[0]));
        });
    });
}

function getBookingDetails(bookingId, userId, requiredStatus, callback) {
    const tryFetch = (plumberColumn, descriptionColumn) => {
        const statusClause = requiredStatus ? 'AND status = ?' : '';
        const query = `SELECT idbookings, idUser, amount, type, status, ${descriptionColumn} AS description, ${plumberColumn} AS assignedPlumber
                       FROM bookings
                       WHERE idbookings = ? AND idUser = ? ${statusClause}`;
        const params = requiredStatus ? [bookingId, userId, requiredStatus] : [bookingId, userId];

        connection.query(query, params, (err, results) => {
            if (err && err.code === 'ER_BAD_FIELD_ERROR' && plumberColumn === 'plumberid') {
                return tryFetch('idPlumber', descriptionColumn);
            }
            if (err && err.code === 'ER_BAD_FIELD_ERROR' && descriptionColumn === 'des') {
                return tryFetch(plumberColumn, 'description');
            }
            if (err) {
                return callback(err);
            }

            callback(null, results[0] || null);
        });
    };

    tryFetch('plumberid', 'des');
}

/* GET Payment page. */
router.get('/', (req, res) => {
    const bookingId = req.query.booking_id;
    if (!bookingId) return res.status(400).send('Booking ID required');

    // Fetch booking details
    const query = 'SELECT * FROM bookings WHERE idbookings = ? AND idUser = ? AND status IN ("COMPLETED", "PAID")';
    connection.query(query, [bookingId, req.user.idusers], (err, results) => {
        if (err || results.length === 0) return res.status(404).send('Booking not found or not completed');
        const booking = results[0];
        getPersistentReceiptForBooking(booking.idbookings, req.user.idusers, (_, receipt) => {
            res.render('payment', { title: 'Payment', booking, receipt });
        });
    });
});

/* POST /payment/process - Simulate payment */
router.post('/process', (req, res) => {
    const { booking_id } = req.body;

    if (!booking_id) {
        return res.status(400).json({ success: false, message: 'booking_id is required' });
    }

    getBookingDetails(booking_id, req.user.idusers, 'COMPLETED', (detailsErr, booking) => {
        if (detailsErr) {
            console.error('Error validating payable booking', detailsErr);
            return res.status(500).json({ success: false, message: 'Internal server error' });
        }
        if (!booking) {
            return res.status(404).json({ success: false, message: 'Booking not found, not owned by user, or not payable' });
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

            createOrGetPersistentReceipt(booking, (_, receipt) => {
                createNotification({
                    userId: booking.idUser,
                    role: 'customer',
                    bookingId: booking_id,
                    type: 'booking_paid',
                    title: 'Payment completed',
                    message: 'Your payment was processed successfully.'
                });

                if (booking.assignedPlumber) {
                    createNotification({
                        userId: booking.assignedPlumber,
                        role: 'plumber',
                        bookingId: booking_id,
                        type: 'booking_paid',
                        title: 'Customer payment received',
                        message: 'A customer has paid for a completed booking.'
                    });
                }

                res.json({
                    success: true,
                    message: 'Payment simulated successfully',
                    receiptNumber: receipt ? receipt.receiptNumber : null
                });
            });
        });
    });
});

// GET /payment/success - Confirmation page
router.get('/success', (req, res) => {
    const bookingId = req.query.booking_id;
    if (!bookingId) return res.status(400).send('Booking ID required');

    const query = 'SELECT idbookings FROM bookings WHERE idbookings = ? AND idUser = ? AND status = "PAID"';
    connection.query(query, [bookingId, req.user.idusers], (err, results) => {
        if (err || results.length === 0) return res.status(404).send('Payment record not found');
        getPersistentReceiptForBooking(bookingId, req.user.idusers, (_, receipt) => {
            res.render('payment-success', { title: 'Payment Success', booking_id: bookingId, receipt });
        });
    });
});

// GET /payment/history - Paid receipts and completed invoices
router.get('/history', (req, res) => {
    const loadHistory = (descriptionColumn) => {
        const query = `SELECT idbookings, type, amount, status, date_start, ${descriptionColumn} AS description
                       FROM bookings
                       WHERE idUser = ? AND status IN ("COMPLETED", "PAID")
                       ORDER BY idbookings DESC`;

        connection.query(query, [req.user.idusers], (err, rows) => {
            if (err && err.code === 'ER_BAD_FIELD_ERROR' && descriptionColumn === 'des') {
                return loadHistory('description');
            }
            if (err) {
                console.error('Error loading payment history', err);
                return res.status(500).send('Unable to load payment history');
            }

            const history = [];
            let index = 0;

            const next = () => {
                if (index >= rows.length) {
                    return res.render('payment-history', {
                        title: 'Invoices & Receipts',
                        history
                    });
                }

                const row = rows[index];
                index += 1;

                getPersistentReceiptForBooking(row.idbookings, req.user.idusers, (_, receipt) => {
                    history.push({
                        ...row,
                        amount: toMoney(row.amount),
                        receipt,
                        invoiceNumber: receipt && receipt.invoiceNumber ? receipt.invoiceNumber : buildInvoiceNumber(row.idbookings),
                        isPaid: row.status === 'PAID' && !!receipt
                    });
                    next();
                });
            };

            next();
        });
    };

    loadHistory('des');
});

// GET /payment/receipt/:bookingId - Render a single receipt page
router.get('/receipt/:bookingId', (req, res) => {
    const bookingId = req.params.bookingId;

    const query = 'SELECT idbookings, idUser, type, amount, status FROM bookings WHERE idbookings = ? AND idUser = ?';
    connection.query(query, [bookingId, req.user.idusers], (err, results) => {
        if (err || results.length === 0) {
            return res.status(404).send('Receipt not found');
        }

        const booking = results[0];
        getPersistentReceiptForBooking(bookingId, req.user.idusers, (_, receipt) => {
            if (!receipt || booking.status !== 'PAID') {
                return res.status(404).send('Receipt not found for this booking');
            }

            res.render('receipt', {
                title: 'Payment Receipt',
                booking,
                receipt
            });
        });
    });
});

module.exports = router;