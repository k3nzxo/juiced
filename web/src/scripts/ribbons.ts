// Hero-Animation: vertikale "Saft-Spirale" aus mehreren Farbbändern (Canvas 2D).
// Läuft nur, solange sie sichtbar ist, und respektiert prefers-reduced-motion.

type Strand = { color: [number, number, number]; phase: number; amp: number; speed: number; width: number };

// Farben werden zur Laufzeit aus dem Theme gelesen: Akzent + Grautöne (kein Regenbogen)
function palette(): [number, number, number][] {
  const dark = document.documentElement.dataset.theme === "dark";
  const accent: [number, number, number] = dark ? [238, 106, 36] : [220, 85, 18];
  const g1: [number, number, number] = dark ? [228, 228, 231] : [40, 40, 42];
  const g2: [number, number, number] = dark ? [113, 113, 122] : [150, 147, 144];
  return [accent, g1, g2, accent, g2, g1];
}

export function initRibbons(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const strands: Strand[] = palette().map((color, i) => ({
    color,
    phase: (i / 6) * Math.PI * 2,
    amp: 0.78 + (i % 3) * 0.09,
    speed: 0.55 + (i % 2) * 0.12,
    width: 2.6 + (i % 3) * 0.6,
  }));

  let w = 0, h = 0, dpr = 1, raf = 0, running = false, t = 0, last = 0;

  const resize = () => {
    const r = canvas.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = r.width; h = r.height;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  const draw = () => {
    const dark = document.documentElement.dataset.theme === "dark";
    const cols = palette();
    strands.forEach((st, i) => (st.color = cols[i]));
    ctx.clearRect(0, 0, w, h);
    ctx.globalCompositeOperation = "source-over";
    const cx = w / 2;
    const maxA = Math.min(w * 0.42, 210);
    const step = 3;
    const k = (Math.PI * 2 * 2.4) / h; // ~2,4 Windungen über die Höhe

    for (const s of strands) {
      // erst die hinteren Segmente, dann die vorderen -> Tiefenwirkung
      for (let pass = 0; pass < 2; pass++) {
        for (let y = 0; y < h; y += step) {
          const env = Math.sin((y / h) * Math.PI) ** 0.85; // oben/unten schmal
          const a1 = k * y + t * s.speed + s.phase;
          const a2 = k * (y + step) + t * s.speed + s.phase;
          const depth = Math.cos(a1); // -1 hinten, 1 vorne
          if ((pass === 0) !== (depth < 0)) continue;
          const x1 = cx + Math.sin(a1) * maxA * s.amp * env;
          const x2 = cx + Math.sin(a2) * maxA * s.amp * env;
          const alpha = (0.18 + 0.62 * ((depth + 1) / 2)) * env;
          const [r, g, b] = s.color;
          ctx.strokeStyle = `rgba(${r},${g},${b},${dark ? alpha * 0.85 : alpha})`;
          ctx.lineWidth = s.width * (0.55 + 0.6 * ((depth + 1) / 2));
          ctx.lineCap = "round";
          ctx.beginPath();
          ctx.moveTo(x1, y);
          ctx.lineTo(x2, y + step);
          ctx.stroke();
        }
      }
    }
    // feine Querstriche ("Signale") für Struktur
    ctx.globalCompositeOperation = "source-over";
    for (let i = 0; i < 9; i++) {
      const y = ((i + 0.5) / 9) * h;
      const env = Math.sin((y / h) * Math.PI);
      const len = maxA * 1.1 * env;
      const pulse = (Math.sin(t * 0.9 + i * 1.3) + 1) / 2;
      ctx.strokeStyle = dark ? `rgba(255,255,255,${0.05 + pulse * 0.07})` : `rgba(23,20,15,${0.04 + pulse * 0.05})`;
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 6]);
      ctx.beginPath();
      ctx.moveTo(cx - len, y);
      ctx.lineTo(cx + len, y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  };

  const frame = (now: number) => {
    const dt = last ? Math.min((now - last) / 1000, 0.05) : 0;
    last = now;
    t += dt;
    draw();
    if (running) raf = requestAnimationFrame(frame);
  };

  const start = () => { if (running || reduce) return; running = true; last = 0; raf = requestAnimationFrame(frame); };
  const stop = () => { running = false; cancelAnimationFrame(raf); };

  resize();
  t = 1.2;
  draw();
  new ResizeObserver(() => { resize(); draw(); }).observe(canvas);
  new IntersectionObserver(([e]) => (e.isIntersecting ? start() : stop())).observe(canvas);
  document.addEventListener("visibilitychange", () => (document.hidden ? stop() : start()));
  window.addEventListener("themechange", () => { if (!running) draw(); });
}
