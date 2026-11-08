// Mitgliederbereich: Login-Status, Navigation (Hash-Router) und die einzelnen Ansichten.
import { api, esc, fmtDate, icon, initI18n, lang, modal, T, timeAgo, toast } from "./core";
// @ts-ignore -- reines JS-Modul
import { renderVods, vodCleanup } from "./vods.js";
import { enhancePicker, closePicker } from "./picker";
import { timeRange, timeShort } from "../schedule";

type Me = {
  id: number; display_name: string; username: string; avatar_url: string | null; rank: string; public_rank: string;
  coach_roles: string[]; ingame_name: string | null; main_role: string | null; country: string | null;
  weapons: string[]; weapon_other: string | null;
  show_on_team: boolean; lang: string | null; is_member: boolean; can_manage: boolean; is_admin: boolean; rank_manual: boolean;
};

const root = document.getElementById("app-root")!;
let me: Me | null = null;
const ROLES = ["healer", "tank", "dps"];                       // Hauptrollen
const WEAPONS_BY_ROLE: Record<string, string[]> = { dps: ["nameless_sword", "strategic_sword", "nameless_spear", "heavenquaker_spear", "infernal_twinblades", "inkwell_fan", "vernal_umbrella", "mortal_rope_dart", "ninefold_umbrella"], tank: ["stormbreaker_spear", "thundercry_blade"], healer: ["panacea_fan", "soulshade_umbrella", "ribbon_drum"] };
const COACH_ROLES = ["healer", "tank", "nameless", "twinblades"]; // Coaches sind auf Waffen spezialisiert
const RANK_KEYS: Record<string, string> = { developer: "rank_developer", leader: "rank_leader", vice: "rank_vice", management: "rank_management", coach: "rank_coach", member: "rank_member", guest: "rank_guest" };

function avatar(u: { avatar_url: string | null; display_name: string }, size = 32) {
  return u.avatar_url
    ? `<img class="av" src="${esc(u.avatar_url)}" alt="" width="${size}" height="${size}" referrerpolicy="no-referrer">`
    : `<span class="av av-fb" style="width:${size}px;height:${size}px">${esc((u.display_name || "?")[0].toUpperCase())}</span>`;
}
const rankBadge = (r: string) => `<span class="badge badge-${esc(r)}">${esc(T(RANK_KEYS[r] || r))}</span>`;
const roleTag = (r: string | null) => (r ? `<span class="role-tag role-${esc(r)}">${esc(T("role_" + r))}</span>` : "");
// Rolle + Waffen kompakt: "DPS · Nameless, Twinblades"
const weaponText = (w: string[] = [], other: string | null = null) => [...w.map((x) => T("weapon_" + x)), ...(other ? [other] : [])].join(", ");
const roleWeapons = (r: string | null, w: string[] = [], other: string | null = null) => {
  const wt = weaponText(w, other);
  return roleTag(r) + (wt ? `<span class="muted weapons-tag">${r ? "· " : ""}${esc(wt)}</span>` : "");
};
const flag = (cc: string | null) => (cc && /^[A-Z]{2}$/i.test(cc) ? `<img class="flag" src="/flags/${cc.toLowerCase()}.svg" alt="${cc.toUpperCase()}" width="20" height="15" loading="lazy">` : "");

// ------------------------------------------------------------------ Start

export async function start() {
  const data = JSON.parse(root.dataset.dict || "{}");
  initI18n(data, root.dataset.lang || "en");
  window.addEventListener("hashchange", route);
  window.addEventListener("juiced:unauthorized", () => { me = null; renderLogin(); });
  try {
    const r = await api<{ user: Me | null; login_configured: boolean }>("/auth/me");
    me = r.user;
    if (!me) return renderLogin(r.login_configured);
    if (!me.is_member) return renderNoAccess();
    renderShell();
    route();
  } catch {
    root.innerHTML = `<div class="app-center"><p>${esc(T("error"))}</p></div>`;
  }
}

function renderLogin(configured = true) {
  const next = encodeURIComponent(location.pathname + location.hash);
  root.innerHTML = `<div class="app-center">
    <div class="login-card card">
      <span class="login-ico">${icon.shield}</span>
      <h1>${esc(T("app_login_t"))}</h1>
      <p>${esc(T("app_login_b"))}</p>
      <a class="btn btn-primary discord-btn ${configured ? "" : "disabled"}" href="/api/auth/login?next=${next}">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20.3 4.9A17.6 17.6 0 0 0 15.9 3.5l-.6 1.2a16.3 16.3 0 0 0-6.6 0L8.1 3.5a17.6 17.6 0 0 0-4.4 1.4C1 9 .3 13 .6 16.9a17.8 17.8 0 0 0 5.4 2.7l1.2-1.9c-.7-.2-1.3-.5-1.9-.9l.5-.4a12.7 12.7 0 0 0 12.4 0l.5.4c-.6.4-1.2.7-1.9.9l1.2 1.9a17.8 17.8 0 0 0 5.4-2.7c.4-4.5-.7-8.4-3.1-12ZM8.5 14.6c-1 0-1.9-1-1.9-2.1s.8-2.1 1.9-2.1 1.9 1 1.9 2.1-.8 2.1-1.9 2.1Zm7 0c-1 0-1.9-1-1.9-2.1s.8-2.1 1.9-2.1 1.9 1 1.9 2.1-.8 2.1-1.9 2.1Z"/></svg>
        ${esc(T("app_login_btn"))}
      </a>
    </div></div>`;
}

function renderNoAccess() {
  root.innerHTML = `<div class="app-center">
    <div class="login-card card">
      ${avatar(me!, 56)}
      <h1>${esc(T("app_noaccess_t"))}</h1>
      <p>${esc(T("app_noaccess_b"))}</p>
      <div class="row-gap"><a class="btn btn-outline" href="https://discord.gg/juiced" target="_blank" rel="noopener">Discord</a>
      <button class="btn btn-ghost" data-logout>${icon.logout} ${esc(T("nav_logout"))}</button></div>
    </div></div>`;
  bindLogout();
}

function bindLogout() {
  root.querySelectorAll("[data-logout]").forEach((b) => b.addEventListener("click", async () => {
    await api("/auth/logout", { method: "POST" }).catch(() => {});
    location.href = `/${lang()}/`;
  }));
}

// ------------------------------------------------------------------ Layout + Router

function navItems() {
  const items = [
    { id: "", label: T("app_nav_dashboard"), ico: icon.grid },
    { id: "vods", label: T("app_nav_vods"), ico: icon.video },
    { id: "roster", label: T("app_nav_members"), ico: icon.users },
  ];
  if (me!.is_admin) items.push({ id: "schedule", label: T("app_nav_schedule"), ico: icon.calendar });
  if (me!.is_admin) items.push({ id: "matches", label: T("app_nav_matches"), ico: icon.swords });
  if (me!.can_manage) items.push({ id: "applications", label: T("app_nav_apps"), ico: icon.inbox });
  if (me!.is_admin) items.push({ id: "admin", label: T("app_nav_admin"), ico: icon.shield });
  items.push({ id: "profile", label: T("app_nav_profile"), ico: icon.settings });
  return items;
}

function renderShell() {
  root.innerHTML = `<div class="app">
    <aside class="side">
      <div class="side-user">${avatar(me!, 40)}<div><strong>${esc(me!.display_name)}</strong>${rankBadge(me!.public_rank)}</div></div>
      <nav class="side-nav">${navItems().map((n) => `<a href="#/${n.id}" data-nav="${n.id}" title="${esc(n.label)}">${n.ico}<span>${esc(n.label)}</span></a>`).join("")}</nav>
      <button class="side-logout" data-logout>${icon.logout} ${esc(T("nav_logout"))}</button>
    </aside>
    <section class="view" id="view"></section>
  </div>`;
  bindLogout();
  refreshBadges();
}

// Offene Punkte als Zahl an den Menüpunkten (gleiche Daten wie die Glocke im Header).
// Die Glocke fragt regelmäßig nach (juiced:bell), hier wird nur direkt nach eigenen Aktionen neu geladen.
type Counts = { applications: number; matches: number; vods: number; total: number };
function applyBadges(n: Counts) {
  const map: Record<string, number> = { applications: n.applications, matches: n.matches, vods: n.vods };
  root.querySelectorAll<HTMLElement>("[data-nav]").forEach((a) => {
    const c = map[a.dataset.nav || ""] || 0;
    const cur = a.querySelector<HTMLElement>(".nbadge");
    const txt = c > 99 ? "99+" : String(c);
    if (!c) { cur?.remove(); return; }
    if (cur) { if (cur.textContent !== txt) cur.textContent = txt; }
    else a.insertAdjacentHTML("beforeend", `<span class="nbadge">${txt}</span>`);
  });
}
window.addEventListener("juiced:bell", (e) => applyBadges((e as CustomEvent).detail));
export async function refreshBadges() {
  try {
    const n = await api<Counts>("/notifications");
    applyBadges(n);
    window.dispatchEvent(new CustomEvent("juiced:notifications", { detail: n }));
  } catch { /* egal */ }
}

function route() {
  if (!me || !me.is_member) return;
  const h = location.hash.replace(/^#\/?/, "");
  const seg = h.split(/[/?]/)[0];
  root.querySelectorAll<HTMLElement>("[data-nav]").forEach((a) => a.classList.toggle("active", a.dataset.nav === seg));
  const view = document.getElementById("view")!;
  if (seg !== "vods") vodCleanup();
  closePicker();
  document.body.classList.toggle("vod-focus", /^vods\/\d+/.test(h));
  view.classList.remove("in");
  void view.offsetWidth;
  view.classList.add("in");
  switch (seg) {
    case "vods": return renderVods(view, me);
    case "roster": return viewRoster(view);
    case "applications": return me.can_manage ? viewApplications(view) : viewDashboard(view);
    case "schedule": return me.is_admin ? viewSchedule(view) : viewDashboard(view);
    case "matches": return me.is_admin ? viewMatches(view) : viewDashboard(view);
    case "admin": return me.is_admin ? viewAdmin(view) : viewDashboard(view);
    case "profile": return viewProfile(view);
    default: return viewDashboard(view);
  }
}

const head = (title: string, sub = "", actions = "") =>
  `<header class="v-head"><div><h1>${esc(title)}</h1>${sub ? `<p>${esc(sub)}</p>` : ""}</div>${actions ? `<div class="v-actions">${actions}</div>` : ""}</header>`;
const loading = `<div class="loader"><span class="spinner"></span></div>`;

// ------------------------------------------------------------------ Übersicht / Ankündigungen

async function viewDashboard(view: HTMLElement) {
  view.innerHTML = head(T("dash_hello", { name: me!.display_name }), T("dash_sub"),
    me!.can_manage ? `<button class="btn btn-primary btn-sm" data-new>${icon.plus} ${esc(T("ann_new"))}</button>` : "") +
    `<div class="quick">
      <a class="quick-card card" href="#/vods">${icon.video}<span>${esc(T("app_nav_vods"))}</span></a>
      <a class="quick-card card" href="#/roster">${icon.users}<span>${esc(T("app_nav_members"))}</span></a>
      <a class="quick-card card" href="#/profile">${icon.settings}<span>${esc(T("app_nav_profile"))}</span></a>
    </div>
    <h2 class="v-sub">${esc(T("week_title"))}</h2><div id="next-ev">${loading}</div>
    <h2 class="v-sub">${esc(T("ann_title"))}</h2><div id="ann">${loading}</div>`;
  loadNextEvents(view.querySelector("#next-ev")!);
  view.querySelector("[data-new]")?.addEventListener("click", () => editAnnouncement(null, () => viewDashboard(view)));
  try {
    const list = await api<any[]>("/announcements");
    const el = view.querySelector("#ann")!;
    if (!list.length) { el.innerHTML = `<p class="empty">${esc(T("ann_empty"))}</p>`; return; }
    el.innerHTML = list.map((a) => `<article class="ann card ${a.pinned ? "pinned" : ""}" data-id="${a.id}">
      <div class="ann-head">
        ${a.pinned ? `<span class="badge badge-leader">${icon.pin} ${esc(T("ann_pinned"))}</span>` : ""}
        <h3>${esc(a.title)}</h3>
        ${a.can_edit ? `<div class="ann-actions"><button class="btn btn-ghost btn-sm" data-edit>${icon.edit}</button><button class="btn btn-ghost btn-sm" data-del>${icon.trash}</button></div>` : ""}
      </div>
      <div class="ann-body">${esc(a.body).replace(/\n/g, "<br>")}</div>
      <div class="ann-meta">${a.author_avatar ? `<img src="${esc(a.author_avatar)}" alt="" width="18" height="18">` : ""}${esc(a.author || "")} · ${esc(timeAgo(a.created_at))}</div>
    </article>`).join("");
    el.querySelectorAll<HTMLElement>(".ann").forEach((card) => {
      const a = list.find((x) => x.id === Number(card.dataset.id));
      card.querySelector("[data-edit]")?.addEventListener("click", () => editAnnouncement(a, () => viewDashboard(view)));
      card.querySelector("[data-del]")?.addEventListener("click", async () => {
        if (!confirm(T("ann_delete_confirm"))) return;
        await api(`/announcements/${a.id}`, { method: "DELETE" }).catch((e) => toast(e.message));
        viewDashboard(view);
      });
    });
  } catch (e) { view.querySelector("#ann")!.innerHTML = `<p class="empty">${esc((e as Error).message)}</p>`; }
}

function editAnnouncement(a: any | null, done: () => void) {
  const m = modal(a ? T("edit") : T("ann_new"), `
    <div class="field"><label>${esc(T("ann_ph_title"))}</label><input class="input" id="an-title" maxlength="160" value="${esc(a?.title || "")}"></div>
    <div class="field"><label>&nbsp;</label><textarea class="textarea" id="an-body" rows="7" maxlength="8000" placeholder="${esc(T("ann_ph_body"))}">${esc(a?.body || "")}</textarea></div>
    <label class="check"><input type="checkbox" id="an-pin" ${a?.pinned ? "checked" : ""}> <span>${esc(T("ann_pin"))}</span></label>`,
    `<button class="btn btn-primary" data-save>${esc(a ? T("save") : T("ann_post"))}</button>`);
  m.el.querySelector("[data-save]")!.addEventListener("click", async () => {
    const json = {
      title: (m.el.querySelector("#an-title") as HTMLInputElement).value,
      body: (m.el.querySelector("#an-body") as HTMLTextAreaElement).value,
      pinned: (m.el.querySelector("#an-pin") as HTMLInputElement).checked,
    };
    try {
      await api(a ? `/announcements/${a.id}` : "/announcements", { method: a ? "PUT" : "POST", json });
      m.close(); done();
    } catch (e) { toast((e as Error).message); }
  });
}

// ------------------------------------------------------------------ Roster (intern)

async function viewRoster(view: HTMLElement) {
  view.innerHTML = head(T("mem_title")) + `<input class="input search" placeholder="${esc(T("mem_search"))}" data-q><div id="rost">${loading}</div>`;
  let list: any[] = [];
  const draw = () => {
    const q = (view.querySelector("[data-q]") as HTMLInputElement).value.toLowerCase();
    const items = list.filter((u) => !q || `${u.display_name} ${u.username}`.toLowerCase().includes(q));
    view.querySelector("#rost")!.innerHTML = items.length ? `<div class="table card">${items.map((u) => `
      <div class="tr">${avatar(u, 34)}<div class="tr-main"><strong>${esc(u.display_name)}</strong><span class="muted">@${esc(u.username)}</span></div>
      <div class="tr-tags">${rankBadge(u.rank)} ${u.coach_roles.map((r: string) => `<span class="badge">${esc(T("rank_coach"))} ${esc(T("role_" + r))}</span>`).join(" ")} ${roleWeapons(u.main_role, u.weapons, u.weapon_other)} <span>${flag(u.country)}</span></div></div>`).join("")}</div>`
      : `<p class="empty">${esc(T("mem_empty"))}</p>`;
  };
  view.querySelector("[data-q]")!.addEventListener("input", draw);
  try { list = await api<any[]>("/members"); draw(); } catch (e) { toast((e as Error).message); }
}

// ------------------------------------------------------------------ Bewerbungen (Leader / Vice)

async function viewApplications(view: HTMLElement) {
  view.innerHTML = head(T("apps_title")) + `<div id="apps">${loading}</div>`;
  const el = view.querySelector("#apps")!;
  try {
    const list = await api<any[]>("/applications");
    if (!list.length) { el.innerHTML = `<p class="empty">${esc(T("apps_empty"))}</p>`; return; }
    const st: Record<string, string> = { pending: T("apps_pending"), accepted: T("apps_accepted"), rejected: T("apps_rejected") };
    el.innerHTML = list.map((a) => `<article class="app-card card" data-id="${a.id}" data-status="${a.status}">
      <div class="app-top"><div><h3>${esc(a.ingame)}</h3><span class="muted">${esc(a.discord)} · ${esc(a.country)} · ${esc(timeAgo(a.created_at))}</span></div>
        <span class="status status-${a.status}">${esc(st[a.status])}</span></div>
      <div class="app-tags">${roleWeapons(a.main_role, a.weapons, a.weapon_other)}${a.region ? `<span class="badge">${esc(a.region.toUpperCase() === "EU" ? "EU" : T("region_other"))}</span>` : ""}${a.gear_score ? `<span class="badge badge-gs">${esc(T("apps_gs"))} ${esc(Number(a.gear_score).toLocaleString(loc()))}</span>` : ""}${a.arena_rank ? `<span class="badge">${esc(T("apps_arena"))}: ${esc(a.arena_rank)}</span>` : ""}${a.times ? `<span class="muted">${esc(a.times)}</span>` : ""}${a.lang ? `<span class="badge">${esc(a.lang)}</span>` : ""}</div>
      ${a.platforms && a.platforms.length ? `<div class="app-tags"><span class="muted">${esc(T("apps_platforms"))}:</span>${a.platforms.map((p: string) => `<span class="badge">${esc(T("plat_" + p))}</span>`).join("")}</div>` : ""}
      ${a.build || a.inner_ways || (a.build_images || []).length ? `<div class="app-build">
        <span class="muted">${esc(T("apps_build"))}</span>
        ${a.build ? `<p class="app-text">${esc(a.build)}</p>` : ""}
        ${a.inner_ways ? `<p class="app-text"><strong>${esc(T("apps_inner"))}:</strong> ${esc(a.inner_ways)}</p>` : ""}
        ${a.build_link ? `<a href="${esc(a.build_link)}" target="_blank" rel="noopener noreferrer nofollow">${esc(shortUrl(a.build_link))}</a>` : ""}
        ${(a.build_images || []).length ? `<div class="app-shots">${a.build_images.map((u: string) => `<a href="${esc(u)}" target="_blank" rel="noopener"><img src="${esc(u)}" alt="" loading="lazy"></a>`).join("")}</div>` : ""}
      </div>` : ""}
      <p class="app-text">${esc(a.experience)}</p>${a.why ? `<p class="app-text muted">${esc(a.why)}</p>` : ""}
      ${a.vod_links && a.vod_links.length ? `<div class="vod-links"><span class="muted">${esc(T("apps_vods"))}:</span>${a.vod_links.map((u: string) => `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer nofollow">${esc(shortUrl(u))}</a>`).join("")}</div>` : ""}
      <div class="row-gap">
        ${a.status !== "accepted" ? `<button class="btn btn-primary btn-sm" data-s="accepted">${icon.check} ${esc(T("apps_accept"))}</button>` : ""}
        ${a.status !== "rejected" ? `<button class="btn btn-outline btn-sm" data-s="rejected">${esc(T("apps_reject"))}</button>` : ""}
        <button class="btn btn-ghost btn-sm" data-del>${icon.trash}</button>
      </div></article>`).join("");
    el.querySelectorAll<HTMLElement>(".app-card").forEach((c) => {
      const id = c.dataset.id;
      c.querySelectorAll<HTMLElement>("[data-s]").forEach((b) => b.addEventListener("click", async () => {
        await api(`/applications/${id}`, { method: "PUT", json: { status: b.dataset.s } }).catch((e) => toast(e.message));
        refreshBadges();
        viewApplications(view);
      }));
      c.querySelector("[data-del]")!.addEventListener("click", async () => {
        if (!confirm(T("apps_delete_confirm"))) return;
        await api(`/applications/${id}`, { method: "DELETE" }).catch((e) => toast(e.message));
        viewApplications(view);
      });
    });
  } catch (e) { el.innerHTML = `<p class="empty">${esc((e as Error).message)}</p>`; }
}

// ------------------------------------------------------------------ Ränge & Rollen (Leader / Vice)

async function viewAdmin(view: HTMLElement) {
  view.innerHTML = head(T("admin_title"), T("admin_sub")) + `<input class="input search" placeholder="${esc(T("admin_search"))}" data-q><div id="adm">${loading}</div>`;
  let list: any[] = [];
  const ranks = ["guest", "member", "vice", "leader", ...(me!.rank === "developer" ? ["developer"] : [])];
  const draw = () => {
    const q = (view.querySelector("[data-q]") as HTMLInputElement).value.toLowerCase();
    const items = list.filter((u) => !q || `${u.display_name} ${u.username}`.toLowerCase().includes(q));
    view.querySelector("#adm")!.innerHTML = `<div class="table card">${items.map((u) => `
      <div class="tr tr-admin" data-id="${u.id}">${avatar(u, 34)}
        <div class="tr-main"><strong>${esc(u.display_name)}</strong><span class="muted">@${esc(u.username)} · ${esc(u.rank_manual ? T("admin_manual") : T("admin_from_discord"))}</span></div>
        <div class="tr-ctrl">
          <select class="select" data-rank aria-label="${esc(T("admin_rank"))}">${ranks.map((r) => `<option value="${r}" ${u.rank === r ? "selected" : ""}>${esc(T(RANK_KEYS[r]))}</option>`).join("")}</select>
          <div class="coach-pick"><span class="coach-label">${esc(T("admin_coach_for"))}:</span><div class="chips">${COACH_ROLES.map((r) => `<button class="chip role-${r} ${u.coach_roles.includes(r) ? "active" : ""}" data-coach="${r}" aria-pressed="${u.coach_roles.includes(r)}">${esc(T("role_" + r))}</button>`).join("")}</div></div>
          ${u.rank_manual ? `<button class="btn btn-ghost btn-sm" data-sync title="${esc(T("admin_use_discord"))}">${icon.refresh}</button>` : ""}
        </div></div>`).join("")}</div>`;
    view.querySelectorAll<HTMLElement>(".tr-admin").forEach((row) => {
      const u = list.find((x) => x.id === Number(row.dataset.id));
      const save = async (json: any) => {
        try { Object.assign(u, await api(`/admin/users/${u.id}`, { method: "PUT", json })); toast(T("saved")); }
        catch (e) { toast((e as Error).message); }
        draw();
      };
      row.querySelector<HTMLSelectElement>("[data-rank]")!.addEventListener("change", (e) => save({ rank: (e.target as HTMLSelectElement).value }));
      row.querySelectorAll<HTMLElement>("[data-coach]").forEach((b) => b.addEventListener("click", () => {
        const r = b.dataset.coach!;
        save({ coach_roles: u.coach_roles.includes(r) ? u.coach_roles.filter((x: string) => x !== r) : [...u.coach_roles, r] });
      }));
      row.querySelector("[data-sync]")?.addEventListener("click", () => save({ use_discord: true }));
    });
  };
  view.querySelector("[data-q]")!.addEventListener("input", draw);
  try { list = await api<any[]>("/admin/users"); draw(); } catch (e) { toast((e as Error).message); }
}

// ------------------------------------------------------------------ Profil

const COUNTRIES = ["AE", "AL", "AM", "AR", "AT", "AU", "AZ", "BA", "BE", "BG", "BR", "BY", "CA", "CH", "CL", "CN", "CO", "CY", "CZ", "DE", "DK", "DZ", "EE", "EG", "ES", "FI", "FR", "GB", "GE", "GR", "HR", "HU", "ID", "IE", "IL", "IN", "IS", "IT", "JP", "KR", "KZ", "LT", "LU", "LV", "MA", "MD", "ME", "MK", "MT", "MX", "MY", "NG", "NL", "NO", "NZ", "PE", "PH", "PK", "PL", "PT", "RO", "RS", "RU", "SA", "SE", "SG", "SI", "SK", "TH", "TN", "TR", "TW", "UA", "US", "VE", "VN", "XK", "ZA"];

function viewProfile(view: HTMLElement) {
  const regionName = (() => { try { return new Intl.DisplayNames([lang()], { type: "region" }); } catch { return null; } })();
  const opts = COUNTRIES.map((c) => ({ c, n: regionName?.of(c) || c })).sort((a, b) => a.n.localeCompare(b.n));
  view.innerHTML = head(T("prof_title")) + `<form class="profile card" novalidate>
    <div class="prof-top">${avatar(me!, 56)}<div><strong>${esc(me!.username)}</strong>${rankBadge(me!.public_rank)}</div></div>
    <div class="field"><label for="p-name">${esc(T("prof_ingame"))}</label><input class="input" id="p-name" maxlength="40" value="${esc(me!.ingame_name || "")}"></div>
    <div class="field"><span class="label">${esc(T("prof_role"))}</span><div class="chips">${ROLES.map((r) => `<button type="button" class="chip role-${r}" aria-pressed="${me!.main_role === r}" data-role="${r}">${esc(T("role_" + r))}</button>`).join("")}</div></div>
    <div class="field" data-weapons-field ${me!.main_role ? "" : "hidden"}><span class="label">${esc(T("prof_weapons"))}</span><div class="chips">${Object.entries(WEAPONS_BY_ROLE).map(([r, ws]) => ws.map((w) => `<button type="button" class="chip" aria-pressed="${(me!.weapons || []).includes(w)}" data-weapon="${w}" data-for="${r}" ${me!.main_role === r ? "" : "hidden"}>${esc(T("weapon_" + w))}</button>`).join("")).join("")}
      <input class="input weapon-other" id="p-wother" maxlength="40" placeholder="${esc(T("join_weapon_other"))}" value="${esc(me!.weapon_other || "")}"></div></div>
    <div class="field"><label for="p-country">${esc(T("prof_country"))}</label><select class="select" id="p-country"><option value="">—</option>${opts.map((o) => `<option value="${o.c}" ${me!.country === o.c ? "selected" : ""}>${esc(o.n)}</option>`).join("")}</select></div>
    <label class="check"><input type="checkbox" id="p-show" ${me!.show_on_team ? "checked" : ""}> <span>${esc(T("prof_show"))}</span></label>
    <button class="btn btn-primary" type="submit">${esc(T("save"))}</button>
  </form>`;
  let role = me!.main_role;
  const weapons = new Set<string>(me!.weapons || []);
  view.querySelectorAll<HTMLElement>("[data-weapon]").forEach((b) => b.addEventListener("click", () => {
    const w = b.dataset.weapon!;
    weapons.has(w) ? weapons.delete(w) : weapons.add(w);
    b.setAttribute("aria-pressed", String(weapons.has(w)));
  }));
  view.querySelectorAll<HTMLElement>("[data-role]").forEach((b) => b.addEventListener("click", () => {
    role = role === b.dataset.role ? null : b.dataset.role!;
    view.querySelector<HTMLElement>("[data-weapons-field]")!.hidden = !role;
    view.querySelectorAll<HTMLElement>("[data-weapon]").forEach((x) => {
      const mine = x.dataset.for === role;
      x.hidden = !mine;
      if (!mine && weapons.delete(x.dataset.weapon!)) x.setAttribute("aria-pressed", "false");
    });
    view.querySelectorAll("[data-role]").forEach((x) => x.setAttribute("aria-pressed", String((x as HTMLElement).dataset.role === role)));
  }));
  view.querySelector("form")!.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const r = await api<{ user: Me }>("/me", { method: "PUT", json: {
        ingame_name: (view.querySelector("#p-name") as HTMLInputElement).value,
        main_role: role, weapons: role ? [...weapons] : [],
        weapon_other: role ? (view.querySelector("#p-wother") as HTMLInputElement).value : "",
        country: (view.querySelector("#p-country") as HTMLSelectElement).value || null,
        show_on_team: (view.querySelector("#p-show") as HTMLInputElement).checked, lang: lang(),
      } });
      me = r.user;
      toast(T("saved"));
      renderShell(); route();
    } catch (err) { toast((err as Error).message); }
  });
}



// ------------------------------------------------------------------ Termine

function shortUrl(u: string) {
  try { const x = new URL(u); return (x.hostname.replace(/^www\./, "") + x.pathname).slice(0, 48); } catch { return u.slice(0, 48); }
}

const KINDS = ["gvg", "raid", "scrim", "ingame", "friday", "other"];
const loc = () => (lang() === "pt" ? "pt-BR" : lang());
const fmtWhen = (iso: string) => new Date(iso).toLocaleString(loc(), { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
// Wochentage Mo=0 ... So=6 (wie im Backend)
const wdName = (i: number) => new Date(2024, 0, 1 + i).toLocaleDateString(loc(), { weekday: "short" }).replace(".", "");
const repeatLabel = (days: string) => !days ? "" : days.length === 7 ? T("ev_daily")
  : days.length === 1 ? T("ev_weekly") : days.split("").map((d) => wdName(Number(d))).join(", ");
const fmtWhenEv = (e: any) => e.open_end
  ? `${new Date(e.starts_at).toLocaleDateString(loc(), { weekday: "short", day: "numeric", month: "short" })}, ${T("sched_from", { t: new Date(e.starts_at).toLocaleTimeString(loc(), { hour: "2-digit", minute: "2-digit" }) })} · ${T("sched_open_end")}`
  : fmtWhen(e.starts_at);

async function fetchUpcoming(days = 14) {
  const start = new Date(), end = new Date(Date.now() + days * 86400000);
  return api<any[]>(`/events?start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(end.toISOString())}`);
}

function evRow(e: any, editable: boolean) {
  return `<div class="tr ev-row kind-${esc(e.kind)}" data-id="${e.id}">
    <span class="ev-dot"></span>
    <div class="tr-main"><strong>${esc(e.title)}${e.opponent ? ` <span class="muted">· ${esc(T("sched_vs", { name: e.opponent }))}</span>` : ""}</strong>
      <span class="muted">${esc(fmtWhenEv(e))} · ${esc(T("kind_" + e.kind))}${e.repeat_days ? ` · ${esc(repeatLabel(e.repeat_days))}` : ""}${!e.is_public ? ` · ${esc(T("sched_internal"))}` : ""}</span></div>
    ${editable ? `<div class="row-gap"><button class="btn btn-ghost btn-sm" data-edit>${icon.edit}</button><button class="btn btn-ghost btn-sm" data-del>${icon.trash}</button></div>` : ""}
  </div>`;
}

// "Was ansteht": Agenda nach Tagen, nächster Termin hervorgehoben mit Countdown, laufende Termine "Live"
let agendaTimer = 0;
async function loadNextEvents(el: HTMLElement) {
  window.clearInterval(agendaTimer);
  let list: any[] = [];
  try { list = (await fetchUpcoming(7)).slice(0, 8); } catch { el.innerHTML = ""; return; }
  if (!list.length) { el.innerHTML = `<p class="empty">${esc(T("ev_none"))}</p>`; return; }
  const rel = new Intl.RelativeTimeFormat(loc(), { numeric: "auto" });
  const relShort = new Intl.RelativeTimeFormat(loc(), { numeric: "always", style: "short" });
  const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

  const groups: { date: Date; items: any[] }[] = [];
  for (const e of list) {
    const d = new Date(e.starts_at);
    const g = groups.find((x) => dayKey(x.date) === dayKey(d));
    if (g) g.items.push(e); else groups.push({ date: d, items: [e] });
  }
  const now = Date.now();
  const live = (e: any) => new Date(e.starts_at).getTime() <= now && (e.open_end || new Date(e.ends_at).getTime() > now);
  const next = list.find((e) => new Date(e.starts_at).getTime() > now);

  const dayLabel = (d: Date) => {
    const diff = Math.round((startOf(d).getTime() - startOf(new Date()).getTime()) / 86400000);
    return diff <= 1 ? cap(rel.format(diff, "day")) : d.toLocaleDateString(loc(), { weekday: "short" }).replace(".", "");
  };
  const countdown = (e: any) => {
    const ms = new Date(e.starts_at).getTime() - Date.now();
    const min = Math.max(1, Math.round(ms / 60000));
    if (min < 60) return relShort.format(min, "minute");
    const h = Math.round(min / 60);
    return h < 48 ? relShort.format(h, "hour") : relShort.format(Math.round(h / 24), "day");
  };

  el.innerHTML = `<div class="agenda">${groups.map((g) => `
    <section class="ag-day">
      <div class="ag-date">
        <span class="ag-wd">${esc(dayLabel(g.date))}</span>
        <span class="ag-num">${g.date.getDate()}</span>
        <span class="ag-mon">${esc(g.date.toLocaleDateString(loc(), { month: "short" }).replace(".", ""))}</span>
      </div>
      <div class="ag-items">${g.items.map((e) => {
        const s = new Date(e.starts_at), en = new Date(e.ends_at);
        const isLive = live(e), isNext = !isLive && e === next;
        const time = e.open_end ? T("sched_from", { t: timeShort(s, lang()) }) : timeRange(s, en, lang());
        return `<article class="ag-ev kind-${esc(e.kind)} ${isLive ? "is-live" : ""} ${isNext ? "is-next" : ""}" data-start="${esc(e.starts_at)}">
          <div class="ag-time">${esc(time)}</div>
          <div class="ag-main">
            <strong>${esc(e.title)}${e.opponent ? ` <span>· ${esc(T("sched_vs", { name: e.opponent }))}</span>` : ""}</strong>
            <span class="ag-meta"><i></i>${esc(T("kind_" + e.kind))}${e.open_end ? ` · ${esc(T("sched_open_end"))}` : ""}${e.repeat_days ? ` · ${esc(repeatLabel(e.repeat_days))}` : ""}${!e.is_public ? ` · ${esc(T("sched_internal"))}` : ""}</span>
          </div>
          ${isLive ? `<span class="ag-live"><b></b>Live</span>` : isNext ? `<span class="ag-in" data-countdown>${esc(countdown(e))}</span>` : ""}
        </article>`;
      }).join("")}</div>
    </section>`).join("")}</div>`;

  // Countdown jede Minute aktualisieren, solange die Übersicht offen ist
  if (next) agendaTimer = window.setInterval(() => {
    const c = el.querySelector<HTMLElement>("[data-countdown]");
    if (!c || !document.body.contains(el)) { window.clearInterval(agendaTimer); return; }
    if (new Date(next.starts_at).getTime() <= Date.now()) { loadNextEvents(el); return; }
    c.textContent = countdown(next);
  }, 30000);
}

async function viewSchedule(view: HTMLElement) {
  view.innerHTML = head(T("app_nav_schedule"), T("ev_upcoming"), `<a class="btn btn-ghost btn-sm" href="/${lang()}/schedule/" target="_blank">${esc(T("week_cta"))}</a><button class="btn btn-primary btn-sm" data-new>${icon.plus} ${esc(T("ev_new"))}</button>`) + `<div id="evs">${loading}</div>`;
  view.querySelector("[data-new]")!.addEventListener("click", () => editEvent(null, () => viewSchedule(view)));
  const el = view.querySelector("#evs")!;
  try {
    const list = await fetchUpcoming(14);
    // wöchentliche Termine nur einmal auflisten (nächstes Vorkommen)
    const seen = new Set<number>();
    const items = list.filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)));
    el.innerHTML = items.length ? `<div class="table card">${items.map((e) => evRow(e, true)).join("")}</div>` : `<p class="empty">${esc(T("ev_none"))}</p>`;
    el.querySelectorAll<HTMLElement>(".ev-row").forEach((row) => {
      const e = items.find((x) => x.id === Number(row.dataset.id));
      row.querySelector("[data-edit]")!.addEventListener("click", () => editEvent(e, () => viewSchedule(view)));
      row.querySelector("[data-del]")!.addEventListener("click", async () => {
        if (!confirm(T("ev_delete_confirm"))) return;
        await api(`/events/${e.id}`, { method: "DELETE" }).catch((x) => toast(x.message));
        viewSchedule(view);
      });
    });
  } catch (x) { el.innerHTML = `<p class="empty">${esc((x as Error).message)}</p>`; }
}

function toLocalInput(iso: string | null) {
  const d = iso ? new Date(iso) : new Date(Date.now() + 86400000);
  if (!iso) d.setHours(20, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function editEvent(e: any | null, done: () => void, preset: any = {}) {
  const v = { title: "", kind: "gvg", duration_min: 90, opponent: "", description: "", repeat_days: "", open_end: false, is_public: true, ...preset, ...(e || {}) };
  const start = e ? (e.first_start || e.starts_at) : preset.starts_at || null;
  const m = modal(e ? T("ev_edit") : T("ev_new"), `
    <div class="field"><label>${esc(T("ev_title"))}</label><input class="input" id="ev-title" maxlength="120" value="${esc(v.title)}"></div>
    <div class="row2">
      <div class="field"><label>${esc(T("ev_kind"))}</label><select class="select" id="ev-kind">${KINDS.map((k) => `<option value="${k}" ${v.kind === k ? "selected" : ""}>${esc(T("kind_" + k))}</option>`).join("")}</select></div>
      <div class="field"><label>${esc(T("ev_opponent"))}</label><input class="input" id="ev-opp" maxlength="80" value="${esc(v.opponent || "")}"></div>
    </div>
    <div class="row2">
      <div class="field"><label>${esc(T("ev_start"))}</label><input id="ev-start" value="${toLocalInput(start)}"></div>
      <div class="field"><label>${esc(T("ev_duration"))}</label><input class="input" type="number" id="ev-dur" min="10" max="1440" step="5" value="${v.duration_min}" ${v.open_end ? "disabled" : ""}></div>
    </div>
    <label class="check"><input type="checkbox" id="ev-open" ${v.open_end ? "checked" : ""}> <span>${esc(T("ev_open_end"))}</span></label>
    <div class="field"><label>${esc(T("ev_desc"))}</label><textarea class="textarea" id="ev-desc" rows="3" maxlength="2000">${esc(v.description || "")}</textarea></div>
    <div class="field"><span class="label">${esc(T("ev_repeat"))}</span>
      <div class="rep-row">
        <div class="rep-days">${[0, 1, 2, 3, 4, 5, 6].map((d) => `<button type="button" class="rep-day" data-day="${d}" aria-pressed="${(v.repeat_days || "").includes(String(d))}">${esc(wdName(d))}</button>`).join("")}</div>
        <button type="button" class="rep-quick" data-rep="all">${esc(T("ev_rep_daily"))}</button>
        <button type="button" class="rep-quick" data-rep="none">${esc(T("ev_rep_none"))}</button>
      </div></div>
    <label class="check"><input type="checkbox" id="ev-pub" ${v.is_public ? "checked" : ""}> <span>${esc(T("ev_public"))}</span></label>`,
    `<button class="btn btn-primary" data-save>${esc(T("save"))}</button>`);
  const q = <T extends HTMLElement>(sel: string) => m.el.querySelector(sel) as T;
  enhancePicker(q<HTMLInputElement>("#ev-start"), "datetime");
  const openEnd = q<HTMLInputElement>("#ev-open");
  const dayBtns = [...m.el.querySelectorAll<HTMLElement>(".rep-day")];
  const repDays = () => dayBtns.filter((b) => b.getAttribute("aria-pressed") === "true").map((b) => b.dataset.day).join("");
  dayBtns.forEach((b) => b.addEventListener("click", () => b.setAttribute("aria-pressed", String(b.getAttribute("aria-pressed") !== "true"))));
  m.el.querySelectorAll<HTMLElement>("[data-rep]").forEach((b) => b.addEventListener("click", () =>
    dayBtns.forEach((x) => x.setAttribute("aria-pressed", String(b.dataset.rep === "all")))));
  const syncOpen = () => { q<HTMLInputElement>("#ev-dur").disabled = openEnd.checked; };
  openEnd.addEventListener("change", syncOpen);
  // Friday Night beginnt fest, das Ende ist offen
  q<HTMLSelectElement>("#ev-kind").addEventListener("change", (x) => {
    if ((x.target as HTMLSelectElement).value === "friday" && !e) { openEnd.checked = true; syncOpen(); }
  });
  m.el.querySelector("[data-save]")!.addEventListener("click", async () => {
    const startVal = q<HTMLInputElement>("#ev-start").value;
    if (!startVal) return;
    const json = {
      title: q<HTMLInputElement>("#ev-title").value, kind: q<HTMLSelectElement>("#ev-kind").value,
      starts_at: new Date(startVal).toISOString(), duration_min: Number(q<HTMLInputElement>("#ev-dur").value) || 90,
      opponent: q<HTMLInputElement>("#ev-opp").value, description: q<HTMLTextAreaElement>("#ev-desc").value,
      repeat_days: repDays(), is_public: q<HTMLInputElement>("#ev-pub").checked,
      open_end: openEnd.checked,
    };
    try {
      await api(e ? `/events/${e.id}` : "/events", { method: e ? "PUT" : "POST", json });
      closePicker(); m.close(); toast(T("saved")); done();
    } catch (x) { toast((x as Error).message); }
  });
}

// ------------------------------------------------------------------ Match-Anfragen

async function viewMatches(view: HTMLElement) {
  view.innerHTML = head(T("mt_title")) + `<div id="mts">${loading}</div>`;
  const el = view.querySelector("#mts")!;
  try {
    const list = await api<any[]>("/scrims");
    if (!list.length) { el.innerHTML = `<p class="empty">${esc(T("mt_empty"))}</p>`; return; }
    const st: Record<string, string> = { pending: T("mt_pending"), accepted: T("mt_accepted"), declined: T("mt_declined") };
    el.innerHTML = list.map((r) => `<article class="app-card card" data-id="${r.id}" data-status="${r.status === "declined" ? "rejected" : r.status}">
      <div class="app-top"><div><h3>${esc(r.guild_name)}</h3><span class="muted">${esc(r.contact)}${r.server ? ` · ${esc(r.server)}` : ""} · ${esc(timeAgo(r.created_at))}</span></div>
        <span class="status status-${r.status === "declined" ? "rejected" : r.status}">${esc(st[r.status])}</span></div>
      <div class="app-tags">${r.format ? `<span class="badge">${esc(r.format)}</span>` : ""}<strong>${esc(r.proposed_times)}</strong></div>
      ${r.message ? `<p class="app-text">${esc(r.message)}</p>` : ""}
      <textarea class="textarea mt-reply" rows="2" maxlength="1000" placeholder="${esc(T("mt_reply_ph"))}" data-reply>${esc(r.reply || "")}</textarea>
      <div class="row-gap">
        ${r.status !== "accepted" ? `<button class="btn btn-primary btn-sm" data-accept>${icon.check} ${esc(T("mt_accept"))}</button>` : ""}
        ${r.status !== "declined" ? `<button class="btn btn-outline btn-sm" data-decline>${esc(T("mt_decline"))}</button>` : ""}
        <button class="btn btn-ghost btn-sm" data-del>${icon.trash}</button>
      </div></article>`).join("");
    el.querySelectorAll<HTMLElement>(".app-card").forEach((c) => {
      const r = list.find((x) => x.id === Number(c.dataset.id));
      const set = async (status: string) => {
        await api(`/scrims/${r.id}`, { method: "PUT", json: { status, reply: c.querySelector<HTMLTextAreaElement>("[data-reply]")!.value } });
        refreshBadges();
      };
      c.querySelector("[data-accept]")?.addEventListener("click", async () => {
        try { await set("accepted"); } catch (x) { toast((x as Error).message); return; }
        editEvent(null, () => viewMatches(view), { kind: "scrim", title: T("kind_scrim"), opponent: r.guild_name, description: `${r.proposed_times}${r.format ? " · " + r.format : ""}` });
      });
      c.querySelector("[data-decline]")?.addEventListener("click", async () => { await set("declined").catch((x) => toast(x.message)); viewMatches(view); });
      c.querySelector("[data-del]")!.addEventListener("click", async () => {
        if (!confirm(T("mt_delete_confirm"))) return;
        await api(`/scrims/${r.id}`, { method: "DELETE" }).catch((x) => toast(x.message));
        viewMatches(view);
      });
    });
  } catch (x) { el.innerHTML = `<p class="empty">${esc((x as Error).message)}</p>`; }
}
