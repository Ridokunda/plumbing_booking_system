const express = require('express');
const router = express.Router();
const connection = require('../database/connection');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { verifyToken } = require('../middleware/auth');

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadDir = process.env.UPLOAD_PATH || 'public/uploads/profile-pictures';
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'profile-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: parseInt(process.env.MAX_FILE_SIZE) || 5 * 1024 * 1024 // 5MB limit
    },
    fileFilter: function (req, file, cb) {
        const allowedTypes = process.env.ALLOWED_IMAGE_TYPES ? 
            new RegExp(process.env.ALLOWED_IMAGE_TYPES.replace(/,/g, '|')) : 
            /jpeg|jpg|png|gif/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        
        if (mimetype && extname) {
            return cb(null, true);
        } else {
            cb(new Error('Only image files are allowed!'));
        }
    }
});

// GET profile page
router.get('/', verifyToken, function(req, res) {
    const userId = req.user.idusers;
    
    // Get user data
    const userQuery = 'SELECT * FROM users WHERE idusers = ?';
    connection.query(userQuery, [userId], function(err, userResults) {
        if (err) {
            console.error('Error fetching user data:', err);
            return res.status(500).json({ success: false, message: 'Database error' });
        }
        
        if (userResults.length === 0) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }
        
        const user = userResults[0];
        
        // Get booking statistics
        const statsQuery = `
            SELECT 
                COUNT(*) as totalBookings,
                SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END) as completedBookings,
                SUM(CASE WHEN status IN ('NEW', 'ASSIGNED', 'IN_PROGRESS') THEN 1 ELSE 0 END) as pendingBookings,
                SUM(CASE WHEN status = 'CANCELLED' THEN 1 ELSE 0 END) as cancelledBookings
            FROM bookings 
            WHERE idUser = ?
        `;
        
        connection.query(statsQuery, [userId], function(err, statsResults) {
            if (err) {
                console.error('Error fetching booking stats:', err);
                return res.status(500).json({ success: false, message: 'Database error' });
            }
            
            const stats = statsResults[0] || {
                totalBookings: 0,
                completedBookings: 0,
                pendingBookings: 0,
                cancelledBookings: 0
            };
            
            res.render('profile', {
                title: 'Profile',
                user: user,
                stats: stats
            });
        });
    });
});

// POST update profile
router.post('/update', verifyToken, function(req, res) {
    const userId = req.user.idusers;
    const { name, surname, email, phone, address } = req.body;
    
    // Validate required fields
    if (!name || !surname || !email) {
        return res.status(400).json({ 
            success: false, 
            message: 'Name, surname, and email are required' 
        });
    }
    
    // Check if email is already taken by another user
    const emailCheckQuery = 'SELECT idusers FROM users WHERE email = ? AND idusers != ?';
    connection.query(emailCheckQuery, [email, userId], function(err, emailResults) {
        if (err) {
            console.error('Error checking email:', err);
            return res.status(500).json({ success: false, message: 'Database error' });
        }
        
        if (emailResults.length > 0) {
            return res.status(400).json({ 
                success: false, 
                message: 'Email is already taken by another user' 
            });
        }
        
        // Update user profile
        const updateQuery = `
            UPDATE users 
            SET name = ?, surname = ?, email = ?, phone = ?, address = ?
            WHERE idusers = ?
        `;
        
        connection.query(updateQuery, [name, surname, email, phone, address, userId], function(err, result) {
            if (err) {
                console.error('Error updating profile:', err);
                return res.status(500).json({ success: false, message: 'Database error' });
            }
            
            res.json({ 
                success: true, 
                message: 'Profile updated successfully' 
            });
        });
    });
});

// POST upload profile picture
router.post('/upload-picture', verifyToken, upload.single('profile_picture'), function(req, res) {
    const userId = req.user.idusers;
    
    if (!req.file) {
        return res.status(400).json({ 
            success: false, 
            message: 'No file uploaded' 
        });
    }
    
    const profilePictureUrl = '/uploads/profile-pictures/' + req.file.filename;
    
    // Update user's profile picture in database
    const updateQuery = 'UPDATE users SET profile_picture = ? WHERE idusers = ?';
    connection.query(updateQuery, [profilePictureUrl, userId], function(err, result) {
        if (err) {
            console.error('Error updating profile picture:', err);
            return res.status(500).json({ success: false, message: 'Database error' });
        }
        
        res.json({ 
            success: true, 
            message: 'Profile picture updated successfully',
            profile_picture_url: profilePictureUrl
        });
    });
});

module.exports = router; 