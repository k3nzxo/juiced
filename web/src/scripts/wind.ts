// Windfeld im Hero: feine Strömungslinien, die der Maus ausweichen und um sie herum wirbeln.
// Jede Linie merkt sich ihre letzten Punkte (Ringpuffer); gezeichnet wird jedes Bild komplett neu, dadurch bleibt kein Schleier zurück.
const TL = 30;
type P = { x: number; y: number; vx: number; vy: number; s: number; life: number; c: number; hot: number;
  tx: Float32Array; ty: Float32Array; head: number; n: number; dying: boolean };

export function initWind(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  // "Weniger Bewegung" im System: Wind läuft trotzdem, nur ruhiger
  const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0.55 : 1;
  let w = 0, h = 0, dpr = 1;
  let parts: P[] = [];
  let t = Math.random() * 100;
  let raf = 0, visible = true;
  const mouse = { x: -9999, y: -9999, vx: 0, vy: 0, on: false };
  let colors = ["#dc5512", "#111"];

  const readColors = () => {
    const cs = getComputedStyle(document.documentElement);
    colors = [cs.getPropertyValue("--accent").trim() || "#dc5512", cs.getPropertyValue("--text").trim() || "#111"];
    ctx.clearRect(0, 0, w, h);
  };

  const spawn = (p: P, anywhere: boolean) => {
    p.x = anywhere ? Math.random() * w : -10 - Math.random() * 60;
    p.y = Math.random() * h;
    p.vx = 0; p.vy = 0; p.hot = 0; p.dying = false;
    if (!p.tx) { p.tx = new Float32Array(TL); p.ty = new Float32Array(TL); }
    p.head = 0; p.n = 1; p.tx[0] = p.x; p.ty[0] = p.y;
    p.s = 0.7 + Math.random() * 1.5;
    p.life = 160 + Math.random() * 360;
    p.c = Math.random() < 0.93 ? 0 : 1;
  };

  const resize = () => {
    const r = canvas.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    w = r.width; h = r.height;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const n = Math.min(320, Math.round((w * h) / 3500));
    parts = Array.from({ length: n }, () => { const p = {} as P; spawn(p, true); return p; });
  };

  // Weiches Strömungsfeld aus überlagerten Wellen (reicht völlig, kein Noise-Paket nötig)
  const angle = (x: number, y: number) => {
    const nx = x / 520, ny = y / 380;
    return -0.12
      + 0.9 * Math.sin(nx * 1.7 + t * 0.35) * Math.cos(ny * 2.1 - t * 0.27)
      + 0.45 * Math.sin((nx + ny) * 3.1 + t * 0.6);
  };

  const R = 220;  // Wirkradius der Maus

  const step = () => {
    t += 0.004;
    ctx.clearRect(0, 0, w, h);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    // Bewegen: jede Linie hat Schwung und gleitet zurück in die Windrichtung
    const mspeed = Math.min(40, Math.hypot(mouse.vx, mouse.vy));
    for (const p of parts) {
      if (p.dying) {
        // Spur läuft aus statt plötzlich zu verschwinden
        if (--p.n <= 1) spawn(p, true);
        continue;
      }
      const a = angle(p.x, p.y);
      const tx = Math.cos(a) * p.s * 1.6 * calm, ty = Math.sin(a) * p.s * 1.6 * calm;
      p.vx += (tx - p.vx) * 0.06;
      p.vy += (ty - p.vy) * 0.06;
      p.hot *= 0.94;
      if (mouse.on) {
        const dx = p.x - mouse.x, dy = p.y - mouse.y, d2 = dx * dx + dy * dy;
        if (d2 < R * R) {
          const d = Math.sqrt(d2) || 1, f = 1 - d / R, f2 = f * f;
          // Wirbel um den Cursor + leicht wegdrücken + Windstoß in Mausrichtung
          p.vx += (-dy / d) * f2 * 0.8 + (dx / d) * f2 * 0.22 + mouse.vx * f * 0.06;
          p.vy += (dx / d) * f2 * 0.8 + (dy / d) * f2 * 0.22 + mouse.vy * f * 0.06;
          p.hot = Math.max(p.hot, f * (0.6 + mspeed / 40));
        }
      }
      const sp = Math.hypot(p.vx, p.vy);
      if (sp > 7) { p.vx *= 7 / sp; p.vy *= 7 / sp; }
      p.x += p.vx; p.y += p.vy;
      if (p.x > w + 20 || p.x < -80 || p.y < -40 || p.y > h + 40) { spawn(p, false); continue; }
      p.head = (p.head + 1) % TL;
      p.tx[p.head] = p.x; p.ty[p.head] = p.y;
      if (p.n < TL) p.n++;
      if (--p.life < 0) p.dying = true;
    }

    // Zeichnen: Spur von hell (vorne) nach durchsichtig (hinten); normal, neutral, "heiß" nah an der Maus
    const pass = (c: number, hot: boolean, alpha: number, width: number) => {
      ctx.strokeStyle = colors[c];
      ctx.lineWidth = width;
      for (let k = 0; k < TL - 1; k++) {
        ctx.globalAlpha = alpha * (1 - k / (TL - 1));
        ctx.beginPath();
        for (const p of parts) {
          if (p.c !== c || (p.hot > 0.15) !== hot || k + 1 >= p.n) continue;
          const i0 = (p.head - k + TL) % TL, i1 = (p.head - k - 1 + TL) % TL;
          ctx.moveTo(p.tx[i0], p.ty[i0]);
          ctx.lineTo(p.tx[i1], p.ty[i1]);
        }
        ctx.stroke();
      }
    };
    pass(1, false, 0.3, 1.35);
    pass(0, false, 0.75, 1.35);
    pass(1, true, 0.55, 1.8);
    pass(0, true, 1, 2.2);
    ctx.globalAlpha = 1;
    mouse.vx *= 0.8; mouse.vy *= 0.8;
  };

  const loop = () => {
    raf = 0;
    if (!visible || document.hidden) return;
    step();
    raf = requestAnimationFrame(loop);
  };
  const start = () => { if (!raf) raf = requestAnimationFrame(loop); };

  // Ohne Animation (reduzierte Bewegung): einmal ein stehendes Bild zeichnen
  const still = () => { /* Bild baut sich über die Animation auf */ };
  readColors();
  resize();
  still();
  start();

  // Größe neu messen, sobald sich der Hero ändert (auch wenn er beim Start noch 0 groß war)
  let rt = 0, lastW = w, lastH = h;
  new ResizeObserver(([e]) => {
    const { width, height } = e.contentRect;
    if (Math.abs(width - lastW) < 2 && Math.abs(height - lastH) < 2) return;
    lastW = width; lastH = height;
    clearTimeout(rt); rt = window.setTimeout(() => { resize(); still(); }, w ? 150 : 0);
  }).observe(canvas);
  window.addEventListener("themechange", () => requestAnimationFrame(() => { readColors(); still(); }));
  document.addEventListener("visibilitychange", start);
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; start(); }).observe(canvas);

  const host = canvas.parentElement!;
  host.addEventListener("pointermove", (e) => {
    const r = canvas.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    if (mouse.on) { mouse.vx += x - mouse.x; mouse.vy += y - mouse.y; }
    mouse.x = x; mouse.y = y; mouse.on = true;
  }, { passive: true });
  host.addEventListener("pointerleave", () => { mouse.on = false; });
}
