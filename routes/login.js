var express = require('express');
var router = express.Router();
var bcrypt = require('bcrypt');
const connection = require('../database/connection');


/* GET Login page. */
router.get('/', function(req, res, next) {
  const error = req.query.error;
  res.render('login',{ title: 'Log in', error});
});

/* POST login*/
router.post('/log', (req, res) =>{
  const {email, password} = req.body;
  if(!email || !password){
    return res.send("Provide email and password");
  }

  const query = "SELECT * FROM users WHERE email = ?";

  connection.query(query, [email], async (err,result) =>{
    if(err){
      console.error('error querying the database',err);
      return res.status(500).send('Internal server error');
    };

    if(result.length === 0){
      return res.redirect("/login?error=Invalid password or email");
    }
    const user = result[0];

    const match = await bcrypt.compare(password, user.password)
    if(!match){
      return res.redirect("/login?error=Invalid password or email");
    }
    req.session.userid = user.idusers;
    //res.end('Successfully logged in');
    if(user.usertype === 3){
      res.redirect('/plumber');
    }
    if(user.usertype === 2){
      res.redirect('/admin');
    }
    if(user.usertype === 1){
      res.redirect('/');
    }
    
  });
});

router.get('/logout', (req, res) =>{
  req.session.destroy();
  res.redirect('/');
})

module.exports = router;
