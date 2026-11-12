// Calculs de l'écran « Naviguer » : où en est le livreur sur le tracé, quelle est la prochaine manœuvre, à quelle
// distance, et comment la dire. Sans dépendance au navigateur : testable seul.

export type LatLng = { latitude: number; longitude: number };

export type RouteStep = {
  type: string;
  modifier: string | null;
  name: string;
  exit: number | null;
  latitude: number;
  longitude: number;
  distanceM: number;
};

export type Route = { distanceM: number; durationS: number; line: [number, number][]; steps: RouteStep[] };

export type PreparedRoute = Route & {
  // Distance cumulée depuis le départ, pour chaque point du tracé.
  cum: number[];
  // Distance depuis le départ de chaque manœuvre.
  stepAt: number[];
};

const R = 6371000;
const rad = (d: number) => (d * Math.PI) / 180;

export function metersBetween(a: LatLng, b: LatLng) {
  const h = Math.sin(rad(b.latitude - a.latitude) / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(rad(b.longitude - a.longitude) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Cap de a vers b, en degrés (0 = nord, 90 = est).
export function bearing(a: LatLng, b: LatLng) {
  const y = Math.sin(rad(b.longitude - a.longitude)) * Math.cos(rad(b.latitude));
  const x = Math.cos(rad(a.latitude)) * Math.sin(rad(b.latitude)) - Math.sin(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.cos(rad(b.longitude - a.longitude));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

// Projection du point p sur le segment [a, b] (plan local, assez précis à l'échelle d'une rue).
function project(p: LatLng, a: [number, number], b: [number, number]) {
  const k = Math.cos(rad(p.latitude));
  const ax = a[1] * k, ay = a[0], bx = b[1] * k, by = b[0], px = p.longitude * k, py = p.latitude;
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  const at = { latitude: ay + t * dy, longitude: (ax + t * dx) / k };
  return { t, at, dist: metersBetween(p, at) };
}

export function prepareRoute(route: Route): PreparedRoute {
  const cum = [0];
  for (let i = 1; i < route.line.length; i++) {
    const [a, b] = [route.line[i - 1], route.line[i]];
    cum.push(cum[i - 1] + metersBetween({ latitude: a[0], longitude: a[1] }, { latitude: b[0], longitude: b[1] }));
  }
  // Chaque manœuvre tombe sur un point du tracé : le plus proche, sans revenir en arrière.
  let from = 0;
  const stepAt = route.steps.map((s) => {
    let best = from;
    let bestD = Infinity;
    for (let i = from; i < route.line.length; i++) {
      const d = metersBetween(s, { latitude: route.line[i][0], longitude: route.line[i][1] });
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    from = best;
    return cum[best] ?? 0;
  });
  return { ...route, cum, stepAt };
}

export type Progress = {
  // Distance entre le livreur et le tracé : au-delà de quelques dizaines de mètres, il a quitté l'itinéraire.
  offRouteM: number;
  doneM: number;
  remainingM: number;
  remainingS: number;
  // Index dans steps de la prochaine manœuvre (null : plus que l'arrivée en ligne droite).
  next: number | null;
  toNextM: number;
  // Point du tracé le plus proche du livreur.
  snapped: LatLng;
};

export function progress(route: PreparedRoute, p: LatLng): Progress {
  const { line, cum } = route;
  let best = { dist: Infinity, along: 0, at: { latitude: line[0]?.[0] ?? p.latitude, longitude: line[0]?.[1] ?? p.longitude } };
  for (let i = 1; i < line.length; i++) {
    const pr = project(p, line[i - 1], line[i]);
    if (pr.dist < best.dist) best = { dist: pr.dist, along: cum[i - 1] + pr.t * (cum[i] - cum[i - 1]), at: pr.at };
  }
  if (line.length === 1) best.dist = metersBetween(p, best.at);
  const total = cum[cum.length - 1] ?? 0;
  const remainingM = Math.max(0, total - best.along);
  // Prochaine manœuvre devant le livreur (le départ ne compte pas ; 5 m de marge pour celle qu'il est en train de passer).
  let next: number | null = null;
  for (let i = 0; i < route.steps.length; i++) {
    if (route.steps[i].type === "depart") continue;
    if (route.stepAt[i] > best.along + 5) {
      next = i;
      break;
    }
  }
  const toNextM = next === null ? remainingM : Math.max(0, route.stepAt[next] - best.along);
  const remainingS = route.distanceM > 0 ? (route.durationS * remainingM) / route.distanceM : remainingM / 5;
  return { offRouteM: best.dist, doneM: best.along, remainingM, remainingS, next, toNextM, snapped: best.at };
}

type T = (key: string, vars?: Record<string, string | number>) => string;

// Phrase de la manœuvre, à afficher et à dire : « Tournez à gauche sur Boulevard du 13 Janvier ».
export function instruction(step: RouteStep, t: T): string {
  const m = step.modifier ?? "straight";
  const turn: Record<string, string> = {
    left: t("Tournez à gauche"),
    right: t("Tournez à droite"),
    "slight left": t("Serrez à gauche"),
    "slight right": t("Serrez à droite"),
    "sharp left": t("Tournez franchement à gauche"),
    "sharp right": t("Tournez franchement à droite"),
    straight: t("Continuez tout droit"),
    uturn: t("Faites demi-tour"),
  };
  let text: string;
  switch (step.type) {
    case "arrive":
      return t("Vous êtes arrivé");
    case "depart":
      text = t("Partez");
      break;
    case "roundabout":
    case "rotary":
    case "roundabout turn":
      text = step.exit ? t("Au rond-point, prenez la sortie {n}", { n: step.exit }) : t("Prenez le rond-point");
      break;
    case "exit roundabout":
    case "exit rotary":
      text = t("Sortez du rond-point");
      break;
    case "fork":
      text = m.includes("left") ? t("À l'embranchement, restez à gauche") : m.includes("right") ? t("À l'embranchement, restez à droite") : turn.straight;
      break;
    case "end of road":
      text = m.includes("left") ? t("Au bout de la route, tournez à gauche") : m.includes("right") ? t("Au bout de la route, tournez à droite") : (turn[m] ?? turn.straight);
      break;
    case "new name":
    case "continue":
    case "notification":
      text = m === "straight" ? turn.straight : (turn[m] ?? turn.straight);
      break;
    default:
      text = turn[m] ?? turn.straight;
  }
  return step.name ? `${text} ${t("sur {name}", { name: step.name })}` : text;
}

// Flèche de la manœuvre, en degrés de rotation d'une flèche vers le haut (null : rond-point ou arrivée, dessin propre).
export function arrowAngle(step: RouteStep): number | null {
  if (step.type === "arrive" || step.type.includes("roundabout") || step.type.includes("rotary")) return null;
  const angles: Record<string, number> = { left: -90, right: 90, "slight left": -45, "slight right": 45, "sharp left": -135, "sharp right": 135, straight: 0, uturn: 180 };
  if (step.type === "fork" || step.type === "end of road") {
    const m = step.modifier ?? "";
    return m.includes("left") ? (step.type === "fork" ? -45 : -90) : m.includes("right") ? (step.type === "fork" ? 45 : 90) : 0;
  }
  return angles[step.modifier ?? "straight"] ?? 0;
}

// « 80 m », « 450 m », « 1,2 km » ; la langue anglaise garde le point décimal.
export function fmtDistance(m: number, lang: "fr" | "en" = "fr") {
  if (m < 1000) return `${m < 100 ? Math.max(10, Math.round(m / 10) * 10) : Math.round(m / 50) * 50} m`;
  const km = (m / 1000).toFixed(m < 10_000 ? 1 : 0);
  return `${lang === "fr" ? km.replace(".", ",") : km} km`;
}

// Faut-il recalculer ? Hors du tracé depuis au moins deux positions, et pas plus d'une fois toutes les 15 s.
export const OFF_ROUTE_M = 45;
export const REROUTE_EVERY_MS = 15_000;
export const ARRIVED_M = 35;
