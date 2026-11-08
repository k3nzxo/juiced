// Gemeinsames Verhalten aller Seiten: Theme, Sprache, Mobile-Menü, Header, Scroll-Reveal.
import { initMotion } from "./motion";

function safeSet(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* privater Modus */ }
}

export function initChrome() {
  const root = document.documentElement;

  // Theme
  document.querySelectorAll<HTMLButtonElement>("[data-theme-toggle]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const next = root.dataset.theme === "dark" ? "light" : "dark";
      root.classList.add("theme-anim");
      root.dataset.theme = next;
      safeSet("juiced-theme", next);
      window.setTimeout(() => root.classList.remove("theme-anim"), 350);
      window.dispatchEvent(new CustomEvent("themechange", { detail: next }));
    });
  });

  // Sprache merken (für die Weiterleitung auf "/")
  document.querySelectorAll<HTMLAnchorElement>("[data-set-lang]").forEach((a) =>
    a.addEventListener("click", () => {
      safeSet("juiced-lang", a.dataset.setLang || "en");
      document.cookie = `juiced_lang=${a.dataset.setLang}; path=/; max-age=31536000; samesite=lax`;
    }),
  );

  // Sprachmenü
  const menu = document.querySelector<HTMLElement>("[data-lang-menu]");
  if (menu) {
    const btn = menu.querySelector<HTMLButtonElement>("[data-lang-btn]")!;
    const list = menu.querySelector<HTMLElement>(".lang-list")!;
    const close = () => { list.hidden = true; btn.setAttribute("aria-expanded", "false"); };
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const open = list.hidden;
      list.hidden = !open;
      btn.setAttribute("aria-expanded", String(open));
    });
    document.addEventListener("click", (e) => { if (!menu.contains(e.target as Node)) close(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
  }

  // Mobile-Menü
  const mBtn = document.querySelector<HTMLButtonElement>("[data-menu-btn]");
  const panel = document.querySelector<HTMLElement>("[data-mobile-panel]");
  mBtn?.addEventListener("click", () => {
    if (!panel) return;
    panel.hidden = !panel.hidden;
    mBtn.setAttribute("aria-expanded", String(!panel.hidden));
  });

  // Header-Linie beim Scrollen
  const header = document.getElementById("site-header");
  const onScroll = () => header?.classList.toggle("scrolled", window.scrollY > 8);
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });

  // Scroll-Reveal
  const items = document.querySelectorAll<HTMLElement>(".reveal");
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }),
      { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
    );
    items.forEach((el) => io.observe(el));
  } else items.forEach((el) => el.classList.add("in"));

  initMotion();

  // Angemeldet? Dann Avatar + Name im Header zeigen
  fetch("/api/auth/me", { credentials: "same-origin" })
    .then((r) => (r.ok ? r.json() : null))
    .then((me) => {
      const label = document.querySelector<HTMLElement>("[data-account-label]");
      const link = document.querySelector<HTMLElement>("[data-account-link]");
      document.documentElement.dataset.auth = me && me.user ? "in" : "out";
      if (!me || !me.user) {
        // abgemeldet: Zwischenspeicher und evtl. schon gezeigten Namen zurücksetzen
        try { sessionStorage.removeItem("juiced-me"); } catch { /* egal */ }
        if (label) label.textContent = label.dataset.default || label.textContent;
        link?.querySelector(".acc-av")?.remove();
        const bell = document.querySelector<HTMLElement>("[data-bell]");
        if (bell) bell.hidden = true;
        return;
      }
      if (!label || !link) return;
      const u = me.user;
      let img = link.querySelector<HTMLImageElement>(".acc-av");
      if (u.avatar_url) {
        if (!img) {
          img = document.createElement("img");
          img.alt = ""; img.width = 20; img.height = 20; img.className = "acc-av";
          link.prepend(img);
        }
        if (img.src !== u.avatar_url) img.src = u.avatar_url;
      } else img?.remove();
      label.textContent = u.display_name;
      saveMe({ n: u.display_name, a: u.avatar_url || "", m: !!u.is_member });
      if (u.is_member) initBell();
    })
    .catch(() => {});
}

function saveMe(patch: Record<string, unknown>) {
  try {
    const cur = JSON.parse(sessionStorage.getItem("juiced-me") || "{}");
    sessionStorage.setItem("juiced-me", JSON.stringify({ ...cur, ...patch }));
  } catch { /* privater Modus */ }
}

// Glocke: offene Bewerbungen, Match-Anfragen, VODs ohne Review
const bellSvg = (d: string) => `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const BELL_ICONS: Record<string, string> = {
  applications: bellSvg('<path d="M3 13h5l2 3h4l2-3h5"/><path d="M5 5h14l2 8v6H3v-6Z"/>'),
  matches: bellSvg('<path d="M14.5 17.5 3 6V3h3l11.5 11.5M13 19l6-6M16 16l4 4M19 21l2-2M14.5 6.5 18 3h3v3l-3.5 3.5M5 14l4 4M7 17l-3 3M3 19l2 2"/>'),
  vods: bellSvg('<rect x="3" y="5" width="18" height="14" rx="3"/><path d="m10 9 5 3-5 3Z"/>'),
};
function initBell() {
  const bell = document.querySelector<HTMLElement>("[data-bell]");
  if (!bell) return;
  const L = JSON.parse(bell.dataset.l || "{}");
  const lang = bell.dataset.lang || "en";
  const btn = bell.querySelector<HTMLButtonElement>("[data-bell-btn]")!;
  const menu = bell.querySelector<HTMLElement>("[data-bell-menu]")!;
  const count = bell.querySelector<HTMLElement>("[data-bell-count]")!;
  let last = Number(count.hidden ? 0 : count.textContent) || -1;
  const baseTitle = document.title.replace(/^\(\d+\+?\) /, "");
  const paint = (n: Record<string, number>) => {
    const total = n.total || 0;
    document.title = total ? `(${total > 99 ? "99+" : total}) ${baseTitle}` : baseTitle;
    saveMe({ c: total });
    count.hidden = !total;
    count.textContent = total > 99 ? "99+" : String(total);
    if (last >= 0 && total > last) { bell.classList.remove("ring"); void bell.offsetWidth; bell.classList.add("ring"); }
    last = total;
    const rows = (["applications", "matches", "vods"] as const).filter((k) => n[k] > 0)
      .map((k) => `<a href="/${lang}/app/#/${k}"><span class="bm-ico bm-${k}">${BELL_ICONS[k]}</span><span class="bm-label">${L[k]}</span><b>${n[k]}</b></a>`).join("");
    menu.innerHTML = `<div class="bm-head">${L.t}</div>` + (rows || `<div class="bm-empty">${L.empty}</div>`);
  };
  // Live: alle 15 s nachsehen, solange der Tab offen ist, und sofort beim Zurückkehren
  let busy = false;
  const load = () => {
    if (busy) return;
    busy = true;
    fetch("/api/notifications", { credentials: "same-origin", cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((n) => { if (n) { paint(n); window.dispatchEvent(new CustomEvent("juiced:bell", { detail: n })); } })
      .catch(() => {})
      .finally(() => { busy = false; });
  };
  bell.hidden = false;
  load();
  window.setInterval(() => { if (!document.hidden) load(); }, 15000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) load(); });
  window.addEventListener("focus", load);
  window.addEventListener("juiced:notifications", (e) => paint((e as CustomEvent).detail));
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    menu.hidden = !menu.hidden;
    btn.setAttribute("aria-expanded", String(!menu.hidden));
  });
  document.addEventListener("click", (e) => { if (!bell.contains(e.target as Node)) menu.hidden = true; });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") menu.hidden = true; });
}

export function toast(msg: string) {
  const wrap = document.getElementById("toasts");
  if (!wrap) return;
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = msg;
  wrap.appendChild(el);
  window.setTimeout(() => { el.style.transition = "opacity .3s"; el.style.opacity = "0"; }, 2600);
  window.setTimeout(() => el.remove(), 3000);
}
