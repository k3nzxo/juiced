// Dezente Bewegungen: Wort-für-Wort-Überschriften, Hochzählen, leichte 3D-Neigung. Alles aus bei reduced motion.

const reduce = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function onVisible(el: Element, fn: () => void, margin = "0px 0px -10% 0px") {
  if (!("IntersectionObserver" in window)) return fn();
  const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { io.disconnect(); fn(); } }, { rootMargin: margin });
  io.observe(el);
}

/** <h2 data-split>…</h2> -> jedes Wort fährt einzeln hoch. Verschachtelte Elemente (z. B. Gradient-Span) bleiben erhalten. */
function splitWords(el: HTMLElement) {
  if (el.dataset.splitDone) return;
  el.dataset.splitDone = "1";
  let i = 0;
  const walk = (node: Node) => {
    [...node.childNodes].forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        const parts = (child.textContent || "").split(/(\s+)/);
        const frag = document.createDocumentFragment();
        parts.forEach((p) => {
          if (!p) return;
          if (/^\s+$/.test(p)) { frag.appendChild(document.createTextNode(p)); return; }
          const w = document.createElement("span");
          w.className = "w";
          const inner = document.createElement("span");
          inner.textContent = p;
          inner.style.transitionDelay = `${i++ * 55}ms`;
          w.appendChild(inner);
          frag.appendChild(w);
        });
        child.replaceWith(frag);
      } else if (child.nodeType === Node.ELEMENT_NODE && (child as HTMLElement).classList.contains("grad-text")) {
        // Verlaufstext als Ganzes animieren, sonst reißt der Farbverlauf an jedem Wort ab
        const w = document.createElement("span");
        w.className = "w";
        const el = child as HTMLElement;
        el.style.display = "inline-block";
        el.style.transitionDelay = `${i++ * 55}ms`;
        el.classList.add("w-inner");
        child.replaceWith(w);
        w.appendChild(el);
      } else if (child.nodeType === Node.ELEMENT_NODE && (child as HTMLElement).tagName !== "BR") {
        walk(child);
      }
    });
  };
  walk(el);
  el.classList.add("split");
  onVisible(el, () => requestAnimationFrame(() => el.classList.add("split-in")));
}

/** <span data-count-to="42"> zählt beim Sichtbarwerden hoch. Wert kann später per setCount gesetzt werden. */
export function setCount(el: HTMLElement, to: number) {
  el.dataset.countTo = String(to);
  if (el.dataset.counted) animateCount(el);
}

function animateCount(el: HTMLElement) {
  el.dataset.counted = "1";
  const to = Number(el.dataset.countTo || 0);
  if (reduce() || !to) { el.textContent = String(to); return; }
  const from = Number(el.textContent) || 0;
  const dur = 1100, t0 = performance.now();
  const step = (now: number) => {
    const p = Math.min(1, (now - t0) / dur);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = String(Math.round(from + (to - from) * eased));
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/** Leichte 3D-Neigung zur Maus (nur bei echter Maus). */
function tilt(el: HTMLElement) {
  if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
  const max = Number(el.dataset.tilt || 5);
  el.addEventListener("pointermove", (e) => {
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
    el.style.transform = `perspective(900px) rotateX(${(-y * max).toFixed(2)}deg) rotateY(${(x * max).toFixed(2)}deg) translateY(-3px)`;
  });
  el.addEventListener("pointerleave", () => { el.style.transform = ""; });
}

export function initMotion() {
  if (reduce()) {
    document.querySelectorAll<HTMLElement>("[data-count-to]").forEach((el) => (el.textContent = el.dataset.countTo || "0"));
    return;
  }
  document.querySelectorAll<HTMLElement>("[data-split]").forEach(splitWords);
  document.querySelectorAll<HTMLElement>("[data-count-to]").forEach((el) => onVisible(el, () => animateCount(el)));
  document.querySelectorAll<HTMLElement>("[data-tilt]").forEach(tilt);
  initSpotlight();
}

// Weicher Lichtkegel unter dem Mauszeiger auf Karten (auch für später eingefügte Karten)
const SPOT = ".tile, .person, .quick-card, .vod-card, .app-card, .ann, .form-wrap, .status, .cta-card";
function initSpotlight() {
  if (!window.matchMedia("(hover: hover)").matches) return;
  let frame = 0;
  document.addEventListener("pointermove", (e) => {
    const el = (e.target as Element | null)?.closest?.<HTMLElement>(SPOT);
    if (!el || frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      el.classList.add("spot");
      const r = el.getBoundingClientRect();
      el.style.setProperty("--mx", `${e.clientX - r.left}px`);
      el.style.setProperty("--my", `${e.clientY - r.top}px`);
    });
  }, { passive: true });
}
