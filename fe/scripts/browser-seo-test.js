import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import http from "node:http";
const base = process.env.TEST_URL || "http://127.0.0.1:5173";
await mkdir("artifacts", { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const checks = [];
try {
  const context = await browser.newContext({
      javaScriptEnabled: false,
      viewport: { width: 390, height: 844 },
    }),
    page = await context.newPage();
  const result = await page.goto(base);
  assert.equal(result.status(), 200);
  await page.locator(".seo-overview").scrollIntoViewIfNeeded();
  assert.ok(await page.locator(".seo-overview").innerText());
  assert.equal(await page.locator(".seo-overview a").count(), 4);
  checks.push(
    "Homepage has visible DB content and crawlable links with JavaScript disabled",
  );
  for (const slug of ["huong-dan", "che-do-choi", "xay-dung-co-the"]) {
    const response = await page.goto(base + "/" + slug + "/");
    assert.equal(response.status(), 200);
    assert.equal(await page.locator("h1").count(), 1);
    assert.ok((await page.locator("main").innerText()).length > 500);
    assert.equal(await page.locator("script[src]").count(), 0);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    checks.push("Guide readable on mobile without JavaScript: " + slug);
  }
  await page.screenshot({
    path: "artifacts/seo-guide-mobile.png",
    fullPage: true,
  });
  const png = await fetch(base + "/social-cover.png");
  assert.equal(png.status, 200);
  assert.equal(png.headers.get("content-type"), "image/png");
  checks.push("Social card served as PNG");
  // Node fetch decompresses automatically; raw HTTP measures bytes actually transferred.
  const measure = (encoding) =>
    new Promise((resolve, reject) => {
      http
        .get(
          base + "/v2/client.js",
          { headers: { "Accept-Encoding": encoding } },
          (res) => {
            let bytes = 0;
            res.on("data", (b) => (bytes += b.length));
            res.on("end", () =>
              resolve({
                encoding: res.headers["content-encoding"] || "identity",
                bytes,
                status: res.statusCode,
              }),
            );
          },
        )
        .on("error", reject);
    });
  const sizes = await Promise.all(["identity", "gzip", "br"].map(measure));
  assert.ok(sizes.every((s) => s.status === 200));
  assert.ok(sizes[2].bytes < sizes[0].bytes * 0.4);
  checks.push("Game bundle compression materially reduces network bytes");
  const report = {
    date: new Date().toISOString(),
    checks,
    sizes,
    limitations:
      "Local HTTP; no Google crawl/indexation or field Core Web Vitals measurements.",
  };
  await writeFile(
    "artifacts/seo-validation.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
