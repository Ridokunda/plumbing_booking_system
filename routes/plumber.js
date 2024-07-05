var express = require('express');
var router = express.Router();
const connection = require('../database/connection');

router.get('/', function(req,res,next){
    res.render('plumber', {title:'Plumber Dashboard'});
})

module.exports = router;