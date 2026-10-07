import './fixtures/configure.js';
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {readFile} from 'node:fs/promises';
import { fileURLToPath } from "node:url";
import {
  seoResponse,
  publicOrigin,
  createSiteLoader,
} from "../scripts/site-content.js";
import { createFrontend } from "../scripts/serve.js";
const site = {
  origin: "https://game.example",
  indexable: true,
  name: "Serpent Survivor",
  language: "vi",
  title: "Game title",
  description: "Useful description",
  heading: "Survive and evolve",
  introduction: "Build a body",
  socialImage: "/social-cover.png",
  googleVerification: "verify-token",
  faq: [{ question: "How to play?", answer: "Use your mouse." }],
  pages: [
    {
      slug: "guide",
      title: "Guide title",
      description: "Guide description",
      heading: "Learn to play",
      sections: [{ heading: "Controls", text: "Use arrow keys." }],
    },
  ],
};
const content = { version: 1, site, updatedAt: "2026-10-05T00:00:00.000Z" },
  template =
    "<html><head><title>old</title></head><body><main>game</main></body></html>";
test("SEO content is visible without JavaScript, escaped and has canonical structured data", () => {
  const data = structuredClone(content);
  data.site.title = "</script><script>alert(1)</script>";
  data.site.faq[0].answer = "<img src=x onerror=alert(1)>";
  const r = seoResponse("/", template, data);
  assert.match(r.body, /rel="canonical" href="https:\/\/game.example\/"/);
  assert.match(r.body, /&lt;img/);
  assert.equal(r.body.includes("<script>alert(1)</script>"), false);
  const ld = JSON.parse(
    r.body.match(/application\/ld\+json">(.*?)<\/script>/)[1],
  );
  assert.equal(ld["@graph"][0].name, site.name);
  const guide = seoResponse("/guide/", "", content);
  assert.match(guide.body, /<h1>Learn to play<\/h1>/);
  assert.match(guide.body, /Use arrow keys/);
  assert.doesNotMatch(guide.body, /<script[^>]+src=/);
  assert.match(guide.body, /BreadcrumbList/);
  assert.equal(seoResponse("/missing/", "", content), null);
  assert.deepEqual(seoResponse("/guide", "", content), { redirect: "/guide/" });
});
test("indexing requires configured public HTTPS origin; sitemap excludes private routes", () => {
  for (const origin of [
    "",
    "http://game.example",
    "https://localhost",
    "https://127.0.0.1",
    "https://a:b@game.example",
    "https://game.example/path",
  ])
    assert.equal(publicOrigin({ origin }), "");
  const off = { site: { ...site, origin: "" } };
  assert.match(seoResponse("/", template, off).robots, /noindex/);
  assert.match(seoResponse("/robots.txt", "", off).body, /Disallow: \//);
  assert.doesNotMatch(seoResponse("/sitemap.xml", "", off).body, /<loc>/);
  assert.equal(seoResponse("/", template, null).status, 503);
  const sitemap = seoResponse("/sitemap.xml", "", content).body;
  assert.match(sitemap, /<loc>https:\/\/game.example\/guide\/<\/loc>/);
  assert.doesNotMatch(sitemap, /admin|account/);
  assert.match(seoResponse("/admin.html", template, content).robots, /noindex/);
});
test("frontend serves compressed crawlable pages, HEAD/ETag and actual 404; loader coalesces requests", async (t) => {
  let calls = 0;
  const template=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
  const copy=Object.fromEntries([...template.matchAll(/\{\{copy:([a-z0-9_]+)\}\}/g)].map(m=>[m[1],'Public UI content']));
  const upstream = http.createServer((req, res) => {
    if(req.url==='/api/configuration'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({version:1,copy}));return;}
    calls++;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(content));
  });
  await new Promise((r) => upstream.listen(0, "127.0.0.1", r));
  const backend = `http://127.0.0.1:${upstream.address().port}`;
  const loader = createSiteLoader(backend);
  await Promise.all(Array.from({ length: 20 }, () => loader()));
  assert.equal(calls, 1);
  const app = createFrontend({
    port: 0,
    backend,
    directory: fileURLToPath(new URL("../public", import.meta.url)),
  });
  const address = await app.listen(),
    base = `http://127.0.0.1:${address.port}`;
  t.after(async () => {
    await app.close();
    await new Promise((r) => upstream.close(r));
  });
  const response = await fetch(base + "/guide/", {
      headers: { "Accept-Encoding": "br" },
    }),
    body = await response.text();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-encoding"), "br");
  assert.match(body, /Learn to play/);
  assert.match(body, /https:\/\/game.example\/guide\//);
  const etag = response.headers.get("etag");
  assert.equal(
    (
      await fetch(base + "/guide/", {
        headers: { "Accept-Encoding": "br", "If-None-Match": etag },
      })
    ).status,
    304,
  );
  const head = await fetch(base + "/guide/", {
    method: "HEAD",
    headers: { "Accept-Encoding": "br" },
  });
  assert.equal(await head.text(), "");
  assert.equal(
    head.headers.get("content-length"),
    response.headers.get("content-length"),
  );
  assert.equal(
    (
      await fetch(base + "/guide/", {
        headers: { "Accept-Encoding": "br;q=0,gzip;q=0" },
      })
    ).headers.get("content-encoding"),
    null,
  );
  assert.equal(
    (await fetch(base + "/guide", { redirect: "manual" })).status,
    308,
  );
  assert.equal((await fetch(base + "/not-a-page")).status, 404);
  assert.match(await (await fetch(base)).text(), /How to play/);
  assert.equal(calls, 2);
});
