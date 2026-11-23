import type { PrismaClient } from "@prisma/client";
import { startOfDayUtc, zedekaRevenue } from "./stats.js";

// Indicateurs clés (KPI) du métier pour l'admin : volume par service, acceptation, délais par étape, annulations,
// clients actifs et fidélité, panier moyen, revenus, livreurs et abonnements. Chaque indicateur est calculé sur la
// période choisie et sur la période précédente de même durée (même nombre d'heures écoulées), pour la tendance.

const DAY = 86_400_000;
export const KPI_DAYS = [1, 7, 30, 90] as const;
// Garde-fou de lecture : au-delà, la période est tronquée (le pilote en est très loin).
const MAX_ROWS = 50_000;

export type KpiOrder = {
  type: string;
  status: string;
  storeSale: boolean;
  fulfillment: string;
  createdAt: Date;
  confirmedAt: Date | null;
  readyAt: Date | null;
  pickedUpAt: Date | null;
  deliveredAt: Date | null;
  cancelledAt: Date | null;
  cancellationReason: string | null;
  customerId: string | null;
  driverId: string | null;
  restaurantId: string | null;
  subtotal: number;
  total: number;
  deliveryFee: number;
  extraFee: number;
  discount: number;
  promoPayer: string | null;
  commission: number;
  driverEarning: number;
};
export type KpiRide = {
  status: string;
  createdAt: Date;
  acceptedAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  price: number | null;
  quotedPrice: number | null;
  customerId: string | null;
  driverId: string | null;
};
export type KpiService = {
  module: string;
  status: string;
  createdAt: Date;
  acceptedAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  finalPrice: number | null;
  estimate: number;
  customerId: string | null;
  providerId: string | null;
};

export const SERVICES = ["food", "shop", "parcel", "ride", "service"] as const;
export type Service = (typeof SERVICES)[number];

export const serviceOf = (o: Pick<KpiOrder, "type" | "storeSale">): Service => (o.type === "PARCEL" ? "parcel" : o.storeSale ? "shop" : "food");

const minutes = (a: Date | null, b: Date | null) => (a && b && b >= a ? (b.getTime() - a.getTime()) / 60_000 : null);

export function quantile(values: number[], q: number): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return Math.round((s[lo] + (s[hi] - s[lo]) * (pos - lo)) * 10) / 10;
}

const median = (v: number[]) => quantile(v, 0.5);
const rate = (part: number, total: number) => (total ? Math.round((part / total) * 1000) / 10 : null);
const avg = (v: number[]) => (v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null);
const nonNull = (v: (number | null)[]) => v.filter((x): x is number => x !== null);

// Indicateurs d'une période (commandes, courses Zed et demandes de services créées dans la période).
export function computeKpis(orders: KpiOrder[], rides: KpiRide[], services: KpiService[], days: number) {
  const created = { food: 0, shop: 0, parcel: 0, ride: rides.length, service: services.length } as Record<Service, number>;
  for (const o of orders) created[serviceOf(o)]++;
  const total = SERVICES.reduce((sum, s) => sum + created[s], 0);

  const cancelledOrders = orders.filter((o) => o.status === "CANCELLED");
  const cancelledRides = rides.filter((r) => r.status === "CANCELLED");
  const cancelledServices = services.filter((r) => r.status === "CANCELLED");
  const cancelled = cancelledOrders.length + cancelledRides.length + cancelledServices.length;
  const delivered = orders.filter((o) => o.status === "DELIVERED");
  const completed = delivered.length + rides.filter((r) => r.status === "COMPLETED").length + services.filter((r) => r.status === "DONE").length;

  // Acceptation par les commerces : parmi les commandes de repas et de boutique tranchées (acceptées, ou annulées
  // sans avoir été acceptées), la part acceptée. Zed et services : la part des demandes prises par un conducteur
  // ou un prestataire, parmi celles qui ne sont plus en recherche.
  const merchantDecided = orders.filter((o) => o.type === "FOOD" && (o.confirmedAt || o.status === "CANCELLED"));
  const ridesDecided = rides.filter((r) => r.acceptedAt || r.status === "CANCELLED" || r.status === "NO_DRIVER");
  const servicesDecided = services.filter((r) => r.acceptedAt || r.status === "CANCELLED");

  // Délais par étape (médiane en minutes) des commandes livrées.
  const food = delivered.filter((o) => o.type === "FOOD" && o.fulfillment === "DELIVERY");
  const parcels = delivered.filter((o) => o.type === "PARCEL");
  const totals = nonNull(delivered.filter((o) => o.fulfillment === "DELIVERY").map((o) => minutes(o.createdAt, o.deliveredAt)));
  const stages = {
    accept: median(nonNull(orders.filter((o) => o.type === "FOOD").map((o) => minutes(o.createdAt, o.confirmedAt)))),
    prepare: median(nonNull(food.map((o) => minutes(o.confirmedAt, o.readyAt)))),
    waitDriver: median(nonNull(food.map((o) => minutes(o.readyAt, o.pickedUpAt)))),
    deliverFood: median(nonNull(food.map((o) => minutes(o.pickedUpAt, o.deliveredAt)))),
    parcelPickup: median(nonNull(parcels.map((o) => minutes(o.createdAt, o.pickedUpAt)))),
    deliverParcel: median(nonNull(parcels.map((o) => minutes(o.pickedUpAt, o.deliveredAt)))),
    rideAccept: median(nonNull(rides.map((r) => minutes(r.createdAt, r.acceptedAt)))),
    serviceAccept: median(nonNull(services.map((r) => minutes(r.createdAt, r.acceptedAt)))),
  };

  // Chiffre d'affaires (ce que paient les clients) et revenu Zedeka par service.
  const valid = orders.filter((o) => o.status !== "CANCELLED");
  const revenue = Object.fromEntries(SERVICES.map((s) => [s, { gmv: 0, zedeka: null as number | null }])) as Record<Service, { gmv: number; zedeka: number | null }>;
  for (const o of valid) {
    const r = revenue[serviceOf(o)];
    r.gmv += o.total;
    r.zedeka = (r.zedeka ?? 0) + zedekaRevenue(o);
  }
  for (const r of rides) if (r.status === "COMPLETED") revenue.ride.gmv += r.price ?? r.quotedPrice ?? 0;
  for (const r of services) if (r.status === "DONE") revenue.service.gmv += r.finalPrice ?? r.estimate;
  const gmv = SERVICES.reduce((sum, s) => sum + revenue[s].gmv, 0);
  const zedeka = valid.reduce((sum, o) => sum + zedekaRevenue(o), 0);

  const foodBaskets = valid.filter((o) => o.type === "FOOD").map((o) => o.subtotal);
  const customers = new Set([...orders.map((o) => o.customerId), ...rides.map((r) => r.customerId), ...services.map((r) => r.customerId)].filter((c): c is string => !!c));
  const drivers = new Set(
    [...delivered.map((o) => o.driverId), ...rides.filter((r) => r.status === "COMPLETED").map((r) => r.driverId), ...services.filter((r) => r.status === "DONE").map((r) => r.providerId)].filter(
      (d): d is string => !!d,
    ),
  );

  const reasons = new Map<string, number>();
  for (const o of cancelledOrders) {
    const key = (o.cancellationReason ?? "").trim().slice(0, 60) || "Sans motif";
    reasons.set(key, (reasons.get(key) ?? 0) + 1);
  }

  return {
    orders: total,
    ordersPerDay: Math.round((total / days) * 10) / 10,
    byService: created,
    completed,
    cancelled,
    cancellationRate: rate(cancelled, total),
    cancellationByService: {
      food: rate(cancelledOrders.filter((o) => serviceOf(o) === "food").length, created.food),
      shop: rate(cancelledOrders.filter((o) => serviceOf(o) === "shop").length, created.shop),
      parcel: rate(cancelledOrders.filter((o) => serviceOf(o) === "parcel").length, created.parcel),
      ride: rate(cancelledRides.length, created.ride),
      service: rate(cancelledServices.length, created.service),
    },
    cancellationReasons: [...reasons].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count).slice(0, 6),
    acceptanceRate: rate(merchantDecided.filter((o) => o.confirmedAt).length, merchantDecided.length),
    rideAcceptanceRate: rate(ridesDecided.filter((r) => r.acceptedAt).length, ridesDecided.length),
    serviceAcceptanceRate: rate(servicesDecided.filter((r) => r.acceptedAt).length, servicesDecided.length),
    stages,
    deliveryMinutes: { median: median(totals), p90: quantile(totals, 0.9), avg: avg(totals) },
    avgBasket: avg(foodBaskets),
    avgOrderValue: avg(valid.map((o) => o.total)),
    gmv,
    revenue: zedeka,
    revenuePerDay: Math.round(zedeka / days),
    revenueByService: revenue,
    activeCustomers: customers.size,
    activeDrivers: drivers.size,
    deliveriesPerDriverPerDay: drivers.size ? Math.round((completed / drivers.size / days) * 10) / 10 : null,
    customerIds: customers,
  };
}

type Window = { from: Date; to: Date };

async function load(prisma: PrismaClient, w: Window) {
  const where = { createdAt: { gte: w.from, lt: w.to } };
  const [orders, rides, services] = await Promise.all([
    prisma.order.findMany({
      where,
      take: MAX_ROWS,
      select: {
        type: true,
        status: true,
        storeSale: true,
        fulfillment: true,
        createdAt: true,
        confirmedAt: true,
        readyAt: true,
        pickedUpAt: true,
        deliveredAt: true,
        cancelledAt: true,
        cancellationReason: true,
        customerId: true,
        driverId: true,
        restaurantId: true,
        subtotal: true,
        total: true,
        deliveryFee: true,
        extraFee: true,
        discount: true,
        promoPayer: true,
        commission: true,
        driverEarning: true,
      },
    }),
    prisma.zedRide.findMany({
      where,
      take: MAX_ROWS,
      select: { status: true, createdAt: true, acceptedAt: true, completedAt: true, cancelledAt: true, price: true, quotedPrice: true, customerId: true, driverId: true },
    }),
    prisma.serviceRequest.findMany({
      where,
      take: MAX_ROWS,
      select: { module: true, status: true, createdAt: true, acceptedAt: true, completedAt: true, cancelledAt: true, finalPrice: true, estimate: true, customerId: true, providerId: true },
    }),
  ]);
  return { orders: orders as unknown as KpiOrder[], rides: rides as unknown as KpiRide[], services: services as unknown as KpiService[] };
}

// Volume et revenu jour par jour sur la période (graphique de tendance).
export function dailySeries(data: { orders: KpiOrder[]; rides: KpiRide[]; services: KpiService[] }, from: Date, days: number) {
  const rows = Array.from({ length: days }, (_, i) => ({
    date: new Date(from.getTime() + i * DAY).toISOString().slice(0, 10),
    food: 0,
    shop: 0,
    parcel: 0,
    ride: 0,
    service: 0,
    cancelled: 0,
    revenue: 0,
  }));
  const at = (d: Date) => rows[Math.floor((startOfDayUtc(d).getTime() - from.getTime()) / DAY)];
  for (const o of data.orders) {
    const r = at(o.createdAt);
    if (!r) continue;
    r[serviceOf(o)]++;
    if (o.status === "CANCELLED") r.cancelled++;
    else r.revenue += zedekaRevenue(o);
  }
  for (const x of data.rides) {
    const r = at(x.createdAt);
    if (!r) continue;
    r.ride++;
    if (x.status === "CANCELLED") r.cancelled++;
  }
  for (const x of data.services) {
    const r = at(x.createdAt);
    if (!r) continue;
    r.service++;
    if (x.status === "CANCELLED") r.cancelled++;
  }
  return rows;
}

// Rapport complet : période en cours (depuis minuit il y a days-1 jours), période précédente de même durée écoulée,
// et les chiffres « en ce moment » (livreurs en ligne, abonnements).
export async function kpiReport(prisma: PrismaClient, days: number, now = new Date()) {
  const from = new Date(startOfDayUtc(now).getTime() - (days - 1) * DAY);
  const span = now.getTime() - from.getTime();
  const cur: Window = { from, to: now };
  const prev: Window = { from: new Date(from.getTime() - span), to: from };
  const stale = new Date(now.getTime() - 5 * 60_000);
  const onDuty = { active: true, status: "APPROVED", deletedAt: null } as const;

  const [curData, prevData, newCustomers, newCustomersPrev, driversOnline, driversApproved, restaurants, merchants] = await Promise.all([
    load(prisma, cur),
    load(prisma, prev),
    prisma.customer.count({ where: { createdAt: { gte: cur.from, lt: cur.to } } }),
    prisma.customer.count({ where: { createdAt: { gte: prev.from, lt: prev.to } } }),
    prisma.driver.count({ where: { ...onDuty, online: true, lastSeenAt: { gte: stale } } }),
    prisma.driver.count({ where: onDuty }),
    prisma.restaurant.findMany({ where: { active: true, deletedAt: null }, select: { subscriptionFee: true, commissionRate: true, plan: true } }),
    prisma.merchant.findMany({ where: { storeStatus: "ONLINE" }, select: { storeSubscriptionFee: true } }),
  ]);

  const current = computeKpis(curData.orders, curData.rides, curData.services, days);
  const previous = computeKpis(prevData.orders, prevData.rides, prevData.services, days);

  // Fidélité : parmi les clients actifs de la période précédente, la part revenue dans la période en cours.
  const retained = [...previous.customerIds].filter((c) => current.customerIds.has(c)).length;
  const returning = [...current.customerIds].filter((c) => previous.customerIds.has(c)).length;

  const subscribed = restaurants.filter((r) => (r.subscriptionFee ?? 0) > 0);
  const merchantSubs = merchants.filter((m) => (m.storeSubscriptionFee ?? 0) > 0);
  const mrr = subscribed.reduce((s, r) => s + (r.subscriptionFee ?? 0), 0) + merchantSubs.reduce((s, m) => s + (m.storeSubscriptionFee ?? 0), 0);

  const strip = ({ customerIds: _c, ...k }: ReturnType<typeof computeKpis>) => k;
  return {
    days,
    from: cur.from.toISOString(),
    to: cur.to.toISOString(),
    previousFrom: prev.from.toISOString(),
    current: { ...strip(current), newCustomers, returningCustomers: returning, retentionRate: rate(retained, previous.customerIds.size) },
    previous: { ...strip(previous), newCustomers: newCustomersPrev },
    series: dailySeries(curData, cur.from, days),
    now: {
      driversOnline,
      driversApproved,
      restaurants: restaurants.length,
      subscribedRestaurants: subscribed.length,
      proRestaurants: restaurants.filter((r) => r.plan === "PRO").length,
      commissionRestaurants: restaurants.filter((r) => !(r.subscriptionFee ?? 0) && r.commissionRate > 0).length,
      onlineShops: merchants.length,
      subscribedShops: merchantSubs.length,
      monthlySubscriptions: mrr,
    },
  };
}
