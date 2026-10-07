import './fixtures/configure.js';
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createFrontend } from "../scripts/serve.js";
import { fileURLToPath } from "node:url";
test("frontend owns static assets, rejects traversal and proxies only public API routes", async (t) => {
  const upstream = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        path: req.url,
        secret: req.headers["x-game-secret"] || null,
      }),
    );
  });
  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const app = createFrontend({
    port: 0,
    backend: `http://127.0.0.1:${upstream.address().port}`,
    directory: fileURLToPath(new URL("../public", import.meta.url)),
  });
  const address = await app.listen(),
    url = `http://127.0.0.1:${address.port}`;
  t.after(async () => {
    await app.close();
    await new Promise((resolve) => upstream.close(resolve));
  });
  assert.equal(
    (await fetch(url)).status,
    503,
    "missing site API is temporary unavailability, not a successful indexable empty page",
  );
  assert.match(
    (await fetch(url + "/game/engine.js")).headers.get("content-type"),
    /javascript/,
  );
  for (const p of [
    "/.env",
    "/package.json",
    "/scripts/serve.js",
    "/game/%2e%2e%2f%2e%2e%2fpackage.json",
    "/game/%2e%2e%5c%2e%2e%5cpackage.json",
    "/internal/catalog",
    "/metrics",
  ])
    assert.equal((await fetch(url + p)).status, 404, p);
  const proxied = await fetch(url + "/api/account/catalog?version=example", {
    headers: { "x-game-secret": "untrusted" },
  });
  assert.deepEqual(await proxied.json(), {
    path: "/api/account/catalog?version=example",
    secret: null,
  });
  assert.equal((await fetch(url, { method: "POST" })).status, 405);
});
