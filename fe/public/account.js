import {t as uiText,htmlCopy} from './configuration.js';
import {configuration} from './configuration.js';
import {createSecurityUI} from './security-ui.js';
export function createAccountUI({ openModal, escapeHtml, toast, onChange }) {
  let profile = null;
  let restricted=false;
  const security=createSecurityUI({api,openModal,toast});
  const esc = escapeHtml;
  async function api(path, body) {
    const response = await fetch(`/api/account/${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
    const data = await response.json();
    if (!response.ok) {if(data.restriction){restricted=true;security.showRestriction(data.restriction);}throw Object.assign(new Error(data.error || uiText("text_cf7198d2373cab")),{restriction:data.restriction});}
    return data;
  }
  function update(next) {
    profile = next;
    onChange(profile);
  }
  async function refresh() {
    const data = await api("me");
    restricted=Boolean(data.restricted);if(data.restriction)security.showRestriction(data.restriction);
    update(data.profile);
    return profile;
  }
  const ready = refresh().catch(() => update(null));
  function showLogin(register = false) {
    openModal(
      "account",
      htmlCopy(`<div class="eyebrow">{{copy:text_71c68cc5bc2146}}</div><h2>${register ? uiText("text_4946af096f27c1") : uiText("text_6995eb574e6742")}</h2><p>{{copy:text_090c96aa0165c2}}</p><form id="account-form" data-register="${register}"><label class="input-label">{{copy:text_a175fb23c9b849}}<input name="username" pattern="[A-Za-z0-9_]+" autocomplete="username" required></label>${register ? htmlCopy("<label class=\"input-label\">{{copy:text_f4a0c3a5ac8013}}<input name=\"displayName\" autocomplete=\"nickname\" required></label>") : ""}<label class="input-label">{{copy:text_d2a5584b2986fb}}<input name="password" type="password" autocomplete="${register ? "new-password" : "current-password"}" required></label><p class="error-text" id="account-error" role="alert"></p><button class="primary-button" type="submit">${register ? uiText("text_e8a4aa0c35ff52") : uiText("text_9a402bdfdea79e")} ↗</button></form><button class="secondary-button" data-account="${register ? "login" : "register"}">${register ? uiText("text_77de2b9ce590b0") : uiText("text_5f2a09c7851478")}</button><p class="account-note">{{copy:text_2c02b269dbb38d}}</p>`),
    );
    const form=document.querySelector('#account-form'),limits=configuration.limits;
    form.elements.username.minLength=limits.usernameMin;form.elements.username.maxLength=limits.usernameMax;
    form.elements.password.minLength=register?limits.passwordMin:1;form.elements.password.maxLength=limits.passwordMax;
    if(form.elements.displayName)form.elements.displayName.maxLength=limits.displayNameMax;
  }
  function showProfile() {
    if(restricted){void security.center().catch(e=>toast(e.message));return;}
    if (!profile) {
      showLogin();
      return;
    }
    openModal(
      "account",
      htmlCopy(`<div class="eyebrow">{{copy:text_fbdc0fd43f05a3}}</div><h2>${esc(profile.display_name)}</h2><p>@${esc(profile.username)} · ${profile.lives} lượt được ghi nhận · Cấp ${profile.progression_level || 1}</p><div class="result-stats"><div class="result-stat"><strong>${profile.gold}</strong><span>{{copy:text_e7248d6360290d}}</span></div><div class="result-stat"><strong>${profile.dna}</strong><span>{{copy:text_4d9e779cd9bdb7}}</span></div><div class="result-stat"><strong>${profile.evolution_points}</strong><span>{{copy:text_daa84507176c17}}</span></div></div><h3>{{copy:text_7015fc0aca28f3}}</h3><p>${(profile.seasonProgress || []).map((s) => esc(s.season_id) + uiText("text_73a4170021c525") + s.level + " · " + s.xp + " XP").join("<br>") || uiText("text_2b9a9acb9421e8")}</p><h3>{{copy:text_a6e6d056432834}}</h3><div class="account-collection">${profile.catalog.map((s) => `<div class="account-item"><div><strong>${esc(s.name)}</strong><small>Mastery ${profile.mastery.find((m) => m.snake_id === s.id)?.xp || 0} EXP</small></div>${profile.snakes.includes(s.id) ? htmlCopy("<span class=\"ready\">{{copy:text_4214ce95465743}}</span>") : `<button class="secondary-button" data-account="unlock" data-species-id="${esc(s.id)}" ${Number(profile.gold) < s.unlock_gold ? "disabled" : ""}>${s.unlock_gold} vàng</button>`}</div>`).join("")}</div><h3>{{copy:text_303300a003c2e9}}</h3>${profile.meta.map((m) => `<div class="account-item"><div><strong>${esc(m.name)} · ${m.level}/${m.max_level}</strong><small>${esc(m.description)}</small></div><button class="secondary-button" data-account="meta" data-upgrade-id="${esc(m.id)}" data-level="${m.level}" ${m.level >= m.max_level || Number(profile.gold) < m.base_cost * (m.level + 1) ? "disabled" : ""}>${m.level >= m.max_level ? uiText("text_96cb00b2b629fe") : m.base_cost * (m.level + 1) + uiText("text_5d7fbb6cc888ea")}</button></div>`).join("")}<h3>{{copy:text_3aa1e1fee2b40b}}</h3><div class="achievement-list">${profile.achievements.length ? profile.achievements.map((a) => `<span title="${esc(a.description)}">◇ ${esc(a.name)}</span>`).join("") : htmlCopy("<span>{{copy:text_59741a41ef6683}}</span>")}</div><button class="primary-button" data-account="history">{{copy:text_c410d3f5c11be8}}</button><button class="secondary-button" data-account="security">{{copy:text_fbf1f4e2937c48}}</button><button class="secondary-button" data-account="report">{{copy:text_e2ff823ad7b9cf}}</button><button class="secondary-button" data-account="logout">{{copy:text_c9e0facd692ac3}}</button>`),
    );
  }
  async function history() {
    if (!profile) {
      showLogin();
      return;
    }
    const { rows } = await api("history");
    openModal(
      "history",
      htmlCopy(`<div class="eyebrow">{{copy:text_4782385a484046}}</div><h2>{{copy:text_40e32ff6c3de16}}</h2><p>{{copy:text_e3b941b08d92ad}}</p><div class="history-list">${rows.length ? rows.map((r) => `<article class="history-row"><div><strong>${esc(r.snake_id.toUpperCase())} · ${Number(r.score).toLocaleString("vi-VN")} điểm</strong><small>${Math.floor(r.duration_seconds)} giây · ${r.kills} quái · ${r.pvp_kills} PvP · +${r.earned_gold} vàng · +${r.earned_dna || 0} DNA · ${esc(r.mode)}${r.reason === "extracted" ? uiText("text_f3408cff88316b") : ""}</small></div><div class="build-chips">${r.upgrades.map((u) => `<span class="rarity-${esc(u.rarity.toLowerCase())}">${esc(u.id)} · ${esc(u.rarity)}</span>`).join("") || htmlCopy("<span>{{copy:text_f56e9c28f0dd3c}}</span>")}</div>${r.traits.length ? `<small>Cộng hưởng: ${r.traits.map(esc).join(", ")}</small>` : ""}<div class="build-chips">${[...(r.keystones || []), ...(r.curses || []), ...(r.organs || []).map((o) => o.id), ...(r.evolutions || []), ...(r.mutations || []), ...(r.hybrids || [])].map((id) => `<span>${esc(id)}</span>`).join("")}</div><small>${esc(r.content_version)}</small></article>`).join("") : htmlCopy("<p>{{copy:text_a8283bc5082e04}}</p>")}</div><button class="secondary-button" data-account="profile">{{copy:text_dc8c11eb255330}}</button>`),
    );
  }
  async function leaderboard() {
    const { rows, seasonName } = await api("leaderboard");
    openModal(
      "season",
      htmlCopy(`<div class="eyebrow">${esc(seasonName)}</div><h2>{{copy:text_7944da01bada5b}}</h2><p>{{copy:text_624796a201d19d}}</p><div class="season-table"><div class="season-row"><span>#</span><span>{{copy:text_39931ef7bac5c7}}</span><span>{{copy:text_3f661e650e6af5}}</span></div>${rows.map((r, i) => `<div class="season-row"><span>${i + 1}</span><strong>${esc(r.display_name)}</strong><span>${Number(r.best_score).toLocaleString("vi-VN")}</span></div>`).join("") || htmlCopy("<p>{{copy:text_88a611246936f2}}</p>")}</div>`),
    );
  }
  document.addEventListener("submit", async (event) => {
    if (event.target.id !== "account-form") return;
    event.preventDefault();
    const form = event.target,
      button = form.querySelector("button");
    button.disabled = true;
    try {
      const data = await api(
        form.dataset.register === "true" ? "register" : "login",
        Object.fromEntries(new FormData(form)),
      );
      update(data.profile);
      showProfile();
    } catch (error) {
      const label = document.querySelector("#account-error");
      if (label) label.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });
  document.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-account]");
    if (!button || button.disabled) return;
    const action = button.dataset.account;
    button.disabled = true;
    try {
      if (action === "register" || action === "login")
        showLogin(action === "register");
      else if (action === "profile") {
        await ready;
        await refresh().catch(() => {});
        showProfile();
      } else if (action === "history") await history();
      else if (action === "season") await leaderboard();
      else if(action==='security')await security.center();
      else if (action === "logout") {
        await api("logout", {});
        restricted=false;
        update(null);
        showLogin();
      } else if (action === "report") {
        security.report();
      } else if (action === "unlock") {
        update(
          (await api("unlock", { species: button.dataset.speciesId })).profile,
        );
        showProfile();
      } else if (action === "meta") {
        update(
          (
            await api("meta", {
              upgrade: button.dataset.upgradeId,
              expectedLevel: Number(button.dataset.level),
            })
          ).profile,
        );
        showProfile();
      }
    } catch (error) {
      toast(error.message);
    } finally {
      button.disabled = false;
    }
  });
  return {
    security,
    get profile() {
      return profile;
    },
    refresh,
    async savedLife(lifeId) {
      return (await api("history")).rows.find((row) => row.life_id === lifeId);
    },
    async ticket(species, mode) {
      await ready;
      return profile
        ? (await api("ticket", { species, ...(mode ? { mode } : {}) })).ticket
        : undefined;
    },
  };
}
