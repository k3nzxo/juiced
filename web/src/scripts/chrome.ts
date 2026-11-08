// Gemeinsames Verhalten aller Seiten: Theme, Sprache, Mobile-Menü, Header, Scroll-Reveal.

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

  // Angemeldet? Dann Avatar + Name im Header zeigen
  fetch("/api/auth/me", { credentials: "same-origin" })
    .then((r) => (r.ok ? r.json() : null))
    .then((me) => {
      if (!me || !me.user) return;
      const label = document.querySelector<HTMLElement>("[data-account-label]");
      const link = document.querySelector<HTMLElement>("[data-account-link]");
      if (!label || !link) return;
      if (me.user.avatar_url) {
        const img = document.createElement("img");
        img.src = me.user.avatar_url; img.alt = ""; img.width = 20; img.height = 20;
        img.style.cssText = "border-radius:50%;width:20px;height:20px";
        link.prepend(img);
      }
      label.textContent = me.user.display_name;
    })
    .catch(() => {});
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
