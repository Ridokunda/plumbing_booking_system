var createError = require('http-errors');
var express = require('express');
var path = require('path');
var cookieParser = require('cookie-parser');
var logger = require('morgan');
const mysql2 = require('mysql2');

// create a database connection
const connection = mysql2.createConnection({
  host: "localhost",
  database: "fixit_db",
  user: "root",
  password: "Kundi2001rio!"
});

connection.connect((err)=>{
  if(err) throw err;
  console.log("Database connected");
})

var registerCustomerRouter = require('./routes/registerCustomer');
var loginRouter = require('./routes/login');
var usersRouter = require('./routes/users');
var indexRouter = require('./routes/index');

var app = express();

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

app.set('view options', { debug: true });


app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/', indexRouter);
app.use('/registerCustomer', indexRouter);
app.use('/login', indexRouter);
app.use('/users', usersRouter);





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







