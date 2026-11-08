// Gemeinsame Helfer für den Mitgliederbereich.
import { toast as baseToast } from "../chrome";

let DICT: Record<string, string> = {};
let LANG = "en";

export function initI18n(dict: Record<string, string>, lang: string) {
  DICT = dict;
  LANG = lang;
}

export function T(key: string, vars?: Record<string, string | number>): string {
  let s = DICT[key] ?? key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? String(vars[k]) : `{${k}}`));
  return s;
}

export const lang = () => LANG;
export const toast = baseToast;

export function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export class ApiError extends Error {
  status: number;
  constructor(msg: string, status: number) { super(msg); this.status = status; }
}

export async function api<T = any>(path: string, opts: RequestInit & { json?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = { ...(opts.headers as Record<string, string>) };
  let body = opts.body;
  if (opts.json !== undefined) { headers["Content-Type"] = "application/json"; body = JSON.stringify(opts.json); }
  else if (typeof body === "string") headers["Content-Type"] = "application/json";
  let res: Response;
  try {
    res = await fetch(`/api${path}`, { ...opts, body, headers, credentials: "same-origin" });
  } catch {
    throw new ApiError(T("error"), 0);
  }
  let data: any = null;
  try { data = await res.json(); } catch { /* kein Body */ }
  if (!res.ok) {
    if (res.status === 401) window.dispatchEvent(new Event("juiced:unauthorized"));
    throw new ApiError((data && data.detail && typeof data.detail === "string" ? data.detail : null) || T("error"), res.status);
  }
  return data as T;
}

const locale = () => ({ pt: "pt-BR" } as Record<string, string>)[LANG] || LANG;

export function fmtDate(d: string): string {
  try { return new Date(d).toLocaleDateString(locale(), { year: "numeric", month: "short", day: "numeric" }); }
  catch { return d; }
}

export function timeAgo(d: string): string {
  const mins = Math.floor((Date.now() - new Date(d).getTime()) / 60000);
  if (mins < 1) return T("just_now");
  if (mins < 60) return T("min_ago", { n: mins });
  const h = Math.floor(mins / 60);
  if (h < 24) return T("h_ago", { n: h });
  const days = Math.floor(h / 24);
  if (days < 14) return T("d_ago", { n: days });
  return fmtDate(d);
}

export function closeModal(backdrop: HTMLElement) {
  if (!backdrop || backdrop.classList.contains("closing")) return;
  backdrop.classList.add("closing");
  window.setTimeout(() => backdrop.remove(), 160);
}

const svg = (d: string, size = 15) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

export const icon = {
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  x: svg('<path d="M6 6l12 12M18 6 6 18"/>', 18),
  trash: svg('<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>'),
  edit: svg('<path d="M4 20h4L19 9l-4-4L4 16Z"/><path d="m14 6 4 4"/>'),
  copy: svg('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>'),
  play: svg('<rect x="3" y="5" width="18" height="14" rx="3"/><path d="m10 9 5 3-5 3Z"/>', 28),
  refresh: svg('<path d="M4 9a7 7 0 0 1 12-3l3 3M20 15a7 7 0 0 1-12 3l-3-3"/><path d="M19 4v5h-5M5 20v-5h5"/>'),
  arrowLeft: svg('<path d="M19 12H5M11 6l-6 6 6 6"/>'),
  user: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/>'),
  pin: svg('<path d="M12 17v5M8 3h8l-1 6 3 3v2H6v-2l3-3Z"/>'),
  check: svg('<path d="m5 12 5 5 9-10"/>'),
  logout: svg('<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l-5-5 5-5M5 12h11"/>'),
  grid: svg('<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>', 17),
  video: svg('<rect x="3" y="5" width="18" height="14" rx="3"/><path d="m10 9 5 3-5 3Z"/>', 17),
  users: svg('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.5 3.3-5.5 6.5-5.5s5.9 2 6.5 5.5"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.8c2 .7 3.2 2.5 3.5 5.2"/>', 17),
  inbox: svg('<path d="M3 13h5l2 3h4l2-3h5"/><path d="M5 5h14l2 8v6H3v-6Z"/>', 17),
  shield: svg('<path d="M12 3 4 6v6c0 4.5 3.4 8 8 9 4.6-1 8-4.5 8-9V6Z"/>', 17),
  calendar: svg('<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18"/>', 17),
  swords: svg('<path d="M14.5 17.5 3 6V3h3l11.5 11.5M13 19l6-6M16 16l4 4M19 21l2-2M9.5 6.5 13 3h3v3l-3.5 3.5M5 14l-3 3M7 16l-3 3"/>', 17),
  settings: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/>', 17),
};

export function modal(title: string, bodyHtml: string, footHtml = ""): { el: HTMLElement; close: () => void } {
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <div class="modal-head"><h3>${esc(title)}</h3><button class="close-x" aria-label="${esc(T("cancel"))}">${icon.x}</button></div>
    <div class="modal-body">${bodyHtml}</div>${footHtml ? `<div class="modal-foot">${footHtml}</div>` : ""}</div>`;
  document.body.appendChild(backdrop);
  const close = () => closeModal(backdrop);
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
  backdrop.querySelector(".close-x")!.addEventListener("click", close);
  const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { close(); document.removeEventListener("keydown", onKey); } };
  document.addEventListener("keydown", onKey);
  return { el: backdrop, close };
}
