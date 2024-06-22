var express = require('express');
var router = express.Router();
const connection = require('../database/connection');

router.get('/', function(req,res,next){
    res.render('admin', {title:'Admin Dashboard'});
})

module.exports = router;