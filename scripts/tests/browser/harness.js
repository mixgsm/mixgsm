// Tarayici testleri icin yerel ortam: depoyu http://127.0.0.1:<port> altinda
// sunar; raw.githubusercontent.com/mixgsm/mixgsm/main/* gorsellerini depodaki
// dosyalardan verir; Google Sheets / GitHub API isteklerini keser (canli veriye
// dokunulmaz, testler agdan bagimsiz). Gercek iOS Safari DEGILDIR.
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..", "..");
const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".json": "application/json", ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".woff2": "font/woff2", ".xml": "application/xml",
};

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let u = decodeURIComponent(req.url.split("?")[0]);
      if (u.endsWith("/")) u += "index.html";
      const f = path.join(ROOT, path.normalize(u));
      if (!f.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
      fs.readFile(f, (err, data) => {
        if (err) { res.writeHead(404); return res.end("404"); }
        res.writeHead(200, { "content-type": MIME[path.extname(f).toLowerCase()] || "application/octet-stream", "cache-control": "no-cache" });
        res.end(data);
      });
    });
    server.listen(0, "127.0.0.1", () => resolve({ server, url: `http://127.0.0.1:${server.address().port}/` }));
  });
}

async function routeExternal(context, { catalogBody } = {}) {
  await context.route(/^https:\/\/raw\.githubusercontent\.com\/mixgsm\/mixgsm\/main\//, (route) => {
    const rel = decodeURIComponent(new URL(route.request().url()).pathname.replace(/^\/mixgsm\/mixgsm\/main\//, ""));
    const f = path.join(ROOT, path.normalize(rel));
    if (!f.startsWith(ROOT) || !fs.existsSync(f)) return route.fulfill({ status: 404, body: "" });
    return route.fulfill({ status: 200, contentType: MIME[path.extname(f).toLowerCase()] || "application/octet-stream", body: fs.readFileSync(f) });
  });
  await context.route(/^https:\/\/(docs\.google\.com|[a-z0-9-]+\.googleusercontent\.com|api\.github\.com)\//, (route) => route.abort());
  if (catalogBody !== undefined) {
    await context.route(/\/catalog\.json(\?|$)/, (route) => route.fulfill({ status: 200, contentType: "application/json", body: catalogBody }));
  }
}

function launchOptions() {
  const exe = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  return exe ? { executablePath: exe } : {};
}

module.exports = { startServer, routeExternal, launchOptions, ROOT };
