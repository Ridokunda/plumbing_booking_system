const http = require('http');
const fs = require('fs');

const server = http.createServer((req,res) =>{
    res.setHeader('Content-Type', 'text/html');

    //send an html file
    let path = './views/';

    switch(req.url){
        case '/':
            path += 'index.html';
            res.statusCode = 200;
            break;
        case '/registerCustomer':
            path += 'registerCustomer.html';
            res.statusCode = 200;
            break;
        default:
            path += '/404.html';
            res.statusCode = 404;
            break;

    }
    fs.readFile(path, (err,data) =>{
        if(err){
            console.log(err);
            res.end();
        }else{
            res.write(data);
            res.end();
        }
    });
});

server.listen(3000,() =>{
    console.log("listening on port 3000....");
})