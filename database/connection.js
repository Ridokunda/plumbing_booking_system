var mysql2 = require('mysql2');


const connection = mysql2.createConnection({
    host: "localhost",
    database: "fixit_db",
    user: "root",
    password: "root"
  });
  
  connection.connect((err)=>{
    if(err) throw err;
    console.log("Database connected");
  })

  module.exports = connection;