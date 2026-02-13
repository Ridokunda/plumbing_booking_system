const jwt = require('jsonwebtoken');

// Middleware to verify JWT token from Authorization header or cookies
const verifyToken = (req, res, next) => {
  // Get token from Authorization header or cookies
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1] || req.cookies.token;

  if (!token) {
    // If no token found, check if it's a public route or redirect to login
    return res.status(401).json({ success: false, message: 'No token provided' });
  }

  jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key', (err, decoded) => {
    if (err) {
      console.error('Token verification failed:', err);
      return res.status(403).json({ success: false, message: 'Invalid or expired token' });
    }
    
    // Attach user info from token to request
    req.user = decoded;
    next();
  });
};

// Middleware to check if user is admin
const isAdmin = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'Not authenticated' });
  }
  
  if (req.user.usertype === 2) {
    next();
  } else {
    return res.status(403).json({ success: false, message: 'Access Denied: Not an Admin' });
  }
};

// Middleware to check if user is a plumber
const isPlumber = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'Not authenticated' });
  }
  
  if (req.user.usertype === 3) {
    next();
  } else {
    return res.status(403).json({ success: false, message: 'Access Denied: Not a Plumber' });
  }
};

// Middleware to check if user is a customer
const isCustomer = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'Not authenticated' });
  }
  
  if (req.user.usertype === 1) {
    next();
  } else {
    return res.status(403).json({ success: false, message: 'Access Denied: Not a Customer' });
  }
};

module.exports = { verifyToken, isAdmin, isPlumber, isCustomer };
