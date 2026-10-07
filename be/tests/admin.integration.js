import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { createBackend } from "../backend/index.js";
import { totp } from "../backend/mfa.js";

test("Database authorization, MFA, configuration and audit", async (t) => {
  const schema = "test_" + randomBytes(8).toString("hex"),
    db = new Pool({ connectionString: process.env.DATABASE_URL });
  await db.query(`CREATE SCHEMA ${schema}`);
  let app;
  try {
    app = await createBackend({
      port: 0,
      schema,
      namespace: schema,
      secret: randomBytes(32).toString("hex"),
    });
    const addr = await app.listen(),
      base = `http://127.0.0.1:${addr.port}`;
    const client = () => ({
      cookie: "",
      async api(path, body, method) {
        const r = await fetch(base + path, {
          method: method || (body === undefined ? "GET" : "POST"),
          headers: { "content-type": "application/json", cookie: this.cookie },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        if (r.headers.get("set-cookie"))
          this.cookie = r.headers.get("set-cookie").split(";")[0];
        return { status: r.status, data: await r.json() };
      },
    });
    const users = {};
    for (const role of ["root", "admin", "mod", "player"]) {
      const c = client();
      const r = await c.api("/api/account/register", {
        username: "test_" + role,
        password: "Strong local test 123",
        displayName: role,
      });
      assert.equal(r.status, 201);
      c.id = r.data.profile.id;
      users[role] = c;
    }
    const { root, admin, mod, player } = users;
    const command = (values) => ({
      requestId: randomUUID(),
      reason: "Integration test operation",
      ...values,
    });
    await t.test("USER cannot enter admin or grant currency", async () => {
      assert.equal((await player.api("/admin/access")).status, 403);
      assert.equal(
        (
          await player.api(
            `/admin/players/${player.id}/currency`,
            command({ currency: "gold", amount: 10 }),
          )
        ).status,
        403,
      );
    });
    for (const [name, role] of [
      ["root", "SUPER_ADMIN"],
      ["admin", "ADMIN"],
      ["mod", "MODERATOR"],
    ]) {
      const c = users[name];
      await app.store.query(
        "INSERT INTO user_roles(user_id,role_code) VALUES ($1,$2)",
        [c.id, role],
      );
      assert.equal((await c.api("/admin/access")).status, 403);
      await app.store.query(
        "INSERT INTO whitelist_entries(id,user_id,type,environment,reason) VALUES ($1,$2,'ADMIN_PANEL','LOCAL','Integration fixture')",
        [randomUUID(), c.id],
      );
      assert.equal((await c.api("/admin/players")).status, 401);
      const setup = await c.api("/admin/mfa/enroll", {});
      assert.equal(setup.status, 200);
      c.mfaSecret = setup.data.secret;
      const encrypted = (
        await app.store.query(
          "SELECT encrypted_secret FROM admin_mfa WHERE user_id=$1",
          [c.id],
        )
      ).rows[0].encrypted_secret;
      assert.notEqual(encrypted, c.mfaSecret);
      c.code = totp(c.mfaSecret, Math.floor(Date.now() / 30000));
      assert.equal(
        (await c.api("/admin/mfa/verify", { code: c.code })).status,
        200,
      );
    }
    await t.test(
      "MFA rejects replay, privileges follow DB permissions and priority",
      async () => {
        assert.equal(
          (await admin.api("/admin/mfa/verify", { code: admin.code })).status,
          401,
        );
        assert.equal(
          (
            await admin.api(
              `/admin/players/${admin.id}/roles`,
              command({ role: "SUPER_ADMIN" }),
            )
          ).status,
          403,
        );
        assert.equal(
          (
            await mod.api(
              `/admin/players/${root.id}/ban`,
              command({
                temporary: true,
                expiresAt: new Date(Date.now() + 3600000).toISOString(),
              }),
            )
          ).status,
          403,
        );
        assert.equal(
          (
            await root.api(
              `/admin/players/${root.id}/roles`,
              command({ role: "SUPER_ADMIN", revoke: true }),
            )
          ).status,
          409,
        );
      },
    );
    await t.test('player reports are idempotent; moderator resolution is authorized and audited',async()=>{
      const body={requestId:randomUUID(),username:'test_admin',reason:'Suspicious conduct reported by test player'};
      assert.equal((await player.api('/api/account/reports',body)).status,200);
      assert.equal((await player.api('/api/account/reports',body)).data.duplicate,true);
      assert.equal((await player.api('/api/account/reports',{...body,reason:'Different reported conduct'})).status,409);
      const report=(await mod.api('/admin/reports')).data.rows.find(r=>r.id===body.requestId);assert.equal(report.target_id,admin.id);
      assert.equal((await player.api('/admin/reports')).status,403);
      const resolve=command({status:'resolved'});assert.equal((await mod.api('/admin/reports/'+report.id,resolve)).status,200);
      assert.equal((await app.store.query('SELECT status FROM player_reports WHERE id=$1',[report.id])).rows[0].status,'resolved');
      assert.equal((await app.store.query('SELECT count(*) FROM admin_audit_logs WHERE request_id=$1',[resolve.requestId])).rows[0].count,'1');
    });
    await t.test('report quotas, ban disclosure, restricted sessions, appeals and own notifications',async()=>{
      const report={requestId:randomUUID(),username:'test_admin',category:'cheating',reason:'Unusual movement in a verified match'};
      assert.equal((await player.api('/api/account/reports',{...report,evidenceUrl:'javascript:alert(1)'})).status,400);
      assert.equal((await player.api('/api/account/reports',report)).status,429);
      assert.equal((await player.api('/internal/security/events',{})).status,403);
      const operation=command({scope:'ACCOUNT',temporary:true,expiresAt:new Date(Date.now()+3600000).toISOString(),publicReason:'Repeated verified rule violations',reason:'Private moderator evidence, never disclose'});
      assert.equal((await mod.api('/admin/players/'+player.id+'/ban',operation)).status,200);
      assert.equal((await mod.api('/admin/players/'+player.id+'/ban',operation)).data.duplicate,true);
      const stranger=client();assert.equal((await stranger.api('/api/account/login',{username:'test_player',password:'wrong'})).status,401);assert.equal(stranger.cookie,'');
      const login=await player.api('/api/account/login',{username:'test_player',password:'Strong local test 123'});assert.equal(login.status,403);assert.equal(login.data.code,'ACCOUNT_BANNED');assert.equal(login.data.restriction.reason,operation.publicReason);assert.ok(!JSON.stringify(login.data).includes('Private moderator'));
      assert.equal((await player.api('/api/account/me')).data.restricted,true);assert.equal((await player.api('/api/account/ticket',{species:'cobra',mode:'arena'})).status,403);assert.equal((await player.api('/api/account/history')).status,403);assert.equal((await player.api('/admin/access')).status,403);
      const appeal={requestId:randomUUID(),actionId:login.data.restriction.id,reason:'Please review this decision with the match evidence'};
      assert.equal((await stranger.api('/api/account/appeals',appeal)).status,401);assert.equal((await admin.api('/api/account/appeals',{...appeal,requestId:randomUUID()})).status,404);
      assert.equal((await player.api('/api/account/appeals',appeal)).status,200);assert.equal((await player.api('/api/account/appeals',appeal)).data.duplicate,true);assert.equal((await player.api('/api/account/appeals',{...appeal,reason:'A different reason with same request'})).status,409);
      const state=(await player.api('/api/account/security')).data,notice=state.notifications.find(n=>n.kind==='RESTRICTION');assert.ok(notice);assert.equal(state.notifications.filter(n=>n.kind==='RESTRICTION').length,1);
      assert.equal((await admin.api('/api/account/notifications/'+notice.id+'/read',{})).status,404);assert.equal((await player.api('/api/account/notifications/'+notice.id+'/read',{})).status,200);
      const review=command({status:'resolved',resolution:'Reviewed. Access restriction remains active.'});assert.equal((await mod.api('/admin/appeals/'+appeal.requestId,review)).status,200);
      assert.equal((await player.api('/api/account/security')).data.restrictions.length,1);
      assert.equal((await root.api('/admin/players/'+player.id+'/unban',command({}))).status,200);
      assert.equal((await player.api('/api/account/security')).status,401);
      assert.equal((await player.api('/api/account/login',{username:'test_player',password:'Strong local test 123'})).status,200);
      assert.equal((await player.api('/api/account/security')).data.restrictions.length,0);
    });
    await t.test('public SEO reads DB; publishing requires authorization and preserves audit/idempotency',async()=>{
      const initial=await player.api('/api/site');assert.equal(initial.status,200);assert.equal(initial.data.site.indexable,false);
      const site={...initial.data.site,origin:'https://game.example',indexable:true,title:'Updated public game title'};
      assert.equal((await player.api('/admin/settings',command({key:'site',value:site}))).status,403);
      assert.equal((await root.api('/admin/settings',command({key:'site',value:{...site,origin:''}}))).status,400);
      assert.equal((await root.api('/admin/settings',command({key:'site',value:{...site,origin:'http://game.example'}}))).status,400);
      const operation=command({key:'site',value:site});assert.equal((await root.api('/admin/settings',operation)).status,200);
      assert.equal((await root.api('/admin/settings',operation)).data.duplicate,true);
      assert.equal((await player.api('/api/site')).data.site.title,site.title);
      assert.equal((await app.store.query('SELECT count(*) FROM admin_audit_logs WHERE request_id=$1',[operation.requestId])).rows[0].count,'1');
      assert.equal(Object.hasOwn((await player.api('/api/site')).data,'settings'),false);
    });
    await t.test('catalog publishing retains prior version and rejects broken progression or seasons',async()=>{
      const prior=(await root.api('/admin/catalog')).data.catalog;
      const c=structuredClone(prior);c.id+='-test';c.balance.speed+=3;
      assert.equal((await root.api('/admin/catalog',command({catalog:{...c,progression:{...c.progression,levelXp:0}}}))).status,400);
      assert.equal((await root.api('/admin/catalog',command({catalog:{...c,season:{...c.season,endsAt:'invalid'}}}))).status,400);
      assert.equal((await root.api('/admin/catalog',command({catalog:{...c,adaptiveGraphics:{...c.adaptiveGraphics,lowFps:100,highFps:50}}}))).status,400);
      const invalid=structuredClone(c);invalid.bots.evolutionPreferences.farmer=[{kind:'organs',choice:'missing'}];
      assert.equal((await root.api('/admin/catalog',command({catalog:invalid}))).status,400);
      const response=await root.api('/admin/catalog',command({catalog:c}));assert.equal(response.status,200,JSON.stringify(response.data));
      assert.equal((await player.api('/api/account/catalog')).data.catalog.balance.speed,c.balance.speed);
      assert.equal((await player.api('/api/account/catalog?version='+prior.id)).data.catalog.balance.speed,prior.balance.speed);
    });
    await t.test(
      "cap changes take effect from DB without restart; currency and audit are idempotent",
      async () => {
        await app.store.query(
          "UPDATE authorization_policy SET value=jsonb_set(value,'{gold}','120') WHERE key='caps'",
        );
        const body = command({ currency: "gold", amount: 100 }),
          path = `/admin/players/${player.id}/currency`;
        assert.equal((await admin.api(path, body)).status, 200);
        const retry = await admin.api(path, body);
        assert.equal(retry.status, 200);
        assert.equal(retry.data.duplicate, true);
        assert.equal(
          (await admin.api(path, { ...body, amount: 99 })).status,
          409,
        );
        assert.equal(
          (await admin.api(path, command({ currency: "gold", amount: 30 })))
            .status,
          409,
        );
        assert.equal(Number((await app.store.profile(player.id)).gold), 100);
        assert.equal(
          Number(
            (
              await app.store.query(
                "SELECT count(*) FROM admin_audit_logs WHERE request_id=$1",
                [body.requestId],
              )
            ).rows[0].count,
          ),
          1,
        );
      },
    );
    await t.test(
      "new DB permission and deny override work without a code release",
      async () => {
        const endpoints=(await app.store.query("SELECT value FROM authorization_policy WHERE key='endpoints'")).rows[0].value;
        await app.store.query("UPDATE authorization_policy SET value=value-'player:report:read' WHERE key='endpoints'");
        assert.equal((await root.api('/admin/reports')).status,403,'even wildcard permissions require an endpoint mapping from DB');
        await app.store.query("UPDATE authorization_policy SET value=$1 WHERE key='endpoints'",[JSON.stringify(endpoints)]);
        assert.equal(
          (
            await root.api(
              "/admin/permissions",
              command({
                code: "event:season:preview",
                description: "Season preview",
              }),
            )
          ).status,
          200,
        );
        await app.store.query(
          "INSERT INTO user_permission_overrides VALUES ($1,'player:currency:grant','DENY',NULL,'Deny test')",
          [admin.id],
        );
        assert.equal(
          (
            await admin.api(
              `/admin/players/${player.id}/currency`,
              command({ currency: "gold", amount: 1 }),
            )
          ).status,
          403,
        );
        await app.store.query(
          "DELETE FROM user_permission_overrides WHERE user_id=$1",
          [admin.id],
        );
        assert.equal(
          (
            await admin.api(
              `/admin/players/${player.id}/currency`,
              command({ currency: "gold", amount: 1 }),
            )
          ).status,
          200,
        );
      },
    );
    await t.test(
      "maintenance and scoped whitelist deny guests and reject wrong environment",
      async () => {
        await app.store.query(
          "UPDATE system_settings SET value='true' WHERE key='maintenance'",
        );
        await assert.rejects(
          () => app.authz.admission(null, "arena"),
          (e) => e.status === 403,
        );
        await app.store.query(
          "INSERT INTO whitelist_entries(id,user_id,type,scope,value,environment,reason) VALUES ($1,$2,'MAINTENANCE_BYPASS','GLOBAL','','STAGING','Wrong environment')",
          [randomUUID(), player.id],
        );
        await assert.rejects(
          () => app.authz.admission(player.id, "arena"),
          (e) => e.status === 403,
        );
        await app.store.query(
          "UPDATE whitelist_entries SET environment='LOCAL' WHERE user_id=$1",
          [player.id],
        );
        assert.equal(
          (await app.authz.admission(player.id, "arena")).allowed,
          true,
        );
        await app.store.query(
          "UPDATE whitelist_entries SET starts_at=now()-interval '2 days',expires_at=now()-interval '1 day' WHERE user_id=$1",
          [player.id],
        );
        await assert.rejects(() => app.authz.admission(player.id, "arena"));
        await app.store.query(
          "UPDATE system_settings SET value='false' WHERE key='maintenance'",
        );
      },
    );
    await t.test(
      "audit is append-only and contains no MFA secret; catalog is read from DB",
      async () => {
        const rows = (await app.store.query("SELECT * FROM admin_audit_logs"))
          .rows;
        for (const c of Object.values(users))
          if (c.mfaSecret)
            assert.ok(!JSON.stringify(rows).includes(c.mfaSecret));
        await assert.rejects(
          () => app.store.query("UPDATE admin_audit_logs SET reason='tamper'"),
          /append-only/,
        );
        const c = await player.api("/api/account/catalog");
        assert.equal(c.status, 200);
        assert.ok(c.data.catalog.modes.some((m) => m.id === "raid"));
        await app.store.query(
          "UPDATE game_catalogs SET data=jsonb_set(data,'{modes,0,name}','\"Arena DB changed\"') WHERE id=$1",
          [c.data.catalog.id],
        );
        assert.equal(
          (await player.api("/api/account/catalog")).data.catalog.modes[0].name,
          "Arena DB changed",
        );
      },
    );
  } finally {
    if (app) {
      for await (const keys of app.store.redis.scanIterator({
        MATCH: `${schema}:*`,
        COUNT: 100,
      }))
        if (keys.length) await app.store.redis.del(keys);
      await app.close();
    }
    await db.query(`DROP SCHEMA ${schema} CASCADE`);
    await db.end();
  }
});
