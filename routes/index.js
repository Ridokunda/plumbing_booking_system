var express = require('express');
var router = express.Router();

const connection = require("../database/connection");



/* GET home page. */
router.get('/', function(req, res, next) {
  res.render('index', { title: 'WeFixIt | Home' });
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
