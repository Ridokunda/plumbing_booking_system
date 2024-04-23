var express = require('express');
var router = express.Router();
const connection = require("../app")

/* GET users listing. */
router.get('/', function(req, res, next) {
  res.send('respond with a resource');
});

router.post('/routes/users', (req, res, next) =>{
  const {name, surname , email, password} = req.body;
  const query = "INSERT INTO customers (name,surname,email,password) VALUES (?,?,?,?)";

  connection.query(query, [name,surname,email,password], (err,result) =>{
    if(err) throw err;
    console.log("Customer added");
  });
});

module.exports = router;
