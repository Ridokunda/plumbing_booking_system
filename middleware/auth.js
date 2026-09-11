// Session-only browser authentication avoids exposing credentials in localStorage.

// Browser authentication is intentionally session-only. Keeping one source of
// truth makes logout and server-side revocation reliable.
const verifyToken = (req, res, next) => {
  if (req.session && req.session.user) {
    req.user = req.session.user;
    return next();
  }
  if (req.accepts('html')) {
    return res.redirect('/login');
  }
  return res.status(401).json({ success: false, message: 'Authentication required' });
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
