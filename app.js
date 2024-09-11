var createError = require('http-errors');
var express = require('express');
var path = require('path');
var cookieParser = require('cookie-parser');
var logger = require('morgan');
const BodyParser = require('body-parser');
const session = require('express-session');

var app = express();


app.use(session({
  secret : 'fixit',
  resave : true,
  saveUninitialized : true,
}));

//middleware that sets the session variable
app.use((req,res,next)=>{
  res.locals.session = req.session;
  next();
});


var registerRouter = require('./routes/register');
var loginRouter = require('./routes/login');
var usersRouter = require('./routes/users');
var indexRouter = require('./routes/index');
var bookingRouter = require('./routes/booking');
var adminRouter = require('./routes/admin');
var plumberRouter = require('./routes/plumber');



// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');
app.set('view options', { debug: false });


app.use(logger('dev'));
app.use(BodyParser.json());
//app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));
app.use(BodyParser.urlencoded({ extended: false }));

app.use('/', indexRouter);
app.use('/index', indexRouter);
app.use('/routes/users', usersRouter);
app.use('/users', usersRouter);
app.use('/register', registerRouter);
app.use('/login', loginRouter);
app.use('/booking', bookingRouter);
app.use('/admin', adminRouter);

app.use('/plumber', plumberRouter);


// catch 404 and forward to error handler
app.use(function(req, res, next) {
  next(createError(404));
});



// error handler
app.use(function(err, req, res, next) {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  // render the error page
  res.status(err.status || 500);
  res.render('error');
});


module.exports = app;







