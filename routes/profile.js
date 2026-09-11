const express = require('express');
const router = express.Router();
const connection = require('../database/connection');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { verifyToken } = require('../middleware/auth');
const { cleanText, normalizeEmail } = require('../utils/validation');
const { recordAuditEvent } = require('../utils/audit');

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
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, 'profile-' + uniqueSuffix + path.extname(file.originalname).toLowerCase());
  },
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE) || 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: function (req, file, cb) {
    const extname = ['.jpg', '.jpeg', '.png', '.webp'].includes(
      path.extname(file.originalname).toLowerCase(),
    );
    const mimetype = ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'));
    }
  },
});

async function hasSupportedImageSignature(filePath) {
  const handle = await fs.promises.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(12);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead < 4) return false;
    const jpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    const png = buffer
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const webp =
      buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP';
    return jpeg || png || webp;
  } finally {
    await handle.close();
  }
}

// GET profile page
router.get('/', verifyToken, function (req, res) {
  const userId = req.user.idusers;

  // Get user data
  const userQuery = 'SELECT * FROM users WHERE idusers = ?';
  connection.query(userQuery, [userId], function (err, userResults) {
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
                SUM(CASE WHEN status IN ('COMPLETED', 'PAID') THEN 1 ELSE 0 END) as completedBookings,
                SUM(CASE WHEN status IN ('NEW', 'ASSIGNED', 'IN_PROGRESS') THEN 1 ELSE 0 END) as pendingBookings,
                SUM(CASE WHEN status = 'CANCELLED' THEN 1 ELSE 0 END) as cancelledBookings
            FROM bookings 
            WHERE idUser = ?
        `;

    connection.query(statsQuery, [userId], function (err, statsResults) {
      if (err) {
        console.error('Error fetching booking stats:', err);
        return res.status(500).json({ success: false, message: 'Database error' });
      }

      const stats = statsResults[0] || {
        totalBookings: 0,
        completedBookings: 0,
        pendingBookings: 0,
        cancelledBookings: 0,
      };

      res.render('profile', {
        title: 'Profile',
        user: user,
        stats: stats,
      });
    });
  });
});

// POST update profile
router.post('/update', verifyToken, function (req, res) {
  const userId = req.user.idusers;
  const name = cleanText(req.body.name, { min: 2, max: 100 });
  const surname = cleanText(req.body.surname, { min: 2, max: 100 });
  const email = normalizeEmail(req.body.email);
  const phone = cleanText(req.body.phone || '', { min: 0, max: 30 });
  const address = cleanText(req.body.address || '', { min: 0, max: 500 });

  // Validate required fields
  if (!name || !surname || !email) {
    return res.status(400).json({
      success: false,
      message: 'Name, surname, and email are required',
    });
  }

  // Check if email is already taken by another user
  const emailCheckQuery = 'SELECT idusers FROM users WHERE email = ? AND idusers != ?';
  connection.query(emailCheckQuery, [email, userId], function (err, emailResults) {
    if (err) {
      console.error('Error checking email:', err);
      return res.status(500).json({ success: false, message: 'Database error' });
    }

    if (emailResults.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Email is already taken by another user',
      });
    }

    // Update user profile
    const updateQuery = `
            UPDATE users
            SET name = ?, surname = ?,
                email_verified_at = IF(email = ?, email_verified_at, NULL),
                email = ?, phone = ?, address = ?
            WHERE idusers = ?
        `;

    connection.query(
      updateQuery,
      [name, surname, email, email, phone, address, userId],
      function (err) {
        if (err) {
          console.error('Error updating profile:', err);
          return res.status(500).json({ success: false, message: 'Database error' });
        }

        req.session.user.email = email;
        req.session.user.name = name;
        recordAuditEvent({
          actorId: userId,
          action: 'PROFILE_UPDATED',
          entityType: 'user',
          entityId: userId,
          ipAddress: req.ip,
        });
        res.json({
          success: true,
          message: 'Profile updated successfully',
        });
      },
    );
  });
});

// POST upload profile picture
router.post(
  '/upload-picture',
  verifyToken,
  upload.single('profile_picture'),
  async function (req, res, next) {
    const userId = req.user.idusers;

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded',
      });
    }

    try {
      if (!(await hasSupportedImageSignature(req.file.path))) {
        fs.rm(req.file.path, { force: true }, () => {});
        return res.status(400).json({
          success: false,
          message: 'The uploaded file is not a valid JPEG, PNG, or WebP image.',
        });
      }
    } catch (error) {
      fs.rm(req.file.path, { force: true }, () => {});
      return next(error);
    }

    const profilePictureUrl = '/uploads/profile-pictures/' + req.file.filename;

    try {
      const [[currentUser]] = await connection
        .promise()
        .query('SELECT profile_picture FROM users WHERE idusers = ?', [userId]);
      await connection
        .promise()
        .query('UPDATE users SET profile_picture = ? WHERE idusers = ?', [
          profilePictureUrl,
          userId,
        ]);
      if (currentUser?.profile_picture?.startsWith('/uploads/profile-pictures/')) {
        const uploadRoot = path.resolve(
          process.env.UPLOAD_PATH || 'public/uploads/profile-pictures',
        );
        const oldFile = path.resolve(uploadRoot, path.basename(currentUser.profile_picture));
        if (path.dirname(oldFile) === uploadRoot && oldFile !== path.resolve(req.file.path)) {
          fs.rm(oldFile, { force: true }, () => {});
        }
      }
      recordAuditEvent({
        actorId: userId,
        action: 'PROFILE_PHOTO_UPDATED',
        entityType: 'user',
        entityId: userId,
        ipAddress: req.ip,
      });
      res.json({
        success: true,
        message: 'Profile picture updated successfully',
        profile_picture_url: profilePictureUrl,
      });
    } catch (error) {
      fs.rm(req.file.path, { force: true }, () => {});
      next(error);
    }
  },
);

module.exports = router;
