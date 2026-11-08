// Windfeld im Hero: feine Strömungslinien, die der Maus ausweichen und um sie herum wirbeln.
type P = { x: number; y: number; px: number; py: number; s: number; life: number; c: number };

export function initWind(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
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
    p.px = p.x; p.py = p.y;
    p.s = 0.7 + Math.random() * 1.5;
    p.life = 160 + Math.random() * 360;
    p.c = Math.random() < 0.8 ? 0 : 1;
  };

  const resize = () => {
    const r = canvas.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    w = r.width; h = r.height;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const n = Math.min(900, Math.round((w * h) / 1500));
    parts = Array.from({ length: n }, () => { const p = {} as P; spawn(p, true); return p; });
  };

  // Weiches Strömungsfeld aus überlagerten Wellen (reicht völlig, kein Noise-Paket nötig)
  const angle = (x: number, y: number) => {
    const nx = x / 520, ny = y / 380;
    return -0.12
      + 0.9 * Math.sin(nx * 1.7 + t * 0.35) * Math.cos(ny * 2.1 - t * 0.27)
      + 0.45 * Math.sin((nx + ny) * 3.1 + t * 0.6);
  };

  const step = () => {
    t += 0.004;
    // Spuren langsam ausblenden (funktioniert auf transparentem Canvas, egal welches Theme)
    ctx.globalCompositeOperation = "destination-out";
    ctx.fillStyle = "rgba(0,0,0,0.055)";
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = "source-over";
    ctx.lineWidth = 1.35;
    ctx.lineCap = "round";

    for (let c = 0; c < 2; c++) {
      ctx.strokeStyle = colors[c];
      ctx.globalAlpha = c === 0 ? 0.7 : 0.25;
      ctx.beginPath();
      for (const p of parts) {
        if (p.c !== c) continue;
        const a = angle(p.x, p.y);
        let vx = Math.cos(a) * p.s * 1.6, vy = Math.sin(a) * p.s * 1.6;
        if (mouse.on) {
          const dx = p.x - mouse.x, dy = p.y - mouse.y, d2 = dx * dx + dy * dy;
          if (d2 < 170 * 170) {
            const d = Math.sqrt(d2) || 1, f = (1 - d / 170) ** 2;
            // wegdrücken + verwirbeln + Mausbewegung mitnehmen
            vx += (dx / d) * f * 4 + (-dy / d) * f * 5 + mouse.vx * f * 0.6;
            vy += (dy / d) * f * 4 + (dx / d) * f * 5 + mouse.vy * f * 0.6;
          }
        }
        p.px = p.x; p.py = p.y;
        p.x += vx; p.y += vy;
        if (--p.life < 0 || p.x > w + 20 || p.x < -80 || p.y < -20 || p.y > h + 20) { spawn(p, p.life < 0); continue; }
        ctx.moveTo(p.px, p.py);
        ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    mouse.vx *= 0.85; mouse.vy *= 0.85;
  };

  const loop = () => {
    raf = 0;
    if (!visible || document.hidden) return;
    step();
    raf = requestAnimationFrame(loop);
  };
  const start = () => { if (!raf && !reduce) raf = requestAnimationFrame(loop); };

  // Ohne Animation (reduzierte Bewegung): einmal ein stehendes Bild zeichnen
  const still = () => { if (reduce && w) for (let i = 0; i < 90; i++) step(); };
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
  if (reduce) return;
  document.addEventListener("visibilitychange", start);
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; start(); }).observe(canvas);

  const host = canvas.parentElement!;
  host.addEventListener("pointermove", (e) => {
    const r = canvas.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    if (mouse.on) { mouse.vx = x - mouse.x; mouse.vy = y - mouse.y; }
    mouse.x = x; mouse.y = y; mouse.on = true;
  }, { passive: true });
  host.addEventListener("pointerleave", () => { mouse.on = false; });
}
