import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const base = process.env.TEST_URL || "http://127.0.0.1:5173";
const artifacts = new URL("../artifacts/", import.meta.url);
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const errors = [];
const attachErrors = (page) =>
  page.on("pageerror", (error) => errors.push(error.message));
const context = await browser.newContext({
  viewport: { width: 1440, height: 1050 },
  reducedMotion: "reduce",
});
// Test-only read access lets the driver aim at actual food. No debug surface is
// shipped to players, and movement/collection/upgrades still use the real UI.
await context.route("**/app.js", async (route) => {
  const response = await route.fetch();
  await route.fulfill({
    response,
    body: `${await response.text()}\nwindow.testState = () => ({world, ownId, camera:renderer.camera, zoom:renderer.zoom, view, connected});`,
  });
});
const page = await context.newPage();
attachErrors(page);
const check = async (name, fn) => {
  await fn();
  console.log(`PASS ${name}`);
};
try {
  await check(
    "home loads with three selectable species and responsive layout",
    async () => {
      await page.goto(base);
      await page.locator(".species-card").first().waitFor();
      assert.equal(
        await page.locator("#species-grid .species-card").count(),
        3,
      );
      await page.locator('[data-species="python"]').click();
      assert.equal(
        await page.locator("#selected-species-name").textContent(),
        "Python",
      );
      await page.locator('[data-species="cobra"]').click();
      await page.screenshot({
        path: fileURLToPath(new URL("home-desktop.png", artifacts)),
        fullPage: true,
      });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
    },
  );
  await check("guide, settings and local records open and close", async () => {
    for (const action of ["guide", "settings", "records"]) {
      await page.locator(`.sidebar [data-action="${action}"]`).click();
      await page.locator("#modal[open]").waitFor();
      await page.locator("#modal-close").click();
    }
  });
  await check(
    "solo moves, keyboard steering, skills and pause work",
    async () => {
      await page.locator("#player-name").fill("Test Survivor");
      await page.locator("#mode-solo").click();
      await page.locator("#play-button").click();
      await page.locator("#game:not([hidden])").waitFor();
      const first = await page.evaluate(
        () => window.testState().world.players[0].y,
      );
      await page.waitForTimeout(700);
      const next = await page.evaluate(
        () => window.testState().world.players[0].y,
      );
      assert.ok(next < first, "snake moves continuously");
      await page.keyboard.press("Space");
      await page.waitForTimeout(150);
      assert.match(await page.locator("#dash-cooldown").textContent(), /s$/);
      await page.keyboard.press("KeyQ");
      await page.waitForTimeout(150);
      assert.match(await page.locator("#pulse-cooldown").textContent(), /s$/);
      await page.locator("#pause-button").click();
      const time = await page.evaluate(() => window.testState().world.time);
      await page.waitForTimeout(400);
      assert.equal(
        await page.evaluate(() => window.testState().world.time),
        time,
      );
      await page.keyboard.press("Escape");
      assert.equal(
        await page.locator("#modal").evaluate((el) => el.open),
        false,
      );
    },
  );
  await check(
    "real food collection triggers three upgrade choices and resumes after selection",
    async () => {
      const deadline = Date.now() + 30000;
      while (Date.now() < deadline) {
        if (await page.locator("#upgrade-modal").evaluate((el) => el.open))
          break;
        const target = await page.evaluate(() => {
          const { world, ownId, camera, zoom } = window.testState();
          const p = world.players.find((p) => p.id === ownId);
          const candidates = world.foods.filter(
            (f) => f.type === "xp" || f.type === "growth",
          );
          candidates.sort(
            (a, b) =>
              Math.hypot(a.x - p.x, a.y - p.y) -
              Math.hypot(b.x - p.x, b.y - p.y),
          );
          const f = candidates[0];
          return f
            ? {
                x: (f.x - camera.x) * zoom + innerWidth / 2,
                y: (f.y - camera.y) * zoom + innerHeight / 2,
              }
            : null;
        });
        if (target)
          await page.mouse.move(
            Math.max(25, Math.min(1415, target.x)),
            Math.max(210, Math.min(900, target.y)),
          );
        await page.waitForTimeout(120);
      }
      assert.equal(
        await page.locator("#upgrade-modal").evaluate((el) => el.open),
        true,
        "collected enough real XP",
      );
      assert.equal(await page.locator(".upgrade-card").count(), 3);
      const before = await page.evaluate(() => window.testState().world.time);
      await page.waitForTimeout(300);
      assert.equal(
        await page.evaluate(() => window.testState().world.time),
        before,
      );
      await page.screenshot({
        path: fileURLToPath(new URL("level-up.png", artifacts)),
      });
      await page.keyboard.press("Digit1");
      await page.waitForTimeout(350);
      assert.ok(
        (await page.evaluate(() => window.testState().world.time)) > before,
      );
      await page.keyboard.press("F3");
      await page.locator("#telemetry:not([hidden])").waitFor();
      assert.equal(await page.locator("#telemetry").isVisible(), true);
      await page.screenshot({
        path: fileURLToPath(new URL("gameplay.png", artifacts)),
      });
      await page.locator("#pause-button").click();
      await page.locator('[data-action="leave-game"]').click();
    },
  );
  await check(
    "two browser clients create/join/ready and share an authoritative match",
    async () => {
      await page.locator("#mode-coop").click();
      await page.locator("#play-button").click();
      await page.locator(".room-code strong").waitFor();
      const code = await page.locator(".room-code strong").textContent();
      const other = await context.newPage();
      attachErrors(other);
      await other.goto(base);
      await other.waitForFunction(() => Boolean(window.testState));
      await other.locator("#player-name").fill("Second Player");
      await other.locator("#join-button").click();
      await other.locator("#room-code-input").fill(code);
      await other.locator("#join-form button").click();
      await other.locator(".lobby-player").nth(1).waitFor();
      await page.locator('[data-action="ready"]').click();
      await other.locator('[data-action="ready"]').click();
      await page.locator("#game:not([hidden])").waitFor();
      await other.locator("#game:not([hidden])").waitFor();
      await page.waitForTimeout(600);
      assert.equal(
        await page.evaluate(() => window.testState().world.players.length),
        2,
      );
      assert.equal(
        await other.evaluate(() => window.testState().world.players.length),
        2,
      );
      const id = await other.evaluate(() => window.testState().ownId);
      await other.reload();
      await other.locator("#game:not([hidden])").waitFor();
      assert.equal(
        await other.evaluate(() => window.testState().ownId),
        id,
        "reload resumes same authoritative player",
      );
      await other.locator("#pause-button").click();
      await other.locator('[data-action="leave-game"]').click();
      await other.close();
      await page.locator("#pause-button").click();
      await page.locator('[data-action="leave-game"]').click();
    },
  );
  await check(
    "mobile menu fits and touch game controls are visible",
    async () => {
      const mobile = await browser.newContext({
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 1,
        isMobile: true,
        hasTouch: true,
        reducedMotion: "reduce",
      });
      const phone = await mobile.newPage();
      attachErrors(phone);
      await phone.goto(base);
      await phone.locator("#play-button").waitFor();
      assert.equal(
        await phone.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
      await phone.screenshot({
        path: fileURLToPath(new URL("home-mobile.png", artifacts)),
        fullPage: true,
      });
      await phone.locator("#mode-solo").click();
      await phone.locator("#play-button").click();
      await phone.locator("#game:not([hidden])").waitFor();
      assert.equal(await phone.locator("#dash-button").isVisible(), true);
      await phone.screenshot({
        path: fileURLToPath(new URL("gameplay-mobile.png", artifacts)),
      });
      await mobile.close();
    },
  );
  assert.deepEqual(errors, [], "no uncaught browser errors");
  await writeFile(
    new URL("browser-results.json", artifacts),
    JSON.stringify({ passed: true, checks: 6, errors }, null, 2),
  );
  console.log("PASS browser smoke suite: 6 checks, no uncaught errors");
} catch (error) {
  await page
    .screenshot({
      path: fileURLToPath(new URL("browser-failure.png", artifacts)),
      fullPage: true,
    })
    .catch(() => {});
  console.error(error);
  process.exitCode = 1;
} finally {
  await browser.close();
}
