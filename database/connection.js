require('dotenv').config();
var mysql2 = require('mysql2');

const connection = mysql2.createConnection({
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT
  });
  
  connection.connect((err)=>{
    if(err) throw err;
    console.log("Database connected");
  })

  module.exports = connection;