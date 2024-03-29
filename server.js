const http = require('http');
const fs = require('fs');

const server = http.createServer((req,res) =>{
    

    //send an html file
    let path = './views/';
    let path2 = '';
    switch(req.url){
        case '/':
            path += 'index.html';
            res.statusCode = 200;
            break;
        case '/registerCustomer':
            path += 'registerCustomer.html';
            res.statusCode = 200;
            break;
        case '/css/registerCustomer.css':
            path2 = "";
            path2 += './css/registerCustomer.css';
            res.statusCode = 200;
            break;
        case '/img/favicon.ico':
            path2 = "";
            path2 += './img/favicon.ico';
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
            res.setHeader('Content-Type', 'text/html');
            res.write(data);
            res.end();
        }
        
    });
    
    if(req.url.includes('css')){
        fs.readFile(path2, (err, data) => {
            if (err) {
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end('Internal Server Error');
                return;
            }
    
            // Set the content type to CSS
            res.writeHead(200, { 'Content-Type': 'text/css' });
            res.end(data);
        });
    }else if(req.url.includes('img')){
        fs.readFile(path2, (err, data) => {
            if (err) {
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end('Internal Server Error');
                return;
            }
    
            // Set the content type to CSS
            res.writeHead(200, { 'Content-Type': 'image/x-icon' });
            res.end(data);
        });
    }
        
    

});

// Load the CSS file

server.listen(3000,() =>{
    console.log("listening on port 3000....");
})