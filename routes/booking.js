var express = require('express');
var router = express.Router();

const connection = require("../database/connection");

/* GET home page. */
router.get('/', function(req, res, next) {
  if(!req.session.userid){
    return res.redirect('/login');
  }
  res.render('booking', { title: 'Book a Trip' });
});

router.post('/', (req,res, next) => {
  if(!req.session.userid){
    return res.redirect('/login');
  }
   
  var service = req.body.service;
  var date_start = req.body.date_start;
  var des = req.body.description;

  
    
  const query = 'INSERT INTO bookings (idUser,type,date_start,des) VALUES(?,?,?,?)';

  connection.query(query, [req.session.userid,service,date_start,des], (err, result) =>{
    if(err){
      console.error('Error insert booking in the database', err);
      return res.status(500).send('Internal server error');
    }
    console.log('booking added');
    res.send('Booking added');
  })
});




module.exports = router;