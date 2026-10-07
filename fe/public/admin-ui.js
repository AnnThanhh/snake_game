import {t as uiText,htmlCopy} from './configuration.js';
import {configuration} from './configuration.js';
const $ = (s) => document.querySelector(s),
  esc = (value) =>
    String(value ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
let access = null,
  currentPlayer = null,
  catalog = null,
  policy = null,
  whitelist = null,
  roles = null,
  settingsData = null,
  tab = "players";
const message = (text) => ($("#admin-message").textContent = text);
async function api(path, body, method) {
  const r = await fetch("/admin/" + path, {
    method: method || (body === undefined ? "GET" : "POST"),
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || uiText("text_40473c14f05509"));
  return data;
}
const pendingCommands = new Map();
async function command(path, body, method) {
  const reason = $("#operation-reason")?.value?.trim();
    if (!reason || reason.length < configuration.limits.adminReasonMin)
    throw new Error(uiText("text_236eba9434a706"));
  const key = JSON.stringify({ path, body, method, reason });
  if (!pendingCommands.has(key)) {
    if (pendingCommands.size > 50)
      pendingCommands.delete(pendingCommands.keys().next().value);
    pendingCommands.set(key, crypto.randomUUID());
  }
  const result = await api(
    path,
    { ...body, reason, requestId: pendingCommands.get(key) },
    method,
  );
  pendingCommands.delete(key);
  message(uiText("text_2755d32cd40428"));
  return result;
}
const reason = () =>
  htmlCopy(`<label class="input-label">{{copy:text_ed6918941c32dd}}<input id="operation-reason" minlength="${configuration.limits.adminReasonMin}" maxlength="${configuration.limits.adminReasonMax}" placeholder="{{copy:text_307f809b51d114}}"></label>`);
const button = (action, label) =>
  `<button class="secondary-button" data-action="${action}">${label}</button>`;
const json = (value) => esc(JSON.stringify(value, null, 2));
async function start() {
  try {
    access = await api("access");
    $("#admin-state").textContent =
      `${access.environment} · ${access.roles.join(", ")} · phiên MFA ${access.elevated ? uiText("text_2b36819db8bc7f") : uiText("text_e537fd4b95eb23")}`;
    if (!access.elevated) {
      $("#admin-tabs").hidden = true;
      $("#admin-content").innerHTML =
        htmlCopy(`<h2>{{copy:text_42ac8c6806b55c}}</h2><p>{{copy:text_8e368c192a5d19}}</p>${!access.mfaEnrolled ? button("enroll", uiText("text_c8b1dacf305ddf")) : ""}<div id="mfa-enrollment"></div><form id="mfa-form"><label>{{copy:text_31d320bbe8ba5b}}<input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required></label><button class="primary-button">{{copy:text_8c84fc6ea7ef63}}</button></form>`);
      return;
    }
    $("#admin-tabs").hidden = false;
    $("#admin-tabs").innerHTML = configuration.adminTabs
      .map(({id, name}) => button("tab:" + esc(id), esc(name)))
      .join("");
    await renderTab();
  } catch (error) {
    message(error.message);
    $("#admin-content").innerHTML =
      htmlCopy("<p>{{copy:text_a18bfdab9bdac2}}</p><a href=\"/\">{{copy:text_ff89585954eea6}}</a>");
  }
}
async function renderTab() {
  message("");
  currentPlayer = null;
  if (tab === "players") {
    $("#admin-content").innerHTML =
      htmlCopy("<h2>{{copy:text_6c4e124bc48258}}</h2><form id=\"search-form\"><input name=\"q\" placeholder=\"{{copy:text_f0948b55bd52f7}}\"><button class=\"primary-button\">{{copy:text_87ae432c9f654c}}</button></form><div id=\"players\"></div>");
    await search("");
  }
  if (tab === "whitelist") {
    whitelist = await api("whitelist");
    $("#admin-content").innerHTML =
      htmlCopy(`<h2>{{copy:text_5f0aed19b999e4}}</h2><form id="whitelist-form"><label>{{copy:text_2069ad6205a689}}<input name="userId" required></label><div class="admin-grid">${[
        ["type", whitelist.types],
        ["scope", whitelist.scopes],
        ["environment", whitelist.environments],
      ]
        .map(
          ([key, values]) =>
            `<label>${key}<select name="${key}">${values.map((v) => `<option ${key === "environment" && v === access.environment ? "selected" : ""}>${esc(v)}</option>`).join("")}</select></label>`,
        )
        .join(
          "",
        )}<label>{{copy:text_b80763ac6d8d3f}}<input name="value"></label><label>{{copy:text_c182b0aa8778ba}}<input name="startsAt" type="datetime-local"></label><label>{{copy:text_dd3b93971b50eb}}<input name="expiresAt" type="datetime-local"></label></div>${reason()}<button class="primary-button">{{copy:text_ed0a1dcc8fb031}}</button></form>${whitelist.rows.map((w) => `<div class="admin-row"><span>${esc(w.username)} · ${esc(w.type)} · ${esc(w.scope)}:${esc(w.value)} · ${esc(w.environment)} · ${w.is_active ? uiText("text_c3f5004120e17c") : uiText("text_d2ccac0ea23be6")}</span>${w.is_active ? button("remove-whitelist:" + w.id, uiText("text_f3243c3049a379")) : ""}</div>`).join("")}`);
  }
  if (tab === "roles") {
    roles = await api("roles");
    $("#admin-content").innerHTML =
      htmlCopy(`<h2>{{copy:text_1f758d0fca70f6}}</h2><form id="role-map-form"><label>{{copy:text_3576695cc5ba30}}<select name="role">${roles.roles.map((r) => `<option>${esc(r.code)}</option>`).join("")}</select></label><label>{{copy:text_db1c28ce4abb66}}<textarea name="permissions"></textarea></label>${reason()}<button class="primary-button">{{copy:text_ff44cc63d877b2}}</button></form><h3>{{copy:text_59d18c95504c5f}}</h3><form id="permission-form"><input name="code" placeholder="{{copy:text_1149cf052114ef}}" required><input name="description" placeholder="{{copy:text_2752b07ea03eaa}}" required><button class="secondary-button">{{copy:text_7aae766c97d2f9}}</button></form><details><summary>{{copy:text_a2426e40173d3c}}</summary><pre>${json(roles)}</pre></details>`);
  }
  if (tab === "roles") {
    $("#admin-content").insertAdjacentHTML(
      "beforeend",
      htmlCopy("<h3>{{copy:text_1fc67c6147e100}}</h3><form id=\"role-create-form\"><label>{{copy:text_679417b989db16}}<input name=\"code\" required></label><label>{{copy:text_19b8df7f49224a}}<input name=\"name\" required></label><label>{{copy:text_8aaff8b6980374}}<input name=\"priority\" type=\"number\" min=\"0\" required></label><button class=\"secondary-button\">{{copy:text_1fc67c6147e100}}</button></form>"),
    );
    const select = $("#role-map-form select");
    $("#role-map-form textarea").value = roles.mappings
      .filter((m) => m.role_code === select.value)
      .map((m) => m.permission_code)
      .join("\n");
  }
  if (tab === "catalog") {
    catalog = (await api("catalog")).catalog;
    $("#admin-content").innerHTML =
      htmlCopy(`<h2>{{copy:text_c4c92b533ce51f}}</h2><p>{{copy:text_99cafd7b55ba8b}}</p><form id="catalog-form"><textarea name="catalog" style="min-height:480px">${json(catalog)}</textarea>${reason()}<button class="primary-button">{{copy:text_f89ac9837591d1}}</button></form>`);
  }
  if (tab === "policy") {
    policy = (await api("policy")).policy;
    $("#admin-content").innerHTML =
      htmlCopy(`<h2>{{copy:text_590e5ca19ce607}}</h2><form id="policy-form"><label>{{copy:text_e968f312f5fe5d}}<select name="key">${[
        "caps",
        "security",
        "registration",
        "commands",
        "access",
        "endpoints",
      ]
        .filter((k) => policy[k])
        .map((k) => `<option>${k}</option>`)
        .join(
          "",
        )}</select></label><textarea name="value">${json(policy.caps)}</textarea>${reason()}<button class="primary-button">{{copy:text_28aaf37577cfd9}}</button></form><p>{{copy:text_1f8fe39e0d1981}}</p>`);
  }
  if (tab === "settings") {
    const { settings } = await api("settings");
    settingsData = settings;
    $("#admin-content").innerHTML =
      htmlCopy(`<h2>{{copy:text_66cb299cfd8f81}}</h2><form id="settings-form"><label>{{copy:text_b41684c372b407}}<select name="key">${Object.keys(
        settings,
      )
        .map((k) => `<option>${esc(k)}</option>`)
        .join(
          "",
        )}</select></label><textarea name="value">${json(settings[Object.keys(settings)[0]])}</textarea>${reason()}<button class="primary-button">{{copy:text_19b064a46e0ee6}}</button></form><pre>${json(settings)}</pre>`);
  }
  if (tab === "reports"||tab==='appeals') {
    const route=tab;
    const { rows } = await api(route);
    $("#admin-content").innerHTML =
      htmlCopy("<h2>{{copy:text_e2ff823ad7b9cf}}</h2>") +
      reason() +
      rows
        .map(
          (r) =>
            '<article class="admin-row"><p>' +
            esc(r.target_name||r.username) +
            " · " +
            esc(r.reason) +
            " · " +
            esc(r.status) +
            '</p><form class="report-resolve-form"><input type="hidden" name="id" value="' +
            esc(r.id) +
            '"><input type="hidden" name="route" value="'+route+'"><select name="status">'+configuration.moderation[route==='reports'?'reportStatuses':'appealStatuses'].map(s=>`<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('')+htmlCopy("</select><textarea name=\"resolution\" placeholder=\"{{copy:text_bea4afa8889411}}\" required></textarea><button class=\"secondary-button\">{{copy:text_762413cc5c9fc8}}</button></form><pre>")+json({category:r.category,evidence:r.evidence_url,room:r.room_id,match:r.match_id,action:r.action_id})+'</pre></article>',
        )
        .join("");
  }
  if(tab==='security-events'){const {rows}=await api('security-events');$('#admin-content').innerHTML=htmlCopy(`<h2>{{copy:text_1ff70fee2bcb60}}</h2><pre>${json(rows)}</pre>`);}
  if (tab === "audit") {
    const { rows } = await api("audit");
    $("#admin-content").innerHTML =
      htmlCopy(`<h2>{{copy:text_09a4fc3a608649}}</h2>${rows.map((r) => `<details class="admin-row"><summary>${esc(r.action)} · ${esc(r.reason)} · ${new Date(r.created_at).toLocaleString("vi-VN")}</summary><pre>${json(r)}</pre></details>`).join("") || htmlCopy("<p>{{copy:text_7483d68a9feebb}}</p>")}`);
  }
}
async function search(q) {
  const { rows } = await api("players?q=" + encodeURIComponent(q));
  $("#players").innerHTML =
    rows
      .map(
        (p) =>
          `<div class="admin-row"><span>${esc(p.display_name)} · @${esc(p.username)}<small> · ${p.gold} vàng</small></span>${button("player:" + p.id, uiText("text_4e97a7221b4ba3"))}</div>`,
      )
      .join("") || htmlCopy("<p>{{copy:text_b657ef94ccbb45}}</p>");
}
async function player(id) {
  currentPlayer = (await api("players/" + id)).player;
  const p = currentPlayer;
  $("#admin-content").innerHTML =
    htmlCopy(`<h2>${esc(p.display_name)} · @${esc(p.username)}</h2><p>${p.gold} vàng · ${p.dna} DNA · ${p.evolution_points} EP</p>${reason()}<div class="admin-grid"><form id="currency-form"><h3>{{copy:text_daa50483be892a}}</h3><select name="currency"><option value="gold">{{copy:text_3fb909dba00e78}}</option><option value="dna">{{copy:text_4d9e779cd9bdb7}}</option><option value="evolution_points">{{copy:text_dcc9be2679d9e1}}</option></select><input name="amount" type="number" required placeholder="{{copy:text_b45fbf1a6798cd}}"><button class="primary-button">{{copy:text_0b53f7984f379b}}</button></form><form id="grant-role-form"><h3>{{copy:text_9bcc7721e80f37}}</h3><input name="role" placeholder="{{copy:text_8114b22dd157a0}}" required><select name="revoke"><option value="false">{{copy:text_cf04fe53433870}}</option><option value="true">{{copy:text_f3243c3049a379}}</option></select><button class="secondary-button">{{copy:text_868db0f670aecd}}</button></form></div><div class="admin-actions">${button("player-command:unlock-all", uiText("text_571ae8242609f9"))}${button("player-command:max", "MAX theo cap DB")}${button("player-command:reset", uiText("text_2617ed2e4203a7"))}${button("player-command:unban", uiText("text_21c868f1851b3b"))}</div><form id="ban-form"><h3>{{copy:text_2ffb68954b6ef8}}</h3><select name="scope"><option>{{copy:text_2d75b76b2dcf46}}</option><option>{{copy:text_1fda097e248b01}}</option><option>{{copy:text_a5e7f23901968e}}</option><option>{{copy:text_0a7ef9fd6f44ba}}</option></select><input name="mode" placeholder="{{copy:text_00e54c07fc8358}}"><input name="expiresAt" type="datetime-local" required><button class="secondary-button">{{copy:text_30eb6dad75559b}}</button></form><details><summary>{{copy:text_721ca3e90b1500}}</summary><pre>${json(p)}</pre></details>`);
  await extraPlayerForms();
}
async function extraPlayerForms() {
  const d = await api("definitions"),
    options = (items, value, label) =>
      items
        .map(
          (x) =>
            '<option value="' +
            esc(x[value]) +
            '">' +
            esc(x[label] || x[value]) +
            "</option>",
        )
        .join("");
  const rolesSelect = document.createElement("select");
  $('#ban-form select[name=scope]').innerHTML=options(d.moderation.scopes,'id','name');
  $('#ban-form').insertAdjacentHTML('beforeend',htmlCopy(`<label>{{copy:text_ba423f1df281c7}}<textarea name="publicReason" maxlength="${configuration.limits.reportReasonMax}" required></textarea></label>`));
  rolesSelect.name = "role";
  rolesSelect.innerHTML = options(d.roles, "code", "name");
  $("#grant-role-form input[name=role]").replaceWith(rolesSelect);
  $("#grant-role-form").insertAdjacentHTML(
    "beforeend",
    htmlCopy("<label>{{copy:text_a4f2b71c3ed853}}<input name=\"expiresAt\" type=\"datetime-local\"></label>"),
  );
  $("#ban-form").insertAdjacentHTML(
    "afterbegin",
    htmlCopy("<label>{{copy:text_de1c5a90fc10e6}}<select name=\"temporary\"><option value=\"true\">{{copy:text_2ffb68954b6ef8}}</option><option value=\"false\">{{copy:text_476ab384c22818}}</option></select></label>"),
  );
  $("#ban-form input[name=expiresAt]").required = false;
  $("#admin-content").insertAdjacentHTML(
    "beforeend",
    htmlCopy("<div class=\"admin-grid\"><form id=\"inventory-form\"><h3>{{copy:text_ecc0f650acae8c}}</h3><select name=\"itemId\">") +
      options(d.inventory, "id", "name") +
      htmlCopy("</select><input name=\"amount\" type=\"number\" placeholder=\"{{copy:text_3b66c6c747025d}}\" required><button class=\"secondary-button\">{{copy:text_27bb6edf93b6aa}}</button></form><form id=\"progression-form\"><h3>{{copy:text_22bb1d27d3406e}}</h3><input name=\"level\" type=\"number\" min=\"1\" max=\"") +
      d.caps.level +
      htmlCopy("\" required><button class=\"secondary-button\">{{copy:text_2044c84c81117e}}</button></form><form id=\"unlock-form\"><h3>{{copy:text_f3de59b2187015}}</h3><select name=\"species\">") +
      options(d.snakes, "id", "name") +
      htmlCopy("</select><button class=\"secondary-button\">{{copy:text_db3ad475db5cab}}</button></form><form id=\"override-form\"><h3>{{copy:text_cd190836d44e46}}</h3><select name=\"permission\">") +
      options(d.permissions, "code", "description") +
      htmlCopy("</select><select name=\"effect\"><option>{{copy:text_36aa3700fc28d7}}</option><option>{{copy:text_25a2778c67ba98}}</option><option>{{copy:text_5fdf0b2bbe277c}}</option></select><label>{{copy:text_dd3b93971b50eb}}<input name=\"expiresAt\" type=\"datetime-local\"></label><button class=\"secondary-button\">{{copy:text_4cc826a3593b9f}}</button></form><form id=\"mute-form\"><h3>{{copy:text_317ae2e1eaa848}}</h3><input name=\"expiresAt\" type=\"datetime-local\" required><button class=\"secondary-button\">{{copy:text_8dd6857baf0268}}</button></form></div>") +
      button("player-command:unmute", uiText("text_377df944361668")),
  );
}

document.addEventListener("change", (e) => {
  if (e.target.closest("#settings-form") && e.target.name === "key")
    $("#settings-form textarea").value = JSON.stringify(
      settingsData[e.target.value],
      null,
      2,
    );
  if (e.target.closest("#policy-form") && e.target.name === "key")
    $("#policy-form textarea").value = JSON.stringify(
      policy[e.target.value],
      null,
      2,
    );
  if (e.target.closest("#role-map-form") && e.target.name === "role")
    $("#role-map-form textarea").value = roles.mappings
      .filter((m) => m.role_code === e.target.value)
      .map((m) => m.permission_code)
      .join("\n");
});
document.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-action]");
  if (!b) return;
  b.disabled = true;
  try {
    const [action, id] = b.dataset.action.split(":");
    if (action === "tab") {
      tab = id;
      await renderTab();
    } else if (action === "enroll") {
      const data = await api("mfa/enroll", {});
      $("#mfa-enrollment").innerHTML =
        htmlCopy(`<p>{{copy:text_4b54f1337f1c42}}</p><code>${esc(data.secret)}</code>`);
    } else if (action === "player") await player(id);
    else if (action === "remove-whitelist") {
      await command("whitelist/" + id, {}, "DELETE");
      await renderTab();
    } else if (action === "player-command") {
      await command("players/" + currentPlayer.id + "/" + id, {});
      await player(currentPlayer.id);
    }
  } catch (error) {
    message(error.message);
  } finally {
    b.disabled = false;
  }
});
document.addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target,
    values = Object.fromEntries(new FormData(form)),
    button = form.querySelector("button");
  button.disabled = true;
  try {
    if (form.id === "mfa-form") {
      await api("mfa/verify", values);
      await start();
    }
    if (form.id === "search-form") await search(values.q);
    if (form.id === "currency-form") {
      await command("players/" + currentPlayer.id + "/currency", {
        currency: values.currency,
        amount: Number(values.amount),
      });
      await player(currentPlayer.id);
    }
    if (form.id === "grant-role-form")
      await command("players/" + currentPlayer.id + "/roles", {
        role: values.role,
        revoke: values.revoke === "true",
        ...(values.expiresAt
          ? { expiresAt: new Date(values.expiresAt).toISOString() }
          : {}),
      });
    if (form.id === "ban-form")
      await command("players/" + currentPlayer.id + "/ban", {
        scope: values.scope,
        publicReason: values.publicReason,
        mode: values.mode,
        temporary: values.temporary !== "false",
        ...(values.expiresAt
          ? { expiresAt: new Date(values.expiresAt).toISOString() }
          : {}),
      });
    if (form.id === "inventory-form")
      await command("players/" + currentPlayer.id + "/inventory", {
        itemId: values.itemId,
        amount: Number(values.amount),
      });
    if (form.id === "progression-form")
      await command("players/" + currentPlayer.id + "/progression", {
        level: Number(values.level),
      });
    if (form.id === "unlock-form")
      await command("players/" + currentPlayer.id + "/unlock", values);
    if (form.id === "override-form")
      await command("players/" + currentPlayer.id + "/overrides", {
        ...values,
        ...(values.expiresAt
          ? { expiresAt: new Date(values.expiresAt).toISOString() }
          : { expiresAt: null }),
      });
    if (form.id === "mute-form")
      await command("players/" + currentPlayer.id + "/mute", {
        expiresAt: new Date(values.expiresAt).toISOString(),
      });
    if (form.id === "role-create-form") {
      await command("roles", { ...values, priority: Number(values.priority) });
      await renderTab();
    }
    if (form.matches(".report-resolve-form")) {
      await command(values.route+"/" + values.id, { status: values.status,resolution:values.resolution });
      await renderTab();
    }
    if (form.id === "whitelist-form") {
      for (const key of ["startsAt", "expiresAt"])
        if (values[key]) values[key] = new Date(values[key]).toISOString();
        else delete values[key];
      await command("whitelist", values);
      await renderTab();
    }
    if (form.id === "role-map-form")
      await command("role-permissions", {
        role: values.role,
        permissions: values.permissions
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean),
      });
    if (form.id === "permission-form") await command("permissions", values);
    if (form.id === "catalog-form")
      await command("catalog", { catalog: JSON.parse(values.catalog) });
    if (form.id === "policy-form") {
      await command("policy", {
        key: values.key,
        value: JSON.parse(values.value),
      });
      await start();
    }
    if (form.id === "settings-form")
      await command("settings", {
        key: values.key,
        value: JSON.parse(values.value),
      });
  } catch (error) {
    message(error.message);
  } finally {
    button.disabled = false;
  }
});
void start();
