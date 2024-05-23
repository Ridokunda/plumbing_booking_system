var express = require('express');
var router = express.Router();
 const connection = require('../database/connection')

// GET registerCustomer page
router.get('/', function(req, res, next) {
    res.render('registerCustomer', { title: 'WeFixIt | Register Page', message: null });
  });



/* POST add a customer*/
router.post('/', (req, res) =>{
    const { name, surname , birthdate, email, password} = req.body;
    const query1 = "INSERT INTO users (name,surname,birthdate,email,password) VALUES (?,?,?,?,?)";
    
    const query2 = `SELECT * FROM users WHERE email='${email}'`;

    const query3 = 'INSERT INTO customers (FK_iduser) VALUES (?)';

    connection.query(query1, [name,surname,birthdate,email,password], (err,result) =>{
      if(err) throw err;
      console.log("User added");
      //res.render('registerCustomer', { title: 'Register Page', message: null });
      connection.query(query2, [email], (err, result) =>{
        if(err) throw err;
        console.log("User found");
        var userid = result[0].idusers;

        connection.query(query3, [userid], (err, result) =>{
          if(err) throw err;
          console.log('customer added');
          req.session.user_id = userid;
          res.redirect('/');
        });
      });

    });
});
module.exports = router;


