// Motif de remplacement (classes pat-0 à pat-5 de globals.css) choisi d'après un nom : toujours le même pour un plat ou un restaurant.
export function patternClass(key: string): string {
  let h = 0;
  for (const c of key) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `pat-${h % 6}`;
}

// Initiales courtes pour un restaurant sans logo : « Chez Tante Ama » → « CTA ».
export function initials(name: string): string {
  const words = name.split(/[\s'’-]+/).filter((w) => w.length > 1 || /[A-Z0-9]/.test(w));
  return (words.length > 1 ? words.slice(0, 3).map((w) => w[0]) : [name.slice(0, 2)]).join("").toUpperCase();
}
