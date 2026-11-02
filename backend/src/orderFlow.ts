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

// Commandes dont Zedeka doit le prix des plats au restaurant (relevés, « à vous verser »). Un retrait payé en
// espèces au comptoir en est exclu : le restaurant a encaissé lui-même, Zedeka ne lui doit rien.
export const OWED_TO_RESTAURANT: Prisma.OrderWhereInput = { NOT: { fulfillment: "PICKUP", paymentMethod: "CASH" } };

// Commandes encore à verser par relevé : dues au restaurant et pas déjà réglées sur son dépôt.
export const SETTLED_BY_STATEMENT: Prisma.OrderWhereInput = { ...OWED_TO_RESTAURANT, paidFromDeposit: false };

// Données à écrire pour passer une commande à un nouveau statut.
export async function statusUpdate(
  prisma: PrismaClient,
  current: Order,
  to: OrderStatus,
  opts: { reason?: string; prepMinutes?: number; extraFee?: number } = {},
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

  const extraFee = opts.extraFee ?? current.extraFee;
  if (to === "CANCELLED") {
    if (!opts.reason) throw new HttpError(400, "Indiquez le motif d'annulation");
    update.cancellationReason = opts.reason;
    update.cancellationFee = cancellationFee({ ...current, extraFee }, await getSettings(prisma), now);
  }
  if (to === "DELIVERED") {
    // Les salariés de Zedeka touchent leur salaire, pas de part par course.
    const driver = current.driverId ? await prisma.driver.findUnique({ where: { id: current.driverId }, select: { employment: true } }) : null;
    update.driverEarning = driver?.employment === "STAFF" ? 0 : driverEarning({ ...current, extraFee }, await getSettings(prisma));
    if (current.paymentMethod === "MOBILE_MONEY") update.paymentStatus = "PAID";
    // Retrait remis au client : payé au comptoir s'il ne l'était pas déjà.
    if (current.fulfillment === "PICKUP") update.paymentStatus = "PAID";
    // Restaurant avec un dépôt Zedeka : il se paie les plats dessus, la commande ne passera pas par un relevé.
    if (current.restaurantId && settlesOnDeposit(current, await hasDeposit(prisma, current.restaurantId))) update.paidFromDeposit = true;
    update.closedBy = "ADMIN"; // remplacé par CUSTOMER, CODE ou AUTO selon qui clôture
  }
  return update;
}
