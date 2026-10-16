// Placeholder so Railway has something to deploy.
// Replaced when the Shopify app is scaffolded.
const http = require("http");

const port = process.env.PORT || 3000;

http
  .createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: true }));
    }
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Embroidery Builder: placeholder deploy is running.\n");
  })
  .listen(port, () => console.log(`Listening on ${port}`));
