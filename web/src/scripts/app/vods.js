// VOD-Reviews: Liste, Upload in Stücken, Player mit Zeitstempel-Notizen.
// Wird vom Router im Mitgliederbereich aufgerufen: renderVods(container, me)
import { api, toast, esc as escapeHtml, icon, fmtDate as formatDate, timeAgo, closeModal, T } from "./core";

let $app = null;
const goTo = (h) => { location.hash = h; };
const VOD_KEYS = {
  upload_btn: "vod_upload", back: "vod_back", back_list: "vod_back", search: "vod_search", edit_vod: "vod_edit",
  del_vod_confirm: "vod_del_confirm", del_note_confirm: "vod_del_note_confirm", role_hint_member: "vod_role_hint",
  role_hint_team: "vod_role_hint_team", save: "save", cancel: "cancel", edit: "edit", del: "delete",
  sub: "vod_sub", title: "vod_title", eyebrow: "app_title",
};
function vt(key, vars) {
  const k = VOD_KEYS[key] || (key.startsWith("role_") ? key : "vod_" + key);
  return T(k, vars);
}

const VOD_CATS = ["good", "mistake", "info", "question"];
const VOD_COACH_ROLES = ["healer", "tank", "nameless"];
const vodState = { list: null, filter: "", uploads: {}, pollTimer: null, keyHandler: null, catFilter: "all", roleFilter: "all", me: null };

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

function vodResultBadge(r) {
  if (!r) return "";
  return `<span class="vod-result vod-result-${r}">${escapeHtml(vt("r_" + r))}</span>`;
}

function vodCleanup() {
  if (vodState.pollTimer) { clearTimeout(vodState.pollTimer); vodState.pollTimer = null; }
  if (vodState.keyHandler) { document.removeEventListener("keydown", vodState.keyHandler); vodState.keyHandler = null; }
}

// Router-Einstieg (aus route() in app.js)
export async function renderVods(container, me) {
  $app = container;
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
        <div class="vod-chip-row" id="vod-role-filter" style="margin-bottom:1rem;">
          ${["all", ...VOD_COACH_ROLES].map(r => `<button class="cat-tab ${vodState.roleFilter === r ? "active" : ""}" data-rf="${r}">${vt("role_" + r)}</button>`).join("")}
        </div>
        <div id="vod-list"><div class="loader"><span class="spinner"></span></div></div>
    </div>`;
  $app.querySelector("#vod-upload-btn").addEventListener("click", () => openVodUploadModal());
  $app.querySelectorAll("[data-rf]").forEach(b => b.addEventListener("click", () => {
    vodState.roleFilter = b.dataset.rf;
    $app.querySelectorAll("[data-rf]").forEach(x => x.classList.toggle("active", x === b));
    drawVodList();
  }));
  $app.querySelector("#vod-search").addEventListener("input", (e) => { vodState.filter = e.target.value; drawVodList(); });
  renderUploadProgressPanel();
  await loadVodList();
}

async function loadVodList() {
  try {
    const [list, storage] = await Promise.all([api("/vods"), api("/vods/storage")]);
    vodState.list = list;
    vodState.storage = storage;
  } catch (err) {
    const el = document.getElementById("vod-list");
    if (el) el.innerHTML = `<div class="empty-state"><div class="display">${escapeHtml(err.message)}</div></div>`;
    return;
  }
  drawVodList();
  // Solange etwas verarbeitet wird, regelmäßig neu laden
  if (vodState.list.some(v => v.status === "processing") && location.hash.startsWith("#/vods") && !/^#\/vods\/\d+/.test(location.hash)) {
    vodState.pollTimer = setTimeout(loadVodList, 5000);
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
        ${v.status !== "ready" ? `<span class="vod-status vod-status-${v.status}">${vt("st_" + v.status)}</span>` : ""}
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
          <span>${vodExpiryLabel(v)} ${vt("notes_n", { n: v.note_count })}</span>
        </div>
        ${v.status === "uploading" && !vodState.uploads[v.id] ? `<button class="btn btn-sm btn-ghost vod-resume-btn" data-resume-id="${v.id}">${icon.refresh} ${vt("resume")}</button>` : ""}
      </div>
    </div>`).join("")}</div>`;
  el.querySelectorAll(".vod-card").forEach(card => {
    card.addEventListener("click", (e) => {
      if (e.target.closest("[data-resume-id]")) return;
      if (card.dataset.status === "uploading") return;
      goTo(`#/vods/${card.dataset.vodId}`);
    });
  });
  el.querySelectorAll("[data-resume-id]").forEach(btn => {
    btn.addEventListener("click", () => resumeVodUpload(vodState.list.find(v => v.id === parseInt(btn.dataset.resumeId, 10))));
  });
}

// ---------------------------------------------------------------- Upload

function openVodUploadModal() {
  const maxBytes = vodState.storage ? vodState.storage.max_file_bytes : 0;
  const today = new Date().toISOString().slice(0, 10);
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <div class="modal modal-md">
      <div class="modal-head"><h3>${vt("upload_btn")}</h3><button class="close-x">${icon.x}</button></div>
      <div class="modal-body">
        <div class="field">
          <label>${vt("f_file")}</label>
          <input type="file" id="vod-f-file" accept="video/*,.mkv,.flv,.ts" />
          <p class="vod-hint">${vt("f_file_hint", { max: vodFmtBytes(maxBytes) })}</p>
        </div>
        <div class="field"><label>${vt("f_role")}</label>${vodRoleChips("vod-f-role", null)}
          <p class="vod-hint" id="vod-f-role-hint">${vt("role_hint_member")}</p></div>
        <div class="field"><label>${vt("f_title")}</label><input id="vod-f-title" maxlength="200" /></div>
        <div class="vod-form-row">
          <div class="field"><label>${vt("f_opponent")}</label><input id="vod-f-opponent" maxlength="120" /></div>
          <div class="field"><label>${vt("f_date")}</label><input type="date" id="vod-f-date" value="${today}" /></div>
        </div>
        <div class="field"><label>${vt("f_result")}</label>
          <div class="vod-chip-row" id="vod-f-result">
            ${["", "win", "loss", "draw"].map(r => `<button type="button" class="cat-tab ${r === "" ? "active" : ""}" data-r="${r}">${vt(r ? "r_" + r : "r_none")}</button>`).join("")}
          </div>
        </div>
        <div class="field"><label>${vt("f_desc")}</label><textarea id="vod-f-desc" rows="3" maxlength="5000"></textarea></div>
      </div>
      <div class="modal-foot">
        <button class="btn btn-primary" id="vod-f-submit">${vt("start_upload")}</button>
      </div>
    </div>`;
  document.body.appendChild(backdrop);
  const close = () => closeModal(backdrop);
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
  backdrop.querySelector(".close-x").addEventListener("click", close);

  let result = "";
  let role = null;
  vodBindRoleChips(backdrop, "vod-f-role", r => {
    role = r;
    backdrop.querySelector("#vod-f-role-hint").textContent = vt(r === "team" ? "role_hint_team" : "role_hint_member");
  });
  backdrop.querySelectorAll("#vod-f-result [data-r]").forEach(b => b.addEventListener("click", () => {
    result = b.dataset.r;
    backdrop.querySelectorAll("#vod-f-result [data-r]").forEach(x => x.classList.toggle("active", x === b));
  }));
  const fileIn = backdrop.querySelector("#vod-f-file");
  const titleIn = backdrop.querySelector("#vod-f-title");
  fileIn.addEventListener("change", () => {
    const f = fileIn.files[0];
    if (f && !titleIn.value.trim()) titleIn.value = f.name.replace(/\.[^.]+$/, "").replace(/[_]+/g, " ").slice(0, 200);
  });

  backdrop.querySelector("#vod-f-submit").addEventListener("click", async (e) => {
    const file = fileIn.files[0];
    const title = titleIn.value.trim();
    if (!file || !title) { toast(vt("missing_fields")); return; }
    if (!role) { toast(vt("missing_role")); return; }
    e.currentTarget.disabled = true;
    try {
      const vod = await api("/vods", {
        method: "POST",
        body: JSON.stringify({
          title, role, filename: file.name, size_bytes: file.size,
          opponent: backdrop.querySelector("#vod-f-opponent").value.trim() || null,
          match_date: backdrop.querySelector("#vod-f-date").value || null,
          result: result || null,
          description: backdrop.querySelector("#vod-f-desc").value.trim() || null,
        }),
      });
      close();
      startVodUpload(vod, file, 0);
    } catch (err) {
      toast(err.message);
      e.currentTarget.disabled = false;
    }
  });
}

function resumeVodUpload(vod) {
  if (!vod) return;
  toast(vt("resume_pick", { name: vod.original_filename || "" }));
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "video/*,.mkv,.flv,.ts";
  input.addEventListener("change", () => {
    const f = input.files[0];
    if (!f) return;
    if (f.size !== vod.size_bytes) { toast(vt("resume_wrong")); return; }
    startVodUpload(vod, f, vod.received_bytes || 0);
  });
  input.click();
}

function vodUploadChunk(vodId, offset, blob) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", `/api/vods/${vodId}/upload?offset=${offset}`);
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.upload.onprogress = (e) => { const u = vodState.uploads[vodId]; if (u) { u.inflight = e.loaded; renderUploadProgressPanel(); } };
    xhr.onload = () => {
      let data = null;
      try { data = JSON.parse(xhr.responseText); } catch (e) {}
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else {
        const err = new Error((data && data.detail) || `HTTP ${xhr.status}`);
        err.status = xhr.status;
        reject(err);
      }
    };
    xhr.onerror = () => { const err = new Error(T("error")); err.status = 0; reject(err); };
    xhr.send(blob);
  });
}

async function startVodUpload(vod, file, startOffset) {
  const chunk = vod.chunk_size || 32 * 1024 * 1024;
  const up = { id: vod.id, title: vod.title, size: file.size, done: startOffset, inflight: 0, started: Date.now(), startedBytes: startOffset, error: null };
  vodState.uploads[vod.id] = up;
  renderUploadProgressPanel();
  if (location.hash.startsWith("#/vods") && !/^#\/vods\/\d+/.test(location.hash)) loadVodList();

  let offset = startOffset;
  let retries = 0;
  try {
    while (offset < file.size) {
      try {
        const res = await vodUploadChunk(vod.id, offset, file.slice(offset, Math.min(offset + chunk, file.size)));
        offset = res.received_bytes;
        retries = 0;
      } catch (err) {
        const m = /^offset:(\d+)$/.exec(err.message || "");
        if (err.status === 409 && m) { offset = parseInt(m[1], 10); continue; }
        if (err.status === 401 || err.status === 403 || err.status === 400 || ++retries > 8) throw err;
        await new Promise(r => setTimeout(r, Math.min(30000, 1500 * retries)));  // Netz weg -> warten, nochmal
      }
      up.done = offset; up.inflight = 0;
      renderUploadProgressPanel();
    }
    await api(`/vods/${vod.id}/complete`, { method: "POST" });
    delete vodState.uploads[vod.id];
    toast(vt("upload_done"));
  } catch (err) {
    up.error = err.message;
    delete vodState.uploads[vod.id];
    toast(`${vt("upload_failed")} (${err.message})`);
  }
  renderUploadProgressPanel();
  if (location.hash.startsWith("#/vods") && !/^#\/vods\/\d+/.test(location.hash)) { vodCleanup(); loadVodList(); }
}

function renderUploadProgressPanel() {
  const el = document.getElementById("vod-upload-progress");
  if (!el) return;
  const ups = Object.values(vodState.uploads);
  el.innerHTML = ups.map(u => {
    const cur = u.done + (u.inflight || 0);
    const pct = Math.min(100, cur / u.size * 100);
    const secs = (Date.now() - u.started) / 1000;
    const speed = secs > 2 ? (cur - u.startedBytes) / secs : 0;
    const eta = speed > 0 ? (u.size - cur) / speed : 0;
    return `<div class="vod-upload-row">
      <div class="vod-upload-head"><strong>${escapeHtml(u.title)}</strong>
        <span>${vodFmtBytes(cur)} / ${vodFmtBytes(u.size)}${speed ? ` · ${(speed / 1024 / 1024).toFixed(1)} MB/s · ~${vodFmtTime(eta)}` : ""}</span></div>
      <div class="vod-progress"><span style="width:${pct.toFixed(1)}%"></span></div>
      <div class="vod-hint">${vt("keep_open")}</div>
    </div>`;
  }).join("");
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
        </div>
      </div>
      <div class="vod-head-actions">
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
          <button class="btn btn-sm btn-ghost" data-seek="-10">-10s</button>
          <button class="btn btn-sm btn-ghost" data-seek="-5">-5s</button>
          <button class="btn btn-sm btn-ghost" data-seek="5">+5s</button>
          <button class="btn btn-sm btn-ghost" data-seek="10">+10s</button>
          <span class="vod-sep"></span>
          ${[0.25, 0.5, 1, 1.5, 2].map(r => `<button class="btn btn-sm btn-ghost vod-rate ${r === 1 ? "active" : ""}" data-rate="${r}">${r}x</button>`).join("")}
        </div>
        <div class="vod-hint">${vt("hotkeys")}</div>
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
    if (tag === "input" || tag === "textarea" || e.ctrlKey || e.metaKey || e.altKey) {
      if (e.key === "Escape" && tag === "textarea") e.target.blur();
      return;
    }
    if (document.querySelector(".modal-backdrop")) return;
    const k = e.key.toLowerCase();
    if (k === " " || k === "k") { e.preventDefault(); video.paused ? video.play() : video.pause(); }
    else if (k === "j") seek(video.currentTime - 5);
    else if (k === "l") seek(video.currentTime + 5);
    else if (k === ",") { video.pause(); seek(video.currentTime - 1 / 30); }
    else if (k === ".") { video.pause(); seek(video.currentTime + 1 / 30); }
    else if (k === "n") { e.preventDefault(); video.pause(); setComposerTime(video.currentTime); textEl.focus(); }
    else if (k === "f") { if (document.fullscreenElement) document.exitFullscreen(); else video.requestFullscreen && video.requestFullscreen(); }
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
        <div class="field"><label>${vt("f_title")}</label><input id="vod-e-title" maxlength="200" value="${escapeHtml(vod.title)}" /></div>
        <div class="vod-form-row">
          <div class="field"><label>${vt("f_opponent")}</label><input id="vod-e-opponent" maxlength="120" value="${escapeHtml(vod.opponent || "")}" /></div>
          <div class="field"><label>${vt("f_date")}</label><input type="date" id="vod-e-date" value="${escapeHtml(vod.match_date || "")}" /></div>
        </div>
        <div class="field"><label>${vt("f_result")}</label>
          <div class="vod-chip-row" id="vod-e-result">
            ${["", "win", "loss", "draw"].map(r => `<button type="button" class="cat-tab ${(vod.result || "") === r ? "active" : ""}" data-r="${r}">${vt(r ? "r_" + r : "r_none")}</button>`).join("")}
          </div>
        </div>
        <div class="field"><label>${vt("f_desc")}</label><textarea id="vod-e-desc" rows="4" maxlength="5000">${escapeHtml(vod.description || "")}</textarea></div>
      </div>
      <div class="modal-foot"><button class="btn btn-primary" id="vod-e-save">${vt("save")}</button></div>
    </div>`;
  document.body.appendChild(backdrop);
  const close = () => closeModal(backdrop);
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
  backdrop.querySelector(".close-x").addEventListener("click", close);
  let result = vod.result || "";
  let role = vod.role;
  vodBindRoleChips(backdrop, "vod-e-role", r => { role = r; });
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
