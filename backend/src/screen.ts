import { createHash, randomBytes, randomInt } from "node:crypto";

// Écran du bureau : un grand moniteur (télé, PC, tablette ou Raspberry Pi, tout appareil avec un navigateur) qui montre l'activité du jour à toute l'équipe.
// Accès en lecture seule par une clé propre à chaque écran, créée par le directeur dans l'admin (Écran du bureau).
// Rien de personnel n'en sort : ni téléphone, ni adresse, ni nom de client, ni montant ; les livreurs y figurent par
// leur prénom et l'initiale du nom.
//
// Lomé est à l'heure UTC : une journée va de minuit à minuit UTC.

export const newScreenKey = () => randomBytes(24).toString("base64url");
export const hashScreenKey = (key: string) => createHash("sha256").update(`zedeka-screen:${key}`).digest("hex");
// Une clé a une forme fixe : 32 caractères base64url. Le reste est refusé sans lecture de la base.
export const isScreenKey = (key: string) => key.length === 32 && /^[A-Za-z0-9_-]+$/.test(key);

// Appairage : l'écran affiche un code à 6 chiffres, valable 15 minutes, que le directeur tape dans l'admin. L'écran
// attend sa clé avec un jeton d'appairage (32 caractères), connu de lui seul ; seule l'empreinte du jeton est gardée.
export const PAIRING_TTL_MS = 15 * 60_000;
export const newPairingCode = () => String(randomInt(0, 1_000_000)).padStart(6, "0");
export const isPairingCode = (code: string) => /^\d{6}$/.test(code);
export const newPairingToken = () => randomBytes(24).toString("base64url");
export const hashPairingToken = (token: string) => createHash("sha256").update(`zedeka-screen-pair:${token}`).digest("hex");

const DAY = 86_400_000;
export const dayStart = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const dayKey = (d: Date) => d.toISOString().slice(0, 10);

// « Kossi Mensah » → « Kossi M. » : assez pour se reconnaître sur l'écran, sans le nom complet.
export function shortName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "Livreur";
  const first = parts[0].slice(0, 16);
  return parts.length > 1 ? `${first} ${parts[parts.length - 1][0].toUpperCase()}.` : first;
}

// Objectif du jour : celui du directeur, sinon la moyenne des 7 derniers jours + 10 %, arrondie aux 5 du dessus
// (au moins 10) : un objectif atteignable mais qui pousse un peu plus haut que d'habitude.
export function dailyGoal(setting: number, last7: number[]): { goal: number; auto: boolean } {
  if (setting > 0) return { goal: setting, auto: false };
  const avg = last7.length ? last7.reduce((a, b) => a + b, 0) / last7.length : 0;
  return { goal: Math.max(10, Math.ceil((avg * 1.1) / 5) * 5), auto: true };
}

// Livraisons par jour des jours passés → record (meilleur jour) et les 7 derniers jours (jours sans livraison compris).
export function history(deliveredAt: Date[], today: Date) {
  const perDay = new Map<string, number>();
  for (const d of deliveredAt) perDay.set(dayKey(d), (perDay.get(dayKey(d)) ?? 0) + 1);
  let record: { count: number; date: string } | null = null;
  for (const [date, count] of perDay) if (!record || count > record.count || (count === record.count && date > record.date)) record = { count, date };
  const start = dayStart(today).getTime();
  const last7 = Array.from({ length: 7 }, (_, i) => perDay.get(dayKey(new Date(start - (i + 1) * DAY))) ?? 0);
  return { record, last7 };
}

export type ScreenOrder = {
  code: string;
  type: string;
  status: string;
  storeSale: boolean;
  fulfillment: string;
  createdAt: Date;
  pickedUpAt: Date | null;
  deliveredAt: Date | null;
  driverId: string | null;
  restaurant: { name: string; kind: string } | null;
  zone: { name: string } | null;
};

// Repas, colis ou boutique : les trois métiers de Zedeka.
export const categoryOf = (o: Pick<ScreenOrder, "type" | "storeSale" | "restaurant">) =>
  o.type === "PARCEL" ? (o.storeSale || o.restaurant?.kind === "SHOP" ? "SHOP" : "PARCEL") : o.restaurant?.kind === "SHOP" ? "SHOP" : "FOOD";

const minutesBetween = (a: Date, b: Date) => (b.getTime() - a.getTime()) / 60_000;
const OPEN = new Set(["PENDING", "CONFIRMED", "PREPARING", "READY", "PICKED_UP"]);

// Chiffres du jour pour l'écran « compteur ». `orders` : commandes créées ou livrées aujourd'hui.
export function buildSummary(input: {
  now: Date;
  orders: ScreenOrder[];
  yesterdayCreated: Date[];
  yesterdayDeliveredSoFar: number;
  past: { record: { count: number; date: string } | null; last7: number[] };
  goalSetting: number;
  drivers: Map<string, string>;
  zedRides: number;
}) {
  const { now, orders } = input;
  const start = dayStart(now);
  const createdToday = orders.filter((o) => o.createdAt >= start);
  const deliveredToday = orders.filter((o) => o.status === "DELIVERED" && o.deliveredAt && o.deliveredAt >= start);
  const delivered = deliveredToday.length;

  const byCategory = { FOOD: 0, PARCEL: 0, SHOP: 0 };
  for (const o of createdToday) byCategory[categoryOf(o)]++;

  // Temps moyen de livraison (commande → remise), livraisons à domicile du jour.
  const times = deliveredToday.filter((o) => o.fulfillment === "DELIVERY").map((o) => minutesBetween(o.createdAt, o.deliveredAt!));
  const avgMinutes = times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : null;

  // Commandes reçues par heure, aujourd'hui et hier (comparaison).
  const hourly = Array.from({ length: 24 }, () => 0);
  for (const o of createdToday) hourly[o.createdAt.getUTCHours()]++;
  const hourlyYesterday = Array.from({ length: 24 }, () => 0);
  for (const d of input.yesterdayCreated) hourlyYesterday[d.getUTCHours()]++;

  // Classement des livreurs du jour : livraisons, puis rapidité moyenne (retrait → remise).
  const perDriver = new Map<string, { deliveries: number; minutes: number[] }>();
  for (const o of deliveredToday) {
    if (!o.driverId) continue;
    const row = perDriver.get(o.driverId) ?? { deliveries: 0, minutes: [] };
    row.deliveries++;
    if (o.pickedUpAt) row.minutes.push(minutesBetween(o.pickedUpAt, o.deliveredAt!));
    perDriver.set(o.driverId, row);
  }
  const leaderboard = [...perDriver.entries()]
    .map(([id, r]) => ({
      id,
      name: shortName(input.drivers.get(id) ?? ""),
      deliveries: r.deliveries,
      avgMinutes: r.minutes.length ? Math.round(r.minutes.reduce((a, b) => a + b, 0) / r.minutes.length) : null,
    }))
    .sort((a, b) => b.deliveries - a.deliveries || (a.avgMinutes ?? 999) - (b.avgMinutes ?? 999))
    .slice(0, 8);

  // Fil des commandes : les plus récentes d'abord, sans rien sur le client.
  const feed = [...createdToday]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, 25)
    .map((o) => ({
      code: o.code,
      category: categoryOf(o),
      from: o.type === "PARCEL" && !o.restaurant ? null : (o.restaurant?.name ?? null),
      zone: o.zone?.name ?? null,
      status: o.status,
      createdAt: o.createdAt.toISOString(),
      deliveredAt: o.deliveredAt?.toISOString() ?? null,
    }));

  const { goal, auto } = dailyGoal(input.goalSetting, input.past.last7);
  return {
    now: now.toISOString(),
    date: dayKey(now),
    today: {
      received: createdToday.length,
      delivered,
      inProgress: orders.filter((o) => OPEN.has(o.status)).length,
      cancelled: createdToday.filter((o) => o.status === "CANCELLED").length,
      byCategory,
      avgMinutes,
      zedRides: input.zedRides,
    },
    yesterday: { createdSoFar: input.yesterdayCreated.filter((d) => d.getTime() <= now.getTime() - DAY).length, deliveredSoFar: input.yesterdayDeliveredSoFar },
    goal: { target: goal, auto },
    record: input.past.record,
    last7: input.past.last7,
    hourly,
    hourlyYesterday,
    leaderboard,
    feed,
  };
}

export type ScreenSummary = ReturnType<typeof buildSummary>;
