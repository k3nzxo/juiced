// Wochenplan: Termine laden und als Woche (Mo–So, lokale Zeitzone) darstellen.
import { esc } from "./team";

export type Ev = {
  id: number; title: string; kind: string; starts_at: string; ends_at: string; duration_min: number;
  opponent: string | null; description: string | null; repeat_weekly: boolean; repeat_days?: string; open_end?: boolean; is_public: boolean; can_edit: boolean;
};

export const KINDS = ["gvg", "raid", "scrim", "ingame", "friday", "other"] as const;

export function startOfWeek(d = new Date()): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = (x.getDay() + 6) % 7; // Montag = 0
  x.setDate(x.getDate() - day);
  return x;
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export async function fetchEvents(from: Date, to: Date): Promise<Ev[]> {
  const q = new URLSearchParams({ start: from.toISOString(), end: to.toISOString() });
  const r = await fetch(`/api/events?${q}`, { credentials: "same-origin" });
  if (!r.ok) throw new Error(String(r.status));
  return r.json();
}

const locale = (lang: string) => (lang === "pt" ? "pt-BR" : lang);
export const timeFmt = (lang: string) => new Intl.DateTimeFormat(locale(lang), { hour: "2-digit", minute: "2-digit" });
export const dayFmt = (lang: string, long = false) => new Intl.DateTimeFormat(locale(lang), { weekday: long ? "long" : "short" });
export const dateFmt = (lang: string) => new Intl.DateTimeFormat(locale(lang), { day: "numeric", month: "short" });

export function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function eventChip(e: Ev, lang: string, L: Record<string, string>): string {
  const s = new Date(e.starts_at), en = new Date(e.ends_at);
  const tf = timeFmt(lang);
  return `<article class="ev kind-${esc(e.kind)}" tabindex="0" title="${esc(e.description || "")}">
    <div class="ev-time">${e.open_end
      ? `${esc((L.sched_from || "{t}").replace("{t}", tf.format(s)))} <span class="ev-open">· ${esc(L.sched_open_end || "")}</span>`
      : `${tf.format(s)}–${tf.format(en)}`}</div>
    <div class="ev-title">${esc(e.title)}</div>
    ${e.opponent ? `<div class="ev-sub">${esc((L.sched_vs || "vs {name}").replace("{name}", e.opponent))}</div>` : ""}
    <div class="ev-tags"><span class="ev-kind">${esc(L["kind_" + e.kind] || e.kind)}</span>${!e.is_public ? `<span class="ev-int">${esc(L.sched_internal)}</span>` : ""}</div>
  </article>`;
}

/**
 * Rendert 7 Tagesspalten ab `monday`. Mit `events = null` nur das leere Gerüst (Laden).
 * Die Spalten werden nur einmal angelegt und danach nur befüllt, damit nichts springt oder neu einfliegt.
 */
export function renderWeek(el: HTMLElement, events: Ev[] | null, monday: Date, lang: string, L: Record<string, string>) {
  const today = new Date();
  const df = dayFmt(lang), dtf = dateFmt(lang);
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  if (el.children.length !== 7) {
    el.innerHTML = days.map((_, i) => `<section class="day" style="--i:${i}"><header><span class="day-name"></span><span class="day-date"></span></header><div class="day-body"></div></section>`).join("");
  }
  days.forEach((d, i) => {
    const sec = el.children[i] as HTMLElement;
    sec.classList.toggle("today", sameDay(d, today));
    sec.classList.toggle("past", d < startOfDay(today));
    sec.querySelector(".day-name")!.textContent = df.format(d);
    sec.querySelector(".day-date")!.textContent = dtf.format(d);
    const body = sec.querySelector<HTMLElement>(".day-body")!;
    if (!events) { body.innerHTML = ""; return; }
    const list = events.filter((e) => sameDay(new Date(e.starts_at), d));
    body.innerHTML = list.length ? list.map((e) => eventChip(e, lang, L)).join("") : `<p class="day-free">${esc(L.sched_free)}</p>`;
  });
}

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
