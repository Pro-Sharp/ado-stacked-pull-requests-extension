// Tiny static file server for the visual harness: node scripts/serve.js [port]
const http = require("http");
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..", "dist");
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png" };
http
  .createServer((req, res) => {
    const file = path.join(root, decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/, "") || "harness.html");
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); res.end("not found"); return; }
      res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream" });
      res.end(data);
    });
  })
  .listen(Number(process.argv[2]) || 5173, () => console.log("harness on http://localhost:" + (process.argv[2] || 5173)));
