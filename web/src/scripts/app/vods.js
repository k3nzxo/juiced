// VOD-Reviews: Liste, Upload in Stücken, Player mit Zeitstempel-Notizen.
// Wird vom Router im Mitgliederbereich aufgerufen: renderVods(container, me)
import { api, toast, esc as escapeHtml, icon, fmtDate as formatDate, timeAgo, closeModal, T, errMsg } from "./core";
import { enhancePicker, closePicker } from "./picker";
import { WEAPONS, SCHOOLS, buildId, buildWeapons, buildLabel, schoolColor } from "../../data/wwm";

let $app = null;
const goTo = (h) => { location.hash = h; };
const VOD_KEYS = {
  upload_btn: "vod_upload", back: "vod_back", back_list: "vod_back", search: "vod_search", edit_vod: "vod_edit",
  del_vod_confirm: "vod_del_confirm", del_note_confirm: "vod_del_note_confirm", role_hint_member: "vod_role_hint",
  role_hint_team: "vod_role_hint_team", save: "save", cancel: "cancel", edit: "edit", del: "delete",
  sub: "vod_sub", title: "vod_title", eyebrow: "app_title",
};
// Gespielter Build je Phase (Tower / Goose / Tree) -- manche wechseln mitten im Krieg, z. B. von Drums auf etwas anderes
const VOD_PHASES = ["tower", "goose", "tree"];
function vodWeaponSelect(phase, n, sel) {
  return `<select class="select vod-ph-w" data-ph="${phase}" data-n="${n}"><option value="">—</option>${SCHOOLS.map(sc =>
    `<optgroup label="${escapeHtml(sc.name)}">${WEAPONS.filter(w => w.school === sc.id).map(w =>
      `<option value="${w.id}" ${w.id === sel ? "selected" : ""}>${escapeHtml(w.name)}</option>`).join("")}</optgroup>`).join("")}</select>`;
}
// quick: Builds aus dem Profil als Schnellauswahl je Phase (ein Klick setzt beide Waffen)
function vodPhaseFields(phases, quick = []) {
  quick = [...new Set((quick || []).filter(b => buildWeapons(b).length === 2))].slice(0, 6);
  return `<div class="field"><label>${escapeHtml(T("vod_f_phases"))}</label><p class="vod-hint">${escapeHtml(T("vod_f_phases_hint"))}</p>
    <div class="vod-phases">${VOD_PHASES.map(p => {
      const ws = buildWeapons(phases?.[p]).map(w => w.id);
      // Waffen-Auswahl nur, wenn es keine Profil-Builds gibt oder der gesetzte Build keiner davon ist -- sonst hinter "+"
      const manual = !quick.length || (phases?.[p] && !quick.includes(phases[p]));
      return `<div class="vod-ph-row ${manual ? "is-manual" : ""}" data-row="${p}"><span class="vod-ph-name">${escapeHtml(T("vod_ph_" + p))}</span>
        ${quick.length ? `<div class="vod-ph-quick">${quick.map(b => `<button type="button" class="vod-ph-q" data-ph="${p}" data-b="${b}" title="${escapeHtml(buildWeapons(b).map(w => w.name).join(" + "))}">${vodBuildDots(b)}${escapeHtml(buildLabel(b))}</button>`).join("")}
          <button type="button" class="vod-ph-q vod-ph-more" data-more="${p}" title="${escapeHtml(T("vod_ph_other"))}" aria-label="${escapeHtml(T("vod_ph_other"))}">+</button></div>` : ""}
        <div class="vod-ph-manual">${vodWeaponSelect(p, 0, ws[0])}${vodWeaponSelect(p, 1, ws[1])}</div></div>`;
    }).join("")}</div></div>`;
}
function vodBuildDots(b) {
  return [...new Set(buildWeapons(b).map(w => w.school))].map(sc => `<i style="background:${schoolColor(sc)}"></i>`).join("");
}
// Schnellauswahl verdrahten + markieren, welcher Build gerade gesetzt ist
function vodBindPhases(root) {
  const mark = () => VOD_PHASES.forEach(p => {
    const [a, b] = [0, 1].map(n => root.querySelector(`.vod-ph-w[data-ph="${p}"][data-n="${n}"]`)?.value || "");
    const cur = a && b && a !== b ? buildId(a, b) : "";
    root.querySelectorAll(`.vod-ph-q[data-ph="${p}"]`).forEach(x => x.classList.toggle("active", x.dataset.b === cur));
    root.querySelector(`[data-more="${p}"]`)?.classList.toggle("active", !!cur && !root.querySelector(`.vod-ph-q[data-ph="${p}"][data-b="${cur}"]`));
  });
  root.querySelectorAll(".vod-ph-q").forEach(btn => btn.addEventListener("click", () => {
    const ws = buildWeapons(btn.dataset.b);
    [0, 1].forEach(n => { const s = root.querySelector(`.vod-ph-w[data-ph="${btn.dataset.ph}"][data-n="${n}"]`); if (s) s.value = ws[n]?.id || ""; });
    mark();
  }));
  root.querySelectorAll(".vod-ph-w").forEach(s => s.addEventListener("change", mark));
  root.querySelectorAll("[data-more]").forEach(btn => btn.addEventListener("click", () => {
    const row = root.querySelector(`[data-row="${btn.dataset.more}"]`);
    row.classList.toggle("is-manual");
    if (row.classList.contains("is-manual")) row.querySelector(".vod-ph-w")?.focus();
  }));
  mark();
}
function vodReadPhases(root) {
  const out = {};
  for (const p of VOD_PHASES) {
    const [a, b] = [0, 1].map(n => root.querySelector(`.vod-ph-w[data-ph="${p}"][data-n="${n}"]`)?.value || "");
    out[p] = a && b && a !== b ? buildId(a, b) : null;
  }
  return out;
}
function vodPhaseTags(phases) {
  const set = VOD_PHASES.filter(p => phases?.[p]);
  if (!set.length) return "";
  return `<div class="vod-phase-tags">${set.map(p => {
    const ws = buildWeapons(phases[p]);
    const dots = [...new Set(ws.map(w => w.school))].map(sc => `<i style="background:${schoolColor(sc)}"></i>`).join("");
    return `<span class="vod-phase-tag" title="${escapeHtml(ws.map(w => w.name).join(" + "))}"><b>${escapeHtml(T("vod_ph_" + p))}</b>${dots}${escapeHtml(buildLabel(phases[p]))}</span>`;
  }).join("")}</div>`;
}

function vt(key, vars) {
  const k = VOD_KEYS[key] || (key.startsWith("role_") ? key : "vod_" + key);
  return T(k, vars);
}

const VOD_CATS = ["good", "mistake", "info", "question"];
const VOD_COACH_ROLES = ["healer", "tank", "nameless", "twinblades"];
const vodState = { list: null, filter: "", uploads: {}, pollTimer: null, keyHandler: null, catFilter: "all", roleFilter: "all", reviewFilter: "all", me: null };

function vodIsCoach() { return vodState.me && (vodState.me.level === "coach" || vodState.me.level === "admin"); }
function vodUploadRoles() { return VOD_COACH_ROLES; }
function vodRoleBadge(r) { return r ? `<span class="vod-role vod-role-${escapeHtml(r)}">${escapeHtml(vt("role_" + r))}</span>` : ""; }
function vodRoleChips(id, selected) {
  return `<div class="vod-chip-row" id="${id}">${vodUploadRoles().map(r =>
    `<button type="button" class="cat-tab vod-role-chip ${selected === r ? "active" : ""}" data-role="${r}">${vt("role_" + r)}</button>`).join("")}</div>`;
}
function vodBindRoleChips(root, id, onPick) {
  root.querySelectorAll(`#${id} [data-role]`).forEach(b => b.addEventListener("click", () => {
    root.querySelectorAll(`#${id} [data-role]`).forEach(x => x.classList.toggle("active", x === b));
    onPick(b.dataset.role);
  }));
}
function vodFmtTime(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const mm = String(m).padStart(h ? 2 : 1, "0"), ss = String(s).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function vodFmtBytes(b) {
  if (!b) return "0 MB";
  if (b >= 1024 ** 4) return `${(b / 1024 ** 4).toFixed(1)} TB`;
  if (b >= 1024 ** 3) return `${(b / 1024 ** 3).toFixed(1)} GB`;
  return `${Math.round(b / 1024 ** 2)} MB`;
}

const vodPinIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M16 3a1 1 0 01.7 1.7L15 6.4v4.2l2.7 2.7a1 1 0 01-.7 1.7H13v6l-1 1-1-1v-6H7a1 1 0 01-.7-1.7L9 10.6V6.4L7.3 4.7A1 1 0 018 3z"/></svg>`;

function vodExpiryLabel(v) {
  if (v.pinned) return `<span class="vod-pinned">${vodPinIcon} ${escapeHtml(vt("unpin").replace(" ✓", ""))}</span>`;
  if (!v.expires_at) return "";
  const days = Math.ceil((new Date(v.expires_at).getTime() - Date.now()) / 86400000);
  return `<span class="vod-expiry">${days <= 0 ? vt("expires_today") : vt("expires_in", { n: days })}</span>`;
}

// Review-Status: offen (orange), läuft (blau) oder abgeschlossen (grün)
function vodReviewBadge(v, detail = false) {
  if (v.status !== "ready") return "";
  if (v.reviewed) {
    const by = detail && v.reviewed_by_name ? ` · ${escapeHtml(v.reviewed_by_name)}` : "";
    return `<span class="vod-review vod-review-done">${icon.check} ${vt("review_done")}${by}</span>`;
  }
  if (v.in_review) {
    const by = detail && v.review_started_by_name ? ` · ${escapeHtml(v.review_started_by_name)}` : "";
    return `<span class="vod-review vod-review-progress"><i class="vod-review-pulse"></i>${vt("review_progress")}${by}</span>`;
  }
  return `<span class="vod-review vod-review-open">${vt("review_open")}</span>`;
}

function vodResultBadge(r) {
  if (!r) return "";
  return `<span class="vod-result vod-result-${r}">${escapeHtml(vt("r_" + r))}</span>`;
}

function vodCleanup() {
  if (vodState.pollTimer) { clearTimeout(vodState.pollTimer); vodState.pollTimer = null; }
  if (vodState.keyHandler) { document.removeEventListener("keydown", vodState.keyHandler); vodState.keyHandler = null; }
}

// Router-Einstieg (aus route() in app.js)
let vodLastMe = null;
export async function renderVods(container = $app, me = vodLastMe) {
  $app = container;
  vodLastMe = me;
  vodCleanup();
  vodState.me = { level: me.can_manage ? "admin" : (me.coach_roles.length ? "coach" : "member"), coach_roles: me.coach_roles };
  const m = location.hash.match(/^#\/vods\/(\d+)/);
  if (m) renderVodDetail(parseInt(m[1], 10));
  else renderVodList();
}

export { vodCleanup };

window.addEventListener("hashchange", () => { if (!location.hash.startsWith("#/vods")) vodCleanup(); });
window.addEventListener("beforeunload", (e) => {
  if (Object.keys(vodState.uploads).length) { e.preventDefault(); e.returnValue = vt("leave_warn"); }
});

// ---------------------------------------------------------------- Liste

async function renderVodList() {
  $app.innerHTML = `
    <div class="vod-page">
      <div class="page-head">
        <div>
          <div class="eyebrow">${vt("eyebrow")}</div>
          <h1>${vt("title")}</h1>
          <p>${vt("sub")}</p>
        </div>
        <div class="vod-head-actions">
          <button class="btn btn-primary" id="vod-upload-btn">${icon.plus} ${vt("upload_btn")}</button></div>
      </div>
        <div class="vod-toolbar">
          <input id="vod-search" placeholder="${escapeHtml(vt("search"))}" value="${escapeHtml(vodState.filter)}" />
          <div class="vod-storage" id="vod-storage"></div>
        </div>
        <div class="vod-hint" id="vod-retention-hint" style="margin:-0.4rem 0 1rem;"></div>
        <div id="vod-upload-progress"></div>
        <div class="vod-filters">
          <div class="vod-chip-row" id="vod-role-filter">
            ${["all", ...VOD_COACH_ROLES].map(r => `<button class="cat-tab ${vodState.roleFilter === r ? "active" : ""}" data-rf="${r}">${vt("role_" + r)}</button>`).join("")}
          </div>
          <div class="vod-seg vod-review-filter" role="tablist">
            ${["all", "open", "progress", "done"].map(r => `<button type="button" class="${vodState.reviewFilter === r ? "active" : ""}" data-revf="${r}">${vt("review_f_" + r)}</button>`).join("")}
          </div>
        </div>
        <div id="vod-list"><div class="loader"><span class="spinner"></span></div></div>
    </div>`;
  $app.querySelector("#vod-upload-btn").addEventListener("click", () => openVodUploadModal());
  $app.querySelectorAll("[data-rf]").forEach(b => b.addEventListener("click", () => {
    vodState.roleFilter = b.dataset.rf;
    $app.querySelectorAll("[data-rf]").forEach(x => x.classList.toggle("active", x === b));
    drawVodList();
  }));
  $app.querySelectorAll("[data-revf]").forEach(b => b.addEventListener("click", () => {
    vodState.reviewFilter = b.dataset.revf;
    $app.querySelectorAll("[data-revf]").forEach(x => x.classList.toggle("active", x === b));
    drawVodList();
  }));
  $app.querySelector("#vod-search").addEventListener("input", (e) => { vodState.filter = e.target.value; drawVodList(); });
  renderUploadProgressPanel();
  await loadVodList();
}

async function loadVodList(quiet = false) {
  try {
    // beim automatischen Nachfragen nur die Liste, die Speicherinfo bleibt von vorher
    const [list, storage] = await Promise.all([api("/vods"), quiet && vodState.storage ? vodState.storage : api("/vods/storage")]);
    vodState.list = list;
    vodState.storage = storage;
  } catch (err) {
    const el = document.getElementById("vod-list");
    if (el) el.innerHTML = `<div class="empty-state"><div class="display">${escapeHtml(err.message)}</div></div>`;
    return;
  }
  drawVodList();
  // Solange etwas verarbeitet wird, regelmäßig neu laden
  if (vodState.list.some(v => v.status === "processing" || (v.status === "uploading" && !v.is_mine)) && location.hash.startsWith("#/vods") && !/^#\/vods\/\d+/.test(location.hash)) {
    // eigenes VOD in Verarbeitung: schnell aktualisieren; nur fremde Uploads anzeigen: gemütlich
    const mineBusy = vodState.list.some(v => v.status === "processing" && v.is_mine);
    vodState.pollTimer = setTimeout(() => loadVodList(true), mineBusy ? 5000 : 15000);
  }
}

function drawVodList() {
  const el = document.getElementById("vod-list");
  if (!el || !vodState.list) return;
  const st = vodState.storage;
  const stEl = document.getElementById("vod-storage");
  if (stEl && st) {
    const pct = Math.min(100, Math.round(st.used_bytes / st.limit_bytes * 100));
    stEl.innerHTML = `<div class="vod-storage-bar"><span style="width:${pct}%"></span></div>
      <span>${vt("storage", { used: vodFmtBytes(st.used_bytes), limit: vodFmtBytes(st.limit_bytes) })}</span>`;
    const hint = document.getElementById("vod-retention-hint");
    if (hint) hint.innerHTML = st.storage_ok === false
      ? `<span style="color:var(--danger);">${vt("storage_down")}</span>`
      : (st.retention_days > 0 ? escapeHtml(vt("retention_hint", { n: st.retention_days, m: st.max_per_user })) : "");
  }
  const q = vodState.filter.trim().toLowerCase();
  const items = vodState.list.filter(v => (vodState.roleFilter === "all" || v.role === vodState.roleFilter)
    && (vodState.reviewFilter === "all" || (v.status === "ready" && (vodState.reviewFilter === "done" ? !!v.reviewed
        : vodState.reviewFilter === "progress" ? !!v.in_review : !v.reviewed && !v.in_review)))
    && (!q || [v.title, v.opponent, v.uploader_name, v.description].some(x => (x || "").toLowerCase().includes(q))));
  if (!items.length) {
    el.innerHTML = `<div class="empty-state"><div class="display">${vt("empty")}</div><p>${vt("empty_hint")}</p></div>`;
    return;
  }
  el.innerHTML = `<div class="vod-grid">${items.map(v => `
    <div class="vod-card" data-vod-id="${v.id}" data-status="${v.status}">
      <div class="vod-thumb">
        ${v.thumb_url ? `<img src="${escapeHtml(v.thumb_url)}" loading="lazy" alt="">` : `<div class="vod-thumb-empty">${icon.play}</div>`}
        ${v.duration_sec ? `<span class="vod-duration">${vodFmtTime(v.duration_sec)}</span>` : ""}
        ${v.status !== "ready" ? `<span class="vod-status vod-status-${v.status}">${vt("st_" + v.status)}</span>` : vodReviewBadge(v)}
      </div>
      <div class="vod-card-body">
        <div class="vod-card-title">${escapeHtml(v.title)}</div>
        <div class="vod-card-meta">
          ${vodRoleBadge(v.role)}
          ${vodResultBadge(v.result)}
          ${v.opponent ? `<span>vs. ${escapeHtml(v.opponent)}</span>` : ""}
          ${v.match_date ? `<span>${escapeHtml(formatDate(v.match_date))}</span>` : ""}
        </div>
        <div class="vod-card-foot">
          <span>${v.uploader_name ? escapeHtml(vt("by", { name: v.uploader_name })) : ""}</span>
          <span class="vod-foot-right">${vodExpiryLabel(v)}<span>${vt("notes_n", { n: v.note_count })}</span></span>
        </div>
        ${v.status === "uploading" && !v.is_mine ? `<div class="vod-up-other"><div class="vod-up-bar"><i style="width:${v.size_bytes ? Math.min(100, Math.round(v.received_bytes / v.size_bytes * 100)) : 0}%"></i></div>
          <span>${escapeHtml(vt("uploading_by", { name: v.uploader_name || "?", pct: v.size_bytes ? Math.min(100, Math.round(v.received_bytes / v.size_bytes * 100)) : 0 }))}</span></div>` : ""}
        ${v.status === "uploading" && v.is_mine && !vodState.uploads[v.id] ? `<div class="vod-resume-row">
          <button class="btn btn-sm btn-outline" data-resume-id="${v.id}">${icon.refresh} ${vt("resume")}</button>
          <button class="btn btn-sm btn-ghost" data-discard-id="${v.id}">${icon.x} ${vt("cancel")}</button></div>` : ""}
      </div>
    </div>`).join("")}</div>`;
  el.querySelectorAll(".vod-card").forEach(card => {
    card.addEventListener("click", (e) => {
      if (e.target.closest("[data-resume-id],[data-discard-id]")) return;
      if (card.dataset.status === "uploading") return;
      goTo(`#/vods/${card.dataset.vodId}`);
    });
  });
  el.querySelectorAll("[data-resume-id]").forEach(btn => {
    btn.addEventListener("click", () => resumeVodUpload(vodState.list.find(v => v.id === parseInt(btn.dataset.resumeId, 10))));
  });
  el.querySelectorAll("[data-discard-id]").forEach(btn => {
    btn.addEventListener("click", () => cancelVodUpload(parseInt(btn.dataset.discardId, 10)));
  });
}

// ---------------------------------------------------------------- Upload

const VOD_ACCEPT = "video/*,.mkv,.flv,.ts";
const VOD_PARALLEL = 4;  // gleichzeitige Stücke (4 lässt der Leitung Luft für den Rest der Seite)

function vodDropzone(id) {
  return `<label class="vod-drop" id="${id}">
    <input type="file" accept="${VOD_ACCEPT}" hidden />
    <span class="vod-drop-ico">${icon.video}</span>
    <span class="vod-drop-empty"><strong>${vt("drop_t")}</strong><span>${vt("drop_b")}</span></span>
    <span class="vod-drop-file" hidden><strong data-name></strong><span><span data-size></span> · <u>${vt("drop_change")}</u></span></span>
  </label>`;
}

function vodBindDropzone(root, id, onFile) {
  const zone = root.querySelector(`#${id}`);
  const input = zone.querySelector("input");
  const show = (f) => {
    zone.classList.add("has-file");
    zone.querySelector(".vod-drop-empty").hidden = true;
    zone.querySelector(".vod-drop-file").hidden = false;
    zone.querySelector("[data-name]").textContent = f.name;
    zone.querySelector("[data-size]").textContent = vodFmtBytes(f.size);
    onFile(f);
  };
  input.addEventListener("change", () => { if (input.files[0]) show(input.files[0]); });
  ["dragenter", "dragover"].forEach(ev => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add("over"); }));
  ["dragleave", "dragend"].forEach(ev => zone.addEventListener(ev, () => zone.classList.remove("over")));
  zone.addEventListener("drop", (e) => {
    e.preventDefault();
    zone.classList.remove("over");
    const f = e.dataTransfer && e.dataTransfer.files[0];
    if (f) show(f);
  });
}

function openVodUploadModal() {
  const maxBytes = vodState.storage ? vodState.storage.max_file_bytes : 0;
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <div class="modal modal-md">
      <div class="modal-head"><h3>${vt("upload_btn")}</h3><button class="close-x">${icon.x}</button></div>
      <div class="modal-body">
        <div class="field">
          ${vodDropzone("vod-f-drop")}
          <p class="vod-hint">${vt("f_file_hint", { max: vodFmtBytes(maxBytes) })}</p>
        </div>
        <div class="field"><label>${vt("f_role")}</label>${vodRoleChips("vod-f-role", null)}</div>
        <div class="field"><label>${vt("f_title")}</label><input class="input" id="vod-f-title" maxlength="200" /></div>
        <div class="vod-form-row">
          <div class="field"><label>${vt("f_opponent")}</label><input class="input" id="vod-f-opponent" maxlength="120" /></div>
          <div class="field"><label>${vt("f_date")}</label><input id="vod-f-date" value="${today}" /></div>
        </div>
        <div class="field"><label>${vt("f_result")}</label>
          <div class="vod-chip-row" id="vod-f-result">
            ${["", "win", "loss"].map(r => `<button type="button" class="cat-tab ${r === "" ? "active" : ""}" data-r="${r}">${vt(r ? "r_" + r : "r_none")}</button>`).join("")}
          </div>
        </div>
        ${vodPhaseFields(vodLastMe?.main_build ? Object.fromEntries(VOD_PHASES.map(p => [p, vodLastMe.main_build])) : null, [vodLastMe?.main_build, ...(vodLastMe?.alt_builds || [])])}
        <div class="field"><label>${vt("f_desc")}</label><textarea class="textarea" id="vod-f-desc" rows="3" maxlength="5000"></textarea></div>
      </div>
      <div class="modal-foot">
        <button class="btn btn-primary" id="vod-f-submit">${vt("start_upload")}</button>
      </div>
    </div>`;
  document.body.appendChild(backdrop);
  const close = () => { closePicker(); closeModal(backdrop); };
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
  backdrop.querySelector(".close-x").addEventListener("click", close);
  enhancePicker(backdrop.querySelector("#vod-f-date"), "date", { clearable: true });

  let result = "";
  let role = null;
  let file = null;
  vodBindRoleChips(backdrop, "vod-f-role", r => { role = r; });
  vodBindPhases(backdrop);
  backdrop.querySelectorAll("#vod-f-result [data-r]").forEach(b => b.addEventListener("click", () => {
    result = b.dataset.r;
    backdrop.querySelectorAll("#vod-f-result [data-r]").forEach(x => x.classList.toggle("active", x === b));
  }));
  const titleIn = backdrop.querySelector("#vod-f-title");
  vodBindDropzone(backdrop, "vod-f-drop", (f) => {
    file = f;
    if (!titleIn.value.trim()) titleIn.value = f.name.replace(/\.[^.]+$/, "").replace(/[_]+/g, " ").slice(0, 200);
  });

  backdrop.querySelector("#vod-f-submit").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    const title = titleIn.value.trim();
    if (!file || !title) { toast(vt("missing_fields")); return; }
    if (!role) { toast(vt("missing_role")); return; }
    btn.disabled = true;
    try {
      const vod = await api("/vods", {
        method: "POST",
        body: JSON.stringify({
          title, role, filename: file.name, size_bytes: file.size,
          opponent: backdrop.querySelector("#vod-f-opponent").value.trim() || null,
          match_date: backdrop.querySelector("#vod-f-date").value || null,
          result: result || null,
          description: backdrop.querySelector("#vod-f-desc").value.trim() || null,
          phases: vodReadPhases(backdrop),
        }),
      });
      close();
      startVodUpload(vod, file, []);
    } catch (err) {
      toast(err.message);
      btn.disabled = false;
    }
  });
}

function resumeVodUpload(vod) {
  if (!vod) return;
  toast(vt("resume_pick", { name: vod.original_filename || "" }));
  const input = document.createElement("input");
  input.type = "file";
  input.accept = VOD_ACCEPT;
  input.addEventListener("change", async () => {
    const f = input.files[0];
    if (!f) return;
    if (f.size !== vod.size_bytes) { toast(vt("resume_wrong")); return; }
    try {
      const fresh = await api(`/vods/${vod.id}`);
      startVodUpload(fresh, f, fresh.chunks_done || []);
    } catch (err) { toast(err.message); }
  });
  input.click();
}

function vodPutChunk(up, index, blob) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    up.xhrs.add(xhr);
    const finish = () => { up.xhrs.delete(xhr); delete up.inflight[index]; };
    xhr.open("PUT", `/api/vods/${up.id}/chunk?index=${index}`);
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.upload.onprogress = (e) => { up.inflight[index] = e.loaded; renderUploadProgressPanel(); };
    xhr.onload = () => {
      finish();
      let data = null;
      try { data = JSON.parse(xhr.responseText); } catch (e) {}
      if (xhr.status >= 200 && xhr.status < 300) return resolve(data);
      const err = new Error(data ? errMsg(data) : `HTTP ${xhr.status}`);
      err.status = xhr.status;
      reject(err);
    };
    xhr.onerror = () => { finish(); const err = new Error(T("error")); err.status = 0; reject(err); };
    xhr.onabort = () => { finish(); const err = new Error("aborted"); err.status = -1; reject(err); };
    xhr.send(blob);
  });
}

// Kurze Ausfälle (Deploy, WLAN weg, Storage Box kurz weg) überbrücken: warten und erneut versuchen.
// Endgültig sind nur Fehler, bei denen ein neuer Versuch nichts bringt (kein Recht, abgebrochen, schon fertig ...).
const VOD_FATAL = [400, 401, 403, 404, 409, 410, 413];
const VOD_MAX_TRIES = 20;  // mit wachsender Pause bis 30 s -> zusammen rund 8 Minuten
const vodWaitOnline = () => (navigator.onLine === false
  ? new Promise(r => window.addEventListener("online", r, { once: true })) : Promise.resolve());
async function vodRetryPause(up, tries) {
  up.retrying = true;
  up.retryAt = Date.now() + Math.min(30000, 1000 * 2 ** Math.min(tries, 5));
  renderUploadProgressPanel();
  // Countdown nur für die Anzeige; gewartet wird mit EINEM Timer (Hintergrund-Tabs bremsen viele kurze Timer stark aus)
  const tick = setInterval(renderUploadProgressPanel, 1000);
  try {
    await vodWaitOnline();
    const wait = up.retryAt - Date.now();
    if (wait > 0 && !up.stopped) await new Promise(r => setTimeout(r, wait));
  } finally {
    clearInterval(tick);
  }
}

async function startVodUpload(vod, file, doneList) {
  const chunk = vod.chunk_size || 16 * 1024 * 1024;
  const total = Math.max(1, Math.ceil(file.size / chunk));
  const sizeOf = (i) => Math.min(chunk, file.size - i * chunk);
  const done = new Set(doneList || []);
  const queue = [];
  for (let i = 0; i < total; i++) if (!done.has(i)) queue.push(i);
  const doneBytes = [...done].reduce((a, i) => a + (i < total ? sizeOf(i) : 0), 0);
  const up = { id: vod.id, title: vod.title, size: file.size, done: doneBytes, inflight: {}, xhrs: new Set(),
               started: Date.now(), startedBytes: doneBytes, stopped: false };
  vodState.uploads[vod.id] = up;
  renderUploadProgressPanel();
  if (vodOnList()) loadVodList();

  const worker = async () => {
    while (queue.length && !up.stopped) {
      const i = queue.shift();
      for (let tries = 0; ; ) {
        try {
          await vodPutChunk(up, i, file.slice(i * chunk, i * chunk + sizeOf(i)));
          up.done += sizeOf(i);
          up.retrying = false;
          renderUploadProgressPanel();
          break;
        } catch (err) {
          if (up.stopped || err.status === -1) return;
          if (VOD_FATAL.includes(err.status) || ++tries > VOD_MAX_TRIES) throw err;
          await vodRetryPause(up, tries);
        }
      }
    }
  };

  try {
    await Promise.all(Array.from({ length: Math.min(VOD_PARALLEL, Math.max(1, queue.length)) }, worker));
    if (up.stopped) return;
    // Abschluss ebenfalls wiederholen (z. B. wenn genau dann die API neu startet)
    for (let tries = 0; ; ) {
      try { await api(`/vods/${vod.id}/complete`, { method: "POST" }); break; }
      catch (err) {
        if (up.stopped) return;
        if (VOD_FATAL.includes(err.status) || ++tries > VOD_MAX_TRIES) throw err;
        await vodRetryPause(up, tries);
      }
    }
    up.retrying = false;
    delete vodState.uploads[vod.id];
    toast(vt("upload_done"));
  } catch (err) {
    if (up.stopped) return;
    up.stopped = true;
    up.xhrs.forEach(x => x.abort());
    delete vodState.uploads[vod.id];
    toast(`${vt("upload_failed")} (${err.message})`);
  }
  renderUploadProgressPanel();
  if (vodOnList()) { vodCleanup(); loadVodList(); }
}

async function cancelVodUpload(id) {
  if (!confirm(vt("cancel_confirm"))) return;
  const up = vodState.uploads[id];
  if (up) {
    up.stopped = true;
    up.xhrs.forEach(x => x.abort());
    delete vodState.uploads[id];
    renderUploadProgressPanel();
  }
  try {
    await api(`/vods/${id}`, { method: "DELETE" });
    toast(vt("cancelled"));
  } catch (err) { toast(err.message); }
  if (vodOnList()) { vodCleanup(); loadVodList(); }
}

const vodOnList = () => location.hash.startsWith("#/vods") && !/^#\/vods\/\d+/.test(location.hash);

// Fortschritt: Zeilen werden EINMAL gebaut und danach nur noch aktualisiert (max. 1x pro Bild),
// Tempo ist ein gleitender Wert über die letzten Sekunden statt Durchschnitt seit Start.
let vodPanelFrame = 0;
function renderUploadProgressPanel() {
  if (vodPanelFrame) return;
  vodPanelFrame = requestAnimationFrame(() => { vodPanelFrame = 0; drawUploadPanel(); });
}

function drawUploadPanel() {
  const el = document.getElementById("vod-upload-progress");
  if (!el) return;
  const ups = Object.values(vodState.uploads);
  // Zeilen für beendete Uploads entfernen
  el.querySelectorAll("[data-up-row]").forEach(r => { if (!vodState.uploads[r.dataset.upRow]) r.remove(); });
  const now = performance.now();
  for (const u of ups) {
    let row = el.querySelector(`[data-up-row="${u.id}"]`);
    if (!row) {
      row = document.createElement("div");
      row.className = "vod-upload-row";
      row.dataset.upRow = String(u.id);
      row.innerHTML = `
        <div class="vod-upload-head">
          <strong>${escapeHtml(u.title)}</strong>
          <span class="vod-upload-pct" data-pct>0%</span>
          <button class="btn btn-sm btn-ghost vod-upload-cancel" type="button">${icon.x} ${vt("cancel")}</button>
        </div>
        <div class="vod-progress"><span data-bar></span></div>
        <div class="vod-upload-foot"><span data-stats></span><span class="vod-hint">${vt("keep_open")}</span></div>`;
      row.querySelector(".vod-upload-cancel").addEventListener("click", () => cancelVodUpload(u.id));
      el.appendChild(row);
    }
    const cur = Math.min(u.size, u.done + Object.values(u.inflight).reduce((a, b) => a + b, 0));
    // gleitendes Tempo: alle ~500 ms messen, weich mitteln
    u.samples = u.samples || { t: now, b: cur, speed: 0 };
    const dt = (now - u.samples.t) / 1000;
    if (dt >= 0.5) {
      const inst = Math.max(0, (cur - u.samples.b) / dt);
      u.samples.speed = u.samples.speed ? u.samples.speed * 0.7 + inst * 0.3 : inst;
      u.samples.t = now; u.samples.b = cur;
    }
    const speed = u.samples.speed;
    const pct = Math.min(100, cur / u.size * 100);
    const eta = speed > 0 ? (u.size - cur) / speed : 0;
    row.querySelector("[data-bar]").style.transform = `scaleX(${(pct / 100).toFixed(4)})`;
    row.querySelector("[data-pct]").textContent = `${Math.floor(pct)}%`;
    row.classList.toggle("is-retrying", !!u.retrying);
    row.querySelector("[data-stats]").textContent = u.retrying
      ? `${vodFmtBytes(cur)} / ${vodFmtBytes(u.size)} · ` + (navigator.onLine === false ? vt("retry_offline")
        : vt("retry_in", { n: Math.max(0, Math.ceil(((u.retryAt || 0) - Date.now()) / 1000)) }))
      : `${vodFmtBytes(cur)} / ${vodFmtBytes(u.size)}` + (speed > 0 ? ` · ${(speed / 1024 / 1024).toFixed(1)} MB/s · ~${vodFmtTime(eta)}` : "");
  }
}

// ---------------------------------------------------------------- Detail / Review

async function renderVodDetail(vodId) {
  $app.innerHTML = `
    <div id="vodmain" class="vod-main"><div class="loader"><span class="spinner"></span></div></div>`;

  let vod;
  try { vod = await api(`/vods/${vodId}`); }
  catch (err) { $app.querySelector("#vodmain").innerHTML = `<div class="empty-state"><div class="display">${escapeHtml(err.message)}</div></div>`; return; }
  if (!location.hash.startsWith(`#/vods/${vodId}`)) return;  // inzwischen weggeklickt

  const main = $app.querySelector("#vodmain");
  if (vod.status !== "ready") {
    main.innerHTML = `
      <div class="page-head"><div><h1>${escapeHtml(vod.title)}</h1>
      <p>${vod.status === "failed" ? `${vt("failed_hint")} ${escapeHtml(vod.error || "")}` : vt("processing_hint")}</p></div>
      ${vod.can_edit ? `<button class="btn btn-danger" id="vod-del-btn">${icon.trash} ${vt("del")}</button>` : ""}</div>
      ${vod.status === "processing" ? `<div class="loader"><span class="spinner"></span></div>` : ""}`;
    const del = main.querySelector("#vod-del-btn");
    if (del) del.addEventListener("click", () => deleteVod(vod));
    if (vod.status === "processing") vodState.pollTimer = setTimeout(() => { if (location.hash.startsWith(`#/vods/${vodId}`)) renderVodDetail(vodId); }, 5000);
    return;
  }

  main.innerHTML = `
    <div class="vod-head">
      <div>
        <div class="eyebrow">${vt("eyebrow")}</div>
        <h1>${escapeHtml(vod.title)}</h1>
        <div class="vod-card-meta">
          ${vodRoleBadge(vod.role)}
          ${vodResultBadge(vod.result)}
          ${vod.opponent ? `<span>vs. ${escapeHtml(vod.opponent)}</span>` : ""}
          ${vod.match_date ? `<span>${escapeHtml(formatDate(vod.match_date))}</span>` : ""}
          ${vod.uploader_name ? `<span>${escapeHtml(vt("by", { name: vod.uploader_name }))}</span>` : ""}
          ${vod.pinned ? "" : vodExpiryLabel(vod)}
          ${vodReviewBadge(vod, true)}
        </div>
        ${vodPhaseTags(vod.phases)}
      </div>
      <div class="vod-head-actions">
        ${vod.can_review && !vod.reviewed ? `<button class="btn btn-sm btn-ghost" id="vod-reviewing-btn">${vod.in_review ? `${icon.x} ${vt("review_stop")}` : `${icon.video} ${vt("review_start")}`}</button>` : ""}
        ${vod.can_review ? `<button class="btn btn-sm ${vod.reviewed ? "btn-ghost" : "btn-primary"}" id="vod-review-btn">${vod.reviewed ? `${icon.refresh} ${vt("review_reopen")}` : `${icon.check} ${vt("review_mark")}`}</button>` : ""}
        <a class="btn btn-sm btn-ghost" href="#/vods">${icon.arrowLeft} ${vt("back")}</a>
        ${vod.can_edit ? `<button class="btn btn-sm btn-ghost ${vod.pinned ? "vod-pin-active" : ""}" id="vod-pin-btn">${vodPinIcon} ${vt(vod.pinned ? "unpin" : "pin")}</button>` : ""}
        <button class="btn btn-sm btn-ghost" id="vod-copy-link" title="${escapeHtml(vt("copy_link"))}">${icon.copy}</button>
        ${vod.can_edit ? `
          <button class="btn btn-sm btn-ghost" id="vod-edit-btn">${icon.edit} ${vt("edit")}</button>
          <button class="btn btn-sm btn-danger" id="vod-del-btn">${icon.trash}</button>` : ""}
      </div>
    </div>
    ${vod.description ? `<p class="vod-desc">${escapeHtml(vod.description)}</p>` : ""}
    ${vod.error ? `<p class="vod-hint">${escapeHtml(vod.error)}</p>` : ""}
    <div class="vod-layout">
      <div class="vod-player-col">
        <div class="vod-player-wrap">
          <video id="vod-video" src="${escapeHtml(vod.video_url)}" controls preload="metadata" playsinline
            ${vod.thumb_url ? `poster="${escapeHtml(vod.thumb_url)}"` : ""}></video>
        </div>
        <div class="vod-timeline" id="vod-timeline"><div class="vod-timeline-pos" id="vod-timeline-pos"></div></div>
        <div class="vod-controls">
          <div class="vod-seg">
            <button type="button" data-seek="-10">−10s</button>
            <button type="button" data-seek="-5">−5s</button>
            <button type="button" data-seek="5">+5s</button>
            <button type="button" data-seek="10">+10s</button>
          </div>
          <div class="vod-seg vod-rates" title="${escapeHtml(vt("speed"))}">
            ${[0.25, 0.5, 1, 1.5, 2].map(r => `<button type="button" class="${r === 1 ? "active" : ""}" data-rate="${r}">${r}×</button>`).join("")}
          </div>
          <span class="vod-keys">${escapeHtml(vt("hotkeys"))}</span>
        </div>
      </div>
      <aside class="vod-notes-col">
        <div class="vod-composer">
          <div class="vod-composer-head">
            <button class="vod-ts-pill" id="vod-composer-ts" title="${escapeHtml(vt("add_note_at", { t: "" }))}">0:00</button>
            <div class="vod-chip-row" id="vod-composer-cats">
              ${VOD_CATS.map(c => `<button type="button" class="vod-cat vod-cat-${c} ${c === "info" ? "active" : ""}" data-cat="${c}">${vt("c_" + c)}</button>`).join("")}
            </div>
          </div>
          <textarea id="vod-composer-text" rows="2" placeholder="${escapeHtml(vt("note_ph"))}"></textarea>
          <div class="vod-composer-foot"><button class="btn btn-sm btn-primary" id="vod-composer-save">${vt("save")}</button></div>
        </div>
        <div class="vod-chip-row vod-note-filter" id="vod-note-filter">
          ${["all", ...VOD_CATS].map(c => `<button class="cat-tab ${vodState.catFilter === c ? "active" : ""}" data-filter="${c}">${vt("c_" + c)}</button>`).join("")}
        </div>
        <div class="vod-notes" id="vod-notes"></div>
      </aside>
    </div>`;

  const video = main.querySelector("#vod-video");
  const notesEl = main.querySelector("#vod-notes");
  const tsPill = main.querySelector("#vod-composer-ts");
  const textEl = main.querySelector("#vod-composer-text");
  let composerT = 0;
  let composerCat = "info";
  let notes = vod.notes || [];
  let editingId = null;
  let replyingTo = null;
  let lastActiveId = null;

  const setComposerTime = (sec) => { composerT = sec; tsPill.textContent = vodFmtTime(sec); };
  const seek = (sec) => { video.currentTime = Math.max(0, Math.min(sec, video.duration || sec)); };

  // ?t=123 aus der URL
  const tParam = new URLSearchParams(location.hash.split("?")[1] || "").get("t");
  if (tParam) video.addEventListener("loadedmetadata", () => seek(parseFloat(tParam)), { once: true });

  main.querySelectorAll("[data-seek]").forEach(b => b.addEventListener("click", () => seek(video.currentTime + parseFloat(b.dataset.seek))));
  main.querySelectorAll("[data-rate]").forEach(b => b.addEventListener("click", () => {
    video.playbackRate = parseFloat(b.dataset.rate);
    main.querySelectorAll("[data-rate]").forEach(x => x.classList.toggle("active", x === b));
  }));
  video.addEventListener("ratechange", () => main.querySelectorAll("[data-rate]").forEach(x => x.classList.toggle("active", parseFloat(x.dataset.rate) === video.playbackRate)));
  main.querySelectorAll("#vod-composer-cats [data-cat]").forEach(b => b.addEventListener("click", () => {
    composerCat = b.dataset.cat;
    main.querySelectorAll("#vod-composer-cats [data-cat]").forEach(x => x.classList.toggle("active", x === b));
  }));
  main.querySelectorAll("#vod-note-filter [data-filter]").forEach(b => b.addEventListener("click", () => {
    vodState.catFilter = b.dataset.filter;
    main.querySelectorAll("#vod-note-filter [data-filter]").forEach(x => x.classList.toggle("active", x === b));
    drawNotes(); drawMarkers();
  }));
  tsPill.addEventListener("click", () => setComposerTime(video.currentTime));
  textEl.addEventListener("focus", () => { if (!textEl.value.trim()) { setComposerTime(video.currentTime); video.pause(); } });
  textEl.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) saveComposer(); });
  main.querySelector("#vod-composer-save").addEventListener("click", saveComposer);

  main.querySelector("#vod-copy-link").addEventListener("click", async () => {
    const url = `${location.origin}/#/vods/${vod.id}?t=${Math.floor(video.currentTime)}`;
    try { await navigator.clipboard.writeText(url); toast(vt("copied")); } catch (e) { prompt("", url); }
  });
  const reviewBtn = main.querySelector("#vod-review-btn");
  if (reviewBtn) reviewBtn.addEventListener("click", async () => {
    reviewBtn.disabled = true;
    try {
      const r = await api(`/vods/${vod.id}/reviewed`, { method: "PUT", body: JSON.stringify({ reviewed: !vod.reviewed }) });
      toast(vt(r.reviewed ? "review_done_toast" : "review_open_toast"));
      renderVods();
    } catch (err) { toast(err.message); reviewBtn.disabled = false; }
  });
  const reviewingBtn = main.querySelector("#vod-reviewing-btn");
  if (reviewingBtn) reviewingBtn.addEventListener("click", async () => {
    reviewingBtn.disabled = true;
    try {
      const r = await api(`/vods/${vod.id}/reviewing`, { method: "PUT", body: JSON.stringify({ reviewing: !vod.in_review }) });
      toast(vt(r.in_review ? "review_started_toast" : "review_open_toast"));
      renderVods();
    } catch (err) { toast(err.message); reviewingBtn.disabled = false; }
  });
  const pinBtn = main.querySelector("#vod-pin-btn");
  if (pinBtn) pinBtn.addEventListener("click", async () => {
    try {
      const r = await api(`/vods/${vod.id}/pin`, { method: "PUT", body: JSON.stringify({ pinned: !vod.pinned }) });
      toast(vt(r.pinned ? "pinned_toast" : "unpinned_toast"));
      renderVods();
    } catch (err) { toast(err.message); }
  });
  const editBtn = main.querySelector("#vod-edit-btn");
  if (editBtn) editBtn.addEventListener("click", () => openVodEditModal(vod));
  const delBtn = main.querySelector("#vod-del-btn");
  if (delBtn) delBtn.addEventListener("click", () => deleteVod(vod));

  async function saveComposer() {
    const text = textEl.value.trim();
    if (!text) return;
    try {
      const n = await api(`/vods/${vod.id}/notes`, { method: "POST", body: JSON.stringify({ t_sec: composerT, category: composerCat, text }) });
      notes.push(n);
      textEl.value = "";
      textEl.blur();
      drawNotes(); drawMarkers();
      const el = notesEl.querySelector(`[data-note-id="${n.id}"]`);
      if (el) el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    } catch (err) { toast(err.message); }
  }

  function visibleRoots() {
    return notes.filter(n => !n.parent_id && (vodState.catFilter === "all" || n.category === vodState.catFilter))
      .sort((a, b) => a.t_sec - b.t_sec || a.id - b.id);
  }

  function noteHtml(n, isReply) {
    const editing = editingId === n.id;
    return `
      <div class="vod-note ${isReply ? "vod-note-reply" : `vod-note-${n.category}`}" data-note-id="${n.id}">
        <div class="vod-note-head">
          ${isReply ? "" : `<button class="vod-ts-pill" data-jump="${n.t_sec}">${vodFmtTime(n.t_sec)}</button>
          <span class="vod-cat vod-cat-${n.category} active small">${vt("c_" + n.category)}</span>`}
          <span class="vod-note-author">${escapeHtml(n.user_name || "?")}</span>
          <span class="vod-note-time">${escapeHtml(timeAgo(n.created_at))}${n.edited ? " · ✎" : ""}</span>
        </div>
        ${editing ? `
          <textarea class="vod-edit-text" rows="3">${escapeHtml(n.text)}</textarea>
          <div class="vod-note-actions"><button class="btn btn-sm btn-primary" data-act="save-edit">${vt("save")}</button>
          <button class="btn btn-sm btn-ghost" data-act="cancel-edit">${vt("cancel")}</button></div>`
        : `<div class="vod-note-text">${escapeHtml(n.text)}</div>
          <div class="vod-note-actions">
            ${isReply ? "" : `<button class="vod-link-btn" data-act="reply">${vt("reply")}</button>`}
            ${n.can_edit ? `<button class="vod-link-btn" data-act="edit">${vt("edit")}</button>
              <button class="vod-link-btn danger" data-act="delete">${vt("del")}</button>` : ""}
          </div>`}
      </div>`;
  }

  function drawNotes() {
    const roots = visibleRoots();
    if (!roots.length) { notesEl.innerHTML = `<p class="vod-hint" style="padding:1rem 0;">${vt("no_notes")}</p>`; return; }
    notesEl.innerHTML = roots.map(r => {
      const replies = notes.filter(n => n.parent_id === r.id).sort((a, b) => a.id - b.id);
      return `<div class="vod-thread">
        ${noteHtml(r, false)}
        ${replies.map(x => noteHtml(x, true)).join("")}
        ${replyingTo === r.id ? `<div class="vod-reply-box"><textarea class="vod-reply-text" rows="2" placeholder="${escapeHtml(vt("reply_ph"))}"></textarea>
          <div class="vod-note-actions"><button class="btn btn-sm btn-primary" data-act="send-reply" data-parent="${r.id}">${vt("reply")}</button>
          <button class="btn btn-sm btn-ghost" data-act="cancel-reply">${vt("cancel")}</button></div></div>` : ""}
      </div>`;
    }).join("");
    const rb = notesEl.querySelector(".vod-reply-text");
    if (rb) rb.focus();
    const eb = notesEl.querySelector(".vod-edit-text");
    if (eb) eb.focus();
    lastActiveId = null;
    highlightActive();
  }

  notesEl.addEventListener("click", async (e) => {
    const jump = e.target.closest("[data-jump]");
    if (jump) { seek(parseFloat(jump.dataset.jump)); video.play().catch(() => {}); return; }
    const btn = e.target.closest("[data-act]");
    if (!btn) return;
    const noteEl = btn.closest("[data-note-id]");
    const id = noteEl ? parseInt(noteEl.dataset.noteId, 10) : null;
    const act = btn.dataset.act;
    try {
      if (act === "reply") { replyingTo = id; editingId = null; drawNotes(); }
      else if (act === "cancel-reply") { replyingTo = null; drawNotes(); }
      else if (act === "send-reply") {
        const text = notesEl.querySelector(".vod-reply-text").value.trim();
        if (!text) return;
        const n = await api(`/vods/${vod.id}/notes`, { method: "POST", body: JSON.stringify({ parent_id: parseInt(btn.dataset.parent, 10), text }) });
        notes.push(n); replyingTo = null; drawNotes();
      }
      else if (act === "edit") { editingId = id; replyingTo = null; drawNotes(); }
      else if (act === "cancel-edit") { editingId = null; drawNotes(); }
      else if (act === "save-edit") {
        const text = noteEl.querySelector(".vod-edit-text").value.trim();
        if (!text) return;
        const n = await api(`/vods/${vod.id}/notes/${id}`, { method: "PUT", body: JSON.stringify({ text }) });
        notes = notes.map(x => x.id === id ? n : x); editingId = null; drawNotes();
      }
      else if (act === "delete") {
        if (!confirm(vt("del_note_confirm"))) return;
        await api(`/vods/${vod.id}/notes/${id}`, { method: "DELETE" });
        notes = notes.filter(x => x.id !== id && x.parent_id !== id);
        drawNotes(); drawMarkers();
      }
    } catch (err) { toast(err.message); }
  });

  const timeline = main.querySelector("#vod-timeline");
  const posEl = main.querySelector("#vod-timeline-pos");
  function drawMarkers() {
    timeline.querySelectorAll(".vod-marker").forEach(m => m.remove());
    const dur = video.duration || vod.duration_sec;
    if (!dur) return;
    visibleRoots().forEach(n => {
      const m = document.createElement("button");
      m.className = `vod-marker vod-marker-${n.category}`;
      m.style.left = `${Math.min(100, n.t_sec / dur * 100)}%`;
      m.title = `${vodFmtTime(n.t_sec)} — ${n.text.slice(0, 80)}`;
      m.addEventListener("click", (e) => {
        e.stopPropagation();
        seek(n.t_sec);
        const el = notesEl.querySelector(`[data-note-id="${n.id}"]`);
        if (el) el.scrollIntoView({ block: "nearest", behavior: "smooth" });
      });
      timeline.appendChild(m);
    });
  }
  timeline.addEventListener("click", (e) => {
    const dur = video.duration || vod.duration_sec;
    if (!dur) return;
    const r = timeline.getBoundingClientRect();
    seek((e.clientX - r.left) / r.width * dur);
  });

  function highlightActive() {
    const t = video.currentTime;
    const dur = video.duration || vod.duration_sec;
    if (dur) posEl.style.left = `${Math.min(100, t / dur * 100)}%`;
    // Aktive Notiz = letzte Notiz, deren Zeitstempel in den letzten 8s liegt
    let active = null;
    for (const n of visibleRoots()) { if (n.t_sec <= t + 0.3 && t - n.t_sec < 8) active = n; }
    const id = active ? active.id : null;
    if (id === lastActiveId) return;
    lastActiveId = id;
    notesEl.querySelectorAll(".vod-note.active").forEach(x => x.classList.remove("active"));
    if (id) {
      const el = notesEl.querySelector(`[data-note-id="${id}"]`);
      if (el) {
        el.classList.add("active");
        if (!video.paused) {
          const box = notesEl.getBoundingClientRect(), r = el.getBoundingClientRect();
          if (r.top < box.top || r.bottom > box.bottom) notesEl.scrollTop += r.top - box.top - 40;
        }
      }
    }
  }
  video.addEventListener("timeupdate", highlightActive);
  video.addEventListener("loadedmetadata", drawMarkers);
  video.addEventListener("pause", () => { if (!textEl.value.trim()) setComposerTime(video.currentTime); });

  vodState.keyHandler = (e) => {
    const tag = (e.target.tagName || "").toLowerCase();
    if (tag === "video") e.target.blur();
    if (tag === "input" || tag === "textarea" || e.ctrlKey || e.metaKey || e.altKey) {
      if (e.key === "Escape" && tag === "textarea") e.target.blur();
      return;
    }
    if (document.querySelector(".modal-backdrop")) return;
    if (tag === "button" && e.key === " ") e.target.blur();
    const k = e.key.toLowerCase();
    if (k === " ") { e.preventDefault(); video.paused ? video.play() : video.pause(); }
    else if (k === "arrowleft") { e.preventDefault(); seek(video.currentTime - 5); }
    else if (k === "arrowright") { e.preventDefault(); seek(video.currentTime + 5); }
    else if (k === "n") { e.preventDefault(); video.pause(); setComposerTime(video.currentTime); textEl.focus(); }
  };
  document.addEventListener("keydown", vodState.keyHandler);

  drawNotes();
  drawMarkers();
}

function openVodEditModal(vod) {
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <div class="modal modal-md">
      <div class="modal-head"><h3>${vt("edit_vod")}</h3><button class="close-x">${icon.x}</button></div>
      <div class="modal-body">
        <div class="field"><label>${vt("f_role")}</label>${vodRoleChips("vod-e-role", vod.role)}</div>
        <div class="field"><label>${vt("f_title")}</label><input class="input" id="vod-e-title" maxlength="200" value="${escapeHtml(vod.title)}" /></div>
        <div class="vod-form-row">
          <div class="field"><label>${vt("f_opponent")}</label><input class="input" id="vod-e-opponent" maxlength="120" value="${escapeHtml(vod.opponent || "")}" /></div>
          <div class="field"><label>${vt("f_date")}</label><input id="vod-e-date" value="${escapeHtml(vod.match_date || "")}" /></div>
        </div>
        <div class="field"><label>${vt("f_result")}</label>
          <div class="vod-chip-row" id="vod-e-result">
            ${["", "win", "loss"].map(r => `<button type="button" class="cat-tab ${(vod.result || "") === r ? "active" : ""}" data-r="${r}">${vt(r ? "r_" + r : "r_none")}</button>`).join("")}
          </div>
        </div>
        ${vodPhaseFields(vod.phases, vod.uploader_builds)}
        <div class="field"><label>${vt("f_desc")}</label><textarea class="textarea" id="vod-e-desc" rows="4" maxlength="5000">${escapeHtml(vod.description || "")}</textarea></div>
      </div>
      <div class="modal-foot"><button class="btn btn-primary" id="vod-e-save">${vt("save")}</button></div>
    </div>`;
  document.body.appendChild(backdrop);
  const close = () => { closePicker(); closeModal(backdrop); };
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
  backdrop.querySelector(".close-x").addEventListener("click", close);
  enhancePicker(backdrop.querySelector("#vod-e-date"), "date", { clearable: true });
  let result = vod.result || "";
  let role = vod.role;
  vodBindRoleChips(backdrop, "vod-e-role", r => { role = r; });
  vodBindPhases(backdrop);
  backdrop.querySelectorAll("#vod-e-result [data-r]").forEach(b => b.addEventListener("click", () => {
    result = b.dataset.r;
    backdrop.querySelectorAll("#vod-e-result [data-r]").forEach(x => x.classList.toggle("active", x === b));
  }));
  backdrop.querySelector("#vod-e-save").addEventListener("click", async () => {
    try {
      await api(`/vods/${vod.id}`, {
        method: "PUT",
        body: JSON.stringify({
          title: backdrop.querySelector("#vod-e-title").value,
          role,
          opponent: backdrop.querySelector("#vod-e-opponent").value,
          match_date: backdrop.querySelector("#vod-e-date").value || null,
          result: result || null,
          description: backdrop.querySelector("#vod-e-desc").value,
          phases: vodReadPhases(backdrop),
        }),
      });
      toast(vt("saved"));
      close();
      renderVods();
    } catch (err) { toast(err.message); }
  });
}

async function deleteVod(vod) {
  if (!confirm(vt("del_vod_confirm"))) return;
  try {
    await api(`/vods/${vod.id}`, { method: "DELETE" });
    toast(vt("deleted"));
    goTo("#/vods");
  } catch (err) { toast(err.message); }
}
