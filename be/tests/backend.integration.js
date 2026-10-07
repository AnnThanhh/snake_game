import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { createBackend } from "../backend/index.js";
import { CONTENT_VERSION } from "../game/version.js";
import { digest } from "../backend/store.js";
import { setTimeout as delay } from "node:timers/promises";

test("Docker PostgreSQL and Redis account/progression lifecycle", async (t) => {
  const schema = `test_${randomBytes(8).toString("hex")}`;
  const namespace = schema;
  const admin = new Pool({ connectionString: process.env.DATABASE_URL });
  await admin.query(`CREATE SCHEMA ${schema}`);
  let app,
    base,
    cookie = "";
  const secret = randomBytes(32).toString("hex");
  async function start() {
    app = await createBackend({ port: 0, schema, namespace, secret });
    const addr = await app.listen();
    base = `http://127.0.0.1:${addr.port}`;
  }
  async function api(path, body, options = {}) {
    const response = await fetch(base + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
        ...options.headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (response.headers.get("set-cookie"))
      cookie = response.headers.get("set-cookie").split(";")[0];
    return { status: response.status, data: await response.json() };
  }
  let id, result;
  try {
    await start();
    await t.test(
      "both live services connect; registration hashes password and persists identity",
      async () => {
        assert.equal((await api("/health")).data.database, "postgresql");
        const r = await api("/api/account/register", {
          username: "docker_test",
          password: "Strong local test 123",
          displayName: "Docker Tester",
        });
        assert.equal(r.status, 201);
        id = r.data.profile.id;
        assert.deepEqual(r.data.profile.snakes, ["cobra"]);
        const row = (
          await app.store.query("SELECT password_hash FROM users WHERE id=$1", [
            id,
          ])
        ).rows[0];
        assert.ok(!row.password_hash.includes("Strong local"));
        assert.equal(
          (
            await api("/api/account/login", {
              username: "docker_test",
              password: "wrong",
            })
          ).status,
          401,
        );
      },
    );
    await t.test(
      "Redis tickets expire and are consumed atomically exactly once",
      async () => {
        const ticket = (await api("/api/account/ticket", { species: "cobra" }))
          .data.ticket;
        const headers = { "x-game-secret": secret };
        assert.equal(
          (await api("/internal/tickets/consume", { ticket }, { headers })).data
            .accountId,
          id,
        );
        assert.equal(
          (await api("/internal/tickets/consume", { ticket }, { headers }))
            .status,
          401,
        );
        assert.equal(
          (await api("/api/account/ticket", { species: "viper" })).status,
          403,
        );
        const expiring = (
          await api("/api/account/ticket", { species: "cobra" })
        ).data.ticket;
        const key = app.store.key(`ticket:${digest(expiring)}`);
        assert.ok((await app.store.redis.ttl(key)) <= 30);
        await app.store.redis.pExpire(key, 5);
        await delay(30);
        assert.equal(
          (
            await api(
              "/internal/tickets/consume",
              { ticket: expiring },
              { headers },
            )
          ).status,
          401,
        );
      },
    );
    await t.test(
      "public result forgery is rejected; trusted result awards wallet/mastery/history once",
      async () => {
        result = {
          lifeId: randomUUID(),
          matchId: randomUUID(),
          accountId: id,
          mode: "arena",
          bot: false,
          contentVersion: CONTENT_VERSION.id,
          species: "cobra",
          reason: "death",
          duration: 90,
          score: 750,
          kills: 5,
          pvpKills: 1,
          level: 3,
          maxLength: 12,
          damage: 500,
          bossDamage: 20,
          xp: 50,
          startedAt: new Date().toISOString(),
          build: [{ id: "fire", rarity: "EPIC" }],
          segments: ["fire", "poison"],
          traits: ["toxic_ignition"],
        };
        assert.equal((await api("/internal/results", result)).status, 403);
        const headers = { "x-game-secret": secret };
        const r = await api("/internal/results", result, { headers });
        assert.equal(r.status, 200);
        assert.equal(r.data.gold, 36);
        const duplicates = await Promise.all(
          Array.from({ length: 5 }, () =>
            api("/internal/results", result, { headers }),
          ),
        );
        assert.ok(
          duplicates.every((r) => r.status === 200 && r.data.duplicate),
        );
        const profile = (await api("/api/account/me")).data.profile;
        assert.equal(Number(profile.gold), 36);
        assert.equal(profile.lives, 1);
        assert.equal(profile.achievements.length, 3);
        assert.equal((await api("/api/account/history")).data.rows.length, 1);
        assert.equal(
          (await api("/api/account/leaderboard")).data.rows.length,
          1,
        );
        assert.equal(
          (
            await api(
              "/internal/results",
              { ...result, score: 751 },
              { headers },
            )
          ).status,
          409,
        );
      },
    );
    await t.test(
      "invalid bot result and unaffordable purchases do not mutate wallet",
      async () => {
        const invalid = await api(
          "/internal/results",
          { ...result, lifeId: randomUUID(), bot: true },
          { headers: { "x-game-secret": secret } },
        );
        assert.equal(invalid.status, 400);
        assert.equal(
          (await api("/api/account/unlock", { species: "python" })).status,
          409,
        );
        assert.equal(
          Number((await api("/api/account/me")).data.profile.gold),
          36,
        );
        assert.equal(
          (
            await api(
              "/api/account/unlock",
              { species: "cobra" },
              { headers: { Origin: "https://unrelated.invalid" } },
            )
          ).status,
          403,
        );
      },
    );
    await t.test(
      "accounts and results survive backend close/reopen against Docker volumes",
      async () => {
        await app.store.query("UPDATE authorization_policy SET value=jsonb_set(value,'{gold}','123456') WHERE key='caps'");
        await app.store.query("UPDATE snake_definitions SET name='Tên do người vận hành sửa' WHERE id='cobra'");
        await app.store.query("DELETE FROM role_permissions WHERE role_code='USER' AND permission_code='shop:read'");
        const versions=(await app.store.query('SELECT id FROM game_catalogs ORDER BY id')).rows;
        await app.close();
        app = null;
        await start();
        assert.equal((await app.store.query("SELECT value->>'gold' AS gold FROM authorization_policy WHERE key='caps'")).rows[0].gold,'123456');
        assert.equal((await app.store.query("SELECT name FROM snake_definitions WHERE id='cobra'")).rows[0].name,'Tên do người vận hành sửa');
        assert.equal((await app.store.query("SELECT 1 FROM role_permissions WHERE role_code='USER' AND permission_code='shop:read'")).rowCount,0);
        assert.deepEqual((await app.store.query('SELECT id FROM game_catalogs ORDER BY id')).rows,versions,'restart must not publish or overwrite catalog versions');
        assert.equal((await api("/api/account/me")).data.profile.id, id);
        assert.equal(
          Number((await api("/api/account/me")).data.profile.gold),
          36,
        );
        await api("/api/account/logout", {});
        assert.equal((await api("/api/account/me")).data.profile, null);
        assert.equal(
          (
            await api("/api/account/login", {
              username: "docker_test",
              password: "Strong local test 123",
            })
          ).status,
          200,
        );
        assert.equal((await api("/api/account/history")).data.rows.length, 1);
      },
    );
    await t.test(
      "concurrent unlocks charge once and stale meta purchases cannot advance twice",
      async () => {
        const headers = { "x-game-secret": secret };
        const reward = {
          ...result,
          lifeId: randomUUID(),
          kills: 300,
          score: 900,
        };
        assert.equal(
          (await api("/internal/results", reward, { headers })).status,
          200,
        );
        const before = Number((await api("/api/account/me")).data.profile.gold);
        const unlocks = await Promise.all([
          api("/api/account/unlock", { species: "python" }),
          api("/api/account/unlock", { species: "python" }),
        ]);
        assert.ok(unlocks.every((r) => r.status === 200));
        assert.equal(
          Number((await api("/api/account/me")).data.profile.gold),
          before - 200,
        );
        const buys = await Promise.all([
          api("/api/account/meta", {
            upgrade: "field_notes",
            expectedLevel: 0,
          }),
          api("/api/account/meta", {
            upgrade: "field_notes",
            expectedLevel: 0,
          }),
        ]);
        assert.deepEqual(buys.map((r) => r.status).sort(), [200, 409]);
        const next = (await api("/api/account/me")).data.profile;
        assert.equal(Number(next.gold), before - 300);
        assert.equal(next.meta[0].level, 1);
        assert.ok(next.snakes.includes("python"));
        assert.equal(
          (await api("/api/account/ticket", { species: "python" })).status,
          200,
        );
      },
    );
  } finally {
    if (app) {
      for await (const keys of app.store.redis.scanIterator({
        MATCH: `${namespace}:*`,
        COUNT: 100,
      }))
        if (keys.length) await app.store.redis.del(keys);
      await app.close();
    }
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
});
