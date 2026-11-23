// Sons et confettis de l'écran du bureau, sans bibliothèque. Le son demande Chromium lancé avec
// --autoplay-policy=no-user-gesture-required (guide d'installation) ; sinon il reste muet, sans erreur.

let audio: AudioContext | null = null;
function ctx(): AudioContext | null {
  try {
    audio ??= new AudioContext();
    if (audio.state === "suspended") void audio.resume();
    return audio;
  } catch {
    return null;
  }
}

function notes(freqs: number[], step: number, volume: number) {
  const a = ctx();
  if (!a) return;
  const start = a.currentTime + 0.02;
  freqs.forEach((f, i) => {
    const osc = a.createOscillator();
    const gain = a.createGain();
    osc.type = "triangle";
    osc.frequency.value = f;
    const t0 = start + i * step;
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(volume, t0 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + step * 2.5);
    osc.connect(gain).connect(a.destination);
    osc.start(t0);
    osc.stop(t0 + step * 3);
  });
}

// Nouvelle commande : deux notes douces.
export const chimeOrder = () => notes([880, 1318.5], 0.12, 0.12);
// Palier, objectif ou record : petite fanfare.
export const chimeParty = () => notes([523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5], 0.14, 0.18);

// Suite pseudo-aléatoire pour les confettis (purement décorative) : hachage sinus d'un compteur, sans source
// aléatoire (les analyses de sécurité signalent toute source aléatoire, même pour une animation).
let tick = Date.now() % 10_000;
const random = () => {
  const x = Math.sin(++tick * 12.9898) * 43758.5453;
  return x - Math.floor(x);
};

const COLORS = ["#10b981", "#facc15", "#f97316", "#38bdf8", "#f472b6", "#ffffff"];

// Pluie de confettis sur un canvas plein écran, pendant `ms` millisecondes.
export function confetti(canvas: HTMLCanvasElement, ms = 5000): () => void {
  const c = canvas.getContext("2d");
  if (!c) return () => {};
  const w = (canvas.width = window.innerWidth);
  const h = (canvas.height = window.innerHeight);
  const parts = Array.from({ length: 220 }, () => ({
    x: random() * w,
    y: -random() * h * 0.6,
    vx: (random() - 0.5) * 3,
    vy: 2 + random() * 4,
    r: 6 + random() * 8,
    a: random() * Math.PI,
    va: (random() - 0.5) * 0.2,
    color: COLORS[Math.floor(random() * COLORS.length)],
  }));
  const end = performance.now() + ms;
  let frame = 0;
  const draw = (now: number) => {
    c.clearRect(0, 0, w, h);
    for (const p of parts) {
      p.x += p.vx;
      p.y += p.vy;
      p.a += p.va;
      if (p.y > h && now < end - 1500) p.y = -20;
      c.save();
      c.translate(p.x, p.y);
      c.rotate(p.a);
      c.fillStyle = p.color;
      c.fillRect(-p.r / 2, -p.r / 4, p.r, p.r / 2);
      c.restore();
    }
    if (now < end) frame = requestAnimationFrame(draw);
    else c.clearRect(0, 0, w, h);
  };
  frame = requestAnimationFrame(draw);
  return () => {
    cancelAnimationFrame(frame);
    c.clearRect(0, 0, w, h);
  };
}
