// Demo app for trying the extension: node test/server.js, then open http://localhost:5173
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 5173;

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

http
  .createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    if (url.pathname === '/' || url.pathname === '/demo.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      fs.createReadStream(path.join(__dirname, 'demo.html')).pipe(res);
      return;
    }
    if (url.pathname === '/api/products') {
      json(res, 200, { products: [{ id: 1, name: 'Coffee mug', price: 12 }, { id: 2, name: 'Notebook', price: 6 }] });
      return;
    }
    if (url.pathname === '/api/user') {
      json(res, 200, { id: 42, name: 'Asha', email: 'asha@example.com', accessToken: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiI0MiJ9.c2lnbmF0dXJlLXRlc3Q' });
      return;
    }
    if (url.pathname === '/api/pay' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => setTimeout(() => json(res, 500, { error: 'Payment gateway timeout', received: body.length }), 300));
      return;
    }
    if (url.pathname === '/api/login' && req.method === 'POST') {
      json(res, 401, { error: 'Invalid credentials' });
      return;
    }
    json(res, 404, { error: 'Not found' });
  })
  .listen(PORT, () => console.log(`Demo app running at http://localhost:${PORT}`));
