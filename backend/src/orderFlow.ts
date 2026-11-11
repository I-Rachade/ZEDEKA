import type { Order, OrderStatus, Prisma, PrismaClient } from "@prisma/client";
import { cancellationFee, driverEarning } from "./delivery.js";
import { hasDeposit, settlesOnDeposit } from "./deposit.js";
import { newDeliveryCode } from "./receipt.js";
import { HttpError } from "./routes/adminWrite.js";
import { getSettings } from "./util.js";

// Cycle de vie d'une commande, partagé par l'admin et l'espace restaurant.

export const STATUSES = ["PENDING", "CONFIRMED", "PREPARING", "READY", "PICKED_UP", "DELIVERED", "CANCELLED"] as const;
export const OPEN: OrderStatus[] = ["PENDING", "CONFIRMED", "PREPARING", "READY", "PICKED_UP"];

const TIMESTAMP: Partial<Record<OrderStatus, keyof Order>> = {
  CONFIRMED: "confirmedAt",
  PREPARING: "preparingAt",
  READY: "readyAt",
  PICKED_UP: "pickedUpAt",
  DELIVERED: "deliveredAt",
  CANCELLED: "cancelledAt",
};

// Ce qu'un restaurant peut faire lui-même : accepter, refuser, préparer, déclarer prête.
const RESTAURANT_MOVES: Partial<Record<OrderStatus, OrderStatus[]>> = {
  PENDING: ["CONFIRMED", "PREPARING", "CANCELLED"],
  CONFIRMED: ["PREPARING", "READY"],
  PREPARING: ["READY"],
};

// Un retrait (« à emporter ») n'a pas de livreur : le restaurant le clôture lui-même en le remettant au client.
export function canRestaurantMove(from: OrderStatus, to: OrderStatus, fulfillment: "DELIVERY" | "PICKUP" = "DELIVERY"): boolean {
  if (fulfillment === "PICKUP" && from === "READY" && to === "DELIVERED") return true;
  return RESTAURANT_MOVES[from]?.includes(to) ?? false;
}

// Étape par étape : tant que le restaurant n'a pas accepté la commande, il ne voit ni le livreur ni le numéro
// du client. Il les découvre une fois la commande acceptée.
export function stepView<T extends { status: string; confirmedAt: Date | null; driver?: unknown; customerPhone: string }>(order: T): T {
  const accepted = order.status !== "PENDING" && (order.status !== "CANCELLED" || !!order.confirmedAt);
  return accepted ? order : { ...order, driver: null, customerPhone: "" };
}

// Commandes dont Zedeka doit le prix des plats au restaurant (relevés, « à vous verser »). Un retrait payé en
// espèces au comptoir en est exclu : le restaurant a encaissé lui-même, Zedeka ne lui doit rien.
export const OWED_TO_RESTAURANT: Prisma.OrderWhereInput = { NOT: { fulfillment: "PICKUP", paymentMethod: "CASH" } };

// Retraits payés en espèces au comptoir : leur commission est due à Zedeka et passe en déduction sur le relevé,
// pour ceux livrés à partir de cette date (décision du 2 novembre 2026 ; les plus anciens ne sont pas refacturés).
export const COUNTER_COMMISSION_FROM = new Date("2026-11-03T00:00:00Z");
const COLLECTED_BY_RESTAURANT: Prisma.OrderWhereInput = { fulfillment: "PICKUP", paymentMethod: "CASH" };

// Commandes d'un relevé, pas déjà réglées sur le dépôt : celles dont Zedeka doit les plats au restaurant, et les
// retraits encaissés au comptoir, dont seule la commission compte (le restaurant la doit à Zedeka).
export const SETTLED_BY_STATEMENT: Prisma.OrderWhereInput = {
  paidFromDeposit: false,
  OR: [OWED_TO_RESTAURANT, { ...COLLECTED_BY_RESTAURANT, commission: { gt: 0 }, deliveredAt: { gte: COUNTER_COMMISSION_FROM } }],
};

// Part des plats que Zedeka doit au restaurant pour une commande : rien pour un retrait encaissé au comptoir.
export const owedSubtotal = (o: { subtotal: number; fulfillment: string; paymentMethod: string }) =>
  o.fulfillment === "PICKUP" && o.paymentMethod === "CASH" ? 0 : o.subtotal;

// Données à écrire pour passer une commande à un nouveau statut.
export async function statusUpdate(
  prisma: PrismaClient,
  current: Order,
  to: OrderStatus,
  // byRestaurant : refus par le restaurant, jamais facturé au client.
  opts: { reason?: string; prepMinutes?: number; extraFee?: number; deliveryFee?: number; byRestaurant?: boolean } = {},
): Promise<Prisma.OrderUncheckedUpdateInput> {
  if (current.status === "DELIVERED" || current.status === "CANCELLED") {
    throw new HttpError(409, "Cette commande est déjà clôturée");
  }
  const now = new Date();
  const update: Prisma.OrderUncheckedUpdateInput = { status: to };
  const ts = TIMESTAMP[to];
  if (ts) (update as Record<string, unknown>)[ts] = now;
  // Une acceptation directe en préparation vaut aussi confirmation.
  if (to === "PREPARING" && !current.confirmedAt) update.confirmedAt = now;
  if (opts.prepMinutes !== undefined) update.prepMinutes = opts.prepMinutes;
  // Code que le client donne au livreur pour clôturer sur place, montré dès que la commande part.
  if (to === "PICKED_UP" && !current.deliveryCode) update.deliveryCode = newDeliveryCode();

  // Montants modifiés dans la même demande (admin) : ce sont eux qui comptent pour les frais et la part du livreur.
  const extraFee = opts.extraFee ?? current.extraFee;
  const deliveryFee = opts.deliveryFee ?? current.deliveryFee;
  if (to === "CANCELLED") {
    if (!opts.reason) throw new HttpError(400, "Indiquez le motif d'annulation");
    update.cancellationReason = opts.reason;
    // Le restaurant qui refuse ou annule : le client n'y est pour rien, aucun frais retenu.
    update.cancellationFee = opts.byRestaurant ? 0 : cancellationFee({ ...current, extraFee, deliveryFee }, await getSettings(prisma), now);
  }
  if (to === "DELIVERED") {
    // Les salariés de Zedeka touchent leur salaire, pas de part par course.
    const driver = current.driverId ? await prisma.driver.findUnique({ where: { id: current.driverId }, select: { employment: true } }) : null;
    const staffDriver = driver?.employment === "STAFF";
    update.driverEarning = staffDriver ? 0 : driverEarning({ ...current, extraFee, deliveryFee }, await getSettings(prisma));
    if (current.paymentMethod === "MOBILE_MONEY") update.paymentStatus = "PAID";
    // Retrait remis au client : payé au comptoir s'il ne l'était pas déjà.
    if (current.fulfillment === "PICKUP") update.paymentStatus = "PAID";
    // Restaurant avec un dépôt Zedeka et livreur salarié : il se paie les plats dessus, la commande ne passera pas
    // par un relevé. Avec un livreur indépendant, la commande reste sur le relevé.
    if (current.restaurantId && settlesOnDeposit(current, await hasDeposit(prisma, current.restaurantId), staffDriver)) update.paidFromDeposit = true;
    update.closedBy = "ADMIN"; // remplacé par CUSTOMER, CODE ou AUTO selon qui clôture
  }
  return update;
}
