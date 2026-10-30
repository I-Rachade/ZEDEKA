// i18n-ignore-file : balisage SVG technique.
import { BRAND, SPEED_LINES, Z_PATH } from "@/components/logoShapes";

export { BRAND };

// Glyphe du logo (traits de vitesse + Z) en SVG, pour les icônes générées par ImageResponse.
export function appIconDataUri(): string {
  const lines = SPEED_LINES.map((l) => `<rect x="${l.x}" y="${l.y}" width="${l.w}" height="13" rx="6.5" fill="${l.fill}"/>`).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-13.5 25 300 300">${lines}<path d="${Z_PATH}" fill="#fff"/></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}
