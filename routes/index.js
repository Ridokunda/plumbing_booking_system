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

router.post('/routes/users', (req, res) =>{
  const { name, surname , email, password} = req.body;
  const query = "INSERT INTO customers (C_Name,C_Surname,C_Email,C_Password) VALUES (?,?,?,?)";

  connection.query(query, [name,surname,email,password], (err,result) =>{
    if(err) throw err;
    console.log("Customer added");
    res.end("Customer Added");
  });
});


module.exports = router;
