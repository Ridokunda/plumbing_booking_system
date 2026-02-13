var express = require('express');
var router = express.Router();
var bcrypt = require('bcrypt');
var jwt = require('jsonwebtoken');
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
    return res.status(400).json({ success: false, message: 'Provide email and password' });
  }

  const query = "SELECT * FROM users WHERE email = ?";

  connection.query(query, [email], async (err,result) =>{
    if(err){
      console.error('error querying the database',err);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    };

    if(result.length === 0){
      return res.status(401).json({ success: false, message: 'Invalid password or email' });
    }
    const user = result[0];

    const match = await bcrypt.compare(password, user.password)
    if(!match){
      return res.status(401).json({ success: false, message: 'Invalid password or email' });
    }
    
    // Generate JWT token
    const token = jwt.sign(
      { 
        idusers: user.idusers, 
        email: user.email, 
        usertype: user.usertype,
        name: user.name 
      },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '24h' }
    );

    // Set token in cookie (httpOnly for security)
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.COOKIE_SECURE === 'true',
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    });

    // Save user into session for server-rendered views
    if (req.session) {
      req.session.user = {
        idusers: user.idusers,
        email: user.email,
        usertype: user.usertype,
        name: user.name
      };
    }

    // Return token in response for client-side storage
    let redirectUrl = '/'; // default
    if(user.usertype === 2) redirectUrl = '/admin';
    if(user.usertype === 3) redirectUrl = '/plumber';
    if(user.usertype === 1) redirectUrl = '/';
    
    res.json({ 
      success: true, 
      token, 
      redirectUrl, 
      usertype: user.usertype,
      message: 'Login successful'
    });
  });
});

router.get('/logout', (req, res) =>{
 
  req.session.destroy();
  res.clearCookie('token');
  res.redirect('/');
})

module.exports = router;
