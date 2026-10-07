// UI contract fixtures only. Real DB/MFA/authorization are tested by the backend.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir, writeFile,readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createFrontend } from "./serve.js";
import http from 'node:http';
const configuration=JSON.parse(await readFile(new URL('../tests/fixtures/public-configuration.json',import.meta.url),'utf8'));
const fixtureBackend=http.createServer((req,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify(req.url==='/api/configuration'?configuration:{version:1,site:{title:'Admin UI fixture',pages:[],faq:[]}}));});
await new Promise(resolve=>fixtureBackend.listen(0,'127.0.0.1',resolve));
const app = createFrontend({
  port: 0,
  backend:`http://127.0.0.1:${fixtureBackend.address().port}`,
  directory: fileURLToPath(new URL("../public", import.meta.url)),
});
const base = `http://127.0.0.1:${(await app.listen()).port}`;
const browser = await chromium.launch({ channel: "chrome", headless: true }),
  page = await browser.newPage(),
  errors = [],
  commands = [];
let elevated = false,
  failCurrency = true;
await page.route('**/api/configuration',route=>route.fulfill({json:configuration}));
page.on("pageerror", (e) => errors.push(e.message));
const player = {
  id: "00000000-0000-4000-8000-000000000001",
  username: "operator_test",
  display_name: "Người kiểm thử",
  gold: "10",
  dna: "3",
  evolution_points: "2",
};
await page.route("**/admin/**", async (route) => {
  const request = route.request(),
    path = new URL(request.url()).pathname.slice(7);
  let data = {};
  if (request.method() !== "GET") {
    const body = request.postDataJSON();
    commands.push({ path, body });
    if (path === "mfa/enroll") data = { secret: "TEST-ONLY-NOT-A-REAL-SECRET" };
    else if (path === "mfa/verify") {
      elevated = true;
      data = { ok: true };
    } else if (path.endsWith("/currency") && failCurrency) {
      failCurrency = false;
      await route.fulfill({ status: 503, json: { error: "Retry fixture" } });
      return;
    } else data = { duplicate: false, data: {} };
  } else if (path === "access")
    data = {
      roles: ["CUSTOM_OPERATOR"],
      environment: "LOCAL",
      elevated,
      mfaEnrolled: false,
    };
  else if (path === "players") data = { rows: [player] };
  else if (path.startsWith("players/")) data = { player };
  else if (path === "definitions")
    data = {
      inventory: [{ id: "artifact", name: "Di vật" }],
      snakes: [{ id: "cobra", name: "Cobra" }],
      roles: [{ code: "CUSTOM_OPERATOR", name: "Vai trò từ API" }],
      permissions: [{ code: "custom:read", description: "Quyền từ API" }],
      caps: { level: 77 },
      moderation:configuration.moderation,
    };
  else if (path === "roles")
    data = {
      roles: [{ code: "CUSTOM_OPERATOR", name: "Vai trò từ API" }],
      permissions: [{ code: "custom:read" }],
      mappings: [
        { role_code: "CUSTOM_OPERATOR", permission_code: "custom:read" },
      ],
    };
  else if (path === "settings")
    data = {
      settings: { maintenance: false, features: { raid: false, crown: true } },
    };
  else if (path === "reports")
    data = {
      rows: [
        {
          id: "00000000-0000-4000-8000-000000000002",
          target_name: "Người bị báo cáo",
          reason: "Kiểm tra báo cáo",
          status: "open",
        },
      ],
    };
  else throw new Error("Unexpected fixture route: " + path);
  await route.fulfill({ json: data });
});
const last = () => commands.at(-1);
const submit = async (selector) => {
  const count = commands.length;
  await page.locator(selector + " button").click();
  await page.waitForFunction(() => !document.querySelector("button:disabled"));
  assert.ok(commands.length > count);
};
try {
  await page.goto(base + "/admin.html");
  await page.locator("#mfa-form").waitFor();
  assert.equal(await page.locator("#admin-tabs").isVisible(), false);
  await page.locator('[data-action="enroll"]').click();
  await page.locator("#mfa-enrollment code").waitFor();
  await page.locator("#mfa-form input").fill("123456");
  await page.locator("#mfa-form button").click();
  await page.locator('[data-action="player:' + player.id + '"]').click();
  await page.locator("#inventory-form").waitFor();
  assert.equal(
    await page.locator("#progression-form input").getAttribute("max"),
    "77",
  );
  assert.equal(
    await page.locator("#grant-role-form select[name=role]").inputValue(),
    "CUSTOM_OPERATOR",
  );
  assert.ok(
    (await page.locator("#admin-content").innerText()).includes(
      "HẾT HẠN VAI TRÒ",
    ),
  );
  await page.locator("#currency-form input").fill("12");
  await page.locator("#currency-form button").click();
  await page.waitForFunction(() =>
    document.querySelector("#admin-message").textContent.includes("Nhập lý do"),
  );
  assert.equal(commands.length, 2);
  await page.locator("#operation-reason").fill("Kiểm thử giao diện quản trị");
  await submit("#currency-form");
  const retry = last();
  await submit("#currency-form");
  assert.equal(last().body.requestId, retry.body.requestId);
  assert.equal(last().body.amount, 12);
  await page.locator('[data-action="tab:roles"]').click();
  await page.locator("#role-create-form").waitFor();
  assert.equal(
    await page.locator("#role-map-form textarea").inputValue(),
    "custom:read",
  );
  await page.locator("#operation-reason").fill("Tạo vai trò kiểm thử");
  await page.locator("#role-create-form [name=code]").fill("EVENT_HELPER");
  await page.locator("#role-create-form [name=name]").fill("Hỗ trợ sự kiện");
  await page.locator("#role-create-form [name=priority]").fill("2");
  await submit("#role-create-form");
  assert.equal(last().path, "roles");
  await page.locator('[data-action="tab:settings"]').click();
  await page.locator("#settings-form select").selectOption("features");
  assert.deepEqual(
    JSON.parse(await page.locator("#settings-form textarea").inputValue()),
    { raid: false, crown: true },
  );
  await page.locator('[data-action="tab:reports"]').click();
  await page.locator(".report-resolve-form").waitFor();
  assert.match(
    await page.locator("#admin-content h2").innerText(),
    /Báo cáo người chơi/,
  );
  await page.locator("#operation-reason").fill("Xử lý báo cáo kiểm thử");
  await page.locator('.report-resolve-form [name=status]').selectOption('resolved');
  await page.locator('.report-resolve-form [name=resolution]').fill('Đã xem xét thông tin của báo cáo.');
  await submit(".report-resolve-form");
  assert.equal(last().body.status, "resolved");
  assert.match(last().body.requestId, /^[a-f0-9-]{36}$/);
  await mkdir("artifacts", { recursive: true });
  await page.screenshot({ path: "artifacts/admin-reports.png" });
  // Account UI receives only public profile/history endpoints.
  await page.route("**/account-fixture.html", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<meta charset="utf-8"><button data-account="profile">Profile</button><main id="modal"></main><output id="toast"></output><script type="module">import {createAccountUI} from "/account.js";createAccountUI({openModal:(_,html)=>document.querySelector("#modal").innerHTML=html,escapeHtml:s=>String(s),toast:s=>document.querySelector("#toast").textContent=s,onChange:()=>{window.loaded=true;}});</script>',
    }),
  );
  await page.route("**/api/account/**", async (route) => {
    const p = new URL(route.request().url()).pathname.split("/").at(-1);
    const profile = {
      ...player,
      lives: 1,
      progression_level: 7,
      seasonProgress: [{ season_id: "test-season", level: 3, xp: 2000 }],
      catalog: [],
      mastery: [],
      snakes: [],
      meta: [],
      achievements: [],
    };
    if (p === "reports") {
      commands.push({ path: p, body: route.request().postDataJSON() });
      await route.fulfill({ json: { ok: true } });
    } else if(p==='security')await route.fulfill({json:{version:1,restrictions:[],notifications:[],reports:[],appeals:[]}});
    else
      await route.fulfill({
        json:
          p === "me"
            ? { profile }
            : {
                rows: [
                  {
                    snake_id: "cobra",
                    score: 50,
                    duration_seconds: 10,
                    kills: 1,
                    pvp_kills: 0,
                    earned_gold: 4,
                    earned_dna: 18,
                    mode: "extraction",
                    reason: "extracted",
                    upgrades: [],
                    traits: [],
                    content_version: "fixture-v2",
                  },
                ],
              },
      });
  });
  await page.goto(base + "/account-fixture.html");
  await page.waitForFunction(() => window.loaded);
  await page.locator('[data-account="profile"]').click();
  await page.locator("#modal h2").waitFor();
  assert.match(await page.locator("#modal").innerText(), /Cấp 7/);
  assert.match(await page.locator("#modal").innerText(), /test-season · cấp 3/);
  await page.locator('[data-account="history"]').click();
  await page.waitForFunction(() =>
    document.querySelector("#modal").textContent.includes("Rút lui thành công"),
  );
  assert.match(await page.locator("#modal").innerText(), /18 DNA/);
  await page.locator('#modal [data-account="profile"]').click();
  await page.locator('[data-account="report"]').click();
  await page.locator("#player-report-form [name=username]").fill("target");
  await page
    .locator("#player-report-form [name=reason]")
    .fill("Lý do báo cáo kiểm thử");
  await page.locator("#player-report-form button").click();
  await page.waitForFunction(() =>
    document.querySelector("#toast").textContent.includes("Đã gửi báo cáo"),
  );
  assert.equal(last().path, "reports");
  assert.deepEqual(errors, []);
  await writeFile(
    "artifacts/admin-ui-results.json",
    JSON.stringify(
      {
        passed: 10,
        scope:
          "Frontend UI with isolated HTTP contract fixtures; no real admin account or DB changes",
        errors,
      },
      null,
      2,
    ),
  );
  console.log("Admin/account UI: 10 checks passed with isolated API fixtures.");
} finally {
  await browser.close();
  await app.close();
  await new Promise(resolve=>fixtureBackend.close(resolve));
}
