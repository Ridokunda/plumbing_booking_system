var express = require('express');
var router = express.Router();

const connection = require("../database/connection");

/* GET home page. */
router.get('/', function(req, res, next) {
  res.render('booking', { title: 'Book a Trip' });
});

router.post('/', (req,res, next) => {
    
    
  var service = req.body.service;
  var date_start = req.body.date_start;
  var des = req.body.description;

  
    
  const query = 'INSERT INTO bookings (idUser,type,date_start,des) VALUES(?,?,?,?)';

  connection.query(query, [3,service,date_start,des], (err, result) =>{
    if(err) throw err;
    console.log('booking added');
    res.redirect('/booking');
  })
});




module.exports = router;