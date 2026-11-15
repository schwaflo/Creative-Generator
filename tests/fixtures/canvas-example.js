'use strict';
/* Canvas-Generator (ältere KI-Generatoren laufen weiter als Canvas-Code) – Testdaten für Sandbox und Prüfung */
window.CANVAS_EXAMPLE = `const params = [
  { id: "blades", label: "Halme", type: "range", min: 20, max: 600, step: 1, default: 260, group: "Form" },
  { id: "height", label: "Höhe", type: "range", min: 0.1, max: 0.9, step: 0.01, default: 0.55, group: "Form" },
  { id: "width", label: "Stärke", type: "range", min: 0.5, max: 6, step: 0.1, default: 1.6, group: "Form" },
  { id: "layers", label: "Ebenen", type: "range", min: 1, max: 5, step: 1, default: 3, group: "Struktur" },
  { id: "curl", label: "Krümmung", type: "range", min: 0, max: 2, step: 0.01, default: 0.8, group: "Struktur" },
  { id: "glow", label: "Licht", type: "toggle", default: true, group: "Struktur" },
  { id: "sway", label: "Schwingen", type: "range", min: 0, max: 1, step: 0.01, default: 0.45, group: "Bewegung" },
  { id: "flow", label: "Strömung", type: "range", min: 0, max: 3, step: 0.01, default: 1.2, group: "Bewegung" },
  { id: "bg", label: "Hintergrund", type: "color", default: "#0b1a22" },
  { id: "body", label: "Halme", type: "color", default: "#3fa37a" },
  { id: "light", label: "Licht", type: "color", default: "#f4e9c8" },
  { id: "seed", label: "Seed", type: "seed", default: 7 }
];

let blades = [];
function setup(ctx, p, rng) {
  blades = [];
  for (let i = 0; i < p.blades; i++) {
    blades.push({ x: rng(), layer: Math.floor(rng() * p.layers), h: 0.6 + rng() * 0.4, off: rng() * 100, lean: rng() - 0.5 });
  }
  blades.sort((a, b) => a.layer - b.layer);              // back to front
}

function draw(ctx, p, t, rng) {
  const W = ctx.canvas.width, H = ctx.canvas.height, S = Math.min(W, H);
  ctx.fillStyle = p.bg;
  ctx.fillRect(0, 0, W, H);
  if (p.glow) {                                          // soft light source for depth
    const g = ctx.createRadialGradient(W * 0.7, H * 0.25, 0, W * 0.7, H * 0.25, S * 0.9);
    g.addColorStop(0, rgba(p.light, 0.35));
    g.addColorStop(1, rgba(p.light, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  ctx.lineCap = "round";
  for (const b of blades) {
    const depth = (b.layer + 1) / p.layers;               // 0..1, front = 1
    const baseX = b.x * W, baseY = H * (0.85 + 0.15 * depth);
    const len = S * p.height * b.h * (0.6 + 0.4 * depth);
    const pts = [];
    for (let k = 0; k <= 10; k++) {
      const u = k / 10;
      const n = loopNoise(b.off + u * p.curl, depth * 3, t, p.flow * 0.3, b.off);   // seamless motion
      const bend = (b.lean * p.curl + n * p.sway) * u * u;                          // stronger toward the tip
      pts.push([baseX + bend * len, baseY - u * len]);
    }
    ctx.strokeStyle = mix(p.body, p.bg, 0.6 * (1 - depth));                        // far = misty
    ctx.globalAlpha = 0.55 + 0.45 * depth;
    ctx.lineWidth = S * 0.001 * p.width * (0.5 + depth);
    ctx.beginPath();
    smoothPath(ctx, pts);
    ctx.stroke();
    if (p.glow) {                                         // highlight at the tip
      const tip = pts[pts.length - 1];
      ctx.fillStyle = rgba(p.light, 0.5 * depth);
      ctx.beginPath();
      ctx.arc(tip[0], tip[1], ctx.lineWidth * 0.8, 0, TAU);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}`;
