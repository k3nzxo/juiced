// Windfeld im Hero: ruhige Strömungslinien, die um den Mauszeiger herum einen weichen Wirbel bilden.
// Jede Linie ist ein glatter Strich mit Verlauf (hinten durchsichtig, vorne kräftig).
// Geschwindigkeit hängt an der echten Zeit, nicht an der Bildrate (60 Hz und 144 Hz sehen gleich aus).

const SEG = 3.2;        // Abstand der gespeicherten Spurpunkte in px
const TL = 44;          // max. Spurpunkte pro Linie (nahe Linien ≈ 140 px, ferne kürzer)
const BASE = 2.1;       // Grundgeschwindigkeit in px pro 1/60 s
const R = 160;          // Wirkradius der Maus

type P = {
  x: number; y: number; vx: number; vy: number; s: number;
  life: number; age: number; dying: boolean; c: number; hot: number; z: number; tl: number;
  px: Float32Array; py: Float32Array; n: number;   // Spur, [0] = ältester Punkt
};

export function initWind(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  let w = 0, h = 0, dpr = 1;
  let parts: P[] = [];
  let t = Math.random() * 100;
  let raf = 0, visible = true, last = 0;
  // geglättete Maus: Position und Bewegung laufen weich nach, dadurch kein Zittern
  const mouse = { x: -9999, y: -9999, sx: -9999, sy: -9999, vx: 0, vy: 0, on: false, k: 0 };
  let rgb: [number, number, number][] = [[220, 85, 18], [17, 17, 17]];

  const toRgb = (c: string): [number, number, number] => {
    ctx.fillStyle = "#000";
    ctx.fillStyle = c;
    const v = String(ctx.fillStyle);
    if (v.startsWith("#")) return [parseInt(v.slice(1, 3), 16), parseInt(v.slice(3, 5), 16), parseInt(v.slice(5, 7), 16)];
    const m = v.match(/\d+/g);
    return m ? [Number(m[0]), Number(m[1]), Number(m[2])] : [220, 85, 18];
  };
  const readColors = () => {
    const cs = getComputedStyle(document.documentElement);
    rgb = [toRgb(cs.getPropertyValue("--accent").trim() || "#dc5512"), toRgb(cs.getPropertyValue("--text").trim() || "#111")];
  };

  const spawn = (p: P, anywhere: boolean) => {
    p.x = anywhere ? Math.random() * w : -20 - Math.random() * 40;
    p.y = Math.random() * h;
    p.vx = 0; p.vy = 0; p.hot = 0; p.age = 0; p.dying = false;
    p.z = Math.pow(Math.random(), 1.25);      // Tiefe: mehr ferne als nahe Linien
    p.s = (0.55 + p.z * 0.9) * (0.9 + Math.random() * 0.2);
    p.tl = Math.round(14 + p.z * (TL - 14));
    p.life = 4 + Math.random() * 6;           // Sekunden
    p.c = Math.random() < 0.92 ? 0 : 1;
    if (!p.px) { p.px = new Float32Array(TL); p.py = new Float32Array(TL); }
    p.px[0] = p.x; p.py[0] = p.y; p.n = 1;
  };

  const resize = () => {
    const r = canvas.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    w = r.width; h = r.height;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const n = Math.min(400, Math.round((w * h) / 2600));
    parts = Array.from({ length: n }, () => { const p = {} as P; spawn(p, true); p.age = 1; return p; });
  };

  // Strömungsfeld: weite, geschwungene Bögen, die sich langsam verschieben
  const angle = (x: number, y: number) =>
    -0.05
    + 0.85 * Math.sin(x / 520 + t * 0.3) * Math.cos(y / 330 - t * 0.22)
    + 0.3 * Math.sin((x - y) / 700 + t * 0.5);

  // Windböen: ein breites Band fegt alle paar Sekunden von links nach rechts
  let gust = -9999, gustNext = 2.5;
  const GUST_W = 280;

  const step = (dt: number) => {
    t += 0.004 * dt;
    gustNext -= dt / 60;
    if (gustNext <= 0 && gust < -1000) { gust = -GUST_W; gustNext = 5 + Math.random() * 4; }
    if (gust > -1000) { gust += 11 * dt; if (gust > w + GUST_W) gust = -9999; }
    // Maus weich nachführen
    const follow = 1 - Math.pow(0.75, dt);
    mouse.sx += (mouse.x - mouse.sx) * follow;
    mouse.sy += (mouse.y - mouse.sy) * follow;
    mouse.k += ((mouse.on ? 1 : 0) - mouse.k) * (1 - Math.pow(0.9, dt));   // Wirbel blendet ein/aus
    const decay = Math.pow(0.86, dt);
    mouse.vx *= decay; mouse.vy *= decay;

    const ease = 1 - Math.pow(1 - 0.16, dt);
    for (const p of parts) {
      p.age += dt / 60;
      if (p.dying) {
        // Spur läuft hinten aus, dann neu starten
        const drop = Math.max(1, Math.round(dt));
        for (let k = 0; k < drop && p.n > 1; k++) { p.px.copyWithin(0, 1, p.n); p.py.copyWithin(0, 1, p.n); p.n--; }
        if (p.n <= 1) spawn(p, Math.random() < 0.6);
        continue;
      }
      const a = angle(p.x, p.y);
      // Böe: Linien im Band werden schneller und leuchten kurz auf
      const gd = gust > -1000 ? (p.x - gust) / GUST_W : 9;
      const g = Math.abs(gd) < 1.5 ? Math.exp(-gd * gd * 2) : 0;
      const boost = 1 + g * 1.4;
      let tx = Math.cos(a) * p.s * BASE * boost, ty = Math.sin(a) * p.s * BASE * boost;
      let wgt = 0;
      if (mouse.k > 0.01) {
        const dx = p.x - mouse.sx, dy = p.y - mouse.sy;
        const d = Math.hypot(dx, dy) || 1;
        wgt = Math.exp(-(d * d) / (R * R)) * mouse.k;     // weicher Abfall, keine harte Kante
        if (wgt > 0.002) {
          // Wirbel: tangential um den Cursor, plus Sog in Mausrichtung
          const swirl = 5.2 * wgt;
          tx = tx * (1 - wgt * 0.7) + (-dy / d) * swirl + mouse.vx * wgt * 0.35;
          ty = ty * (1 - wgt * 0.7) + (dx / d) * swirl + mouse.vy * wgt * 0.35;
        }
      }
      p.vx += (tx - p.vx) * ease;
      p.vy += (ty - p.vy) * ease;
      p.hot += (Math.min(1, wgt * 2.2 + g * 0.7) - p.hot) * (1 - Math.pow(0.88, dt));
      p.x += p.vx * dt; p.y += p.vy * dt;

      // Spur: neuer Punkt erst nach SEG px, der vorderste Punkt folgt immer live
      const li = p.n - 1;
      if (Math.hypot(p.x - p.px[li > 0 ? li - 1 : 0], p.y - p.py[li > 0 ? li - 1 : 0]) >= SEG || p.n === 1) {
        if (p.n < p.tl) p.n++;
        else { p.px.copyWithin(0, 1, p.n); p.py.copyWithin(0, 1, p.n); }
      }
      p.px[p.n - 1] = p.x; p.py[p.n - 1] = p.y;

      p.life -= dt / 60;
      if (p.x > w + 30 || p.y < -60 || p.y > h + 60 || p.x < -120) spawn(p, false);
      else if (p.life <= 0) p.dying = true;
    }

    // Zeichnen
    ctx.clearRect(0, 0, w, h);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const p of parts) {
      if (p.n < 3) continue;
      const [r, g, b] = rgb[p.c];
      const fadeIn = Math.min(1, p.age / 0.6);
      const depth = 0.45 + p.z * 0.55;
      const base = (p.c === 0 ? 0.7 : 0.22) * depth + p.hot * (p.c === 0 ? 0.45 : 0.2);
      const alpha = base * fadeIn;
      if (alpha < 0.01) continue;
      const x0 = p.px[0], y0 = p.py[0], x1 = p.px[p.n - 1], y1 = p.py[p.n - 1];
      const grad = ctx.createLinearGradient(x0, y0, x1, y1);
      grad.addColorStop(0, `rgba(${r},${g},${b},0)`);
      grad.addColorStop(1, `rgba(${r},${g},${b},${alpha.toFixed(3)})`);
      ctx.strokeStyle = grad;
      ctx.lineWidth = 0.7 + p.z * 1.1 + p.hot * 0.5;
      // glatte Kurve durch die Mittelpunkte der Spur
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      for (let k = 1; k < p.n - 1; k++) {
        const mx = (p.px[k] + p.px[k + 1]) / 2, my = (p.py[k] + p.py[k + 1]) / 2;
        ctx.quadraticCurveTo(p.px[k], p.py[k], mx, my);
      }
      ctx.lineTo(x1, y1);
      ctx.stroke();
    }
  };

  const loop = (now: number) => {
    raf = 0;
    if (!visible || document.hidden) { last = 0; return; }
    const dt = last ? Math.min(3, (now - last) / (1000 / 60)) : 1;
    last = now;
    step(dt);
    raf = requestAnimationFrame(loop);
  };
  const start = () => { if (!raf) raf = requestAnimationFrame(loop); };

  readColors();
  resize();
  start();

  // Größe neu messen, sobald sich der Hero ändert (auch wenn er beim Start noch 0 groß war)
  let rt = 0, lastW = w, lastH = h;
  new ResizeObserver(([e]) => {
    const { width, height } = e.contentRect;
    if (Math.abs(width - lastW) < 2 && Math.abs(height - lastH) < 2) return;
    lastW = width; lastH = height;
    clearTimeout(rt); rt = window.setTimeout(resize, w ? 150 : 0);
  }).observe(canvas);
  window.addEventListener("themechange", () => requestAnimationFrame(readColors));
  document.addEventListener("visibilitychange", start);
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; start(); }).observe(canvas);

  const host = canvas.parentElement!;
  host.addEventListener("pointermove", (e) => {
    const r = canvas.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    if (mouse.on) {
      // Mausbewegung sanft mitteln
      mouse.vx = mouse.vx * 0.6 + (x - mouse.x) * 0.4;
      mouse.vy = mouse.vy * 0.6 + (y - mouse.y) * 0.4;
    } else { mouse.sx = x; mouse.sy = y; }
    mouse.x = x; mouse.y = y; mouse.on = true;
  }, { passive: true });
  host.addEventListener("pointerleave", () => { mouse.on = false; });
}
