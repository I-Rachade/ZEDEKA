// Livreur favori (décision du 14 novembre 2026).
//
// Un restaurant ou un marchand invite jusqu'à 3 livreurs Zedeka validés, dans l'ordre ; chaque livreur accepte ou
// refuse l'invitation, et peut se retirer ensuite. Le favori n'est pas réservé : il fait aussi les courses des
// autres et peut être favori de plusieurs commerces.
//
// Une course du commerce est proposée d'abord à ses favoris quand :
// - dispatchRoute = FAVORITE (choisi par le commerce : « À mon livreur favori »), ou
// - dispatchRoute vide, réglage « Mon favori d'abord » activé, et la course n'a encore été proposée à personne.
// Le 1er favori libre et en ligne la reçoit (60 s pour répondre, comme toute proposition), puis le 2e, puis le 3e.
// Refus, silence ou aucun favori disponible : dispatchRoute passe à OPEN et la course part dans la répartition
// habituelle (src/autoDispatch.ts), le commerce est prévenu. L'équipe peut toujours réattribuer à la main.
//
// Marchand : tous les colis en attente au même point de ramassage partent au même favori d'un coup (un seul
// ramassage) ; ceux qu'il refuse passent au favori suivant.
//
// Ces propositions ne dépendent pas du réglage « Attribution automatique » : c'est le commerce qui les déclenche.
import type { Prisma, PrismaClient } from "@prisma/client";
import { PARCEL_ZONE_ID } from "./delivery.js";
import { AWAITING } from "./locationRequest.js";
import type { Notifier } from "./notify.js";
import { OPEN } from "./orderFlow.js";
import { assignDriver } from "./routes/driverApp.js";
import { busyOrderWhere, PICKUP_LEAD_MS } from "./scheduledPickup.js";

export const FAVORITE_NAME = "Livreur favori";
export const MAX_FAVORITES = 3;
export const FAVORITE_STATUSES = ["INVITED", "ACTIVE", "DECLINED"] as const;
export type FavoriteStatus = (typeof FAVORITE_STATUSES)[number];
export type Owner = { restaurantId: string } | { merchantId: string };
export const DISPATCH_ROUTES = ["FAVORITE", "OPEN"] as const;
export type DispatchRoute = (typeof DISPATCH_ROUTES)[number];

export const ownerWhere = (o: Owner) => ("restaurantId" in o ? { restaurantId: o.restaurantId } : { merchantId: o.merchantId });

const favoriteSelect = {
  id: true,
  rank: true,
  status: true,
  createdAt: true,
  respondedAt: true,
  driver: { select: { id: true, name: true, phone: true, vehicle: true, employment: true, online: true, active: true, deletedAt: true } },
} satisfies Prisma.FavoriteDriverSelect;
type FavoriteRow = Prisma.FavoriteDriverGetPayload<{ select: typeof favoriteSelect }>;

export const favoriteView = (f: FavoriteRow) => ({
  id: f.id,
  rank: f.rank,
  status: f.status,
  createdAt: f.createdAt,
  respondedAt: f.respondedAt,
  driver: { id: f.driver.id, name: f.driver.name, phone: f.driver.phone, vehicle: f.driver.vehicle, staff: f.driver.employment === "STAFF", online: f.driver.online },
});

// Favoris d'un commerce, dans l'ordre (refusés à la fin). Les livreurs supprimés ou suspendus n'apparaissent plus.
export async function listFavorites(prisma: PrismaClient, owner: Owner) {
  const rows = await prisma.favoriteDriver.findMany({ where: ownerWhere(owner), orderBy: [{ rank: "asc" }, { createdAt: "asc" }], select: favoriteSelect });
  return sortFavorites(rows.filter((f) => !f.driver.deletedAt && f.driver.active)).map(favoriteView);
}

export function sortFavorites<T extends { status: string; rank: number }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => Number(a.status === "DECLINED") - Number(b.status === "DECLINED") || a.rank - b.rank);
}

export class FavoriteError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

// Invitation d'un livreur par son numéro. Une invitation refusée peut être renvoyée (elle redevient en attente).
export async function inviteFavorite(prisma: PrismaClient, notifier: Notifier, owner: Owner, phone: string, invitedBy: string, ownerName: string) {
  const driver = await prisma.driver.findFirst({ where: { phone, deletedAt: null }, select: { id: true, name: true, status: true, active: true, deliveries: true } });
  if (!driver || driver.status !== "APPROVED" || !driver.active || !driver.deliveries) throw new FavoriteError(404, "Aucun livreur Zedeka validé avec ce numéro");
  const existing = await prisma.favoriteDriver.findMany({ where: ownerWhere(owner), select: { id: true, driverId: true, status: true, rank: true } });
  const same = existing.find((f) => f.driverId === driver.id);
  if (same && same.status !== "DECLINED") throw new FavoriteError(409, same.status === "ACTIVE" ? `${driver.name} est déjà votre livreur favori` : `${driver.name} a déjà une invitation en attente`);
  const counted = existing.filter((f) => f.status !== "DECLINED" && f.driverId !== driver.id);
  if (counted.length >= MAX_FAVORITES) throw new FavoriteError(409, `${MAX_FAVORITES} livreurs favoris au plus : retirez-en un d'abord`);
  const rank = counted.reduce((m, f) => Math.max(m, f.rank), 0) + 1;
  const data = { status: "INVITED", rank, invitedBy, respondedAt: null, createdAt: new Date() };
  const fav = same
    ? await prisma.favoriteDriver.update({ where: { id: same.id }, data, select: favoriteSelect })
    : await prisma.favoriteDriver.create({ data: { ...ownerWhere(owner), driverId: driver.id, ...data }, select: favoriteSelect });
  void notifier
    .push("driver", driver.id, {
      title: "Invitation : livreur favori",
      body: `${ownerName} aimerait que vous soyez son livreur favori. Acceptez ou refusez dans l'application.`,
      url: "/livreur/favoris",
      tag: `favorite-${fav.id}`,
    })
    .catch(() => 0);
  return favoriteView(fav);
}

// Nouvel ordre des favoris (ids dans l'ordre voulu) ; les ids inconnus sont ignorés.
export async function reorderFavorites(prisma: PrismaClient, owner: Owner, ids: string[]) {
  const rows = await prisma.favoriteDriver.findMany({ where: ownerWhere(owner), select: { id: true } });
  const known = new Set(rows.map((r) => r.id));
  const ordered = ids.filter((id) => known.has(id));
  await Promise.all(ordered.map((id, i) => prisma.favoriteDriver.updateMany({ where: { id, ...ownerWhere(owner) }, data: { rank: i + 1 } })));
  return listFavorites(prisma, owner);
}

export async function removeFavorite(prisma: PrismaClient, owner: Owner, id: string) {
  const { count } = await prisma.favoriteDriver.deleteMany({ where: { id, ...ownerWhere(owner) } });
  if (!count) throw new FavoriteError(404, "Livreur favori introuvable");
}

// --- Côté livreur ---

export async function driverFavorites(prisma: PrismaClient, driverId: string) {
  const rows = await prisma.favoriteDriver.findMany({
    where: { driverId, status: { in: ["INVITED", "ACTIVE"] } },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      status: true,
      rank: true,
      createdAt: true,
      restaurant: { select: { name: true, address: true, phone: true, deletedAt: true } },
      merchant: { select: { shopName: true, pickupAddress: true, phone: true, active: true } },
    },
  });
  return rows
    .filter((f) => (f.restaurant ? !f.restaurant.deletedAt : !!f.merchant))
    .map((f) => ({
      id: f.id,
      status: f.status,
      rank: f.rank,
      createdAt: f.createdAt,
      kind: f.restaurant ? ("RESTAURANT" as const) : ("MERCHANT" as const),
      name: f.restaurant?.name ?? f.merchant?.shopName ?? "",
      address: f.restaurant?.address ?? f.merchant?.pickupAddress ?? "",
      phone: f.restaurant?.phone ?? f.merchant?.phone ?? "",
    }));
}

// Réponse du livreur : accepter, refuser une invitation, ou se retirer (plus favori).
export async function answerFavorite(prisma: PrismaClient, notifier: Notifier, driverId: string, id: string, answer: "accept" | "decline" | "leave") {
  const fav = await prisma.favoriteDriver.findFirst({
    where: { id, driverId },
    select: { id: true, status: true, restaurantId: true, merchantId: true, driver: { select: { name: true } }, merchant: { select: { customerId: true } } },
  });
  if (!fav) throw new FavoriteError(404, "Invitation introuvable");
  if (answer === "accept" && fav.status !== "INVITED") throw new FavoriteError(409, "Cette invitation n'attend plus de réponse");
  const now = new Date();
  if (answer === "leave") await prisma.favoriteDriver.delete({ where: { id } });
  else await prisma.favoriteDriver.update({ where: { id }, data: { status: answer === "accept" ? "ACTIVE" : "DECLINED", respondedAt: now } });
  const body =
    answer === "accept" ? `${fav.driver.name} a accepté d'être votre livreur favori.` : answer === "decline" ? `${fav.driver.name} a refusé votre invitation.` : `${fav.driver.name} n'est plus votre livreur favori.`;
  const payload = { title: "Livreur favori", body, url: fav.restaurantId ? "/restaurant/livreurs" : "/marchand/livreurs", tag: `favorite-${id}` };
  const to = fav.restaurantId ? notifier.push("restaurant", fav.restaurantId, payload) : fav.merchant ? notifier.push("customer", fav.merchant.customerId, payload) : null;
  void to?.catch(() => 0);
}

// --- Répartition ---

// Courses du commerce à proposer : même liste que l'attribution automatique (repas prêts, colis dès la demande,
// zone connue, position reçue, retrait programmé proche).
function dispatchableWhere(now: Date): Prisma.OrderWhereInput {
  return {
    status: { in: OPEN },
    driverId: null,
    fulfillment: "DELIVERY",
    zoneId: { not: PARCEL_ZONE_ID },
    AND: [
      { OR: [{ type: "PARCEL" }, { status: { in: ["READY", "PICKED_UP"] } }] },
      { OR: [{ pickupAt: null }, { pickupAt: { lte: new Date(now.getTime() + PICKUP_LEAD_MS) } }] },
      // Favoris : demandés explicitement, ou pas encore décidé (réglage du commerce vérifié plus bas).
      { OR: [{ dispatchRoute: "FAVORITE" }, { dispatchRoute: null }] },
      { OR: [{ restaurantId: { not: null } }, { merchantId: { not: null } }] },
    ],
    NOT: { locationRequest: { status: { in: AWAITING } } },
  };
}

type Pending = {
  id: string;
  code: string;
  restaurantId: string | null;
  merchantId: string | null;
  dispatchRoute: string | null;
  assignments: { driverId: string; assignedBy: string | null }[];
};

// Prochain favori à solliciter pour un groupe de courses : actif, en ligne, libre, pas encore sollicité pour la
// première course du groupe. null : plus personne.
export function nextFavorite<F extends { driverId: string; rank: number }>(favorites: F[], free: Set<string>, tried: Set<string>): F | null {
  return [...favorites].sort((a, b) => a.rank - b.rank).find((f) => free.has(f.driverId) && !tried.has(f.driverId)) ?? null;
}

// Une course entre-t-elle dans la phase « favoris » ? Explicitement, ou par le réglage du commerce tant qu'elle n'a
// été proposée à personne d'autre.
export function wantsFavorite(o: Pick<Pending, "dispatchRoute" | "assignments">, favoriteFirst: boolean): boolean {
  if (o.dispatchRoute === "FAVORITE") return true;
  if (o.dispatchRoute) return false;
  return favoriteFirst && o.assignments.every((a) => a.assignedBy === FAVORITE_NAME);
}

// Chaque minute (et tout de suite après un geste du commerce) : propose les courses aux favoris.
// onlyOwner : limite à un commerce (bouton « À mon livreur favori », nouvel envoi).
export async function favoriteDispatch(prisma: PrismaClient, notifier: Notifier, now = new Date(), onlyOwner?: Owner) {
  const orders: Pending[] = await prisma.order.findMany({
    where: { ...dispatchableWhere(now), ...(onlyOwner ? ownerWhere(onlyOwner) : {}) },
    orderBy: { createdAt: "asc" },
    take: 100,
    select: { id: true, code: true, restaurantId: true, merchantId: true, dispatchRoute: true, assignments: { select: { driverId: true, assignedBy: true } } },
  });
  if (!orders.length) return 0;

  const restaurantIds = [...new Set(orders.map((o) => o.restaurantId).filter((x): x is string => !!x))];
  const merchantIds = [...new Set(orders.map((o) => o.merchantId).filter((x): x is string => !!x))];
  const [restaurants, merchants, favorites] = await Promise.all([
    restaurantIds.length ? prisma.restaurant.findMany({ where: { id: { in: restaurantIds } }, select: { id: true, name: true, favoriteFirst: true } }) : [],
    merchantIds.length ? prisma.merchant.findMany({ where: { id: { in: merchantIds } }, select: { id: true, shopName: true, favoriteFirst: true, customerId: true } }) : [],
    prisma.favoriteDriver.findMany({
      where: { status: "ACTIVE", OR: [{ restaurantId: { in: restaurantIds } }, { merchantId: { in: merchantIds } }] },
      select: { restaurantId: true, merchantId: true, driverId: true, rank: true },
    }),
  ]);
  const favoriteFirst = new Map<string, boolean>([...restaurants.map((r) => [r.id, r.favoriteFirst] as const), ...merchants.map((m) => [m.id, m.favoriteFirst] as const)]);

  // Groupes : une course par groupe pour un restaurant, tous les colis d'un marchand ensemble (un seul ramassage).
  const groups = new Map<string, Pending[]>();
  for (const o of orders) {
    const ownerId = (o.restaurantId ?? o.merchantId)!;
    if (!wantsFavorite(o, favoriteFirst.get(ownerId) ?? false)) continue;
    const key = o.merchantId ? `m:${o.merchantId}` : `o:${o.id}`;
    groups.set(key, [...(groups.get(key) ?? []), o]);
  }
  if (!groups.size) return 0;

  // Favoris libres : en ligne, sans course en cours ni proposition en attente (mêmes règles que la répartition).
  const favIds = [...new Set(favorites.map((f) => f.driverId))];
  const freeRows = favIds.length
    ? await prisma.driver.findMany({
        where: {
          id: { in: favIds },
          active: true,
          status: "APPROVED",
          online: true,
          deletedAt: null,
          deliveries: true,
          orders: { none: busyOrderWhere(now) },
          assignments: { none: { status: "SENT" } },
        },
        select: { id: true },
      })
    : [];
  const free = new Set(freeRows.map((d) => d.id));

  let sent = 0;
  for (const group of groups.values()) {
    const first = group[0];
    const ownerFavorites = favorites.filter((f) => (first.restaurantId ? f.restaurantId === first.restaurantId : f.merchantId === first.merchantId));
    const tried = new Set(first.assignments.filter((a) => a.assignedBy === FAVORITE_NAME).map((a) => a.driverId));
    const fav = nextFavorite(ownerFavorites, free, tried);
    if (!fav) {
      // Plus de favori à solliciter : demande ouverte, le commerce est prévenu (sauf s'il n'a aucun favori actif :
      // le réglage « favori d'abord » ne change alors rien, la course part simplement à tous).
      const ids = group.map((o) => o.id);
      await prisma.order.updateMany({ where: { id: { in: ids }, driverId: null }, data: { dispatchRoute: "OPEN" } });
      if (ownerFavorites.length) void tellOwner(notifier, first, restaurants, merchants, group.length);
      continue;
    }
    free.delete(fav.driverId);
    for (const o of group) {
      if (o.assignments.some((a) => a.driverId === fav.driverId)) continue;
      const { count } = await prisma.order.updateMany({ where: { id: o.id, driverId: null, status: { in: OPEN } }, data: { driverId: fav.driverId, dispatchRoute: "FAVORITE" } });
      if (!count) continue;
      await assignDriver(prisma, notifier, { id: o.id, code: o.code, driverId: null }, fav.driverId, FAVORITE_NAME, now);
      sent++;
    }
  }
  return sent;
}

async function tellOwner(
  notifier: Notifier,
  o: Pending,
  restaurants: { id: string; name: string }[],
  merchants: { id: string; shopName: string; customerId: string }[],
  count: number,
) {
  const body = count > 1 ? `Aucun favori n'a pris vos ${count} colis : ils partent aux autres livreurs Zedeka.` : `Aucun favori n'a pris la course ${o.code} : elle part aux autres livreurs Zedeka.`;
  if (o.restaurantId) {
    await notifier.push("restaurant", o.restaurantId, { title: "Demande ouverte", body, url: `/restaurant/commandes/${o.id}`, tag: `favorite-open-${o.id}` }).catch(() => 0);
    void restaurants;
  } else {
    const m = merchants.find((x) => x.id === o.merchantId);
    if (m) await notifier.push("customer", m.customerId, { title: "Demande ouverte", body, url: "/marchand/colis", tag: `favorite-open-${o.merchantId}` }).catch(() => 0);
  }
}

// Geste du commerce sur ses courses sans livreur : « À mon livreur favori » ou « Demande ouverte ».
export async function routeOrders(prisma: PrismaClient, notifier: Notifier, owner: Owner, orderIds: string[], route: DispatchRoute, now = new Date()) {
  if (route === "FAVORITE") {
    const active = await prisma.favoriteDriver.count({ where: { ...ownerWhere(owner), status: "ACTIVE" } });
    if (!active) throw new FavoriteError(409, "Aucun livreur favori n'a encore accepté votre invitation");
  }
  const { count } = await prisma.order.updateMany({ where: { id: { in: orderIds }, ...ownerWhere(owner), driverId: null, status: { in: OPEN } }, data: { dispatchRoute: route } });
  if (!count) throw new FavoriteError(409, "Un livreur a déjà cette course");
  if (route === "FAVORITE") await favoriteDispatch(prisma, notifier, now, owner);
  return count;
}
