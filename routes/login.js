var express = require('express');
var router = express.Router();



/* GET Login page. */
router.get('/', function(req, res, next) {
  res.render('login',{ title: 'Log in'});
});

/* POST login*/
router.post('/login/log', (req, res) =>{
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
