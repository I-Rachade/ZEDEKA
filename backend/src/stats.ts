// Indicateurs du pilote (document de lancement) : revenu Zedeka = frais de
// livraison et suppléments + commission restaurant (0 pour les commerces à l'abonnement),
// moins remises et part variable du livreur, plus la part journalière des abonnements ;
// seuil de rentabilité ≈ 13 500 FCFA/jour.

export const BREAK_EVEN_PER_DAY = 13_500;

export type StatOrder = {
  restaurantName: string;
  status: string;
  deliveryFee: number;
  extraFee: number;
  discount: number;
  commission: number;
  driverEarning: number;
  createdAt: Date;
  deliveredAt: Date | null;
};

export function zedekaRevenue(
  o: Pick<StatOrder, "deliveryFee" | "extraFee" | "discount" | "commission" | "driverEarning">,
): number {
  return o.deliveryFee + o.extraFee + o.commission - o.discount - o.driverEarning;
}

// Abonnements mensuels des commerces actifs, ramenés à la journée (mois de 30 jours).
export function subscriptionsPerDay(restaurants: { subscriptionFee: number | null }[]): number {
  return Math.round(restaurants.reduce((sum, r) => sum + (r.subscriptionFee ?? 0), 0) / 30);
}

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10); // Lomé est en UTC
}

export function startOfDayUtc(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function buildReport(orders: StatOrder[], from: Date, days: number, subscriptions = 0) {
  const valid = orders.filter((o) => o.status !== "CANCELLED");

  const perDay = Array.from({ length: days }, (_, i) => {
    const date = new Date(from.getTime() + i * 86_400_000);
    const key = dayKey(date);
    const dayOrders = valid.filter((o) => dayKey(o.createdAt) === key);
    const revenue = dayOrders.reduce((sum, o) => sum + zedekaRevenue(o), 0) + subscriptions;
    return { date: key, orders: dayOrders.length, revenue, subscriptions, aboveBreakEven: revenue >= BREAK_EVEN_PER_DAY };
  });

  const byRestaurant = new Map<string, number>();
  for (const o of valid) byRestaurant.set(o.restaurantName, (byRestaurant.get(o.restaurantName) ?? 0) + 1);
  const perRestaurant = [...byRestaurant]
    .map(([name, count]) => ({ name, orders: count, perDay: Math.round((count / days) * 10) / 10 }))
    .sort((a, b) => b.orders - a.orders);

  const deliveryMinutes = valid
    .filter((o) => o.deliveredAt)
    .map((o) => (o.deliveredAt!.getTime() - o.createdAt.getTime()) / 60_000);
  const avgDeliveryMinutes = deliveryMinutes.length
    ? Math.round(deliveryMinutes.reduce((a, b) => a + b, 0) / deliveryMinutes.length)
    : null;

  const revenue = perDay.reduce((sum, d) => sum + d.revenue, 0);
  return {
    days,
    totalOrders: valid.length,
    cancelled: orders.length - valid.length,
    revenue,
    revenuePerDay: Math.round(revenue / days),
    breakEvenPerDay: BREAK_EVEN_PER_DAY,
    subscriptionsPerDay: subscriptions,
    avgDeliveryMinutes,
    perDay,
    perRestaurant,
  };
}
