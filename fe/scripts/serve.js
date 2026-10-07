import http from "node:http";
import https from "node:https";
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createSiteLoader, seoResponse } from "./site-content.js";
import { sendContent } from "./http-content.js";
import {safeRequestTarget,proxyHeaders,securityHeaders} from './request-security.js';
import {createLogger,observeResponse} from './observability.js';
import {proxyHttp} from './http-proxy.js';

export function createFrontend({
  port = Number(process.env.PORT || 5173),
  host = process.env.HOST || "127.0.0.1",
  backend = process.env.BACKEND_URL || "http://127.0.0.1:3000",
  directory = fileURLToPath(new URL("../dist", import.meta.url)),
  logger = createLogger('frontend'),
  proxyTimeoutMs = 15000,
} = {}) {
  const target = new URL(backend);
  if (!["http:", "https:"].includes(target.protocol))
    throw new Error("BACKEND_URL must be HTTP(S)");
  const transport = target.protocol === "https:" ? https : http;
  const loadSite = createSiteLoader(target);
  let uiCopy=null,uiCopyAt=0;
  async function translateTemplate(template){
    if(!template.includes('{{copy:'))return template;
    if(!uiCopy||Date.now()-uiCopyAt>30000){const response=await fetch(new URL('/api/configuration',target),{signal:AbortSignal.timeout(5000)});if(!response.ok)throw new Error('UI configuration unavailable');uiCopy=(await response.json()).copy;uiCopyAt=Date.now();}
    const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    return template.replace(/\{\{copy:([a-z0-9_]+)\}\}/g,(_,key)=>{if(!Object.hasOwn(uiCopy,key))throw new Error('Missing UI content');return escape(uiCopy[key]);});
  }
  const mime = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".webp": "image/webp",
    ".ico": "image/x-icon",
    ".woff2": "font/woff2",
  };
  const inside = (p) => p.startsWith(path.resolve(directory) + path.sep);
  const isApi = (p) =>
    p.startsWith("/api/") || p.startsWith("/admin/") || p.startsWith("/rt/");
  const sockets = new Set();
  const upgraded = new Set();
  let closing = false, closePromise;
  const server = http.createServer(async (req, res) => {
    observeResponse(req,res,logger,{freshId:true});
    for(const [key,value] of Object.entries(securityHeaders))res.setHeader(key,value);
    if(!safeRequestTarget(req.url)){res.writeHead(400).end();return;}
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    let pathname;
    try {
      pathname = decodeURIComponent(
        new URL(req.url, "http://localhost").pathname,
      );
    } catch {
      res.writeHead(400).end();
      return;
    }
    if (isApi(pathname)) {
      const headers = proxyHeaders(req);
      delete headers.connection;
      proxyHttp(req,res,new URL(req.url,target),headers,{timeoutMs:proxyTimeoutMs,unavailableStatus:502});
      return;
    }
    if (!["GET", "HEAD"].includes(req.method)) {
      res.writeHead(405, { Allow: "GET, HEAD" }).end();
      return;
    }
    if (pathname.includes("\\") || pathname.includes("\0")) {
      res.writeHead(404).end();
      return;
    }
    if (
      pathname.split("/").some((s) => s.startsWith(".")) ||
      pathname.startsWith("/internal/") ||
      pathname === "/metrics"
    ) {
      res.writeHead(404).end();
      return;
    }
    if (
      pathname === "/" ||
      pathname === "/index.html" ||
      pathname === "/admin.html" ||
      pathname === "/robots.txt" ||
      pathname === "/sitemap.xml" ||
      !path.extname(pathname)
    ) {
      try {
        const template = ["/", "/admin.html"].includes(pathname)
          ? await readFile(
              path.join(
                directory,
                pathname === "/admin.html" ? "admin.html" : "index.html",
              ),
              "utf8",
            )
          : "";
        const result = seoResponse(pathname, await translateTemplate(template), await loadSite());
        if (result?.redirect) {
          res.writeHead(308, { Location: result.redirect }).end();
          return;
        }
        if (result) {
          await sendContent(req, res, result);
          return;
        }
      } catch {
        res
          .writeHead(503, { "X-Robots-Tag": "noindex", "Retry-After": "60" })
          .end("Temporarily unavailable");
        return;
      }
    }
    const filename = path.resolve(
      directory,
      pathname === "/" ? "index.html" : pathname.slice(1),
    );
    if (!inside(filename) || !mime[path.extname(filename)]) {
      res.writeHead(404).end();
      return;
    }
    try {
      const resolved = await realpath(filename);
      if (!inside(resolved)) {
        res.writeHead(404).end();
        return;
      }
      const data = await readFile(resolved);
      await sendContent(req, res, {
        body: data,
        type: mime[path.extname(filename)],
        cache:
          path.extname(filename) === ".html"
            ? "no-cache"
            : "public, max-age=300",
      });
    } catch {
      res.writeHead(404, { "X-Robots-Tag": "noindex" }).end();
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.on('connection',socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));});
  server.on("upgrade", (req, socket, head) => {
    if(closing){socket.destroy();return;}
    upgraded.add(socket);socket.once('close',()=>upgraded.delete(socket));
    if (!safeRequestTarget(req.url)||!req.url.startsWith("/rt/")) {
      socket.end("HTTP/1.1 404 Not Found\r\n\r\n");
      return;
    }
    const headers = proxyHeaders(req);
    const upstream = transport.request(new URL(req.url, target), {
      headers,
      timeout: 15000,
    });
    upstream.on("upgrade", (incoming, remote, upstreamHead) => {
      socket.write(
        `HTTP/1.1 ${incoming.statusCode} Switching Protocols\r\n${Object.entries(
          incoming.headers,
        )
          .map(([k, v]) => `${k}: ${v}`)
          .join("\r\n")}\r\n\r\n`,
      );
      if (upstreamHead.length) socket.write(upstreamHead);
      if (head.length) remote.write(head);
      remote.on("error", () => socket.destroy());
      socket.on("error", () => remote.destroy());
      socket.on("close", () => remote.destroy());
      remote.on("close", () => socket.destroy());
      socket.pipe(remote).pipe(socket);
    });
    upstream.on("response", (incoming) => {
      socket.end(
        `HTTP/1.1 ${incoming.statusCode} Upstream rejected upgrade\r\n\r\n`,
      );
      incoming.resume();
    });
    upstream.on("timeout", () => upstream.destroy());
    upstream.on("error", () => socket.destroy());
    upstream.end();
  });
  return {
    server,
    listen: () =>
      new Promise((resolve,reject) => {
        server.once('error',reject);
        server.listen(port, host, () => {server.off('error',reject);resolve(server.address());});
      }),
    close: () => closePromise ||= new Promise((resolve) => {
        closing = true;
        for(const socket of upgraded)socket.destroy();
        const deadline=setTimeout(()=>{for(const socket of sockets)socket.destroy();},1000);
        server.close(()=>{clearTimeout(deadline);resolve();});
        server.closeIdleConnections();
      }).then(()=>logger.close()),
  };
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const app = createFrontend({logger:createLogger('frontend',{directory:process.env.LOG_DIR||fileURLToPath(new URL('../.data/logs',import.meta.url))})});
  const address = await app.listen();
  console.log(`Frontend ready: http://${address.address}:${address.port}`);
  for (const signal of ["SIGTERM", "SIGINT"])
    process.once(signal, () => void app.close());
}
