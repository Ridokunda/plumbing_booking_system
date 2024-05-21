var express = require('express');
var router = express.Router();


// GET registerCustomer page
router.get('/', function(req, res, next) {
    res.render('registerCustomer', { title: 'WeFixIt | Register Page' });
  });



/* POST add a customer*/
router.post('/', (req, res) =>{
    const { name, surname , birthdate, email, password} = req.body;
    const query = "INSERT INTO customers (C_Name,C_Surname,C_Birthdate,C_Email,C_Password) VALUES (?,?,?,?,?)";
  
    connection.query(query, [name,surname,birthdate,email,password], (err,result) =>{
      if(err) throw err;
      console.log("Customer added");
      res.end("Customer Added");
    });
});
module.exports = router;


