require('dotenv').config();
var express = require('express');
var path = require('path');
var cookieParser = require('cookie-parser');
var logger = require('morgan');
const session = require('express-session');
const { getUnreadCount, getNotificationsForUser } = require('./utils/notifications');
const { csrfProtection, securityHeaders } = require('./middleware/security');
const database = require('./database/connection');
const MySqlSessionStore = require('./database/sessionStore');
const healthRouter = require('./routes/health');

var app = express();

if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
  throw new Error('SESSION_SECRET must contain at least 32 characters');
}

app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(securityHeaders);
app.use('/health', healthRouter);
app.use(
  session({
    store: process.env.NODE_ENV === 'test' ? undefined : new MySqlSessionStore(database),
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    name: process.env.SESSION_NAME || 'connect.sid',
    cookie: {
      secure: process.env.COOKIE_SECURE === 'true',
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
    },
  }),
);

var registerRouter = require('./routes/register');
var loginRouter = require('./routes/login');
var indexRouter = require('./routes/index');
var bookingRouter = require('./routes/booking');
var adminRouter = require('./routes/admin');
var plumberRouter = require('./routes/plumber');
var profileRouter = require('./routes/profile');
var paymentRouter = require('./routes/payment');
var notificationsRouter = require('./routes/notifications');
var quotesRouter = require('./routes/quotes');
var jobsRouter = require('./routes/jobs');
var reviewsRouter = require('./routes/reviews');
var accountRouter = require('./routes/account');
var supportRouter = require('./routes/support');

app.post(
  '/payment/webhook',
  express.raw({ type: 'application/json' }),
  paymentRouter.stripeWebhookHandler,
);

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');
app.set('view options', { debug: false });

app.use(logger('dev'));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));
// serve uploaded files (e.g. plumber before/after photos)
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use(csrfProtection);

// Make the active session and notification summary available to templates.
app.use(async (req, res, next) => {
  res.locals.session = req.session;

  const activeUser = req.session?.user;
  if (activeUser && activeUser.idusers) {
    try {
      [res.locals.notificationCount, res.locals.recentNotifications] = await Promise.all([
        getUnreadCount(activeUser.idusers),
        getNotificationsForUser(activeUser.idusers, 3),
      ]);
    } catch (_error) {
      res.locals.notificationCount = 0;
      res.locals.recentNotifications = [];
    }
  } else {
    res.locals.notificationCount = 0;
    res.locals.recentNotifications = [];
  }
  next();
});

app.use('/', indexRouter);
app.use('/index', indexRouter);
app.use('/register', registerRouter);
app.use('/login', loginRouter);
app.use('/booking', bookingRouter);
app.use('/admin', adminRouter);
app.use('/plumber', plumberRouter);
app.use('/profile', profileRouter);
app.use('/payment', paymentRouter);
app.use('/notifications', notificationsRouter);
app.use('/quotes', quotesRouter);
app.use('/jobs', jobsRouter);
app.use('/reviews', reviewsRouter);
app.use('/account', accountRouter);
app.use('/support', supportRouter);

// catch 404 and forward to error handler
app.use(function (req, res, next) {
  const error = new Error('Page not found');
  error.status = 404;
  next(error);
});

// error handler
app.use(function (err, req, res, _next) {
  const status = err.status || (err.code === 'LIMIT_FILE_SIZE' ? 413 : 500);
  if (status >= 500) console.error('Unhandled request error:', err);
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  if (req.accepts(['html', 'json']) === 'json') {
    return res.status(status).json({
      success: false,
      message: status >= 500 ? 'Internal server error' : err.message,
    });
  }
  res.status(status);
  res.render('error');
});

module.exports = app;
