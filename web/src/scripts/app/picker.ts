// Eigener Datums-/Zeitwähler statt der Browser-Felder.
// Das Original-<input> bleibt erhalten (versteckt) und hält den Wert im gleichen Format
// wie type="date" (YYYY-MM-DD) bzw. type="datetime-local" (YYYY-MM-DDTHH:MM).
import { lang, T } from "./core";

type Mode = "date" | "datetime";
const pad = (n: number) => String(n).padStart(2, "0");
const loc = () => (lang() === "pt" ? "pt-BR" : lang());
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const QUICK_TIMES = ["18:00", "19:00", "20:00", "21:00"];

const calIcon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18"/></svg>`;
const chev = (d: string) => `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;

function parse(v: string, mode: Mode): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(v || "");
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], mode === "datetime" ? +(m[4] || 20) : 12, mode === "datetime" ? +(m[5] || 0) : 0);
}

function label(d: Date | null, mode: Mode) {
  if (!d) return T("dp_pick");
  const date = d.toLocaleDateString(loc(), { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  return mode === "datetime" ? `${date} · ${pad(d.getHours())}:${pad(d.getMinutes())}` : date;
}

let openPop: { el: HTMLElement; close: () => void } | null = null;

export function enhancePicker(input: HTMLInputElement, mode: Mode, opts: { clearable?: boolean } = {}) {
  if (input.dataset.dp) return;
  input.dataset.dp = "1";
  input.type = "hidden";
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "dp-btn input";
  btn.setAttribute("aria-haspopup", "dialog");
  const paint = () => {
    const d = parse(input.value, mode);
    btn.innerHTML = `${calIcon}<span class="${d ? "" : "dp-ph"}">${label(d, mode)}</span>`;
  };
  paint();
  input.after(btn);
  input.addEventListener("dp:refresh", paint);
  btn.addEventListener("click", (e) => { e.stopPropagation(); openPop?.el.dataset.for === input.id ? openPop.close() : open(); });

  function setValue(d: Date | null) {
    input.value = d ? (mode === "datetime" ? `${ymd(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}` : ymd(d)) : "";
    input.dispatchEvent(new Event("change", { bubbles: true }));
    paint();
  }

  function open() {
    openPop?.close();
    const cur = parse(input.value, mode);
    let view = new Date((cur || new Date()).getFullYear(), (cur || new Date()).getMonth(), 1);
    let hh = cur ? cur.getHours() : 20, mm = cur ? cur.getMinutes() : 0;

    const pop = document.createElement("div");
    pop.className = "dp-pop";
    pop.dataset.for = input.id;
    pop.setAttribute("role", "dialog");
    document.body.appendChild(pop);

    const weekdays = Array.from({ length: 7 }, (_, i) => new Date(2024, 0, 1 + i).toLocaleDateString(loc(), { weekday: "narrow" })); // 1.1.2024 = Montag

    const draw = (dir = 0) => {
      const sel = parse(input.value, mode);
      const today = ymd(new Date());
      const first = (view.getDay() + 6) % 7; // Montag zuerst
      const days = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate();
      const cells: string[] = [];
      for (let i = 0; i < first; i++) cells.push(`<span></span>`);
      for (let d = 1; d <= days; d++) {
        const key = ymd(new Date(view.getFullYear(), view.getMonth(), d));
        cells.push(`<button type="button" class="dp-day ${key === today ? "today" : ""} ${sel && key === ymd(sel) ? "sel" : ""}" data-day="${d}">${d}</button>`);
      }
      const time = mode === "datetime" ? `
        <div class="dp-time">
          <span class="dp-time-l">${T("dp_time")}</span>
          <div class="dp-time-in">
            <select data-h>${Array.from({ length: 24 }, (_, h) => `<option value="${h}" ${h === hh ? "selected" : ""}>${pad(h)}</option>`).join("")}</select>
            <span>:</span>
            <select data-m>${[0, 15, 30, 45].concat([0, 15, 30, 45].includes(mm) ? [] : [mm]).sort((a, b) => a - b).map((m) => `<option value="${m}" ${m === mm ? "selected" : ""}>${pad(m)}</option>`).join("")}</select>
          </div>
          <div class="dp-quick">${QUICK_TIMES.map((t) => `<button type="button" data-q="${t}" class="${t === `${pad(hh)}:${pad(mm)}` ? "on" : ""}">${t}</button>`).join("")}</div>
        </div>` : "";
      pop.innerHTML = `
        <div class="dp-head">
          <button type="button" class="dp-nav" data-nav="-1" aria-label="‹">${chev("M15 6l-6 6 6 6")}</button>
          <strong>${view.toLocaleDateString(loc(), { month: "long", year: "numeric" })}</strong>
          <button type="button" class="dp-nav" data-nav="1" aria-label="›">${chev("M9 6l6 6-6 6")}</button>
        </div>
        <div class="dp-grid dp-wd">${weekdays.map((w) => `<span>${w}</span>`).join("")}</div>
        <div class="dp-grid dp-days ${dir ? (dir > 0 ? "slide-l" : "slide-r") : ""}">${cells.join("")}</div>
        ${time}
        <div class="dp-foot">
          <button type="button" data-today>${T("dp_today")}</button>
          ${opts.clearable ? `<button type="button" data-clear>${T("dp_clear")}</button>` : ""}
        </div>`;
    };

    const pickDate = (d: Date) => {
      if (mode === "datetime") d.setHours(hh, mm, 0, 0);
      setValue(d);
    };

    pop.addEventListener("click", (e) => {
      e.stopPropagation();
      const t = e.target as HTMLElement;
      const nav = t.closest<HTMLElement>("[data-nav]");
      if (nav) { view = new Date(view.getFullYear(), view.getMonth() + Number(nav.dataset.nav), 1); draw(Number(nav.dataset.nav)); return; }
      const day = t.closest<HTMLElement>("[data-day]");
      if (day) {
        pickDate(new Date(view.getFullYear(), view.getMonth(), Number(day.dataset.day)));
        if (mode === "date") close(); else draw();
        return;
      }
      const q = t.closest<HTMLElement>("[data-q]");
      if (q) {
        [hh, mm] = q.dataset.q!.split(":").map(Number);
        pickDate(parse(input.value, mode) || new Date());
        close();
        return;
      }
      if (t.closest("[data-today]")) {
        const now = new Date();
        view = new Date(now.getFullYear(), now.getMonth(), 1);
        pickDate(now);
        if (mode === "date") close(); else draw();
        return;
      }
      if (t.closest("[data-clear]")) { setValue(null); close(); }
    });
    pop.addEventListener("change", (e) => {
      const t = e.target as HTMLSelectElement;
      if (t.matches("[data-h]")) hh = Number(t.value);
      if (t.matches("[data-m]")) mm = Number(t.value);
      pickDate(parse(input.value, mode) || new Date());
      draw();
    });

    const place = () => {
      const r = btn.getBoundingClientRect();
      const w = pop.offsetWidth, h = pop.offsetHeight;
      let left = Math.min(r.left, window.innerWidth - w - 12);
      let top = r.bottom + 6;
      if (top + h > window.innerHeight - 12) top = Math.max(12, r.top - h - 6);
      pop.style.left = `${Math.max(12, left)}px`;
      pop.style.top = `${top}px`;
    };
    draw();
    place();

    const onDoc = (e: Event) => { if (!pop.contains(e.target as Node) && e.target !== btn) close(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopImmediatePropagation(); close(); btn.focus(); } };
    const onMove = () => place();
    function close() {
      document.removeEventListener("click", onDoc, true);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
      pop.classList.add("closing");
      window.setTimeout(() => pop.remove(), 120);
      if (openPop?.el === pop) openPop = null;
    }
    setTimeout(() => document.addEventListener("click", onDoc, true));
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    openPop = { el: pop, close };
  }
}

export function closePicker() { openPop?.close(); }
