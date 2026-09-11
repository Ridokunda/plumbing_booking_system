const crypto = require('crypto');

function createRateLimiter({ windowMs = 15 * 60 * 1000, max = 20 } = {}) {
  const attempts = new Map();
  return function rateLimit(req, res, next) {
    const now = Date.now();
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    const record = attempts.get(key);
    if (!record || record.resetAt <= now) {
      attempts.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    record.count += 1;
    if (record.count > max) {
      res.set('Retry-After', String(Math.ceil((record.resetAt - now) / 1000)));
      return res
        .status(429)
        .json({ success: false, message: 'Too many attempts. Please try again later.' });
    }
    next();
  };
}

function csrfProtection(req, res, next) {
  if (!req.session) return next(new Error('Session middleware must run before CSRF protection'));
  if (!req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  res.locals.csrfToken = req.session.csrfToken;
  res.cookie('csrfToken', req.session.csrfToken, {
    httpOnly: false,
    secure: process.env.COOKIE_SECURE === 'true',
    sameSite: 'strict',
  });

  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const submitted = req.get('x-csrf-token') || req.body?._csrf;
  if (
    submitted &&
    submitted.length === req.session.csrfToken.length &&
    crypto.timingSafeEqual(Buffer.from(submitted), Buffer.from(req.session.csrfToken))
  )
    return next();

  const expectedOrigin = `${req.protocol}://${req.get('host')}`;
  const origin = req.get('origin');
  const referer = req.get('referer');
  if (origin === expectedOrigin || (!origin && referer && referer.startsWith(`${expectedOrigin}/`)))
    return next();
  return res.status(403).json({ success: false, message: 'Invalid or missing CSRF token.' });
}

function securityHeaders(req, res, next) {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(self)',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Content-Security-Policy':
      "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  });
  if (process.env.NODE_ENV === 'production' && process.env.COOKIE_SECURE === 'true') {
    res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
}

module.exports = { createRateLimiter, csrfProtection, securityHeaders };
