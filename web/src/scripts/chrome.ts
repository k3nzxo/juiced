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
function initBell() {
  const bell = document.querySelector<HTMLElement>("[data-bell]");
  if (!bell) return;
  const L = JSON.parse(bell.dataset.l || "{}");
  const lang = bell.dataset.lang || "en";
  const btn = bell.querySelector<HTMLButtonElement>("[data-bell-btn]")!;
  const menu = bell.querySelector<HTMLElement>("[data-bell-menu]")!;
  const count = bell.querySelector<HTMLElement>("[data-bell-count]")!;
  let last = Number(count.hidden ? 0 : count.textContent) || -1;
  const paint = (n: Record<string, number>) => {
    const total = n.total || 0;
    saveMe({ c: total });
    count.hidden = !total;
    count.textContent = total > 99 ? "99+" : String(total);
    if (last >= 0 && total > last) { bell.classList.remove("ring"); void bell.offsetWidth; bell.classList.add("ring"); }
    last = total;
    const rows = (["applications", "matches", "vods"] as const).filter((k) => n[k] > 0)
      .map((k) => `<a href="/${lang}/app/#/${k}">${L[k]}<b>${n[k]}</b></a>`).join("");
    menu.innerHTML = `<div class="bm-head">${L.t}</div>` + (rows || `<div class="bm-empty">${L.empty}</div>`);
  };
  const load = () => fetch("/api/notifications", { credentials: "same-origin" })
    .then((r) => (r.ok ? r.json() : null)).then((n) => n && paint(n)).catch(() => {});
  bell.hidden = false;
  load();
  window.setInterval(() => { if (!document.hidden) load(); }, 90000);
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
