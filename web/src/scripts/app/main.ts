// Mitgliederbereich: Login-Status, Navigation (Hash-Router) und die einzelnen Ansichten.
import { api, esc, fmtDate, icon, initI18n, lang, modal, T, timeAgo, toast } from "./core";
// @ts-ignore -- reines JS-Modul
import { renderVods, vodCleanup } from "./vods.js";
import { enhancePicker, closePicker } from "./picker";
import { timeRange, timeShort } from "../schedule";
import { PATHS, INNER_WAYS, pathById, innerWayById, innerWayImg, pathFromText, WEAPONS, SCHOOLS, buildId, buildWeapons, buildLabel, buildPaths, schoolColor } from "../../data/wwm";

type Me = {
  id: number; discord_id: string; display_name: string; username: string; avatar_url: string | null; rank: string; public_rank: string;
  coach_roles: string[]; ingame_name: string | null; main_role: string | null; country: string | null;
  weapons: string[]; weapon_other: string | null; main_path: string | null; alt_paths: string[]; inner_ways: string[]; partners: string[]; main_build: string | null; alt_builds: string[];
  show_on_team: boolean; lang: string | null; is_member: boolean; can_manage: boolean; is_admin: boolean; rank_manual: boolean;
};

const root = document.getElementById("app-root")!;
let me: Me | null = null;
const ROLES = ["healer", "tank", "dps"];                       // Hauptrollen
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

// Icons: Discord-Emotes, die Raid-Helper für Klassen ("bellstrike") und Pfade ("bamboocut_wind") nutzt
let EMOTES: Record<string, string> = {};
const emoteUrl = (id: string) => `https://cdn.discordapp.com/emojis/${id}.png?size=48`;
const emoteImg = (id: string | undefined | null, cls = "emo", color = "") => (id ? `<img class="${cls}" ${color ? `style="--sc:${color}"` : ""} src="${emoteUrl(id)}" alt="" width="18" height="18" loading="lazy" decoding="async">` : "");
const schoolEmote = (school: string) => EMOTES[school.toLowerCase()] || "";
// kaputte Icons still entfernen
document.addEventListener("error", (ev) => {
  const t = ev.target as HTMLElement;
  if (!t || t.tagName !== "IMG" || !t.classList.contains("emo")) return;
  t.parentElement?.classList.remove("has-emo");  // Chip zeigt wieder seinen Farbpunkt
  const dot = document.createElement("i");
  dot.className = "emo-dot";
  const c = t.style.getPropertyValue("--sc");
  if (c) dot.style.setProperty("--sc", c);
  t.replaceWith(dot);
}, true);

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
    try { EMOTES = await api<Record<string, string>>("/raidhelper/emotes"); } catch { /* ohne Icons */ }
    renderShell();
    route();
  } catch {
    root.innerHTML = `<div class="app-center"><p>${esc(T("error"))}</p></div>`;
  }
}

function renderLogin(configured = true) {
  // kam man vom Discord-Login zurück, ohne angemeldet zu sein? Dann Hinweis zeigen und die URL aufräumen
  const params = new URLSearchParams(location.search);
  const failed = params.has("login");
  if (failed) history.replaceState(null, "", location.pathname + location.hash);
  const next = encodeURIComponent(location.pathname + location.hash);
  root.innerHTML = `<div class="app-center">
    <div class="login-card card">
      <span class="login-ico">${icon.shield}</span>
      <h1>${esc(T("app_login_t"))}</h1>
      <p>${esc(T("app_login_b"))}</p>
      ${failed ? `<p class="login-failed">${esc(T("app_login_failed"))}</p>` : ""}
      <a class="btn btn-primary discord-btn ${configured ? "" : "disabled"}" href="/api/auth/login?next=${next}" data-astro-prefetch="false" rel="nofollow">
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
    { id: "signups", label: T("rh_nav"), ico: icon.signups },
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
    case "roster": {
      const [, sid, sub] = h.split("/");
      const id = Number(sid);
      if (id && sub === "edit") return editMemberBuild(view, id);
      return id ? viewMember(view, id) : viewRoster(view);
    }
    case "signups": return viewSignups(view);
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
    `<div class="dash-top">
      <section class="card dash-card dash-build">
        <header><h2>${esc(T("prof_build"))}</h2><a class="btn btn-ghost btn-sm" href="#/profile">${icon.edit} ${esc(T("dash_build_edit"))}</a></header>
        ${hasBuild(me) ? buildBlock(me, true) : `<p class="muted">${esc(T("dash_build_empty"))}</p>`}
      </section>
      <section class="card dash-card dash-next">
        <header><h2>${esc(T("dash_next"))}</h2><button class="btn btn-ghost btn-sm" data-week aria-expanded="false">${icon.calendar} ${esc(T("dash_week"))}</button></header>
        <div id="next-one">${loading}</div>
        <div id="dash-ann"></div>
      </section>
    </div>
    <div id="next-ev" hidden></div>
    <h2 class="v-sub" id="ann-head">${esc(T("ann_title"))}</h2><div id="ann">${loading}</div>
    <h2 class="v-sub v-sub-link"><span>${esc(T("app_nav_members"))}</span><a href="#/roster">${esc(T("mem_back"))} →</a></h2><div id="dash-mem">${loading}</div>`;
  loadNextOne(view.querySelector("#next-one")!);
  const week = view.querySelector<HTMLElement>("#next-ev")!;
  view.querySelector<HTMLElement>("[data-week]")!.addEventListener("click", (e) => {
    const b = e.currentTarget as HTMLElement;
    week.hidden = !week.hidden;
    b.setAttribute("aria-expanded", String(!week.hidden));
    if (!week.hidden && !week.childElementCount) { week.innerHTML = loading; loadNextEvents(week); }
  });
  api<any[]>("/members").then((list) => {
    const el = view.querySelector<HTMLElement>("#dash-mem");
    if (!el) return;
    el.innerHTML = list.length ? `<div class="mem-strip">${list.slice(0, 18).map((u) => `<a class="ms card" href="#/roster/${u.id}" title="${esc(u.display_name)}">
      ${avatar(u, 40)}<strong>${esc(u.display_name)}</strong>${catTag(u)}</a>`).join("")}</div>`
      : `<p class="empty">${esc(T("mem_empty"))}</p>`;
  }).catch(() => { view.querySelector("#dash-mem")?.remove(); });
  view.querySelector("[data-new]")?.addEventListener("click", () => editAnnouncement(null, () => viewDashboard(view)));
  try {
    const list = await api<any[]>("/announcements");
    // neueste (bzw. angepinnte) Ankündigung steht oben in der Karte, unten nur die übrigen (nichts doppelt)
    const [top, ...rest] = list;
    const reload = () => viewDashboard(view);
    const del = async (x: any) => {
      if (!confirm(T("ann_delete_confirm"))) return;
      await api(`/announcements/${x.id}`, { method: "DELETE" }).catch((err) => toast(err.message));
      reload();
    };
    const prev = view.querySelector<HTMLElement>("#dash-ann")!;
    prev.innerHTML = top ? `<button type="button" class="dash-ann">
        <span class="da-label">${top.pinned ? icon.pin : ""}${esc(T("ann_title"))}<em>${esc(timeAgo(top.created_at))}</em></span>
        <strong>${esc(top.title)}</strong><span class="da-body">${esc(top.body)}</span></button>`
      : `<p class="muted da-none">${esc(T("ann_empty"))}</p>`;
    prev.querySelector("button")?.addEventListener("click", () => {
      const m = modal(top.title, `<div class="ann-body">${esc(top.body).replace(/\n/g, "<br>")}</div>
        <div class="ann-meta">${top.author_avatar ? `<img src="${esc(top.author_avatar)}" alt="" width="18" height="18">` : ""}${esc(top.author || "")} · ${esc(timeAgo(top.created_at))}</div>`,
        top.can_edit ? `<button class="btn btn-ghost" data-del>${icon.trash} ${esc(T("delete"))}</button><button class="btn btn-primary" data-edit>${icon.edit} ${esc(T("edit"))}</button>` : "");
      m.el.querySelector("[data-edit]")?.addEventListener("click", () => { m.close(); editAnnouncement(top, reload); });
      m.el.querySelector("[data-del]")?.addEventListener("click", () => { m.close(); del(top); });
    });
    const el = view.querySelector<HTMLElement>("#ann")!;
    const headEl = view.querySelector<HTMLElement>("#ann-head")!;
    headEl.textContent = T("ann_more");
    headEl.hidden = el.hidden = !rest.length;
    el.innerHTML = rest.map((a) => `<article class="ann card ${a.pinned ? "pinned" : ""}" data-id="${a.id}">
      <div class="ann-head">
        ${a.pinned ? `<span class="badge badge-leader">${icon.pin} ${esc(T("ann_pinned"))}</span>` : ""}
        <h3>${esc(a.title)}</h3>
        ${a.can_edit ? `<div class="ann-actions"><button class="btn btn-ghost btn-sm" data-edit>${icon.edit}</button><button class="btn btn-ghost btn-sm" data-del>${icon.trash}</button></div>` : ""}
      </div>
      <div class="ann-body">${esc(a.body).replace(/\n/g, "<br>")}</div>
      <div class="ann-meta">${a.author_avatar ? `<img src="${esc(a.author_avatar)}" alt="" width="18" height="18">` : ""}${esc(a.author || "")} · ${esc(timeAgo(a.created_at))}</div>
    </article>`).join("");
    el.querySelectorAll<HTMLElement>(".ann").forEach((card) => {
      const a = rest.find((x) => x.id === Number(card.dataset.id));
      card.querySelector("[data-edit]")?.addEventListener("click", () => editAnnouncement(a, reload));
      card.querySelector("[data-del]")?.addEventListener("click", () => del(a));
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

// ------------------------------------------------------------------ Anmeldungen aus Raid-Helper + Aufstellung (Leader/Vice)

const RH_CLASS_COLORS: Record<string, string> = { tank: "#eab308", healer: "#22c55e", dps: "#3b82f6", melee: "#3b82f6", ranged: "#3b82f6", support: "#22c55e", bellstrike: "#3b82f6", silkbind: "#22c55e", stonesplit: "#eab308", bamboocut: "#a855f7" };
const ROLE_ORDER: Record<string, number> = { tank: 0, healer: 1, dps: 2 };
// "Bamboocut_Wind" -> Pfad aus unseren Spieldaten, sonst lesbarer Text
const rhLabel = (s: string) => pathFromText(s)?.name || String(s || "").replace(/_/g, " ");
const rhColor = (cls: string) => { const p = pathFromText(cls); return RH_CLASS_COLORS[(p?.role || cls).toLowerCase()] || "var(--accent)"; };

type RhPlayer = { uid: string; name: string; path: string; role: string; playing: boolean; color?: string; emote?: string };
function rhPlayers(e: any, profiles: Record<string, any>): Map<string, RhPlayer> {
  const m = new Map<string, RhPlayer>();
  for (const s of e.signups) {
    if (!s.user_id) continue;
    const p = pathFromText(s.spec) || pathFromText(s.class);
    const prof = profiles[s.user_id];
    const role = p?.role || (ROLE_ORDER[s.class.toLowerCase()] !== undefined ? s.class.toLowerCase() : profiles[s.user_id]?.main_role || "dps");
    m.set(s.user_id, { uid: s.user_id, name: profiles[s.user_id]?.name || s.name, path: p?.name || (s.spec && s.spec.toLowerCase() !== s.class.toLowerCase() ? s.spec.replace(/_/g, " ") : "") || buildLabel(prof?.main_build), role, playing: s.playing,
      color: p ? schoolColor(p.group) : buildWeapons(prof?.main_build)[0] ? schoolColor(buildWeapons(prof?.main_build)[0].school) : "",
      emote: s.spec_emote || s.class_emote || (p ? EMOTES[p.id] || schoolEmote(p.group) : "") });
  }
  return m;
}
const rhChip = (p: RhPlayer, extra = "") => `<span ${p.color ? `style="--role:${p.color}"` : ""} class="rh-p role-${esc(p.role)} ${p.emote ? "has-emo" : ""} ${p.uid === me!.discord_id ? "is-me" : ""} ${extra}" title="${esc(p.name)}${p.path ? ` · ${esc(p.path)}` : ""}">${emoteImg(p.emote)}<b>${esc(p.name)}</b>${p.path ? `<small>${esc(p.path)}</small>` : ""}</span>`;

async function viewSignups(view: HTMLElement) {
  view.innerHTML = head(T("rh_title"), T("rh_sub")) + `<div id="rh">${loading}</div>`;
  const el = view.querySelector<HTMLElement>("#rh")!;
  let data: any;
  try { data = await api<any>("/raidhelper/events"); }
  catch (x) { el.innerHTML = `<p class="empty">${esc((x as Error).message)}</p>`; return; }
  if (!data.configured) { el.innerHTML = `<p class="empty">${esc(T("rh_off"))}</p>`; return; }
  if (data.can_edit) {
    view.querySelector(".v-head")!.insertAdjacentHTML("beforeend", `<div class="v-actions"><button class="btn btn-ghost btn-sm" data-partners>${icon.users} ${esc(T("pt_title"))}</button><button class="btn btn-primary btn-sm" data-new-ev>${icon.plus} ${esc(T("rh_new"))}</button></div>`);
    view.querySelector("[data-partners]")!.addEventListener("click", () => editPartners(() => viewSignups(view)));
    view.querySelector("[data-new-ev]")!.addEventListener("click", () => newRhEvent(data, () => viewSignups(view)));
  }
  if (data.error) { el.innerHTML = `<p class="empty">${esc(T("rh_error"))}</p>`; return; }
  if (!data.events.length) { el.innerHTML = `<p class="empty">${esc(T("rh_empty"))}</p>`; return; }
  el.innerHTML = `${data.stale ? `<p class="hint rh-stale">${esc(T("rh_error"))}</p>` : ""}<div class="rh-list">${data.events.map((e: any) => `<article class="card rh-ev" data-ev="${esc(e.id)}"></article>`).join("")}</div>`;
  for (const e of data.events) drawSignupEvent(el.querySelector<HTMLElement>(`[data-ev="${CSS.escape(e.id)}"]`)!, e, data);
}

function drawSignupEvent(card: HTMLElement, e: any, data: any) {
  const when = (iso: string) => new Date(iso).toLocaleString(loc(), { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const players = rhPlayers(e, data.profiles || {});
  const groups = new Map<string, any[]>();
  for (const s of e.signups.filter((x: any) => x.playing)) {
    const k = s.class || "—";
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(s);
  }
  const chipFor = (s: any) => players.get(s.user_id) ? rhChip(players.get(s.user_id)!) : rhChip({ uid: "", name: s.name, path: "", role: "", playing: s.playing });
  const out = e.signups.filter((x: any) => !x.playing);
  const roster = e.roster;
  const myGroup = roster?.groups.find((g: any) => g.members.includes(me!.discord_id));
  const gName = (g: any, i: number) => g.name || T("roster_group", { n: i + 1 });
  card.innerHTML = `
    <header class="rh-head">
      <div class="rh-title"><h3>${e.cancelled ? `<span class="rh-cancel-badge">${esc(T("rh_cancelled"))}</span> ` : ""}${esc(e.cancelled ? plainTitle(e.title) : e.title)}</h3><span class="muted">${e.start ? esc(when(e.start)) : ""}${e.leader ? ` · ${esc(e.leader)}` : ""}</span></div>
      <div class="rh-status">
        <span class="rh-count"><b>${e.count}</b> ${esc(T("rh_signed"))}</span>
        ${e.me ? `<span class="rh-me ok">${icon.check} ${esc(T("rh_you", { cls: rhLabel(e.me.spec || e.me.class || "") }))}</span>` : `<span class="rh-me">${esc(T("rh_not_you"))}</span>`}
      </div>
    </header>
    <div class="rh-bar">
      <div class="rh-bar-main">
        ${data.can_edit && !e.cancelled ? `<button class="btn btn-primary btn-sm" data-plan>${icon.users} ${esc(T(roster ? "roster_edit" : "roster_plan"))}</button>` : ""}
        ${data.can_edit && e.cancelled ? `<button class="btn btn-outline btn-sm" data-restore>${icon.refresh} ${esc(T("rh_restore"))}</button>` : ""}
        ${e.url ? `<a class="btn btn-outline btn-sm" href="${esc(e.url)}" target="_blank" rel="noopener" data-discord>${icon.external} ${esc(T("rh_open"))}</a>` : ""}
        ${data.can_remind && !e.cancelled ? `<button class="btn btn-ghost btn-sm" data-remind>${icon.bell} ${esc(T("rh_remind"))}</button>` : ""}
      </div>
      ${data.can_edit ? `<div class="rh-bar-admin">
        ${!e.cancelled ? `<button class="btn btn-ghost btn-sm rh-cancel-btn" data-cancel-ev>${icon.x} ${esc(T("rh_cancel"))}</button>` : ""}
        <button class="btn btn-ghost btn-sm rh-del-btn" data-del-ev title="${esc(T("rh_delete"))}" aria-label="${esc(T("rh_delete"))}">${icon.trash}</button>
      </div>` : ""}
    </div>
    ${roster ? `<section class="ro-view">
      <div class="ro-vhead"><h4>${esc(T("roster_title"))}</h4>${myGroup ? `<span class="rh-me ok">${esc(T("roster_you", { group: gName(myGroup, roster.groups.indexOf(myGroup)) }))}</span>` : ""}
        ${roster.updated_by ? `<span class="muted">${esc(T("roster_by", { name: roster.updated_by, when: roster.updated_at ? timeAgo(roster.updated_at) : "" }))}</span>` : ""}
        <span class="ro-actions"><button class="btn btn-ghost btn-sm" data-img title="${esc(T("roster_img"))}">${icon.download} ${esc(T("roster_img"))}</button>
        <button class="btn btn-ghost btn-sm" data-img-copy title="${esc(T("roster_img_copy"))}">${icon.copy}</button>
        ${data.can_edit ? `<button class="btn btn-outline btn-sm" data-push>${icon.external} ${esc(T("roster_push"))}</button>` : ""}</span></div>
      <div class="rh-groups">${roster.groups.map((g: any, i: number) => `<div class="rh-group ro-g">
        <div class="rh-gh"><i></i>${esc(gName(g, i))}<span>${g.members.length}${g.size ? `/${g.size}` : ""}</span></div>
        <div class="rh-people">${g.members.map((uid: string) => {
          const p = players.get(uid);
          const prof = data.profiles?.[uid];
          return p ? rhChip(p, p.playing ? "" : "is-left") : rhChip({ uid, name: prof?.name || "?", path: "", role: prof?.main_role || "", playing: false }, "is-left");
        }).join("")}</div></div>`).join("")}</div>
    </section>` : ""}
    <details class="rh-signups" ${roster ? "" : "open"}>
      <summary>${esc(T("rh_nav"))} <span class="muted">${e.count}</span></summary>
      ${groups.size ? `<div class="rh-groups">${[...groups.entries()].map(([cls, list]) => `
        <div class="rh-group" style="--c:${rhColor(cls)}">
          <div class="rh-gh">${list[0]?.class_emote ? emoteImg(list[0].class_emote, "emo emo-h") : "<i></i>"}<span class="rh-gname">${esc(rhLabel(cls))}</span><span>${list.length}</span></div>
          <div class="rh-people">${list.map(chipFor).join("")}</div>
        </div>`).join("")}</div>` : `<p class="muted rh-none">${esc(T("rh_nobody"))}</p>`}
      ${out.length ? `<div class="rh-out"><span>${esc(T("rh_other"))}</span>${out.map((s: any) => `<span class="rh-p"><b>${esc(s.name)}</b><small>${esc(s.status !== "primary" ? s.status : rhLabel(s.class))}</small></span>`).join("")}</div>` : ""}
    </details>`;
  card.classList.toggle("is-cancelled", !!e.cancelled);
  card.querySelector("[data-plan]")?.addEventListener("click", () => editRoster(card, e, data, players));
  card.querySelector("[data-cancel-ev]")?.addEventListener("click", () => cancelRhEvent(e, data));
  card.querySelector("[data-restore]")?.addEventListener("click", async () => {
    try { await api(`/raidhelper/events/${encodeURIComponent(e.id)}/restore`, { method: "POST" }); toast(T("rh_restored")); refreshSignups(); }
    catch (x) { toast((x as Error).message); }
  });
  card.querySelector("[data-del-ev]")?.addEventListener("click", async () => {
    if (!confirm(T("rh_delete_confirm", { title: plainTitle(e.title) }))) return;
    try { await api(`/raidhelper/events/${encodeURIComponent(e.id)}`, { method: "DELETE" }); toast(T("rh_deleted")); refreshSignups(); }
    catch (x) { toast((x as Error).message); }
  });
  card.querySelector("[data-push]")?.addEventListener("click", () => pushRoster(e, data));
  card.querySelector("[data-img]")?.addEventListener("click", () => rosterImageAction(e, data, false));
  card.querySelector("[data-img-copy]")?.addEventListener("click", () => rosterImageAction(e, data, true));
  card.querySelector("[data-remind]")?.addEventListener("click", () => remindUnsigned(e, data));
}

// Partnerschaften pflegen: eine Zeile = Spieler, die zusammen in eine Gruppe sollen (Namen dürfen leicht abweichen)
async function editPartners(done: () => void) {
  let current: any[] = [];
  try { current = await api<any[]>("/raidhelper/partnerships"); } catch (x) { toast((x as Error).message); return; }
  const m = modal(T("pt_title"), `
    <p class="hint">${esc(T("pt_hint"))}</p>
    <textarea class="textarea pt-text" id="pt-text" rows="8" placeholder="${esc(T("pt_ph"))}">${esc(current.map((c) => c.members.map((x: any) => x.name).join(", ")).join("\n"))}</textarea>
    <div class="pt-check" id="pt-check"></div>
    <div class="pt-prof" id="pt-prof"></div>`,
    `<button class="btn btn-primary" data-save>${esc(T("save"))}</button>`);
  api<any[]>("/raidhelper/profile-partnerships").then((l) => {
    if (!l.length) return;
    m.el.querySelector<HTMLElement>("#pt-prof")!.innerHTML = `<span class="label">${esc(T("pt_from_profiles", { n: l.length }))}</span>
      ${l.map((x) => `<div class="pt-line"><span class="pt-n is-ok">${esc(x.owner)}</span>${x.partners.map((n: string) => `<span class="pt-n is-ok">${esc(n)}</span>`).join("")}</div>`).join("")}`;
  }).catch(() => {});
  const ta = m.el.querySelector<HTMLTextAreaElement>("#pt-text")!;
  const out = m.el.querySelector<HTMLElement>("#pt-check")!;
  const render = (rep: any[][]) => {
    out.innerHTML = rep.map((line) => `<div class="pt-line ${line.filter((r) => r.id).length < 2 ? "is-bad" : ""}">${line.map((r) =>
      `<span class="pt-n is-${r.status}" title="${esc(r.status === "ok" ? r.name : r.status === "unsure" ? T("pt_unsure", { name: r.name }) : r.status === "ambiguous" ? T("pt_ambiguous", { names: (r.options || []).map((o: any) => o.name).join(", ") }) : T("pt_missing"))}">${esc(r.input)}${r.status === "unsure" ? ` → ${esc(r.name)}` : ""}</span>`).join("")}</div>`).join("");
  };
  let timer = 0;
  const check = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(async () => {
      try { render(await api<any[][]>("/raidhelper/partnerships/check", { method: "POST", json: { text: ta.value } })); } catch { /* egal */ }
    }, 350);
  };
  ta.addEventListener("input", check);
  check();
  m.el.querySelector<HTMLElement>("[data-save]")!.addEventListener("click", async (ev) => {
    const b = ev.currentTarget as HTMLButtonElement;
    b.disabled = true;
    try {
      const r = await api<any>("/raidhelper/partnerships", { method: "PUT", json: { text: ta.value } });
      m.close(); toast(T("pt_saved", { n: r.saved })); done();
    } catch (x) { toast((x as Error).message); b.disabled = false; }
  });
}

// Absagen: Event bleibt stehen (Titel "❌ CANCELLED – …"), optional alle Angemeldeten pingen
const plainTitle = (t: string) => String(t || "").replace(/^\s*(❌\s*((CANCELLED|ABGESAGT)\s*[–:-]?\s*)?|(CANCELLED|ABGESAGT)\s*[–:-]\s*)/i, "").trim() || t;
const refreshSignups = () => { const v = document.getElementById("view"); if (v && location.hash.startsWith("#/signups")) viewSignups(v); };
function cancelRhEvent(e: any, data: any) {
  const signed = e.signups.filter((x: any) => x.status === "primary" && !["absence", "absent"].includes(String(x.class).toLowerCase())).length;
  const m = modal(T("rh_cancel_t", { title: e.title }), `
    <p class="hint">${esc(T("rh_cancel_hint"))}</p>
    <div class="field"><label>${esc(T("rh_cancel_reason"))}</label><input class="input" id="cx-reason" maxlength="300" placeholder="${esc(T("rh_cancel_reason_ph"))}"></div>
    ${data.can_remind ? `<label class="check"><input type="checkbox" id="cx-ping" ${signed ? "checked" : "disabled"}> <span>${esc(T("rh_cancel_ping", { n: signed }))}</span></label>` : ""}`,
    `<button class="btn btn-danger" data-save>${icon.x} ${esc(T("rh_cancel"))}</button>`);
  m.el.querySelector<HTMLElement>("[data-save]")!.addEventListener("click", async (ev) => {
    const b = ev.currentTarget as HTMLButtonElement;
    b.disabled = true;
    try {
      await api(`/raidhelper/events/${encodeURIComponent(e.id)}/cancel`, { method: "POST", json: {
        reason: m.el.querySelector<HTMLInputElement>("#cx-reason")!.value, ping: !!m.el.querySelector<HTMLInputElement>("#cx-ping")?.checked } });
      m.close(); toast(T("rh_cancelled_done")); refreshSignups();
    } catch (x) { toast((x as Error).message); b.disabled = false; }
  });
}

// Neues Raid-Helper-Event (wie im Raid-Helper-Dashboard), Leader ist man selbst
function newRhEvent(data: any, done: () => void) {
  const chans: { id: string; name: string }[] = data.channels || [];
  const m = modal(T("rh_new"), `
    <p class="hint">${esc(T("rh_f_hint"))}</p>
    <div class="field"><label>${esc(T("rh_channel"))}</label><select class="select" id="rh-ch">${chans.map((c) => `<option value="${esc(c.id)}">#${esc(c.name || c.id)}</option>`).join("")}</select></div>
    <div class="field"><label>${esc(T("rh_f_start"))}</label><input id="rh-start" value=""></div>
    <div class="field"><label>${esc(T("rh_f_title"))}</label><input class="input" id="rh-title" maxlength="100"></div>
    <div class="field"><label>${esc(T("rh_f_desc"))}</label><textarea class="textarea" id="rh-desc" rows="3" maxlength="1500"></textarea></div>`,
    `<button class="btn btn-primary" data-save>${esc(T("rh_create"))}</button>`);
  const q = <X extends HTMLElement>(sel: string) => m.el.querySelector(sel) as X;
  enhancePicker(q<HTMLInputElement>("#rh-start"), "datetime");
  q<HTMLElement>("[data-save]").addEventListener("click", async (ev) => {
    const b = ev.currentTarget as HTMLButtonElement;
    const start = q<HTMLInputElement>("#rh-start").value;
    if (!start) { toast(T("err_start_past")); return; }
    b.disabled = true;
    try {
      await api("/raidhelper/events", { method: "POST", json: {
        channel_id: q<HTMLSelectElement>("#rh-ch").value, title: q<HTMLInputElement>("#rh-title").value,
        description: q<HTMLTextAreaElement>("#rh-desc").value, start: new Date(start).toISOString(),
      } });
      m.close(); toast(T("rh_created")); done();
    } catch (x) { toast((x as Error).message); b.disabled = false; }
  });
}

// gespeicherte Aufstellung ins Comp-Tool von Raid-Helper übertragen, optional im Kanal posten
function pushRoster(e: any, data: any) {
  const chans: { id: string; name: string }[] = data.channels || [];
  const m = modal(T("roster_push"), `
    <p class="hint">${esc(T("roster_push_hint"))}</p>
    <label class="check"><input type="checkbox" id="rp-ann"> <span>${esc(T("roster_announce"))}</span></label>
    <div class="field"><label>${esc(T("rh_channel"))}</label><select class="select" id="rp-ch" disabled>${chans.map((c) => `<option value="${esc(c.id)}" ${c.id === e.channel_id ? "selected" : ""}>#${esc(c.name || c.id)}</option>`).join("")}</select></div>
    <label class="check"><input type="checkbox" id="rp-men" disabled> <span>${esc(T("roster_mention"))}</span></label>
    <div class="field"><label>${esc(T("roster_note"))}</label><textarea class="textarea" id="rp-note" rows="2" maxlength="500" disabled></textarea></div>`,
    `<button class="btn btn-primary" data-save>${esc(T("roster_push"))}</button>`);
  const q = <X extends HTMLElement>(sel: string) => m.el.querySelector(sel) as X;
  q<HTMLInputElement>("#rp-ann").addEventListener("change", (x) => {
    const on = (x.target as HTMLInputElement).checked;
    q<HTMLInputElement>("#rp-men").disabled = !on;
    q<HTMLTextAreaElement>("#rp-note").disabled = !on;
    q<HTMLSelectElement>("#rp-ch").disabled = !on;
  });
  q<HTMLElement>("[data-save]").addEventListener("click", async (ev) => {
    const b = ev.currentTarget as HTMLButtonElement;
    b.disabled = true;
    try {
      const r = await api<any>(`/raidhelper/rosters/${encodeURIComponent(e.id)}/push`, { method: "POST", json: {
        announce: q<HTMLInputElement>("#rp-ann").checked, mention: q<HTMLInputElement>("#rp-men").checked, channel_id: q<HTMLSelectElement>("#rp-ch").value || null,
        description: q<HTMLTextAreaElement>("#rp-note").value,
      } });
      m.close();
      toast(T("roster_pushed"));
      if (r.url) window.open(r.url, "_blank", "noopener");
    } catch (x) { toast((x as Error).message); b.disabled = false; }
  });
}

// Aufstellung bearbeiten: Gruppe antippen = Ziel, Spieler anklicken = rein in die Zielgruppe (nochmal = zurück).
// Ziehen geht weiterhin. Jede Gruppe hat ihre eigene Größe.
function editRoster(card: HTMLElement, e: any, data: any, players: Map<string, RhPlayer>) {
  const lastSize = () => Number(sessionStorage.getItem("juiced-roster-size")) || 10;
  const groups: { name: string; members: string[]; size: number }[] = e.roster
    ? e.roster.groups.map((g: any) => ({ name: g.name, members: [...g.members], size: g.size || lastSize() }))
    : [{ name: "", members: [], size: lastSize() }, { name: "", members: [], size: lastSize() }];
  let target = Math.max(0, groups.findIndex((g) => g.members.length < g.size));
  // Partnerschaften gelten für normale Raids, nicht für GvG (am Titel erkannt, im Planer umschaltbar)
  let usePartners = !/\b(gvg|gw|guild\s*wars?|\d+\s*v\s*\d+)\b/i.test(plainTitle(e.title));
  const partnerList = (): string[][] => (usePartners ? data.partnerships || [] : []);
  const info = (uid: string): RhPlayer => players.get(uid) || { uid, name: data.profiles?.[uid]?.name || "?", path: "", role: data.profiles?.[uid]?.main_role || "dps", playing: false };
  const pool = () => [...players.values()].filter((p) => p.playing && !groups.some((g) => g.members.includes(p.uid)))
    .sort((a, b) => (ROLE_ORDER[a.role] ?? 3) - (ROLE_ORDER[b.role] ?? 3) || a.name.localeCompare(b.name));
  const chip = (p: RhPlayer) => {
    const mates = partnersOf(p.uid).filter((u) => players.get(u)?.playing);
    const mine = groups.findIndex((g) => g.members.includes(p.uid));
    const split = mine >= 0 && mates.some((u) => { const o = groups.findIndex((g) => g.members.includes(u)); return o >= 0 && o !== mine; });
    const tip = mates.length ? ` · ${T("pt_with", { names: mates.map((u) => info(u).name).join(", ") })}` : "";
    return `<button type="button" ${p.color ? `style="--role:${p.color}"` : ""} class="rh-p ro-p role-${esc(p.role)} ${p.emote ? "has-emo" : ""} ${p.playing ? "" : "is-left"} ${split ? "is-split" : ""}" draggable="true" data-uid="${esc(p.uid)}" title="${esc((p.playing ? p.name : T("roster_left")) + tip)}">${emoteImg(p.emote)}<b>${esc(p.name)}</b>${mates.length ? `<i class="ro-link">${icon.link}</i>` : ""}${p.path ? `<small>${esc(p.path)}</small>` : ""}</button>`;
  };
  const roleCount = (ids: string[]) => ["tank", "healer", "dps"].map((r) => { const n = ids.filter((u) => info(u).role === r).length; return `<span class="rc role-${r} ${n ? "" : "is-zero"}" title="${esc(T("role_" + r))}"><i></i>${n}</span>`; }).join("");
  const nextOpen = (from: number) => {
    for (let k = 0; k < groups.length; k++) { const i = (from + k) % groups.length; if (groups[i].members.length < groups[i].size) return i; }
    return -1;
  };

  const draw = () => {
    const free = pool();
    if (target >= groups.length) target = groups.length - 1;
    card.innerHTML = `<header class="rh-head"><div><h3>${esc(e.title)}</h3><span class="muted">${esc(T("roster_hint"))}</span></div>
      <div class="rh-side">
        ${(data.partnerships || []).length ? `<label class="check check-sm ro-ptoggle"><input type="checkbox" data-ptoggle ${usePartners ? "checked" : ""}> <span>${icon.link} ${esc(T("roster_partners"))}</span></label>` : ""}
        <button class="btn btn-ghost btn-sm" data-auto>${esc(T("roster_auto"))}</button>
        <button class="btn btn-ghost btn-sm" data-reset>${esc(T("roster_reset"))}</button>
      </div></header>
      <div class="ro-board">
        <section class="ro-col ro-pool" data-drop="-1"><header><strong>${esc(T("roster_pool"))}</strong><span>${free.length}</span></header>
          <div class="ro-list">${free.map(chip).join("")}</div></section>
        <div class="ro-groups">${groups.map((g, i) => `<section class="ro-col ${i === target ? "is-target" : ""} ${g.members.length > g.size ? "over" : ""}" data-drop="${i}" data-target="${i}">
          <header class="ro-gh"><input class="ro-name" data-gname="${i}" maxlength="40" value="${esc(g.name)}" placeholder="${esc(T("roster_group", { n: i + 1 }))}">
            <span class="ro-fill"><b>${g.members.length}</b>/${g.size}</span>
            <button type="button" class="ro-x" data-rm="${i}" title="${esc(T("roster_remove_group"))}">${icon.x}</button></header>
          <i class="ro-bar"><i style="width:${Math.min(100, Math.round((g.members.length / g.size) * 100))}%"></i></i>
          <div class="ro-sub"><span class="ro-rc">${roleCount(g.members)}</span>
            <span class="ro-step" title="${esc(T("roster_size"))}"><button type="button" data-dec="${i}" aria-label="−">−</button><span>${g.size} ${esc(T("roster_slots"))}</span><button type="button" data-inc="${i}" aria-label="+">+</button></span></div>
          <div class="ro-list">${g.members.map((u) => chip(info(u))).join("") || `<span class="ro-empty">${esc(T("roster_drop"))}</span>`}</div></section>`).join("")}
          <button type="button" class="ro-add" data-add>${icon.plus} ${esc(T("roster_add_group"))}</button></div>
      </div>
      <footer class="ro-foot"><button class="btn btn-ghost" data-cancel>${esc(T("cancel"))}</button><button class="btn btn-primary" data-save>${esc(T("save"))}</button></footer>`;
  };
  const move = (uid: string, to: number) => {
    for (const g of groups) g.members = g.members.filter((u) => u !== uid);
    if (to >= 0 && groups[to]) groups[to].members.push(uid);
    draw();
  };
  // Klick aus dem Pool: in die Zielgruppe; ist sie voll, in die nächste freie (oder eine neue)
  const toTarget = (uid: string) => {
    let i = groups[target] && groups[target].members.length < groups[target].size ? target : nextOpen(target);
    if (i < 0) { groups.push({ name: "", members: [], size: groups[groups.length - 1]?.size || lastSize() }); i = groups.length - 1; }
    target = i;
    move(uid, i);
    if (groups[i].members.length >= groups[i].size) { const n = nextOpen(i); if (n >= 0) { target = n; draw(); } }
  };
  // Automatisch verteilen (Regeln wie im Raid-Group-Composer):
  // Partner zuerst zusammen, 8-10 pro Gruppe ohne Mini-Restgruppe, ein Tank pro Gruppe, Heiler gleichmäßig, Rest DPS.
  const autoFill = () => {
    const all = [...players.values()].filter((p) => p.playing);
    const ids = new Set(all.map((p) => p.uid));
    // Partnerschaften: nur Anwesende, überlappende zusammenführen
    let clusters: string[][] = partnerList().map((c: string[]) => c.filter((u) => ids.has(u))).filter((c: string[]) => c.length >= 2);
    for (let merged = true; merged;) {
      merged = false;
      outer: for (let a = 0; a < clusters.length; a++) for (let b = a + 1; b < clusters.length; b++) {
        if (clusters[a].some((u) => clusters[b].includes(u))) {
          clusters[a] = [...new Set([...clusters[a], ...clusters[b]])];
          clusters.splice(b, 1);
          merged = true;
          break outer;
        }
      }
    }
    const MIN = 8, MAX = Math.max(MIN, ...groups.map((g) => g.size), 10);
    const n = all.length;
    let count = Math.max(1, Math.ceil(n / MAX));
    while (count > 1 && n / count < MIN) count--;
    const base = Math.floor(n / count), extra = n % count;
    const names = groups.map((g) => g.name);
    groups.length = 0;
    for (let k = 0; k < count; k++) groups.push({ name: names[k] || "", members: [], size: base + (k < extra ? 1 : 0) });
    const free = (g: { members: string[]; size: number }) => g.size - g.members.length;
    const cnt = (g: { members: string[] }, r: string) => g.members.filter((u) => info(u).role === r).length;
    const warn: string[] = [];
    // 1) Partner-Gruppen zuerst (größte zuerst), in die Gruppe mit dem meisten Platz
    clusters.sort((a, b) => b.length - a.length);
    for (const c of clusters) {
      const g = [...groups].sort((a, b) => free(b) - free(a))[0];
      if (c.length > free(g)) { warn.push(T("roster_warn_cluster", { names: c.map((u) => info(u).name).join(", ") })); g.size = Math.max(g.size, g.members.length + c.length); }
      g.members.push(...c);
    }
    const seated = new Set(groups.flatMap((g) => g.members));
    const rest = all.filter((p) => !seated.has(p.uid));
    // 2) Tanks, 3) Heiler, 4) DPS: jeweils dorthin, wo die Rolle am seltensten ist und Platz frei ist
    for (const role of ["tank", "healer", "dps", ""]) {
      for (const p of rest.filter((x) => (role ? x.role === role : !["tank", "healer", "dps"].includes(x.role)))) {
        let open = groups.filter((g) => free(g) > 0);
        if (!open.length) open = groups;
        open.sort((a, b) => cnt(a, p.role) - cnt(b, p.role) || free(b) - free(a));
        open[0].members.push(p.uid);
      }
    }
    groups.forEach((g, k) => {
      if (!cnt(g, "tank") && all.some((p) => p.role === "tank")) warn.push(T("roster_warn_tank", { g: g.name || T("roster_group", { n: k + 1 }) }));
      if (!cnt(g, "healer") && all.some((p) => p.role === "healer")) warn.push(T("roster_warn_heal", { g: g.name || T("roster_group", { n: k + 1 }) }));
    });
    target = 0;
    draw();
    if (warn.length) toast(warn.join(" · "));
  };
  // Partner eines Spielers (für Markierung + Warnung "getrennt")
  const partnersOf = (uid: string) => [...new Set(partnerList().filter((c: string[]) => c.includes(uid)).flat())].filter((u) => u !== uid) as string[];

  card.classList.add("is-editing");
  draw();
  card.addEventListener("input", (ev) => {
    const t = ev.target as HTMLInputElement;
    if (t.dataset.gname) groups[Number(t.dataset.gname)].name = t.value;
  });
  card.addEventListener("change", (ev) => {
    const t = ev.target as HTMLInputElement;
    if (t.matches("[data-ptoggle]")) { usePartners = t.checked; return draw(); }
    if (t.dataset.gsize) {
      const v = Math.max(1, Math.min(40, Math.round(Number(t.value)) || 1));
      groups[Number(t.dataset.gsize)].size = v;
      try { sessionStorage.setItem("juiced-roster-size", String(v)); } catch { /* egal */ }
      draw();
    }
  });
  card.addEventListener("click", async (ev) => {
    const t = ev.target as HTMLElement;
    if (!card.classList.contains("is-editing")) return;
    const chipEl = t.closest<HTMLElement>("[data-uid]");
    const col = t.closest<HTMLElement>("[data-drop]");
    if (t.closest("[data-auto]")) return autoFill();
    if (t.closest("[data-reset]")) { groups.forEach((g) => (g.members = [])); target = 0; return draw(); }
    if (t.closest("[data-add]")) { groups.push({ name: "", members: [], size: groups[groups.length - 1]?.size || lastSize() }); target = groups.length - 1; return draw(); }
    const step = t.closest<HTMLElement>("[data-inc], [data-dec]");
    if (step) {
      const k = Number(step.dataset.inc ?? step.dataset.dec);
      groups[k].size = Math.max(1, Math.min(40, groups[k].size + (step.dataset.inc !== undefined ? 1 : -1)));
      try { sessionStorage.setItem("juiced-roster-size", String(groups[k].size)); } catch { /* egal */ }
      return draw();
    }
    const rm = t.closest<HTMLElement>("[data-rm]");
    if (rm) { groups.splice(Number(rm.dataset.rm), 1); return draw(); }
    if (t.closest("[data-cancel]")) { card.classList.remove("is-editing"); card.replaceWith(card.cloneNode()); return redraw(); }
    if (t.closest("[data-save]")) {
      try {
        const r = await api<any>(`/raidhelper/rosters/${encodeURIComponent(e.id)}`, { method: "PUT", json: { groups } });
        e.roster = r.roster;
        toast(T("roster_saved"));
        card.classList.remove("is-editing");
        card.replaceWith(card.cloneNode());
        redraw();
      } catch (x) { toast((x as Error).message); }
      return;
    }
    if (chipEl) {
      // im Pool: in die Zielgruppe; in einer Gruppe: zurück in den Pool
      const inPool = chipEl.closest("[data-drop]")?.getAttribute("data-drop") === "-1";
      return inPool ? toTarget(chipEl.dataset.uid!) : move(chipEl.dataset.uid!, -1);
    }
    if (t.closest("input, button")) return;
    if (col && col.dataset.target) { target = Number(col.dataset.target); draw(); }
  });
  card.addEventListener("dragstart", (ev) => {
    const c = (ev.target as HTMLElement).closest<HTMLElement>("[data-uid]");
    if (!c || !ev.dataTransfer) return;
    ev.dataTransfer.setData("text/plain", c.dataset.uid!);
    ev.dataTransfer.effectAllowed = "move";
    c.classList.add("dragging");
  });
  card.addEventListener("dragover", (ev) => {
    const col = (ev.target as HTMLElement).closest<HTMLElement>("[data-drop]");
    if (!col) return;
    ev.preventDefault();
    card.querySelectorAll(".ro-col.hover").forEach((x) => x !== col && x.classList.remove("hover"));
    col.classList.add("hover");
  });
  card.addEventListener("dragleave", (ev) => {
    const col = (ev.target as HTMLElement).closest<HTMLElement>("[data-drop]");
    if (col && !col.contains(ev.relatedTarget as Node)) col.classList.remove("hover");
  });
  card.addEventListener("drop", (ev) => {
    const col = (ev.target as HTMLElement).closest<HTMLElement>("[data-drop]");
    const uid = ev.dataTransfer?.getData("text/plain");
    if (!col || !uid) return;
    ev.preventDefault();
    move(uid, Number(col.dataset.drop));
  });
  // nach Speichern/Abbrechen: Karte neu aufbauen (alte Listener hängen an der ersetzten Karte)
  function redraw() {
    const fresh = document.querySelector<HTMLElement>(`[data-ev="${CSS.escape(e.id)}"]`);
    if (fresh) drawSignupEvent(fresh, e, data);
  }
}

// Aufstellung als Bild (wie der Screenshot im Raid-Helper-Comp-Tool)
const ROLE_HEX: Record<string, string> = { tank: "#eab308", healer: "#22c55e", dps: "#3b82f6" };
const loadImg = (src: string) => new Promise<HTMLImageElement | null>((res) => {
  const im = new Image(); im.crossOrigin = "anonymous";
  im.onload = () => res(im); im.onerror = () => res(null); im.src = src;
});
async function rosterImage(e: any, data: any, withIcons = true): Promise<Blob> {
  const players = rhPlayers(e, data.profiles || {});
  const groups: any[] = e.roster.groups;
  const icons = new Map<string, HTMLImageElement>();
  if (withIcons) {
    const ids = [...new Set(groups.flatMap((g) => g.members.map((u: string) => players.get(u)?.emote).filter(Boolean)))] as string[];
    await Promise.all(ids.map(async (id) => { const im = await loadImg(emoteUrl(id)); if (im) icons.set(id, im); }));
  }
  const cols = Math.min(groups.length, groups.length > 4 ? 3 : groups.length <= 2 ? groups.length : 2) || 1;
  const W = 1200, pad = 36, gap = 18, colW = (W - pad * 2 - gap * (cols - 1)) / cols, rowH = 34, headH = 44;
  const rowsPer = (g: any) => Math.max(g.members.length, 1);
  const lines: number[] = [];
  for (let i = 0; i < groups.length; i += cols) lines.push(Math.max(...groups.slice(i, i + cols).map(rowsPer)));
  const H = pad + 86 + lines.reduce((a, n) => a + headH + n * rowH + 16 + gap, 0) + pad - gap + 20;
  const c = document.createElement("canvas");
  const dpr = 2;
  c.width = W * dpr; c.height = H * dpr;
  const x = c.getContext("2d")!;
  x.scale(dpr, dpr);
  const font = (w: number, s: number) => `${w} ${s}px Inter, system-ui, sans-serif`;
  const rr = (X: number, Y: number, w: number, h: number, r: number) => { x.beginPath(); x.roundRect(X, Y, w, h, r); };
  const fit = (t: string, max: number) => { if (x.measureText(t).width <= max) return t; while (t.length && x.measureText(t + "…").width > max) t = t.slice(0, -1); return t + "…"; };
  x.fillStyle = "#0e0d12"; x.fillRect(0, 0, W, H);
  x.fillStyle = "#ff7a18"; x.fillRect(0, 0, W, 5);
  x.fillStyle = "#f4f2ee"; x.font = font(800, 30); x.fillText(fit(e.title, W - pad * 2 - 160), pad, pad + 30);
  const when = e.start ? new Date(e.start).toLocaleString(loc(), { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }) : "";
  x.fillStyle = "#9b98a3"; x.font = font(500, 16); x.fillText(`${when}${e.leader ? `  ·  ${e.leader}` : ""}`, pad, pad + 60);
  x.textAlign = "right"; x.fillStyle = "#ff7a18"; x.font = font(800, 20); x.fillText("JUICED", W - pad, pad + 30); x.textAlign = "left";
  let y = pad + 86;
  lines.forEach((n, li) => {
    groups.slice(li * cols, li * cols + cols).forEach((g, ci) => {
      const gx = pad + ci * (colW + gap), gi = li * cols + ci;
      rr(gx, y, colW, headH + n * rowH + 16, 12); x.fillStyle = "#17161c"; x.fill();
      x.fillStyle = "#f4f2ee"; x.font = font(700, 16); x.fillText(fit((g.name || T("roster_group", { n: gi + 1 })).toUpperCase(), colW - 80), gx + 16, y + 28);
      x.textAlign = "right"; x.fillStyle = "#9b98a3"; x.font = font(600, 14); x.fillText(`${g.members.length}/${g.size || g.members.length}`, gx + colW - 16, y + 28); x.textAlign = "left";
      g.members.forEach((uid: string, k: number) => {
        const p = players.get(uid) || { name: data.profiles?.[uid]?.name || "?", path: "", role: data.profiles?.[uid]?.main_role || "" } as any;
        const ry = y + headH + k * rowH;
        rr(gx + 10, ry, colW - 20, rowH - 5, 7); x.fillStyle = "#211f27"; x.fill();
        x.fillStyle = p.color || ROLE_HEX[p.role] || "#6b6875"; rr(gx + 10, ry, 4, rowH - 5, 2); x.fill();
        const ic = p.emote && icons.get(p.emote);
        if (ic) x.drawImage(ic, gx + 22, ry + 5, 19, 19);
        x.fillStyle = "#f4f2ee"; x.font = font(600, 14); x.fillText(fit(p.name, colW * 0.5), gx + (ic ? 48 : 24), ry + 19);
        if (p.path) { x.textAlign = "right"; x.fillStyle = "#9b98a3"; x.font = font(500, 12); x.fillText(fit(p.path, colW * 0.38), gx + colW - 20, ry + 19); x.textAlign = "left"; }
      });
    });
    y += headH + n * rowH + 16 + gap;
  });
  x.fillStyle = "#6b6875"; x.font = font(500, 12); x.fillText("juiced.team", pad, H - pad + 14);
  // gibt Discord die Icons nicht frei, ist das Bild "gesperrt" -> ohne Icons neu zeichnen
  try { c.getContext("2d")!.getImageData(0, 0, 1, 1); } catch { return rosterImage(e, data, false); }
  return new Promise((res) => c.toBlob((b) => res(b!), "image/png"));
}

async function rosterImageAction(e: any, data: any, copy: boolean) {
  try { await document.fonts?.ready; } catch { /* egal */ }
  const blob = await rosterImage(e, data);
  if (copy && navigator.clipboard && "ClipboardItem" in window) {
    try { await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]); toast(T("roster_img_copied")); return; } catch { /* Fallback: herunterladen */ }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${e.title.replace(/[^\w-]+/g, "_").slice(0, 40) || "roster"}.png`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

// Erinnerung wie /unsigned bei Raid-Helper: alle mit Rolle X, die noch nicht reagiert haben
let rhRoles: { id: string; name: string; color: number }[] | null = null;
async function remindUnsigned(e: any, data: any) {
  const chans: { id: string; name: string }[] = data.channels || [];
  try { rhRoles = rhRoles || await api<any[]>("/raidhelper/roles"); } catch (x) { toast((x as Error).message); return; }
  let saved = ""; try { saved = localStorage.getItem("juiced-remind-role") || ""; } catch { /* egal */ }
  const def = rhRoles.find((r) => r.id === saved) || rhRoles.find((r) => r.name.toUpperCase() === "G1") || rhRoles[0];
  const m = modal(T("rh_remind_t"), `
    <p class="hint">${esc(T("rh_unsigned_hint"))}</p>
    <div class="row2"><div class="field"><label>${esc(T("rh_role"))}</label><select class="select" id="rm-role">${rhRoles.map((r) => `<option value="${esc(r.id)}" ${r.id === def?.id ? "selected" : ""}>@${esc(r.name)}</option>`).join("")}</select></div>
      <div class="field"><label>${esc(T("rh_channel"))}</label><select class="select" id="rm-ch">${chans.map((c) => `<option value="${esc(c.id)}" ${c.id === e.channel_id ? "selected" : ""}>#${esc(c.name || c.id)}</option>`).join("")}</select></div></div>
    <div class="field"><span class="label" id="rm-count"></span><div class="unsigned-list" id="rm-list">${loading}</div></div>
    <div class="field"><label>${esc(T("rh_remind_text"))}</label><input class="input" id="rm-text" maxlength="800" value="${esc(T("rh_remind_default", { title: e.title }))}"></div>
    <label class="check"><input type="checkbox" id="rm-ping" checked> <span>${esc(T("rh_remind_ping"))}</span></label>
    <label class="check"><input type="checkbox" id="rm-dm"> <span>${esc(T("rh_remind_dm"))}</span></label>`,
    `<button class="btn btn-primary" data-save>${esc(T("rh_remind"))}</button>`);
  const q = <X extends HTMLElement>(sel: string) => m.el.querySelector(sel) as X;
  let count = 0;
  const load = async () => {
    const role = q<HTMLSelectElement>("#rm-role").value;
    try { localStorage.setItem("juiced-remind-role", role); } catch { /* egal */ }
    q<HTMLElement>("#rm-list").innerHTML = loading;
    try {
      const list = await api<any[]>(`/raidhelper/events/${encodeURIComponent(e.id)}/unsigned?role=${encodeURIComponent(role)}`);
      count = list.length;
      q<HTMLElement>("#rm-count").textContent = T("rh_unsigned", { n: list.length });
      q<HTMLElement>("#rm-list").innerHTML = list.length ? list.map((u) => `<span class="rh-p"><b>${esc(u.name)}</b></span>`).join("") : `<span class="muted">${esc(T("rh_unsigned_none"))}</span>`;
    } catch (x) { count = 0; q<HTMLElement>("#rm-count").textContent = ""; q<HTMLElement>("#rm-list").innerHTML = `<span class="muted">${esc((x as Error).message)}</span>`; }
    q<HTMLButtonElement>("[data-save]").disabled = !count;
  };
  q<HTMLSelectElement>("#rm-role").addEventListener("change", load);
  load();
  q<HTMLElement>("[data-save]").addEventListener("click", async (ev) => {
    const b = ev.currentTarget as HTMLButtonElement;
    b.disabled = true;
    try {
      const r = await api<any>(`/raidhelper/events/${encodeURIComponent(e.id)}/remind`, { method: "POST", json: {
        role_id: q<HTMLSelectElement>("#rm-role").value, channel_id: q<HTMLSelectElement>("#rm-ch")?.value || null,
        text: q<HTMLInputElement>("#rm-text").value, ping: q<HTMLInputElement>("#rm-ping").checked, dm: q<HTMLInputElement>("#rm-dm").checked,
      } });
      m.close(); toast(T("rh_reminded_n", { n: r.count }));
    } catch (x) { toast((x as Error).message); b.disabled = false; }
  });
}

// "In Discord öffnen": erst die Discord-App (discord://), nur ohne App die Browser-Version
document.addEventListener("click", (ev) => {
  const a = (ev.target as HTMLElement).closest<HTMLAnchorElement>("a[data-discord]");
  if (!a || ev.button !== 0 || ev.ctrlKey || ev.metaKey || ev.shiftKey) return;
  const m = a.href.match(/^https:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/(.+)$/);
  if (!m) return;
  ev.preventDefault();
  let left = false;
  const gone = () => { left = true; };
  window.addEventListener("blur", gone, { once: true });
  document.addEventListener("visibilitychange", gone, { once: true });
  location.href = `discord://-/${m[1]}`;
  window.setTimeout(() => {
    window.removeEventListener("blur", gone);
    document.removeEventListener("visibilitychange", gone);
    if (!left && document.visibilityState === "visible") window.open(a.href, "_blank", "noopener");
  }, 1200);
});

// ------------------------------------------------------------------ Build: Pfade + Inner Ways (Darstellung)

const pathTag = (id: string | null | undefined, main = false) => {
  const p = pathById(id);
  return p ? `<span class="path-tag role-${p.role} ${main ? "is-main" : ""}" title="${esc(p.weapons.join(" + "))}"><i></i>${esc(p.name)}</span>` : "";
};
const iwTile = (id: string, small = false) => {
  const w = innerWayById(id);
  return w ? `<span class="iw ${small ? "iw-sm" : ""}" title="${esc(w.name)}"><img src="${innerWayImg(id)}" alt="" loading="lazy" width="48" height="64">${small ? "" : `<span>${esc(w.name)}</span>`}</span>` : "";
};
const hasBuild = (u: any) => !!(u.main_build || (u.alt_builds || []).length || (u.inner_ways || []).length);
// Farbpunkte je Schule (Hybride = zwei Farben)
const buildDots = (id: string | null | undefined) => [...new Set(buildWeapons(id).map((w) => w.school))]
  .map((sc) => schoolEmote(sc) ? emoteImg(schoolEmote(sc), "emo emo-s", schoolColor(sc)) : `<i style="background:${schoolColor(sc)}"></i>`).join("");
const buildTag = (id: string | null | undefined, main = false) => {
  const ws = buildWeapons(id);
  return ws.length ? `<span class="path-tag build-tag ${main ? "is-main" : ""}" title="${esc(ws.map((w) => w.name).join(" + "))}">${buildDots(id)}${esc(buildLabel(id))}</span>` : "";
};
// Kategorie für Übersichten: Tank / Healer / DPS, Twinblades-DPS extra als "TB" (lila)
const CAT_COLOR: Record<string, string> = { tank: "#eab308", healer: "#22c55e", dps: "#3b82f6", tb: "#a855f7" };
// Kategorie eines Builds aus den Waffen (für weitere Kombis ohne eigene Rolle)
function buildCategory(id: string | null | undefined, role: string | null = null): string | null {
  const ws = buildWeapons(id).map((w) => w.id);
  let r: string | null = role;
  if (!r && ws.length) r = ws.some((w) => ["museflow_drum", "panacea_fan", "soulshade_umbrella"].includes(w)) ? "healer" : ws.includes("stormbreaker_spear") ? "tank" : "dps";
  if (r === "dps" && ws.some((w) => w.endsWith("twinblades"))) return "tb";
  return r;
}
const category = (u: any) => buildCategory(u.main_build, u.main_role || null);
// alle Kategorien einer Person: Haupt-Build (mit Rolle) + weitere Kombis -> Kategorie => Build
function memberCats(u: any): Map<string, string | null> {
  const m = new Map<string, string | null>();
  const main = category(u);
  if (main) m.set(main, u.main_build || null);
  for (const b of u.alt_builds || []) { const c = buildCategory(b); if (c && !m.has(c)) m.set(c, b); }
  return m;
}
const matchesCat = (u: any, cat: string) => { const m = memberCats(u); return m.has(cat) || (cat === "dps" && m.has("tb")); };
const catTag = (u: any) => {
  const c = category(u);
  return c ? `<span class="path-tag cat-tag" style="--role:${CAT_COLOR[c]}"><i></i>${esc(c === "tb" ? "TB" : T("role_" + c))}</span>` : `<span class="path-tag"><i></i>—</span>`;
};
const roleOrBuildTag = (u: any, main = false) => u.main_build ? buildTag(u.main_build, main)
  : u.main_role ? `<span class="path-tag role-${esc(u.main_role)}"><i></i>${esc(T("role_" + u.main_role))}</span>` : `<span class="path-tag"><i></i>—</span>`;

// ------------------------------------------------------------------ Mitglieder: Liste mit Filter, Klick öffnet das Profil

const memFilter = { q: "", role: "" };
async function viewRoster(view: HTMLElement) {
  view.innerHTML = head(T("mem_title")) + `<div class="mem-filter">
      <input class="input search" placeholder="${esc(T("mem_search"))}" data-q value="${esc(memFilter.q)}">
      <div class="seg-tabs" role="group">${["", ...ROLES, "tb"].map((r) => `<button type="button" data-role="${r}" aria-pressed="${memFilter.role === r}">${r ? `<span class="role-tag" style="--role:${CAT_COLOR[r]}">${esc(r === "tb" ? "TB" : T("role_" + r))}</span>` : esc(T("mem_all"))}</button>`).join("")}</div>
    </div><p class="muted mem-count" data-count></p><div id="rost">${loading}</div>`;
  let list: any[] = [];
  const draw = () => {
    const q = memFilter.q.toLowerCase();
    const items = list.filter((u) => (!q || `${u.display_name} ${u.username}`.toLowerCase().includes(q))
      && (!memFilter.role || matchesCat(u, memFilter.role)));
    view.querySelector("[data-count]")!.textContent = T("mem_count", { n: items.length });
    view.querySelector("#rost")!.innerHTML = items.length ? `<div class="mem-grid">${items.map((u) => `
      <a class="mcard card" href="#/roster/${u.id}">
        <div class="mc-top">${avatar(u, 44)}<div class="mc-name"><strong>${esc(u.display_name)}</strong><span>${rankBadge(u.rank)} ${flag(u.country)}</span></div></div>
        <div class="mc-build">${catTag(u)}${u.main_build ? `<span class="mc-bname">${buildDots(u.main_build)}${esc(buildLabel(u.main_build))}</span>` : ""}
          ${(u.alt_builds || []).length ? `<span class="mc-more">+${u.alt_builds.length}</span>` : ""}</div>
        ${(() => {  // passt nur über eine weitere Kombi? Dann zeigen, welche
          const c = memFilter.role, m = memberCats(u), main = category(u);
          if (!c || main === c || (c === "dps" && main === "tb")) return "";
          const b = m.get(c) ?? (c === "dps" ? m.get("tb") : null);
          return b ? `<div class="mc-also">${esc(T("mem_also"))} ${buildTag(b)}</div>` : "";
        })()}
        <div class="mc-meta">${u.main_build ? `<span>${esc(buildWeapons(u.main_build).map((w) => w.name).join(" + "))}</span>` : `<span class="mc-empty">${esc(T("mem_no_build"))}</span>`}<span>${(u.inner_ways || []).length ? `${u.inner_ways.length} ${esc(T("prof_inner_ways"))}` : ""}</span></div>
      </a>`).join("")}</div>` : `<p class="empty">${esc(T("mem_empty"))}</p>`;
  };
  view.querySelector("[data-q]")!.addEventListener("input", (e) => { memFilter.q = (e.target as HTMLInputElement).value; draw(); });
  view.querySelectorAll<HTMLElement>("[data-role]").forEach((b) => b.addEventListener("click", () => {
    memFilter.role = b.dataset.role || "";
    view.querySelectorAll("[data-role]").forEach((x) => x.setAttribute("aria-pressed", String((x as HTMLElement).dataset.role === memFilter.role)));
    draw();
  }));
  try { list = await api<any[]>("/members"); draw(); } catch (e) { view.querySelector("#rost")!.innerHTML = `<p class="empty">${esc((e as Error).message)}</p>`; }
}

function buildBlock(u: any, compact = false) {
  const main = buildWeapons(u.main_build);
  const alt = (u.alt_builds || []).filter((b: string) => buildWeapons(b).length);
  const ways = (u.inner_ways || []).filter((w: string) => innerWayById(w));
  if (!main.length && !alt.length && !ways.length) return `<p class="muted">${esc(T("mem_no_build"))}</p>`;
  const cols = [...new Set(main.map((w) => schoolColor(w.school)))];
  return `${main.length ? `<div class="path-main build-main" style="--b1:${cols[0]};--b2:${cols[1] || cols[0]}"><span class="pm-label">${esc(T("mem_main"))}</span><strong>${buildDots(u.main_build)}${esc(buildLabel(u.main_build))}${u.main_role ? `<span class="path-tag pm-role role-${esc(u.main_role)}"><i></i>${esc(T("role_" + u.main_role))}</span>` : ""}</strong>
      <span class="pm-weapons">${esc(main.map((w) => w.name).join(" + "))}</span></div>`
      : u.main_role ? `<div class="build-row"><span class="label">${esc(T("prof_role"))}</span><div class="tags">${roleTag(u.main_role)}</div></div>` : ""}
    ${alt.length ? `<div class="build-row"><span class="label">${esc(T("prof_alt_paths"))}</span><div class="tags">${alt.map((b: string) => buildTag(b)).join("")}</div></div>` : ""}
    ${ways.length ? `<div class="build-row"><span class="label">${esc(T("prof_inner_ways"))}</span><div class="iw-grid ${compact ? "small" : ""}">${ways.map((w: string) => iwTile(w, compact)).join("")}</div></div>` : ""}`;
}

// Ingame-Partner auf der Profilseite: eingetragene Partner + wer diese Person als Partner hat
function partnerBox(u: any) {
  const chip = (p: any) => p.uid ? `<a class="pp-chip" href="#/roster/${p.uid}">${icon.link}<b>${esc(p.name)}</b></a>` : `<span class="pp-chip">${icon.link}<b>${esc(p.name)}</b></span>`;
  return `${u.partners.length ? `<div class="pp-partners">${u.partners.map(chip).join("")}</div>` : `<p class="muted pp-none">${esc(T("prof_partners_none"))}</p>`}
    ${u.partner_of.length ? `<p class="muted pp-of">${esc(T("prof_partner_of"))} ${u.partner_of.map((p: any) => p.uid ? `<a href="#/roster/${p.uid}">${esc(p.name)}</a>` : esc(p.name)).join(", ")}</p>` : ""}`;
}

// Partner einer Person bearbeiten (eigene oder als Leader/Vice von allen)
async function editPartnersFor(u: any, done: (info: any) => void) {
  let people: { id: string; name: string }[] = [];
  const sel: { id: string; name: string }[] = u.partners.map((p: any) => ({ id: p.id, name: p.name }));
  const m = modal(`${T("prof_partners")}: ${u.display_name}`, `
    <p class="hint">${esc(T("prof_partners_hint"))}</p>
    <div class="pp-partners" data-sel></div>
    <div class="pp-search"><input class="input" id="pe-search" autocomplete="off" placeholder="${esc(T("prof_partners_ph"))}"><div class="pp-sugg" data-sugg hidden></div></div>`,
    `<button class="btn btn-primary" data-save>${esc(T("save"))}</button>`);
  const q = <X extends HTMLElement>(s: string) => m.el.querySelector(s) as X;
  const draw = () => {
    q<HTMLElement>("[data-sel]").innerHTML = sel.map((p) => `<span class="pp-chip">${icon.link}<b>${esc(p.name)}</b><button type="button" data-unp="${esc(p.id)}" aria-label="×">${icon.x}</button></span>`).join("")
      || `<span class="muted pp-none">${esc(T("prof_partners_none"))}</span>`;
  };
  const input = q<HTMLInputElement>("#pe-search"), sugg = q<HTMLElement>("[data-sugg]");
  const show = () => {
    const t = input.value.trim().toLowerCase();
    const list = t ? people.filter((x) => x.id !== u.discord_id && !sel.some((s) => s.id === x.id) && x.name.toLowerCase().includes(t)).slice(0, 8) : [];
    sugg.innerHTML = list.map((x) => `<button type="button" data-addp="${esc(x.id)}">${esc(x.name)}</button>`).join("");
    sugg.hidden = !list.length;
  };
  draw();
  api<any[]>("/raidhelper/people").then((l) => { people = l; }).catch(() => {});
  input.addEventListener("input", show);
  input.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); sugg.querySelector<HTMLElement>("[data-addp]")?.click(); } });
  m.el.addEventListener("click", async (ev) => {
    const t = ev.target as HTMLElement;
    const add = t.closest<HTMLElement>("[data-addp]");
    if (add) { const p = people.find((x) => x.id === add.dataset.addp); if (p && sel.length < 8) sel.push(p); input.value = ""; sugg.hidden = true; draw(); input.focus(); return; }
    const un = t.closest<HTMLElement>("[data-unp]");
    if (un) { sel.splice(sel.findIndex((x) => x.id === un.dataset.unp), 1); draw(); return; }
    if (t.closest("[data-save]")) {
      try {
        const info = await api<any>(`/members/${u.id}/partners`, { method: "PUT", json: { partners: sel.map((x) => x.id) } });
        m.close(); toast(T("saved")); done(info);
      } catch (x) { toast((x as Error).message); }
      return;
    }
    if (!t.closest(".pp-search")) sugg.hidden = true;
  });
}

async function editMemberBuild(view: HTMLElement, id: number) {
  view.innerHTML = loading;
  try {
    const u = await api<any>(`/members/${id}`);
    if (!u.can_edit_build) { location.hash = `#/roster/${id}`; return; }
    viewProfile(view, u);
  } catch (e) { view.innerHTML = `<p class="empty">${esc((e as Error).message)}</p>`; }
}

async function viewMember(view: HTMLElement, id: number) {
  view.innerHTML = `<a class="back-link" href="#/roster">← ${esc(T("mem_back"))}</a><div id="mem">${loading}</div>`;
  const el = view.querySelector<HTMLElement>("#mem")!;
  let u: any, vods: any[] = [];
  try {
    [u, vods] = await Promise.all([api<any>(`/members/${id}`), api<any[]>("/vods").catch(() => [])]);
  } catch (e) { el.innerHTML = `<p class="empty">${esc((e as Error).message)}</p>`; return; }
  const own = vods.filter((v) => v.uploader_id === u.id && v.status === "ready");
  const joined = u.joined_at ? new Date(u.joined_at).toLocaleDateString(loc(), { month: "long", year: "numeric" }) : "";
  el.innerHTML = `<section class="card mem-hero">
      ${avatar(u, 72)}
      <div class="mh-main"><h1>${esc(u.display_name)} ${flag(u.country)}</h1>
        <div class="mh-tags">${rankBadge(u.rank)} ${u.coach_roles.map((r: string) => `<span class="badge badge-coach">${esc(T("rank_coach"))} ${esc(T("role_" + r))}</span>`).join(" ")}</div>
        <span class="muted">@${esc(u.username)}${joined ? ` · ${esc(T("mem_joined", { d: joined }))}` : ""}</span></div>
      ${u.id === me!.id ? `<a class="btn btn-outline btn-sm" href="#/profile">${icon.edit} ${esc(T("dash_build_edit"))}</a>`
        : u.can_edit_build ? `<a class="btn btn-outline btn-sm" href="#/roster/${u.id}/edit">${icon.edit} ${esc(T("dash_build_edit"))}</a>` : ""}
    </section>
    <h2 class="v-sub">Build</h2>
    <section class="card build-card">${buildBlock(u)}</section>
    <h2 class="v-sub v-sub-link"><span>${esc(T("prof_partners"))}</span>${u.can_edit_partners ? `<button class="btn btn-ghost btn-sm" data-edit-partners>${icon.edit} ${esc(T("edit"))}</button>` : ""}</h2>
    <section class="card build-card" data-partner-box>${partnerBox(u)}</section>
    <h2 class="v-sub">${esc(T("mem_vods"))} <span class="muted">${own.length || ""}</span></h2>
    ${own.length ? `<div class="table card">${own.map((v) => `<a class="tr mem-vod" href="#/vods/${v.id}">
        <span class="mv-ico">${icon.play}</span>
        <div class="tr-main"><strong>${esc(v.title)}</strong><span class="muted">${v.match_date ? esc(fmtDate(v.match_date)) : ""}${v.opponent ? ` · vs ${esc(v.opponent)}` : ""}${v.note_count ? ` · ${v.note_count} ✎` : ""}</span></div>
        ${v.reviewed ? `<span class="mv-ok">${icon.check}</span>` : ""}
      </a>`).join("")}</div>` : `<p class="empty">${esc(T("mem_no_vods"))}</p>`}`;
  el.querySelector("[data-edit-partners]")?.addEventListener("click", () => editPartnersFor(u, (info) => {
    Object.assign(u, info);
    el.querySelector<HTMLElement>("[data-partner-box]")!.innerHTML = partnerBox(u);
    if (u.id === me!.id) me!.partners = info.partners.map((p: any) => p.id);
  }));
}

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

// target: Mitglied, dessen Build ein Leader/Vice bearbeitet (sonst das eigene Profil)
function viewProfile(view: HTMLElement, target: any = null) {
  const own = !target || target.id === me!.id;
  const u: any = own ? me! : target;
  const regionName = (() => { try { return new Intl.DisplayNames([lang()], { type: "region" }); } catch { return null; } })();
  const opts = COUNTRIES.map((c) => ({ c, n: regionName?.of(c) || c })).sort((a, b) => a.n.localeCompare(b.n));
  // Build = Rolle + zwei beliebige Waffen (Hybride erlaubt), weitere Kombis als Liste
  const ROLES3 = ["tank", "healer", "dps"];
  let role: string | null = u.main_role && ROLES3.includes(u.main_role) ? u.main_role : null;
  let mainSel: string[] = buildWeapons(u.main_build).map((w) => w.id);
  const altB = new Set<string>(u.alt_builds || []);
  const curMain = () => (mainSel.length === 2 ? buildId(mainSel[0], mainSel[1]) : null);
  let altSel: string[] = [];
  const ways = new Set<string>(u.inner_ways || []);
  let showAll = false;
  const partners: string[] = (u.partners || []).map((x: any) => (typeof x === "string" ? x : x.id));
  let people: { id: string; name: string }[] = [];
  view.innerHTML = (own ? head(T("prof_title")) : `<a class="back-link" href="#/roster/${u.id}">← ${esc(u.display_name)}</a>` + head(T("prof_edit_other", { name: u.display_name }))) + `<form class="profile card" novalidate>
    <div class="prof-top">${avatar(u, 56)}<div><strong>${esc(u.username)}</strong>${rankBadge(own ? me!.public_rank : u.rank)}</div>
      <a class="btn btn-ghost btn-sm prof-view" href="#/roster/${u.id}">${icon.user}</a></div>
    ${own ? `<div class="field"><label for="p-name">${esc(T("prof_ingame"))}</label><input class="input" id="p-name" maxlength="40" value="${esc(me!.ingame_name || "")}"></div>
    <div class="field"><label for="p-country">${esc(T("prof_country"))}</label><select class="select" id="p-country"><option value="">—</option>${opts.map((o) => `<option value="${o.c}" ${me!.country === o.c ? "selected" : ""}>${esc(o.n)}</option>`).join("")}</select></div>` : ""}
    <h2 class="prof-sec">${esc(own ? T("prof_build") : "Build")}</h2>
    <div class="field"><span class="label">${esc(T("prof_role"))}</span>
      <div class="seg-tabs path-roles" role="group">${ROLES3.map((r) => `<button type="button" data-prole="${r}" aria-pressed="${role === r}"><span class="role-tag role-${r}">${esc(T("role_" + r))}</span></button>`).join("")}</div></div>
    <div class="field"><span class="label">${esc(T("prof_main_build"))}</span><p class="hint">${esc(T("prof_main_build_hint"))}</p>
      <div class="wpick">${SCHOOLS.map((sc) => `<div class="wp-col" style="--sc:${sc.color}"><span class="wp-h">${schoolEmote(sc.id) ? emoteImg(schoolEmote(sc.id), "emo emo-s") : "<i></i>"}${esc(sc.name)}</span>${WEAPONS.filter((w) => w.school === sc.id).map((w) => `<button type="button" class="wp" data-w="${w.id}">${esc(w.name)}</button>`).join("")}</div>`).join("")}</div>
      <div class="bp-current" data-bcur></div></div>
    <div class="field"><span class="label">${esc(T("prof_alt_paths"))}</span><p class="hint">${esc(T("prof_alt_hint"))}</p>
      <div class="pp-partners" data-alts></div>
      <button type="button" class="btn btn-outline btn-sm alt-open" data-alt-open>${icon.plus} ${esc(T("prof_alt_add"))}</button>
      <div class="alt-pick" data-alt-pick hidden><p class="hint">${esc(T("prof_alt_pick_hint"))}</p>
        <div class="wpick">${SCHOOLS.map((sc) => `<div class="wp-col" style="--sc:${sc.color}"><span class="wp-h">${schoolEmote(sc.id) ? emoteImg(schoolEmote(sc.id), "emo emo-s") : "<i></i>"}${esc(sc.name)}</span>${WEAPONS.filter((w) => w.school === sc.id).map((w) => `<button type="button" class="wp" data-aw="${w.id}">${esc(w.name)}</button>`).join("")}</div>`).join("")}</div></div>
</div>
    <div class="field"><div class="iw-head"><span class="label">${esc(T("prof_inner_ways"))} <span class="muted" data-iw-count></span></span>
      <label class="check check-sm"><input type="checkbox" data-iw-all> <span>${esc(T("prof_iw_all"))}</span></label></div>
      <p class="hint">${esc(T("prof_iw_hint"))}</p><div data-iw></div></div>
    <div class="field"><span class="label">${esc(T("prof_partners"))}</span><p class="hint">${esc(T("prof_partners_hint"))}</p>
      <div class="pp-partners" data-partners></div>
      <div class="pp-search"><input class="input" id="p-psearch" autocomplete="off" placeholder="${esc(T("prof_partners_ph"))}"><div class="pp-sugg" data-sugg hidden></div></div></div>
    ${own ? `<label class="check"><input type="checkbox" id="p-show" ${me!.show_on_team ? "checked" : ""}> <span>${esc(T("prof_show"))}</span></label>` : ""}
    <button class="btn btn-primary" type="submit">${esc(T("save"))}</button>
  </form>`;

  // Inner Ways: nach Pfad gruppiert; ohne "Alle zeigen" nur eigene Pfade + allgemeine (+ schon gewählte)
  const drawWays = () => {
    const mainPaths = buildPaths(curMain());
    const mine = new Set([...mainPaths, ...[...altB].flatMap((b) => buildPaths(b))]);
    const groups = [...PATHS.map((p) => ({ id: p.id, name: p.name })), { id: "general", name: T("iw_general") }]
      .map((g) => ({ ...g, items: INNER_WAYS.filter((w) => w.path === g.id && (showAll || mine.has(g.id) || g.id === "general" || ways.has(w.id))) }))
      .filter((g) => g.items.length)
      .sort((a, b) => Number(mainPaths.includes(b.id)) - Number(mainPaths.includes(a.id)));
    view.querySelector("[data-iw]")!.innerHTML = groups.map((g) => `<div class="iw-group"><span class="iw-gname">${esc(g.name)}</span>
      <div class="iw-grid pick">${g.items.map((w) => `<button type="button" class="iw" data-way="${w.id}" aria-pressed="${ways.has(w.id)}" title="${esc(w.name)}">
        <img src="${innerWayImg(w.id)}" alt="" loading="lazy" width="48" height="64"><span>${esc(w.name)}</span></button>`).join("")}</div></div>`).join("");
    view.querySelector("[data-iw-count]")!.textContent = ways.size ? `(${ways.size})` : "";
  };
  drawWays();
  view.querySelector("[data-iw]")!.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-way]");
    if (!b) return;
    const id = b.dataset.way!;
    ways.has(id) ? ways.delete(id) : ways.add(id);
    b.setAttribute("aria-pressed", String(ways.has(id)));
    view.querySelector("[data-iw-count]")!.textContent = ways.size ? `(${ways.size})` : "";
  });
  // Ingame-Partner: Suche über die Discord-Mitglieder, Auswahl als Chips
  const nameOf = (id: string) => people.find((x) => x.id === id)?.name || "…";
  const drawPartners = () => {
    view.querySelector("[data-partners]")!.innerHTML = partners.map((id) => `<span class="pp-chip">${icon.link}<b>${esc(nameOf(id))}</b><button type="button" data-unp="${esc(id)}" aria-label="×">${icon.x}</button></span>`).join("")
      || `<span class="muted pp-none">${esc(T("prof_partners_none"))}</span>`;
  };
  const search = view.querySelector<HTMLInputElement>("#p-psearch")!;
  const sugg = view.querySelector<HTMLElement>("[data-sugg]")!;
  const showSugg = () => {
    const q = search.value.trim().toLowerCase();
    const list = q ? people.filter((x) => x.id !== u.discord_id && !partners.includes(x.id) && x.name.toLowerCase().includes(q)).slice(0, 8) : [];
    sugg.innerHTML = list.map((x) => `<button type="button" data-addp="${esc(x.id)}">${esc(x.name)}</button>`).join("");
    sugg.hidden = !list.length;
  };
  api<{ id: string; name: string }[]>("/raidhelper/people").then((l) => { people = l; drawPartners(); }).catch(() => drawPartners());
  drawPartners();
  search.addEventListener("input", showSugg);
  search.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); sugg.querySelector<HTMLElement>("[data-addp]")?.click(); } });
  view.addEventListener("click", (ev) => {
    const t = ev.target as HTMLElement;
    const add = t.closest<HTMLElement>("[data-addp]");
    if (add) { if (partners.length < 8) partners.push(add.dataset.addp!); search.value = ""; sugg.hidden = true; drawPartners(); search.focus(); return; }
    const un = t.closest<HTMLElement>("[data-unp]");
    if (un) { partners.splice(partners.indexOf(un.dataset.unp!), 1); drawPartners(); return; }
    if (!t.closest(".pp-search")) sugg.hidden = true;
  });
  view.querySelector<HTMLInputElement>("[data-iw-all]")!.addEventListener("change", (e) => { showAll = (e.target as HTMLInputElement).checked; drawWays(); });
  const drawMain = () => {
    const id = curMain();
    view.querySelectorAll<HTMLElement>("[data-w]").forEach((b) => b.setAttribute("aria-pressed", String(mainSel.includes(b.dataset.w!))));
    view.querySelector("[data-bcur]")!.innerHTML = id
      ? `${buildTag(id, true)}<span class="muted">${esc(buildWeapons(id).map((w) => w.name).join(" + "))}</span>`
      : `<span class="muted">${esc(T("prof_pick_two"))}</span>`;
  };
  const drawAlts = () => {
    view.querySelector("[data-alts]")!.innerHTML = [...altB].map((b) => `<span class="pp-chip build-chip-x">${buildDots(b)}<b>${esc(buildLabel(b))}</b><button type="button" data-unalt="${esc(b)}" aria-label="×">${icon.x}</button></span>`).join("");
  };
  const setRole = (r: string | null) => {
    role = r;
    view.querySelectorAll<HTMLElement>("[data-prole]").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.prole === role)));
  };
  drawMain(); drawAlts();
  view.addEventListener("click", (ev) => {
    const t = ev.target as HTMLElement;
    const pr = t.closest<HTMLElement>("[data-prole]");
    if (pr) { setRole(role === pr.dataset.prole ? null : pr.dataset.prole!); return; }
    const w = t.closest<HTMLElement>("[data-w]");
    if (w) {
      const id = w.dataset.w!;
      mainSel = mainSel.includes(id) ? mainSel.filter((x) => x !== id) : [...mainSel, id].slice(-2);
      const m = curMain(); if (m) altB.delete(m);
      drawMain(); drawAlts(); drawWays(); return;
    }
    const un = t.closest<HTMLElement>("[data-unalt]");
    if (un) { altB.delete(un.dataset.unalt!); drawAlts(); drawWays(); return; }
    // weitere Kombi: Raster aufklappen, zwei Waffen anklicken -> hinzugefügt, Raster bleibt offen für die nächste
    if (t.closest("[data-alt-open]")) { const box = view.querySelector<HTMLElement>("[data-alt-pick]")!; box.hidden = !box.hidden; return; }
    const aw = t.closest<HTMLElement>("[data-aw]");
    if (aw) {
      const id = aw.dataset.aw!;
      altSel = altSel.includes(id) ? altSel.filter((x) => x !== id) : [...altSel, id];
      if (altSel.length === 2) {
        const b = buildId(altSel[0], altSel[1]);
        if (b !== curMain() && altB.size < 8) altB.add(b);
        altSel = [];
        drawAlts(); drawWays();
      }
      view.querySelectorAll<HTMLElement>("[data-aw]").forEach((x) => x.setAttribute("aria-pressed", String(altSel.includes(x.dataset.aw!))));
      return;
    }
  });
  view.querySelector("form")!.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!own) {  // Leader/Vice speichert den Build eines Mitglieds
      try {
        await api(`/members/${u.id}/build`, { method: "PUT", json: { main_role: role, main_build: curMain(), alt_builds: [...altB], inner_ways: [...ways], partners } });
        toast(T("saved"));
        location.hash = `#/roster/${u.id}`;
      } catch (err) { toast((err as Error).message); }
      return;
    }
    try {
      const r = await api<{ user: Me }>("/me", { method: "PUT", json: {
        ingame_name: (view.querySelector("#p-name") as HTMLInputElement).value,
        main_role: role, main_build: curMain(), alt_builds: [...altB], inner_ways: [...ways], partners,
        weapon_other: "",
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

// "Als Nächstes": der laufende oder nächste Termin als große Karte
async function loadNextOne(el: HTMLElement) {
  let list: any[] = [];
  try { list = await fetchUpcoming(14); } catch { el.innerHTML = ""; return; }
  const now = Date.now();
  const isLive = (e: any) => new Date(e.starts_at).getTime() <= now && (e.open_end || new Date(e.ends_at).getTime() > now);
  const e = list.find(isLive) || list.find((x) => new Date(x.starts_at).getTime() > now);
  if (!e) { el.innerHTML = `<p class="muted">${esc(T("dash_nothing"))}</p>`; return; }
  const s = new Date(e.starts_at);
  const day = s.toLocaleDateString(loc(), { weekday: "long", day: "numeric", month: "long" });
  const time = e.open_end ? T("sched_from", { t: timeShort(s, lang()) }) : timeRange(s, new Date(e.ends_at), lang());
  const min = Math.max(1, Math.round((s.getTime() - now) / 60000));
  const rel = new Intl.RelativeTimeFormat(loc(), { numeric: "always", style: "short" });
  const inTxt = min < 60 ? rel.format(min, "minute") : min < 2880 ? rel.format(Math.round(min / 60), "hour") : rel.format(Math.round(min / 1440), "day");
  el.innerHTML = `<div class="next-one kind-${esc(e.kind)}">
    <span class="ag-meta"><i></i>${esc(T("kind_" + e.kind))}</span>
    <strong>${esc(e.title)}${e.opponent ? ` <span>· ${esc(T("sched_vs", { name: e.opponent }))}</span>` : ""}</strong>
    <span class="muted">${esc(day)} · ${esc(time)}</span>
    ${isLive(e) ? `<span class="ag-live"><b></b>Live</span>` : `<span class="ag-in">${esc(inTxt)}</span>`}
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
    return diff <= 1 ? cap(rel.format(diff, "day")) : "";
  };
  const countdown = (e: any) => {
    const ms = new Date(e.starts_at).getTime() - Date.now();
    const min = Math.max(1, Math.round(ms / 60000));
    if (min < 60) return relShort.format(min, "minute");
    const h = Math.round(min / 60);
    return h < 48 ? relShort.format(h, "hour") : relShort.format(Math.round(h / 24), "day");
  };

  el.innerHTML = `<div class="agenda">${groups.map((g, gi) => `
    <section class="ag-day ${gi === 0 && dayLabel(g.date) === cap(rel.format(0, "day")) ? "is-today" : ""}">
      <h3 class="ag-head"><span>${esc(dayLabel(g.date))}</span>${esc(g.date.toLocaleDateString(loc(), { weekday: "short", day: "numeric", month: "short" }))}</h3>
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

// Wochenplan verwalten: "Nächste 7 Tage" (nach Tagen) oder "Alle Termine" (jede Serie einmal)
let schedTab: "week" | "all" = "week";
async function viewSchedule(view: HTMLElement) {
  view.innerHTML = head(T("app_nav_schedule"), "", `<a class="btn btn-ghost btn-sm" href="/${lang()}/schedule/" target="_blank">${esc(T("week_cta"))}</a><button class="btn btn-primary btn-sm" data-new>${icon.plus} ${esc(T("ev_new"))}</button>`)
    + `<div class="seg-tabs" role="tablist">
        <button role="tab" data-tab="week" aria-selected="${schedTab === "week"}">${esc(T("ev_tab_week"))}</button>
        <button role="tab" data-tab="all" aria-selected="${schedTab === "all"}">${esc(T("ev_tab_all"))}</button>
      </div><div id="evs">${loading}</div>`;
  const reload = () => viewSchedule(view);
  view.querySelector("[data-new]")!.addEventListener("click", () => editEvent(null, reload));
  view.querySelectorAll<HTMLElement>("[data-tab]").forEach((b) => b.addEventListener("click", () => {
    schedTab = b.dataset.tab as "week" | "all";
    reload();
  }));
  const el = view.querySelector<HTMLElement>("#evs")!;
  let list: any[] = [];
  try { list = await fetchUpcoming(schedTab === "week" ? 7 : 56); }
  catch (x) { el.innerHTML = `<p class="empty">${esc((x as Error).message)}</p>`; return; }
  if (!list.length) { el.innerHTML = `<p class="empty">${esc(T("ev_none"))}</p>`; return; }

  const actions = `<div class="ag-actions"><button class="btn btn-ghost btn-sm" data-edit title="${esc(T("edit"))}">${icon.edit}</button><button class="btn btn-ghost btn-sm" data-del title="${esc(T("delete"))}">${icon.trash}</button></div>`;
  const timeOf = (e: any) => e.open_end ? T("sched_from", { t: timeShort(new Date(e.starts_at), lang()) }) : timeRange(new Date(e.starts_at), new Date(e.ends_at), lang());
  const title = (e: any) => `<strong>${esc(e.title)}${e.opponent ? ` <span>· ${esc(T("sched_vs", { name: e.opponent }))}</span>` : ""}</strong>`;
  const flags = (e: any) => `${e.open_end ? ` · ${esc(T("sched_open_end"))}` : ""}${!e.is_public ? ` · ${esc(T("sched_internal"))}` : ""}`;

  if (schedTab === "week") {
    const groups: { date: Date; items: any[] }[] = [];
    for (const e of list) {
      const d = new Date(e.starts_at);
      const g = groups.find((x) => x.date.toDateString() === d.toDateString());
      if (g) g.items.push(e); else groups.push({ date: d, items: [e] });
    }
    const today = new Date().toDateString();
    el.innerHTML = `<div class="agenda">${groups.map((g) => `
      <section class="ag-day ${g.date.toDateString() === today ? "is-today" : ""}">
        <h3 class="ag-head"><span></span>${esc(g.date.toLocaleDateString(loc(), { weekday: "long", day: "numeric", month: "short" }))}</h3>
        <div class="ag-items">${g.items.map((e) => `
          <article class="ag-ev kind-${esc(e.kind)}" data-id="${e.id}">
            <div class="ag-time">${esc(timeOf(e))}</div>
            <div class="ag-main">${title(e)}<span class="ag-meta"><i></i>${esc(T("kind_" + e.kind))}${e.repeat_days ? ` · ${esc(repeatLabel(e.repeat_days))}` : ""}${flags(e)}</span></div>
            ${actions}
          </article>`).join("")}</div>
      </section>`).join("")}</div>`;
  } else {
    // jede Serie nur einmal (nächstes Vorkommen), getrennt in wiederkehrend / einmalig
    const seen = new Set<number>();
    const items = list.filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)));
    const minutes = (e: any) => { const d = new Date(e.starts_at); return d.getHours() * 60 + d.getMinutes(); };
    // täglich zuerst, dann nach erstem Wochentag (Mo → So), dann Uhrzeit
    const firstDay = (e: any) => (e.repeat_days.length === 7 ? -1 : Number(e.repeat_days[0]));
    const repeating = items.filter((e) => e.repeat_days).sort((a, b) => firstDay(a) - firstDay(b) || minutes(a) - minutes(b) || a.title.localeCompare(b.title));
    const once = items.filter((e) => !e.repeat_days).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    const pattern = (days: string) => { const t = days.length === 7 ? T("ev_daily") : days.split("").map((d) => wdName(Number(d))).join(", "); return t.charAt(0).toUpperCase() + t.slice(1); };
    const row = (e: any, when: string) => `
      <article class="ag-ev kind-${esc(e.kind)}" data-id="${e.id}">
        <div class="ag-time">${esc(when)}</div>
        <div class="ag-main">${title(e)}<span class="ag-meta"><i></i>${esc(T("kind_" + e.kind))}${flags(e)}</span></div>
        ${actions}
      </article>`;
    const section = (head: string, rows: string) => rows ? `<section class="ag-day"><h3 class="ag-head"><span></span>${esc(head)}</h3><div class="ag-items">${rows}</div></section>` : "";
    el.innerHTML = `<div class="agenda series">
      ${section(T("ev_group_repeat"), repeating.map((e) => row(e, `${pattern(e.repeat_days)} · ${timeOf(e)}`)).join(""))}
      ${section(T("ev_group_once"), once.map((e) => row(e, `${new Date(e.starts_at).toLocaleDateString(loc(), { weekday: "short", day: "numeric", month: "short" })} · ${timeOf(e)}`)).join(""))}
    </div>`;
  }

  const byId = new Map(list.map((e) => [e.id, e]));
  el.querySelectorAll<HTMLElement>(".ag-ev").forEach((row) => {
    const e = byId.get(Number(row.dataset.id));
    row.querySelector("[data-edit]")!.addEventListener("click", () => editEvent(e, reload));
    row.querySelector("[data-del]")!.addEventListener("click", async () => {
      if (!confirm(T("ev_delete_confirm"))) return;
      await api(`/events/${e.id}`, { method: "DELETE" }).catch((x) => toast(x.message));
      reload();
    });
  });
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
