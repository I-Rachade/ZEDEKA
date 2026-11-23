// Console MDM : application monopage sans framework (facile à modifier).
// Chaque écran est une fonction de l'objet `pages`, enregistrée dans NAV.

const $ = (s, el = document) => el.querySelector(s);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtDate = (s) => (s ? new Date(s).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }) : "—");
const ago = (s) => {
  if (!s) return "jamais";
  const m = Math.round((Date.now() - new Date(s)) / 60000);
  if (m < 1) return "à l'instant"; if (m < 60) return `il y a ${m} min`;
  const h = Math.round(m / 60); if (h < 48) return `il y a ${h} h`;
  return `il y a ${Math.round(h / 24)} j`;
};
const PLATFORM = { android: "Android", ios: "iOS" };
const SEVERITY = { critique: "bad", haute: "bad", moyenne: "warn", info: "info" };
const STATUS = { actif: "ok", perdu: "bad", "effacé": "neutral", "retiré": "neutral", en_attente: "warn" };
const CMD_STATUS = { en_file: "warn", "envoyée": "info", "terminée": "ok", "échec": "bad", "annulée": "neutral" };

// ------------------------------------------------------------------ API
const state = { token: sessionStorage.getItem("mdm_token"), user: null, charts: [], map: null, timer: null };

async function api(path, opts = {}) {
  const res = await fetch(`/api${path}`, {
    ...opts,
    headers: { "content-type": "application/json", ...(state.token ? { authorization: `Bearer ${state.token}` } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 401 && path !== "/auth/login") { logout(); throw new Error("Session expirée"); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
  return data;
}
function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.classList.remove("hidden");
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.add("hidden"), 3500);
}
const badge = (text, kind = "neutral") => `<span class="badge ${kind}">${esc(text)}</span>`;
const compliance = (d) => (d.compliant ? badge("Conforme", "ok") : badge("Non conforme", "bad"));

// ------------------------------------------------------------------ navigation
const NAV = [
  { id: "dashboard", label: "Tableau de bord", icon: "▦", admin: true },
  { id: "devices", label: "Appareils", userLabel: "Mes appareils", icon: "▢" },
  { id: "map", label: "Carte", icon: "◎" },
  { id: "alerts", label: "Alertes", icon: "!" },
  { id: "apps", label: "Applications", icon: "◫", admin: true },
  { id: "policies", label: "Politiques", icon: "⚙", admin: true },
  { id: "enrollment", label: "Enrôlement", icon: "+", admin: true },
  { id: "users", label: "Utilisateurs", icon: "☺", admin: true },
  { id: "audit", label: "Journal d'audit", icon: "≡", admin: true },
  { id: "privacy", label: "Confidentialité", icon: "⚐" },
];

function renderNav(alertCount = 0) {
  const admin = state.user.role === "admin";
  $("#nav").innerHTML = NAV.filter((n) => admin || !n.admin).map((n) =>
    `<a href="#/${n.id}" data-id="${n.id}"><span>${n.icon}</span>${esc(admin ? n.label : n.userLabel ?? n.label)}
     ${n.id === "alerts" && alertCount ? `<span class="count">${alertCount}</span>` : ""}</a>`).join("");
  highlightNav();
}
function highlightNav() {
  const cur = location.hash.replace("#/", "") || "";
  document.querySelectorAll("#nav a").forEach((a) => a.classList.toggle("active", a.dataset.id === cur));
}

async function route() {
  if (!state.user) return;
  clearInterval(state.timer);
  state.charts.forEach((c) => c.destroy()); state.charts = [];
  if (state.map) { state.map.remove(); state.map = null; }
  $(".sidebar").classList.remove("open");
  const def = state.user.role === "admin" ? "dashboard" : "devices";
  const id = location.hash.replace("#/", "") || def;
  const item = NAV.find((n) => n.id === id && (state.user.role === "admin" || !n.admin)) ?? NAV.find((n) => n.id === def);
  $("#page-title").textContent = state.user.role === "admin" ? item.label : item.userLabel ?? item.label;
  $("#page-actions").innerHTML = "";
  highlightNav();
  $("#view").innerHTML = `<p class="muted">Chargement…</p>`;
  try { await pages[item.id]($("#view")); } catch (e) { $("#view").innerHTML = `<p class="error">${esc(e.message)}</p>`; }
}

// ------------------------------------------------------------------ écrans
const pages = {
  async dashboard(view) {
    const [s, alerts] = await Promise.all([api("/stats"), api("/alerts")]);
    const t = s.totals; const total = t.total || 0;
    const pct = (n) => (total ? Math.round((n / total) * 100) : 0);
    view.innerHTML = `
      <div class="grid kpis">
        ${kpi("Appareils gérés", total, `${t.byod ?? 0} personnels (BYOD)`)}
        ${kpi("Conformes", `${pct(t.compliant ?? 0)} %`, `${total - (t.compliant ?? 0)} non conformes`, t.compliant < total ? "warn" : "ok")}
        ${kpi("En ligne (1 h)", t.online ?? 0, `${total - (t.online ?? 0)} hors ligne`)}
        ${kpi("Perdus / volés", t.lost ?? 0, "en mode perdu", t.lost ? "bad" : "ok")}
        ${kpi("Alertes ouvertes", alerts.length, `${alerts.filter((a) => a.severity === "critique").length} critiques`, alerts.length ? "bad" : "ok")}
        ${kpi("Batterie moyenne", `${t.avg_battery ?? "—"} %`, `stockage occupé ${t.avg_storage ?? "—"} %`)}
      </div>
      <div class="grid charts">
        <div class="card"><h2>Répartition par plateforme</h2><div class="chart-box"><canvas id="c-platform"></canvas></div></div>
        <div class="card"><h2>Versions de système</h2><div class="chart-box"><canvas id="c-os"></canvas></div></div>
        <div class="card"><h2>Alertes ouvertes par gravité</h2><div class="chart-box"><canvas id="c-alerts"></canvas></div></div>
        <div class="card"><h2>Commandes à distance (30 j)</h2><div class="chart-box"><canvas id="c-cmd"></canvas></div></div>
        <div class="card"><h2>Applications les plus installées</h2><div class="chart-box"><canvas id="c-apps"></canvas></div></div>
        <div class="card"><h2>Alertes prioritaires</h2>${alertList(alerts.slice(0, 6))}</div>
      </div>`;
    const css = getComputedStyle(document.documentElement);
    const col = (v) => css.getPropertyValue(v).trim();
    const palette = [col("--primary"), col("--ok"), col("--warn"), col("--bad"), col("--info"), "#8b5cf6", "#0ea5e9", "#64748b"];
    Chart.defaults.color = col("--muted"); Chart.defaults.borderColor = col("--border");
    const mk = (id, type, labels, data, colors, opts = {}) => state.charts.push(new Chart($(id), {
      type, data: { labels, datasets: [{ data, backgroundColor: colors ?? palette, borderWidth: 0, borderRadius: type === "bar" ? 6 : 0 }] },
      options: { maintainAspectRatio: false, plugins: { legend: { display: type === "doughnut", position: "bottom" } }, ...opts },
    }));
    mk("#c-platform", "doughnut", s.byPlatform.map((x) => PLATFORM[x.platform]), s.byPlatform.map((x) => x.n), [col("--ok"), col("--primary")]);
    mk("#c-os", "bar", s.byOs.map((x) => String(x.os ?? "?").replace("android", "Android").replace("ios", "iOS")), s.byOs.map((x) => x.n), col("--primary"));
    const sev = ["critique", "haute", "moyenne", "info"];
    mk("#c-alerts", "bar", sev, sev.map((k) => s.alertsBySeverity.find((x) => x.severity === k)?.n ?? 0), [col("--bad"), col("--warn"), "#eab308", col("--info")]);
    mk("#c-cmd", "bar", s.commands.map((x) => x.type), s.commands.map((x) => x.n), col("--info"), { indexAxis: "y" });
    mk("#c-apps", "bar", s.topApps.map((x) => x.name), s.topApps.map((x) => x.n), col("--ok"), { indexAxis: "y" });
    bindAlertButtons(view);
    state.timer = setInterval(() => location.hash.startsWith("#/dashboard") && route(), 60000);
  },

  async devices(view) {
    const admin = state.user.role === "admin";
    view.innerHTML = `
      <div class="card">
        <div class="toolbar">
          <input id="f-q" placeholder="Rechercher (nom, modèle, utilisateur, n° de série)">
          <select id="f-platform"><option value="">Toutes plateformes</option><option value="android">Android</option><option value="ios">iOS</option></select>
          <select id="f-status"><option value="">Tous statuts</option><option value="actif">Actif</option><option value="perdu">Perdu</option><option value="effacé">Effacé</option></select>
          <select id="f-compliant"><option value="">Conformité</option><option value="1">Conformes</option><option value="0">Non conformes</option></select>
          <span id="f-count" class="muted"></span>
        </div>
      </div>
      <div class="card table-wrap"><table>
        <thead><tr><th>Appareil</th><th>Plateforme</th>${admin ? "<th>Utilisateur</th>" : ""}<th>Statut</th><th>Conformité</th><th>Batterie</th><th>Dernier contact</th></tr></thead>
        <tbody id="dev-rows"></tbody></table></div>`;
    if (admin) $("#page-actions").innerHTML = `<a class="btn primary" href="#/enrollment">+ Enrôler un appareil</a>`;
    const load = async () => {
      const p = new URLSearchParams({ q: $("#f-q").value, platform: $("#f-platform").value, status: $("#f-status").value, compliant: $("#f-compliant").value });
      const list = await api(`/devices?${p}`);
      $("#f-count").textContent = `${list.length} appareil${list.length > 1 ? "s" : ""}`;
      $("#dev-rows").innerHTML = list.map((d) => `
        <tr class="clickable" data-id="${esc(d.id)}">
          <td><b>${esc(d.name)}</b><div class="muted small">${esc(d.model ?? "")}</div></td>
          <td>${esc(PLATFORM[d.platform])} ${esc(d.os_version ?? "")}</td>
          ${admin ? `<td>${esc(d.owner_name ?? "—")}<div class="muted small">${esc(d.ownership)}</div></td>` : ""}
          <td>${badge(d.status, STATUS[d.status])}</td>
          <td>${compliance(d)}</td>
          <td>${d.battery ?? "—"} %</td>
          <td title="${esc(fmtDate(d.last_seen))}">${esc(ago(d.last_seen))}</td>
        </tr>`).join("") || `<tr><td colspan="7" class="muted">Aucun appareil</td></tr>`;
      document.querySelectorAll("#dev-rows tr[data-id]").forEach((tr) => tr.onclick = () => openDevice(tr.dataset.id));
    };
    let t; view.querySelectorAll("input,select").forEach((el) => el.oninput = () => { clearTimeout(t); t = setTimeout(load, 250); });
    await load();
  },

  async map(view) {
    const points = await api("/map");
    view.innerHTML = `<div class="card"><p class="muted small" style="margin:0 0 10px">
      Dernière position connue de chaque appareil. Par défaut, la position n'est relevée que sur demande motivée ou en mode perdu (RGPD).
      Rouge : perdu · orange : non conforme · bleu : normal.</p><div id="map"></div></div>`;
    state.map = L.map("map").setView([46.6, 2.4], 6);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" }).addTo(state.map);
    const bounds = [];
    for (const p of points) {
      const color = p.lost_mode ? "#c0262d" : p.compliant ? "#2f6fed" : "#d97706";
      L.circleMarker([p.lat, p.lon], { radius: p.lost_mode ? 10 : 7, color, fillColor: color, fillOpacity: .8 })
        .addTo(state.map)
        .bindPopup(`<b>${esc(p.name)}</b><br>${esc(p.owner_name ?? "")}<br>${esc(fmtDate(p.located_at))} (${esc(p.source)})<br>
          <a href="#" data-open="${esc(p.id)}">Voir l'appareil</a>`);
      bounds.push([p.lat, p.lon]);
    }
    if (bounds.length) state.map.fitBounds(bounds, { padding: [30, 30], maxZoom: 13 });
    state.map.on("popupopen", (e) => e.popup.getElement().querySelector("[data-open]").onclick = (ev) => { ev.preventDefault(); openDevice(ev.target.dataset.open); });
    state.timer = setInterval(async () => { if (location.hash.startsWith("#/map")) route(); }, 30000);
  },

  async alerts(view) {
    const [open, closed] = await Promise.all([api("/alerts"), api("/alerts?status=résolue")]);
    view.innerHTML = `<div class="card"><h2>Alertes ouvertes (${open.length})</h2>${alertList(open)}</div>
      <div class="card"><h2>Alertes résolues récemment</h2>${alertList(closed.slice(0, 20), true)}</div>`;
    bindAlertButtons(view);
  },

  async apps(view) {
    const apps = await api("/apps");
    $("#page-actions").innerHTML = `<button class="btn primary" id="add-app">+ Ajouter au catalogue</button>`;
    $("#add-app").onclick = () => appForm();
    view.innerHTML = `<div class="card table-wrap"><table>
      <thead><tr><th>Application</th><th>Plateforme</th><th>Version</th><th>Source</th><th>Règle</th><th>Installations</th><th></th></tr></thead>
      <tbody>${apps.map((a) => `<tr>
        <td><b>${esc(a.name)}</b><div class="muted small">${esc(a.identifier)}</div></td>
        <td>${esc(PLATFORM[a.platform])}</td><td>${esc(a.version ?? "—")}</td><td>${esc(a.source)}</td>
        <td>${a.blocked ? badge("Interdite", "bad") : a.mandatory ? badge("Obligatoire", "info") : badge("Disponible", "neutral")}</td>
        <td>${a.installs}</td>
        <td class="actions">
          <button class="btn small" data-deploy="${a.id}">Installer…</button>
          <button class="btn small" data-remove="${a.id}">Désinstaller…</button>
          <button class="btn small ghost" data-edit="${a.id}">Modifier</button>
        </td></tr>`).join("") || `<tr><td colspan="7" class="muted">Catalogue vide</td></tr>`}</tbody></table></div>`;
    view.querySelectorAll("[data-deploy],[data-remove]").forEach((b) => b.onclick = () => deployApp(apps.find((a) => a.id == (b.dataset.deploy ?? b.dataset.remove)), b.dataset.remove ? "remove" : "install"));
    view.querySelectorAll("[data-edit]").forEach((b) => b.onclick = () => appForm(apps.find((a) => a.id == b.dataset.edit)));
  },

  async policies(view) {
    const pols = await api("/policies");
    const get = (type) => pols.find((p) => p.type === type && p.scope === "all")?.settings ?? {};
    const pc = get("passcode"), rs = get("restrictions"), cp = get("compliance");
    view.innerHTML = `
      <form class="card" id="p-passcode"><h2>Politique de mot de passe</h2>
        <div class="form-grid">
          <label>Longueur minimale<input type="number" name="min_length" min="4" max="16" value="${pc.min_length}"></label>
          <label>Tentatives avant effacement<input type="number" name="max_failed_attempts" min="3" max="20" value="${pc.max_failed_attempts}"></label>
          <label>Expiration (jours)<input type="number" name="max_age_days" min="0" value="${pc.max_age_days}"></label>
          <label>Verrouillage auto (min)<input type="number" name="auto_lock_minutes" min="1" max="60" value="${pc.auto_lock_minutes}"></label>
          <label>Historique (codes interdits)<input type="number" name="history" min="0" max="24" value="${pc.history}"></label>
        </div>
        <p><label class="check"><input type="checkbox" name="require_alphanumeric" ${pc.require_alphanumeric ? "checked" : ""}> Exiger lettres et chiffres</label>
        <label class="check"><input type="checkbox" name="biometrics_allowed" ${pc.biometrics_allowed ? "checked" : ""}> Autoriser la biométrie</label></p>
        <button class="btn primary">Appliquer à tout le parc</button></form>
      <form class="card" id="p-restrictions"><h2>Restrictions</h2>
        <p>${[["camera", "Appareil photo autorisé"], ["screen_capture", "Captures d'écran autorisées"], ["usb_file_transfer", "Transfert de fichiers USB"],
              ["unknown_sources", "Installation d'apps hors magasin (Android)"], ["bluetooth", "Bluetooth autorisé"]]
          .map(([k, l]) => `<label class="check"><input type="checkbox" name="${k}" ${rs[k] ? "checked" : ""}> ${l}</label>`).join("")}</p>
        <button class="btn primary">Appliquer</button></form>
      <form class="card" id="p-compliance"><h2>Règles de conformité</h2>
        <p>${[["require_encryption", "Chiffrement du stockage obligatoire"], ["require_passcode", "Code de verrouillage obligatoire"],
              ["block_rooted", "Interdire les appareils rootés / jailbreakés"], ["quarantine_noncompliant", "Mettre en quarantaine réseau les appareils non conformes"]]
          .map(([k, l]) => `<label class="check"><input type="checkbox" name="${k}" ${cp[k] ? "checked" : ""}> ${l}</label>`).join("")}</p>
        <div class="form-grid">
          <label>Android minimum<input name="min_os_android" value="${esc(cp.min_os_android)}"></label>
          <label>iOS minimum<input name="min_os_ios" value="${esc(cp.min_os_ios)}"></label>
        </div><p></p>
        <button class="btn primary">Enregistrer et réévaluer le parc</button></form>`;
    const bind = (id, type) => $(id).onsubmit = async (e) => {
      e.preventDefault();
      const settings = {};
      for (const el of e.target.elements) {
        if (!el.name) continue;
        settings[el.name] = el.type === "checkbox" ? el.checked : el.type === "number" ? Number(el.value) : el.value;
      }
      try { const r = await api(`/policies/${type}`, { method: "PUT", body: { settings } }); toast(`Politique appliquée à ${r.devices} appareils`); }
      catch (err) { toast(err.message); }
    };
    bind("#p-passcode", "passcode"); bind("#p-restrictions", "restrictions"); bind("#p-compliance", "compliance");
  },

  async enrollment(view) {
    const [tokens, events, users] = await Promise.all([api("/enrollment/tokens"), api("/network/events"), api("/users")]);
    view.innerHTML = `
      <form class="card" id="tok-form"><h2>Créer une invitation d'enrôlement</h2>
        <div class="form-grid">
          <label>Utilisateur<select name="owner_email"><option value="">— Appareil partagé —</option>
            ${users.filter((u) => u.active).map((u) => `<option value="${esc(u.email)}">${esc(u.name)} (${esc(u.email)})</option>`).join("")}</select></label>
          <label>Plateforme<select name="platform"><option value="any">Toutes</option><option value="android">Android</option><option value="ios">iOS</option></select></label>
          <label>Propriété<select name="ownership"><option value="entreprise">Entreprise</option><option value="personnel">Personnel (BYOD)</option></select></label>
          <label>Nombre d'utilisations<input type="number" name="max_uses" value="1" min="1" max="500"></label>
          <label>Validité (jours)<input type="number" name="days" value="7" min="1" max="90"></label>
        </div><p></p><button class="btn primary">Générer le QR code</button>
        <div id="tok-result"></div></form>
      <div class="card"><h2>Enrôlement automatique à la connexion réseau</h2>
        <p class="muted">Le contrôleur Wi-Fi, le serveur RADIUS ou la NAC appelle <code>POST /api/network/events</code> à chaque connexion.
        Un appareil inconnu est placé dans le VLAN d'enrôlement et redirigé vers le portail captif ; un appareil non conforme ou perdu est mis en quarantaine.</p>
        <div class="table-wrap"><table><thead><tr><th>Date</th><th>MAC</th><th>Réseau</th><th>Utilisateur</th><th>Décision</th><th>Appareil</th></tr></thead>
        <tbody>${events.map((e) => `<tr><td>${esc(fmtDate(e.at))}</td><td><code>${esc(e.mac)}</code></td><td>${esc(e.ssid ?? "")}</td><td>${esc(e.username ?? "")}</td>
          <td>${badge(e.decision, e.decision === "autoriser" ? "ok" : e.decision === "quarantaine" ? "bad" : "warn")}</td><td>${esc(e.device_name ?? "—")}</td></tr>`).join("")
          || `<tr><td colspan="6" class="muted">Aucun événement</td></tr>`}</tbody></table></div></div>
      <div class="card table-wrap"><h2>Invitations récentes</h2><table><thead><tr><th>Créée le</th><th>Utilisateur</th><th>Plateforme</th><th>Source</th><th>Utilisations</th><th>Expire</th></tr></thead>
        <tbody>${tokens.map((t) => `<tr><td>${esc(fmtDate(t.created_at))}</td><td>${esc(t.owner_email ?? t.label ?? "—")}</td><td>${esc(t.platform)}</td>
          <td>${esc(t.source)}</td><td>${t.uses} / ${t.max_uses}</td><td>${esc(fmtDate(t.expires_at))}</td></tr>`).join("")}</tbody></table></div>`;
    $("#tok-form").onsubmit = async (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      const r = await api("/enrollment/tokens", { method: "POST", body: { ...f, max_uses: Number(f.max_uses), days: Number(f.days), owner_email: f.owner_email || undefined } });
      $("#tok-result").innerHTML = `<p>Lien à envoyer à l'utilisateur : <a href="${esc(r.enroll_url)}" target="_blank">${esc(r.enroll_url)}</a></p>
        <p class="muted small">Ce lien ne sera plus affiché. Il expire le ${esc(fmtDate(r.expires_at))}.</p>`;
    };
  },

  async users(view) {
    const users = await api("/users");
    $("#page-actions").innerHTML = `<button class="btn primary" id="add-user">+ Nouvel utilisateur</button>`;
    $("#add-user").onclick = () => userForm();
    view.innerHTML = `<div class="card table-wrap"><table><thead><tr><th>Nom</th><th>E-mail</th><th>Rôle</th><th>Appareils</th><th>État</th><th></th></tr></thead>
      <tbody>${users.map((u) => `<tr><td><b>${esc(u.name)}</b></td><td>${esc(u.email)}</td>
        <td>${u.role === "admin" ? badge("Administrateur", "info") : badge("Utilisateur", "neutral")}</td><td>${u.devices}</td>
        <td>${u.active ? badge("Actif", "ok") : badge("Désactivé", "neutral")}</td>
        <td class="actions">${u.id === state.user.id ? "" : `
          <button class="btn small" data-role="${u.id}" data-to="${u.role === "admin" ? "user" : "admin"}">${u.role === "admin" ? "Retirer admin" : "Passer admin"}</button>
          <button class="btn small" data-active="${u.id}" data-to="${u.active ? 0 : 1}">${u.active ? "Désactiver" : "Réactiver"}</button>
          <button class="btn small danger" data-anon="${u.id}">Anonymiser (RGPD)</button>`}</td></tr>`).join("")}</tbody></table></div>`;
    view.querySelectorAll("[data-role]").forEach((b) => b.onclick = async () => { await api(`/users/${b.dataset.role}`, { method: "PATCH", body: { role: b.dataset.to } }); route(); });
    view.querySelectorAll("[data-active]").forEach((b) => b.onclick = async () => { await api(`/users/${b.dataset.active}`, { method: "PATCH", body: { active: b.dataset.to === "1" } }); route(); });
    view.querySelectorAll("[data-anon]").forEach((b) => b.onclick = () => confirmModal("Anonymiser ce compte ?",
      "Le nom et l'e-mail seront remplacés, l'historique de positions de ses appareils supprimé. Action irréversible.", true,
      async (reason) => { await api(`/users/${b.dataset.anon}/anonymize`, { method: "POST", body: { reason } }); toast("Compte anonymisé"); route(); }));
  },

  async audit(view) {
    view.innerHTML = `<div class="card"><div class="toolbar"><input id="a-q" placeholder="Filtrer (utilisateur, action, cible)"></div></div>
      <div class="card table-wrap"><table><thead><tr><th>Date</th><th>Auteur</th><th>Action</th><th>Cible</th><th>Motif / détail</th><th>IP</th></tr></thead><tbody id="a-rows"></tbody></table></div>`;
    const load = async () => {
      const rows = await api(`/audit?q=${encodeURIComponent($("#a-q").value)}`);
      $("#a-rows").innerHTML = rows.map((r) => `<tr><td>${esc(fmtDate(r.at))}</td><td>${esc(r.actor)}</td><td>${esc(r.action)}</td>
        <td>${esc(r.target ?? "")}</td><td class="muted">${esc((r.reason ?? "").slice(0, 80))}</td><td class="muted">${esc(r.ip ?? "")}</td></tr>`).join("");
    };
    let t; $("#a-q").oninput = () => { clearTimeout(t); t = setTimeout(load, 250); };
    await load();
  },

  async privacy(view) {
    const h = await fetch("/api/health").then((r) => r.json());
    view.innerHTML = `<div class="card"><h2>Notice de confidentialité</h2>
      <p>${esc(h.org)} utilise cette plateforme pour sécuriser les appareils mobiles professionnels (intérêt légitime, art. 6.1.f du RGPD).</p>
      <ul>
        <li><b>Données collectées :</b> modèle, système, numéro de série, état de sécurité (chiffrement, code, root), applications installées, niveau de batterie.</li>
        <li><b>Localisation :</b> ${h.location_mode === "continuous" ? "relevée périodiquement" : "relevée uniquement sur demande motivée d'un administrateur ou lorsque l'appareil est déclaré perdu ou volé"}.
          Chaque demande est tracée dans le journal d'audit. Les positions sont chiffrées et supprimées automatiquement après la durée de conservation.</li>
        <li><b>Non collecté :</b> contenu des messages, photos, historique de navigation, données des applications personnelles.</li>
        <li><b>Appareil personnel (BYOD) :</b> seul l'espace professionnel peut être effacé ; l'effacement complet est réservé aux appareils de l'entreprise.</li>
        <li><b>Vos droits :</b> accès, rectification, effacement, opposition. Le bouton ci-dessous exporte toutes les données vous concernant.</li>
      </ul>
      <button class="btn primary" id="export">Télécharger mes données (JSON)</button></div>`;
    $("#export").onclick = async () => {
      const data = await api("/me/export");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
      a.download = "mes-donnees-mdm.json"; a.click();
    };
  },
};

// ------------------------------------------------------------------ composants
function kpi(label, value, sub = "", kind = "") {
  return `<div class="card kpi"><div class="label">${esc(label)}</div><div class="value">${esc(value)}</div>
    <div class="sub ${kind ? `badge ${kind}` : "muted"}">${esc(sub)}</div></div>`;
}
function alertList(alerts, closed = false) {
  if (!alerts.length) return `<p class="muted">Aucune alerte</p>`;
  return alerts.map((a) => `<div class="alert-row">${badge(a.severity, SEVERITY[a.severity])}
    <div class="grow"><div>${esc(a.message)}</div><div class="muted small">${esc(fmtDate(a.created_at))}${a.device_id ? ` · <a href="#" data-dev="${esc(a.device_id)}">ouvrir l'appareil</a>` : ""}</div></div>
    ${!closed && state.user.role === "admin" ? `<button class="btn small" data-close="${a.id}">Clore</button>` : ""}</div>`).join("");
}
function bindAlertButtons(root) {
  root.querySelectorAll("[data-close]").forEach((b) => b.onclick = async () => { await api(`/alerts/${b.dataset.close}/close`, { method: "POST", body: {} }); route(); });
  root.querySelectorAll("[data-dev]").forEach((a) => a.onclick = (e) => { e.preventDefault(); openDevice(a.dataset.dev); });
}

async function openDevice(id) {
  const d = await api(`/devices/${id}`);
  const admin = state.user.role === "admin";
  const drawer = $("#drawer"); drawer.classList.remove("hidden");
  const body = $(".drawer-body", drawer);
  body.innerHTML = `
    <div class="drawer-head"><div><h2>${esc(d.name)}</h2><div class="muted">${esc(d.model ?? "")} · ${esc(PLATFORM[d.platform])} ${esc(d.os_version ?? "")}</div></div>
      <button class="btn ghost icon" id="close-drawer" aria-label="Fermer">✕</button></div>
    <div class="actions">${badge(d.status, STATUS[d.status])} ${compliance(d)} ${d.lost_mode ? badge("Mode perdu", "bad") : ""} ${badge(d.ownership, "neutral")}</div>
    ${d.compliance_issues.length ? `<div class="card"><h2>Problèmes de conformité</h2>${d.compliance_issues.map((i) => `<div>${badge(i.severity, SEVERITY[i.severity])} ${esc(i.label)}</div>`).join("")}</div>` : ""}
    <div class="card"><h2>Actions à distance</h2><div class="actions">
      ${d.allowed_commands.filter((c) => !["install_app", "remove_app"].includes(c.type))
        .filter((c) => !(c.type === "lost_mode_on" && d.lost_mode) && !(c.type === "lost_mode_off" && !d.lost_mode))
        .filter((c) => !(c.type === "wipe_full" && d.ownership === "personnel"))
        .map((c) => `<button class="btn small ${c.destructive ? "danger" : ""}" data-cmd="${c.type}">${esc(c.label)}</button>`).join("")}
    </div></div>
    <div class="card"><h2>Localisation</h2>${d.location ? `<div id="mini-map" class="mini-map"></div>
      <p class="muted small">${esc(fmtDate(d.location.located_at))} · source ${esc(d.location.source)}${d.location.accuracy ? ` · précision ${Math.round(d.location.accuracy)} m` : ""}</p>`
      : `<p class="muted">Aucune position enregistrée. Utilisez « Localiser ».</p>`}</div>
    <div class="card"><h2>Informations</h2><dl class="kv">
      <dt>Utilisateur</dt><dd>${esc(d.owner_name ?? "—")} ${d.owner_email ? `<span class="muted">(${esc(d.owner_email)})</span>` : ""}</dd>
      <dt>Gestion</dt><dd>${esc({ agent: "Agent compagnon", android_management: "Android Enterprise", apple_mdm: "MDM Apple" }[d.management] ?? d.management)}</dd>
      <dt>N° de série</dt><dd>${esc(d.serial ?? "—")}</dd>${admin ? `<dt>IMEI</dt><dd>${esc(d.imei ?? "—")}</dd>` : ""}
      <dt>Adresse MAC Wi-Fi</dt><dd>${esc(d.wifi_mac ?? "—")}</dd>
      <dt>Batterie</dt><dd>${d.battery ?? "—"} %</dd><dt>Stockage occupé</dt><dd>${d.storage_used_pct ?? "—"} %</dd>
      <dt>Données mobiles (30 j)</dt><dd>${d.data_usage_mb != null ? `${(d.data_usage_mb / 1024).toFixed(1)} Go` : "—"}</dd>
      <dt>Chiffrement</dt><dd>${d.encrypted ? "Oui" : "Non"}</dd><dt>Code de verrouillage</dt><dd>${d.passcode_set ? "Oui" : "Non"}</dd>
      <dt>Enrôlé le</dt><dd>${esc(fmtDate(d.enrolled_at))}</dd><dt>Dernier contact</dt><dd>${esc(fmtDate(d.last_seen))}</dd>
    </dl></div>
    <div class="card"><h2>Applications (${d.apps.length})</h2>${d.apps.length ? `<table><tbody>${d.apps.map((a) => `<tr><td>${esc(a.name)}<div class="muted small">${esc(a.identifier)}</div></td><td>${esc(a.version ?? "")}</td>
      ${admin ? `<td><button class="btn small ghost" data-rm="${esc(a.identifier)}">Désinstaller</button></td>` : ""}</tr>`).join("")}</tbody></table>` : `<p class="muted">Inventaire non remonté</p>`}</div>
    <div class="card"><h2>Historique des commandes</h2>${d.commands.length ? `<table><tbody>${d.commands.map((c) => `<tr><td>${esc(c.type)}</td><td>${badge(c.status, CMD_STATUS[c.status])}</td>
      <td class="muted small">${esc(c.created_by)}<br>${esc(fmtDate(c.created_at))}</td></tr>`).join("")}</tbody></table>` : `<p class="muted">Aucune commande</p>`}</div>
    ${admin ? `<div class="actions">${d.management === "agent" && d.platform === "android" ? `<button class="btn" id="unlock-code">Code de déblocage</button>` : ""}
      <button class="btn danger" id="retire">Retirer du parc</button></div>` : ""}`;
  const close = () => { drawer.classList.add("hidden"); if (openDevice.map) { openDevice.map.remove(); openDevice.map = null; } };
  $("#close-drawer").onclick = close;
  drawer.onclick = (e) => e.target === drawer && close();
  if (d.location) {
    openDevice.map = L.map("mini-map").setView([d.location.lat, d.location.lon], 14);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" }).addTo(openDevice.map);
    L.marker([d.location.lat, d.location.lon]).addTo(openDevice.map);
  }
  body.querySelectorAll("[data-cmd]").forEach((b) => b.onclick = () => runCommand(d, d.allowed_commands.find((c) => c.type === b.dataset.cmd)));
  body.querySelectorAll("[data-rm]").forEach((b) => b.onclick = async () => {
    await api(`/devices/${d.id}/commands`, { method: "POST", body: { type: "remove_app", params: { identifier: b.dataset.rm } } });
    toast("Désinstallation envoyée"); openDevice(d.id);
  });
  const unlock = $("#unlock-code");
  if (unlock) unlock.onclick = () => confirmModal(`Code de déblocage – ${d.name}`,
    "Ce code permet à l'utilisateur de quitter la gestion ou de retirer la protection de l'agent MDM. Il est valable environ 2 heures. Le motif sera inscrit au journal d'audit.",
    false, async (reason) => {
      try {
        const r = await api(`/devices/${d.id}/unlock-code`, { method: "POST", body: { reason } });
        const m = $("#modal"); m.classList.remove("hidden");
        $(".modal-body", m).innerHTML = `<h2>Code de déblocage</h2><p class="muted">À donner à l'utilisateur de ${esc(d.name)}.</p>
          <p class="unlock-code">${esc(r.code.replace(/(\d{4})(\d{4})/, "$1 $2"))}</p>
          <p class="muted small">Valable jusqu'à ${esc(fmtDate(r.valid_until))} environ.</p>
          <div class="actions"><button class="btn primary" id="m-done">Fermer</button></div>`;
        $("#m-done").onclick = () => m.classList.add("hidden");
      } catch (e) { toast(e.message); }
    });
  const retire = $("#retire");
  if (retire) retire.onclick = () => confirmModal("Retirer cet appareil ?", "Il ne sera plus géré ni visible dans le parc.", false,
    async () => { await api(`/devices/${d.id}`, { method: "DELETE" }); close(); route(); });
}

function runCommand(d, cmd) {
  const needsReason = cmd.destructive || (cmd.type === "locate" && state.user.role === "admin" && !d.lost_mode) || cmd.type === "lost_mode_on";
  const send = async (reason) => {
    try {
      await api(`/devices/${d.id}/commands`, { method: "POST", body: { type: cmd.type, reason } });
      toast(`« ${cmd.label} » envoyé à ${d.name}`); openDevice(d.id); if (location.hash !== "#/map") route();
    } catch (e) { toast(e.message); }
  };
  if (!needsReason && !cmd.destructive) return send("");
  const text = cmd.destructive
    ? `Cette action est irréversible. ${cmd.type === "wipe_full" ? "Toutes les données de l'appareil seront effacées." : "Les applications et données de l'entreprise seront supprimées et l'appareil désenrôlé."}`
    : cmd.type === "locate" ? "Le RGPD impose de justifier chaque localisation. Le motif sera inscrit au journal d'audit."
    : "L'appareil sera verrouillé avec un message, localisé régulièrement et une alerte critique sera créée.";
  confirmModal(`${cmd.label} – ${d.name}`, text, cmd.destructive, send, true);
}

function confirmModal(title, text, danger, onOk, withReason = true) {
  const m = $("#modal"); m.classList.remove("hidden");
  $(".modal-body", m).innerHTML = `<h2>${esc(title)}</h2><p>${esc(text)}</p>
    ${withReason ? `<label>Motif<textarea id="m-reason" rows="2" placeholder="Ex. : vol signalé par l'utilisateur, ticket n°…"></textarea></label>` : ""}
    ${danger ? `<label>Tapez CONFIRMER pour valider<input id="m-confirm" autocomplete="off"></label>` : ""}
    <div class="actions"><button class="btn" id="m-cancel">Annuler</button><button class="btn ${danger ? "danger solid" : "primary"}" id="m-ok">Valider</button></div>`;
  $("#m-cancel").onclick = () => m.classList.add("hidden");
  $("#m-ok").onclick = async () => {
    const reason = $("#m-reason")?.value.trim() ?? "";
    if (withReason && !reason) return toast("Le motif est obligatoire");
    if (danger && $("#m-confirm")?.value !== "CONFIRMER") return toast("Tapez CONFIRMER pour valider");
    m.classList.add("hidden");
    try { await onOk(reason); } catch (e) { toast(e.message); }
  };
}

function appForm(app) {
  const m = $("#modal"); m.classList.remove("hidden");
  $(".modal-body", m).innerHTML = `<h2>${app ? "Modifier" : "Ajouter"} une application</h2>
    <form id="app-form" class="grid">
      <label>Nom<input name="name" required value="${esc(app?.name)}"></label>
      ${app ? "" : `<label>Identifiant (package Android / bundle ID iOS)<input name="identifier" required placeholder="com.exemple.app"></label>
      <label>Plateforme<select name="platform"><option value="android">Android</option><option value="ios">iOS</option></select></label>
      <label>Source<select name="source"><option value="store">Magasin (Play Store / App Store)</option><option value="entreprise">Application interne</option></select></label>`}
      <label>Version<input name="version" value="${esc(app?.version)}"></label>
      <label>Catégorie<input name="category" value="${esc(app?.category)}"></label>
      <label>URL de téléchargement (apps internes)<input name="download_url" value="${esc(app?.download_url)}"></label>
      <label class="check"><input type="checkbox" name="mandatory" ${app?.mandatory ? "checked" : ""}> Obligatoire (installée d'office)</label>
      <label class="check"><input type="checkbox" name="blocked" ${app?.blocked ? "checked" : ""}> Interdite (rend l'appareil non conforme)</label>
      <div class="actions">${app ? `<button type="button" class="btn danger" id="app-del">Supprimer</button>` : ""}<button type="button" class="btn" id="app-cancel">Annuler</button><button class="btn primary">Enregistrer</button></div>
    </form>`;
  $("#app-cancel").onclick = () => m.classList.add("hidden");
  if (app) $("#app-del").onclick = async () => { await api(`/apps/${app.id}`, { method: "DELETE" }); m.classList.add("hidden"); route(); };
  $("#app-form").onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const body = { ...f, mandatory: !!f.mandatory, blocked: !!f.blocked };
    try {
      await api(app ? `/apps/${app.id}` : "/apps", { method: app ? "PATCH" : "POST", body });
      m.classList.add("hidden"); toast("Catalogue mis à jour"); route();
    } catch (err) { toast(err.message); }
  };
}

async function deployApp(app, action) {
  const devices = (await api(`/devices?platform=${app.platform}`)).filter((d) => ["actif", "perdu"].includes(d.status));
  const m = $("#modal"); m.classList.remove("hidden");
  $(".modal-body", m).innerHTML = `<h2>${action === "remove" ? "Désinstaller" : "Installer"} ${esc(app.name)}</h2>
    <label class="check"><input type="checkbox" id="all" checked> Tous les appareils ${esc(PLATFORM[app.platform])} (${devices.length})</label>
    <div id="dev-pick" class="hidden" style="max-height:240px;overflow:auto">${devices.map((d) =>
      `<label class="check"><input type="checkbox" value="${esc(d.id)}"> ${esc(d.name)} <span class="muted small">${esc(d.owner_name ?? "")}</span></label>`).join("")}</div>
    <div class="actions"><button class="btn" id="d-cancel">Annuler</button><button class="btn primary" id="d-ok">Envoyer</button></div>`;
  $("#all").onchange = (e) => $("#dev-pick").classList.toggle("hidden", e.target.checked);
  $("#d-cancel").onclick = () => m.classList.add("hidden");
  $("#d-ok").onclick = async () => {
    const ids = $("#all").checked ? [] : [...m.querySelectorAll("#dev-pick input:checked")].map((i) => i.value);
    if (!$("#all").checked && !ids.length) return toast("Sélectionnez au moins un appareil");
    const r = await api(`/apps/${app.id}/deploy`, { method: "POST", body: { device_ids: ids, action } });
    m.classList.add("hidden"); toast(`${r.commands} commande(s) envoyée(s)`);
  };
}

function userForm() {
  const m = $("#modal"); m.classList.remove("hidden");
  $(".modal-body", m).innerHTML = `<h2>Nouvel utilisateur</h2><form id="u-form" class="grid">
    <label>Nom complet<input name="name" required></label><label>E-mail<input name="email" type="email" required></label>
    <label>Rôle<select name="role"><option value="user">Utilisateur</option><option value="admin">Administrateur</option></select></label>
    <label>Mot de passe initial<input name="password" type="password" required minlength="10"></label>
    <p class="muted small">10 caractères minimum avec majuscule, minuscule, chiffre et caractère spécial.</p>
    <div class="actions"><button type="button" class="btn" id="u-cancel">Annuler</button><button class="btn primary">Créer</button></div></form>`;
  $("#u-cancel").onclick = () => m.classList.add("hidden");
  $("#u-form").onsubmit = async (e) => {
    e.preventDefault();
    try { await api("/users", { method: "POST", body: Object.fromEntries(new FormData(e.target)) }); m.classList.add("hidden"); toast("Compte créé"); route(); }
    catch (err) { toast(err.message); }
  };
}

// ------------------------------------------------------------------ session
async function start() {
  try { state.user = await api("/auth/me"); } catch { return showLogin(); }
  $("#login").classList.add("hidden"); $("#app").classList.remove("hidden");
  $("#me-name").textContent = state.user.name;
  $("#me-role").textContent = state.user.role === "admin" ? "Administrateur" : "Utilisateur";
  fetch("/api/health").then((r) => r.json()).then((h) => { $("#org-name").textContent = h.org; });
  const alerts = await api("/alerts").catch(() => []);
  renderNav(alerts.length);
  route();
}
function showLogin() { $("#app").classList.add("hidden"); $("#login").classList.remove("hidden"); }
function logout() { state.token = null; state.user = null; sessionStorage.removeItem("mdm_token"); showLogin(); }

$("#login-form").onsubmit = async (e) => {
  e.preventDefault();
  $("#login-error").textContent = "";
  try {
    const r = await api("/auth/login", { method: "POST", body: Object.fromEntries(new FormData(e.target)) });
    state.token = r.token; sessionStorage.setItem("mdm_token", r.token); start();
  } catch (err) { $("#login-error").textContent = err.message; }
};
$("#logout").onclick = logout;
$("#menu").onclick = () => $(".sidebar").classList.toggle("open");
window.addEventListener("hashchange", route);
document.addEventListener("keydown", (e) => { if (e.key === "Escape") { $("#modal").classList.add("hidden"); $("#drawer").classList.add("hidden"); } });
// Ouverture depuis le back-office Zedeka : #sso=<jeton d'une minute>, échangé contre une session.
async function boot() {
  const m = location.hash.match(/^#sso=([\w.-]+)$/);
  if (m) {
    history.replaceState(null, "", location.pathname);
    try {
      const r = await api("/auth/sso", { method: "POST", body: { token: m[1] } });
      state.token = r.token; sessionStorage.setItem("mdm_token", r.token);
    } catch (e) { showLogin(); $("#login-error").textContent = e.message; return; }
  }
  state.token ? start() : showLogin();
}
boot();
