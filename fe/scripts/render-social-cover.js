// Render the project's original vector artwork; no external asset service.
import { chromium } from "playwright";
import { readFile } from "node:fs/promises";
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 1,
  });
  await page.setContent(
    '<html><body style="margin:0">' +
      (await readFile("public/social-cover.svg", "utf8")) +
      "</body></html>",
  );
  await page.screenshot({ path: "public/social-cover.png" });
} finally {
  await browser.close();
}
