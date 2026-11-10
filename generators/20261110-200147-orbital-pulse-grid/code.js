const params = [
  { id: "rings", label: "Ringanzahl", type: "range", min: 2, max: 12, step: 1, default: 8, group: "Form" },
  { id: "dots", label: "Punktgitter", type: "range", min: 5, max: 20, step: 1, default: 12, group: "Struktur" },
  { id: "dotSize", label: "Punktgröße", type: "range", min: 0.001, max: 0.02, step: 0.001, default: 0.008, group: "Form" },
  { id: "lineWidth", label: "Linienstärke", type: "range", min: 0.5, max: 8, step: 0.1, default: 2, group: "Form" },
  { id: "diagonalCount", label: "Diagonalen", type: "range", min: 1, max: 10, step: 1, default: 5, group: "Struktur" },
  { id: "rotationSpeed", label: "Rotationsgeschwindigkeit", type: "range", min: 0, max: 5, step: 0.1, default: 1.2, group: "Bewegung" },
  { id: "pulseAmount", label: "Pulsationsstärke", type: "range", min: 0, max: 1, step: 0.01, default: 0.5, group: "Bewegung" },
  { id: "shiftAmount", label: "Linienverschiebung", type: "range", min: 0, max: 1, step: 0.01, default: 0.3, group: "Bewegung" },
  { id: "bg", label: "Hintergrund", type: "color", default: "#050a24" },
  { id: "primary", label: "Primärfarbe", type: "color", default: "#ff9900" },
  { id: "secondary", label: "Sekundärfarbe", type: "color", default: "#e63946" },
  { id: "highlight", label: "Akzentfarbe", type: "color", default: "#f1faee" },
  { id: "seed", label: "Seed", type: "seed", default: 42 }
];

let gridData = [];

function setup(ctx, p, rng) {
  gridData = [];
  for (let i = 0; i < p.dots; i++) {
    for (let j = 0; j < p.dots; j++) {
      gridData.push({
        x: (i / (p.dots - 1)) * 1.5 - 0.25,
        y: (j / (p.dots - 1)) * 1.5 - 0.25,
        phase: rng() * Math.PI * 2
      });
    }
  }
}

function draw(ctx, p, t, rng) {
  const W = ctx.canvas.width, H = ctx.canvas.height, S = Math.min(W, H);
  const a = 2 * Math.PI * t;

  ctx.fillStyle = p.bg;
  ctx.fillRect(0, 0, W, H);

  ctx.save();
  ctx.translate(W / 2, H / 2);

  // 1. Diagonal Lines
  ctx.strokeStyle = p.secondary;
  ctx.lineWidth = p.lineWidth * (S / 1000);
  ctx.globalAlpha = 0.4;
  for (let i = 0; i < p.diagonalCount; i++) {
    const angle = (i / p.diagonalCount) * Math.PI * 2 + (t * 0.2);
    ctx.beginPath();
    ctx.moveTo(-S, -S * Math.tan(angle));
    ctx.lineTo(S, S * Math.tan(angle));
    ctx.stroke();
  }
  ctx.globalAlpha = 1.0;

  // 2. Concentric Rings
  for (let i = 1; i <= p.rings; i++) {
    const radius = (S * 0.3) * (i / p.rings) * (0.8 + (i % 2) * 0.2);
    const rotation = (i * 0.5) + (t * p.rotationSpeed * (i % 3 + 1));
    
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.strokeStyle = i % 2 === 0 ? p.primary : p.highlight;
    ctx.lineWidth = p.lineWidth * (S / 1000) * (1 - (i / p.rings));
    ctx.stroke();
    
    // Orbital arcs
    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.8, rotation, rotation + Math.PI * 0.5);
    ctx.strokeStyle = p.secondary;
    ctx.lineWidth = 1 * (S / 1000);
    ctx.stroke();
  }

  // 3. Grid of dots (Halftone style)
  ctx.fillStyle = p.highlight;
  gridData.forEach((dot, idx) => {
    // Only show dots on the right side to create asymmetrical balance
    if (dot.x > 0.2) {
      const pulse = Math.sin(a * 2 + dot.phase) * p.pulseAmount;
      const size = (S * p.dotSize) * (1 + pulse * 0.5);
      const x = dot.x * S * 0.8 + (p.shiftAmount * S * 0.1 * Math.sin(a));
      const y = dot.y * S * 0.8;
      
      ctx.beginPath();
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.fill();
    }
  });

  // 4. Central Radial Accents
  ctx.strokeStyle = p.primary;
  ctx.lineWidth = p.lineWidth * (S / 1000);
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2 + (t * 0.1);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(angle) * S * 0.4, Math.sin(angle) * S * 0.4);
    ctx.stroke();
  }

  ctx.restore();
}
