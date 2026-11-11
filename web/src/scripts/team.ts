// Öffentliche Team-Daten (Leitung auf der Startseite, ganzes Roster auf /team)

export type PublicMember = {
  display_name: string;
  avatar_url: string | null;
  rank: "developer" | "leader" | "vice" | "coach" | "member";
  coach_roles: string[];
  main_role: string | null;
  weapons?: string[]; weapon_other?: string | null;
  country: string | null;
  bench?: boolean;
  flag_emoji?: string | null;
};

export const RANK_ORDER = ["developer", "leader", "vice", "coach", "member"];

export function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

// Flaggen als SVG-Dateien (Windows zeigt Flaggen-Emojis nur als Buchstaben an)
export function flag(cc: string | null, title = ""): string {
  if (!cc || !/^[A-Za-z]{2}$/.test(cc)) return "";
  const c = cc.toLowerCase();
  return `<img class="flag" src="/flags/${c}.svg" alt="${esc(cc.toUpperCase())}" title="${esc(title || cc.toUpperCase())}" width="20" height="15" loading="lazy" onerror="this.replaceWith(document.createTextNode('${c.toUpperCase()}'))">`;
}

export function avatar(m: { display_name: string; avatar_url: string | null }, size = 56): string {
  if (m.avatar_url) return `<img class="avatar" src="${esc(m.avatar_url)}" alt="" width="${size}" height="${size}" loading="lazy" referrerpolicy="no-referrer">`;
  return `<span class="avatar-fallback" aria-hidden="true">${esc((m.display_name || "?").slice(0, 1).toUpperCase())}</span>`;
}

export async function fetchTeam(): Promise<PublicMember[]> {
  const r = await fetch("/api/team", { credentials: "same-origin" });
  if (!r.ok) throw new Error(String(r.status));
  const data = await r.json();
  return data.members as PublicMember[];
}

export function personCard(m: PublicMember, labels: Record<string, string>): string {
  // öffentlich nur die Rolle (DPS / Tank / Healer), keine Waffen
  const roleLabel = m.main_role ? labels["role_" + m.main_role] || m.main_role : "";
  return `<article class="person">
    ${avatar(m)}
    <div class="p-info">
      <div class="p-name"><span>${esc(m.display_name)}</span>${m.flag_emoji ? `<span class="flag-emoji">${esc(m.flag_emoji)}</span>` : m.country ? flag(m.country) : ""}</div>
      <div class="p-sub"><span class="badge badge-${esc(m.rank)}">${esc(labels[m.rank] || m.rank)}</span>${m.bench ? ` <span class="badge badge-bench">♿ ${esc(labels.bench || "Bench")}</span>` : ""}</div>
      ${roleLabel ? `<div class="p-role"><span class="role-tag role-${esc(m.main_role)}">${esc(roleLabel)}</span></div>` : ""}
    </div>
  </article>`;
}

export async function renderLeadership(grid: HTMLElement) {
  const labels = JSON.parse(grid.dataset.ranks || "{}");
  try {
    const all = await fetchTeam();
    const lead = all.filter((m) => ["developer", "leader", "vice"].includes(m.rank)).slice(0, 8);
    if (!lead.length) {
      grid.innerHTML = `<p class="lead-empty">${esc(grid.dataset.empty)}</p>`;
      return;
    }
    grid.innerHTML = lead.map((m) => personCard(m, labels)).join("");
  } catch {
    grid.innerHTML = `<p class="lead-empty">${esc(grid.dataset.empty)}</p>`;
  }
}
