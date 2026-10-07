import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
const base = process.env.V2_TEST_URL || "http://127.0.0.1:5173";
await mkdir("artifacts", { recursive: true });
const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } }),
  errors = [];
page.on("pageerror", (e) => errors.push(e.stack || e.message));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
try {
  await page.route("**/app.js", async (route) => {
    const r = await route.fetch();
    await route.fulfill({
      response: r,
      body:
        (await r.text()) +
        "\nwindow.__v2test=()=>({world,ownId,view,connected,mode:gameMode,net,rendererType:renderer.game?.renderer?.type,pixels:renderer.canvas.width,width:renderer.width,resolution:renderer.resolution,interact:world?getInput(.05).interact:false});window.__v2drop=()=>socket.room.connection.transport.ws.close();",
    });
  });
  await page.goto(base);
  await page.waitForFunction(() => Boolean(window.__v2test));
  assert.equal(await page.locator("#mode-raid").count(), 1);
  assert.equal(await page.locator("#mode-extraction").count(), 1);
  await page.screenshot({ path: "artifacts/v2-home.png", fullPage: true });
  await page.locator("#play-button").click();
  await page.waitForFunction(() => window.__v2test().view === "playing", {
    timeout: 15000,
  });
  await page.waitForFunction(() => window.__v2test().world?.time > 1, {
    timeout: 10000,
  });
  const first = await page.evaluate(() => window.__v2test());
  assert.equal(first.mode, "arena");
  assert.ok(first.world.director);
  assert.equal(first.net.protocol, 3);
  assert.ok(first.rendererType);
  await page.keyboard.press("KeyB");
  await page.waitForSelector('[data-v2-kind="curses"]');
  assert.ok((await page.locator('[data-v2-kind="organs"]').count()) >= 2);
  await page.locator("#modal-close").click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: "artifacts/v2-arena.png" });
  assert.equal((await page.evaluate(() => window.__v2test())).connected, true);
  await page.reload();
  await page.waitForFunction(() => window.__v2test?.().view === "playing", {
    timeout: 15000,
  });
  assert.equal(
    (await page.evaluate(() => window.__v2test())).ownId,
    first.ownId,
  );
  await page.waitForFunction(() => window.__v2test().world.time > 6);
  await page.evaluate(() => window.__v2drop());
  await page.waitForFunction(() => !window.__v2test().connected);
  await page.waitForFunction(() => window.__v2test().connected, null, {
    timeout: 15000,
  });
  assert.equal(
    (await page.evaluate(() => window.__v2test())).ownId,
    first.ownId,
  );
  const leave = async () => {
    await page.locator("#pause-button").click();
    await page.locator('[data-action="leave-game"]').click();
    await page.waitForFunction(() => window.__v2test().view === "home");
  };
  await leave();
  for (const mode of ["crown", "raid", "extraction"]) {
    await page.locator("#mode-" + mode).click();
    await page.locator("#play-button").click();
    if (mode === "raid") {
      await page.locator('[data-action="ready"]').click();
    }
    await page.waitForFunction(
      (m) =>
        window.__v2test().view === "playing" &&
        window.__v2test().world?.mode === m,
      mode,
      { timeout: 15000 },
    );
    await page.waitForFunction(() => window.__v2test().world?.time > 1);
    const state = await page.evaluate(() => window.__v2test());
    assert.ok(state.world.director.biomes.every((b) => b.modifier));
    assert.equal(state.pixels, Math.round(state.width * state.resolution));
    if (mode === "extraction") {
      await page.setViewportSize({ width: 390, height: 844 });
      const b = page.locator("#interact-button");
      await b.waitFor({ state: "visible" });
      const box = await b.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      assert.equal(
        (await page.evaluate(() => window.__v2test())).interact,
        true,
      );
      await page.mouse.up();
      assert.equal(
        (await page.evaluate(() => window.__v2test())).interact,
        false,
      );
      await page.screenshot({ path: "artifacts/v2-extraction-mobile.png" });
      await page.setViewportSize({ width: 1440, height: 960 });
    }
    await leave();
  }
  assert.deepEqual(errors, []);
  const denied = page.waitForResponse((r) => r.url().endsWith("/admin/access"));
  await page.goto(base + "/admin.html");
  assert.equal((await denied).status(), 401);
  await page.waitForFunction(
    () => document.querySelector("#admin-message").textContent.length > 0,
  );
  assert.match(
    await page.locator("#admin-message").textContent(),
    /đăng nhập/i,
  );
  assert.ok(
    errors.every(
      (e) =>
        e ===
        "Failed to load resource: the server responded with a status of 401 (Unauthorized)",
    ),
  );
  await writeFile(
    "artifacts/v2-browser-results.json",
    JSON.stringify(
      {
        passed: 13,
        unexpectedErrors: [],
        expectedAdminStatus: 401,
        checks: [
          "catalog",
          "mode menu",
          "Phaser",
          "protocol 3",
          "evolution UI",
          "reload identity",
          "transport reconnect",
          "Crown",
          "Raid",
          "Extraction",
          "resolution",
          "mobile extraction control",
          "admin protection",
        ],
      },
      null,
      2,
    ),
  );
  console.log(
    "V2 browser: 13 checks passed, including all new modes, transport reconnect, resolution and mobile extraction.",
  );
} catch (error) {
  console.error("Browser errors:", errors);
  await page.screenshot({ path: "artifacts/v2-failure.png" }).catch(() => {});
  throw error;
} finally {
  await browser.close();
}
