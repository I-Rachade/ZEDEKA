// Logo ZEDEKA : le « Z » flèche avec ses trois traits de vitesse, dans le carré vert, puis le nom « zedeka. ».
// Redessiné en SVG d'après le logo fourni (moins de 1 ko, net à toutes les tailles, animable).

export const BRAND = { green: "#0E7C4A", sun: "#FFB020", ink: "#0E2A1E" };

export const Z_PATH = "M96 79H234V107L152 214H210V187L262 229L210 271V245H92V241L183 111H96Z";
export const SPEED_LINES = [
  { x: 28, y: 105, w: 53, fill: "#FFB020" },
  { x: 11, y: 143, w: 70, fill: "#DBA826" },
  { x: 35, y: 183, w: 47, fill: "#B7A12C" },
];

function Glyph({ animate }: { animate?: boolean }) {
  return (
    <>
      {SPEED_LINES.map((l, i) => (
        <rect
          key={i}
          x={l.x}
          y={l.y}
          width={l.w}
          height="13"
          rx="6.5"
          fill={l.fill}
          className={animate ? "anim-speed" : undefined}
          style={animate ? { animationDelay: `${[0.25, 0.15, 0.35][i]}s` } : undefined}
        />
      ))}
      <path d={Z_PATH} fill="#fff" className={animate ? "anim-zin" : undefined} />
    </>
  );
}

export function LogoMark({ className = "h-8 w-8", animate }: { className?: string; animate?: boolean }) {
  return (
    <svg viewBox="0 0 305 307" className={`shrink-0 ${className}`} aria-hidden="true">
      <rect width="305" height="307" rx="70" fill={BRAND.green} />
      <Glyph animate={animate} />
    </svg>
  );
}

// Marque complète. « tone » : texte foncé sur fond clair, ou blanc sur fond vert/sombre.
export default function Logo({ size = "md", tone = "dark", tagline, animate }: { size?: "sm" | "md" | "lg"; tone?: "dark" | "light"; tagline?: boolean; animate?: boolean }) {
  const mark = { sm: "h-7 w-7", md: "h-9 w-9", lg: "h-20 w-20" }[size];
  const word = { sm: "text-lg", md: "text-2xl", lg: "text-5xl" }[size];
  return (
    <span className="inline-flex items-center gap-2.5" aria-label="Zedeka">
      <LogoMark className={mark} animate={animate} />
      <span className={animate ? "anim-fade-up [animation-delay:.5s]" : undefined}>
        <span className={`font-display block font-extrabold leading-none tracking-tight ${word} ${tone === "dark" ? "text-ink" : "text-white"}`}>
          zedeka<span className="text-sun">.</span>
        </span>
        {tagline && <span className={`font-display mt-1 block text-sm font-semibold ${tone === "dark" ? "text-brand" : "text-white/85"}`}>Commandé, livré. En un clic.</span>}
      </span>
    </span>
  );
}
