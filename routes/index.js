var express = require('express');
var router = express.Router();

const connection = require("../database/connection");

// GET registerCustomer page
router.get('/registerCustomer', function(req, res, next) {
  res.render('registerCustomer', { title: 'Register Page' });
});
/* GET home page. */
router.get('/login', function(req, res, next) {
  res.render('login',{ title: 'Log in'});
});
/* GET home page. */
router.get('/', function(req, res, next) {
  res.render('index', { title: 'Express' });
});

/* POST add a customer*/
router.post('/routes/users', (req, res) =>{
  const { name, surname , birthdate, email, password} = req.body;
  const query = "INSERT INTO customers (C_Name,C_Surname,C_Birthdate,C_Email,C_Password) VALUES (?,?,?,?,?)";

  connection.query(query, [name,surname,birthdate,email,password], (err,result) =>{
    if(err) throw err;
    console.log("Customer added");
    res.end("Customer Added");
  });
});

/* POST login*/
router.post('/routes/users/login', (req, res) =>{
  const {email, password} = req.body;
  const query = "SELECT * FROM customers WHERE C_Email="+email+" AND C_Password="+password;

  connection.query(query, [email,password], (err,result) =>{
    if(err) throw err;
    if(result != null){
      console.log('Successfully logged in')
    }
    res.end('Successfully logged in');
  });
});



module.exports = router;
