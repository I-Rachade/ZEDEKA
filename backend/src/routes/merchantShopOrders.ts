import type { Response, Router } from "express";
import type { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { favoriteDispatch } from "../favorites.js";
import type { Notifier } from "../notify.js";
import { statusUpdate } from "../orderFlow.js";
import { merchantNet } from "../parcel.js";
import { formatFcfa, normalizeCode } from "../pricing.js";
import { ACCEPT_WITHIN_MS, quantities, SHOP_REFUSED, SHOP_TIMEOUT, shopMove } from "../shop.js";
import { firstError } from "../util.js";
import { HttpError } from "./adminWrite.js";
import { restock } from "./shopPublic.js";

// Ventes de la boutique en ligne dans l'appli marchand (/api/marchand/shop-orders) : commandes reçues,
// accepter, préparer le paquet et le déclarer prêt (un livreur Zedeka vient alors le chercher), ou refuser.
// Le marchand voit ce qu'il touchera après la part de Zedeka.

const OPEN = ["PENDING", "CONFIRMED", "PREPARING", "READY", "PICKED_UP"] as const;

const saleSelect = {
  id: true,
  code: true,
  status: true,
  createdAt: true,
  confirmedAt: true,
  readyAt: true,
  pickedUpAt: true,
  deliveredAt: true,
  cancelledAt: true,
  cancellationReason: true,
  recipientName: true,
  recipientPhone: true,
  address: true,
  note: true,
  paymentMethod: true,
  subtotal: true,
  deliveryFee: true,
  extraFee: true,
  discount: true,
  total: true,
  commission: true,
  cashCollected: true,
  storeSale: true,
  merchantPayoutId: true,
  customerId: true,
  driver: { select: { name: true, phone: true } },
  storeItems: { select: { productId: true, name: true, choice: true, imageUrl: true, unitPrice: true, quantity: true } },
} satisfies Prisma.OrderSelect;
type SaleRow = Prisma.OrderGetPayload<{ select: typeof saleSelect }>;

// Le numéro du client n'apparaît qu'une fois la commande acceptée, comme pour les restaurants.
export function saleView(o: SaleRow) {
  const accepted = o.status !== "PENDING" && !(o.status === "CANCELLED" && !o.confirmedAt);
  return {
    ...o,
    customerId: undefined,
    recipientPhone: accepted ? o.recipientPhone : null,
    driver: o.driver && (o.status === "READY" || o.status === "PICKED_UP") ? o.driver : null,
    acceptBefore: o.status === "PENDING" ? new Date(o.createdAt.getTime() + ACCEPT_WITHIN_MS) : null,
    net: o.status === "CANCELLED" ? 0 : merchantNet(o),
    paidOut: !!o.merchantPayoutId,
    merchantPayoutId: undefined,
  };
}

const refuseInput = z.object({ reason: z.string().trim().min(3, "Indiquez le motif").max(200).optional() });

type Shop = { id: string; shopName: string };

export function mountShopOrderRoutes(router: Router, prisma: PrismaClient, notifier: Notifier, merchantOf: (res: Response) => Shop | null) {
  function shop(res: Response): Shop | null {
    const m = merchantOf(res);
    if (!m) res.status(404).json({ error: "Créez d'abord votre boutique" });
    return m;
  }

  router.get("/shop-orders", async (req, res) => {
    const m = shop(res);
    if (!m) return;
    const filter = String(req.query.filter ?? "open");
    const rows = await prisma.order.findMany({
      where: { merchantId: m.id, storeSale: true, ...(filter === "open" ? { status: { in: [...OPEN] } } : filter === "done" ? { status: { in: ["DELIVERED", "CANCELLED"] } } : {}) },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: saleSelect,
    });
    const waiting = await prisma.order.count({ where: { merchantId: m.id, storeSale: true, status: "PENDING" } });
    res.json({ orders: rows.map(saleView), waiting });
  });

  router.get("/shop-orders/:code", async (req, res) => {
    const m = shop(res);
    if (!m) return;
    const o = await prisma.order.findFirst({ where: { code: normalizeCode(req.params.code), merchantId: m.id, storeSale: true }, select: saleSelect });
    if (!o) return void res.status(404).json({ error: "Commande introuvable" });
    res.json(saleView(o));
  });

  router.post("/shop-orders/:code/:action", async (req, res) => {
    const m = shop(res);
    if (!m) return;
    const action = req.params.action;
    if (action !== "accept" && action !== "ready" && action !== "refuse") return void res.status(404).json({ error: "Action inconnue" });
    const parsed = refuseInput.safeParse(req.body ?? {});
    if (!parsed.success) return void res.status(400).json({ error: firstError(parsed.error) });
    const current = await prisma.order.findFirst({ where: { code: normalizeCode(req.params.code), merchantId: m.id, storeSale: true } });
    if (!current) return void res.status(404).json({ error: "Commande introuvable" });
    const to = shopMove(current.status, action);
    if (!to) return void res.status(409).json({ error: current.status === "CANCELLED" ? "Cette commande est annulée" : "Étape déjà passée : rechargez la commande" });
    try {
      const reason = action === "refuse" ? (parsed.data.reason ? `${SHOP_REFUSED} : ${parsed.data.reason}` : SHOP_REFUSED) : undefined;
      const update = await statusUpdate(prisma, current, to, { reason, byRestaurant: true });
      const { count } = await prisma.order.updateMany({ where: { id: current.id, status: current.status }, data: update as never });
      if (!count) throw new HttpError(409, "La commande vient de changer : rechargez-la");
    } catch (e) {
      if (e instanceof HttpError) return void res.status(e.status).json({ error: e.message });
      throw e;
    }
    const now = new Date();
    if (to === "CANCELLED") await giveBack(prisma, current.id);
    if (current.customerId) {
      const notice = {
        CONFIRMED: { title: `Commande ${current.code} acceptée`, body: `${m.shopName} prépare votre paquet.` },
        READY: { title: `Commande ${current.code} prête`, body: "Un livreur Zedeka va la chercher à la boutique." },
        CANCELLED: { title: `Commande ${current.code} annulée`, body: `${m.shopName} ne peut pas la préparer.${current.paymentMethod === "MOBILE_MONEY" ? " Vous serez remboursé." : ""}` },
      }[to];
      void notifier.push("customer", current.customerId, { ...notice, url: `/commande/${current.code}`, tag: `suivi-${current.id}` }).catch(() => {});
    }
    // Paquet prêt : d'abord aux livreurs favoris de la boutique, sinon la répartition habituelle (chaque minute).
    if (to === "READY") await favoriteDispatch(prisma, notifier, now, { merchantId: m.id }).catch((e) => console.error("livreurs favoris", e));
    if (to === "CANCELLED")
      void notifier.staff("ORDERS", { title: `Refusée : ${current.code}`, body: `${m.shopName} · ${formatFcfa(current.total)}${current.paymentMethod === "MOBILE_MONEY" ? " · à rembourser" : ""}`, url: `/admin/commandes/${current.id}`, tag: `order-${current.id}` });
    const o = await prisma.order.findUniqueOrThrow({ where: { id: current.id }, select: saleSelect });
    res.json(saleView(o));
  });
}

// Remet en stock les articles d'une vente annulée.
export async function giveBack(prisma: PrismaClient, orderId: string) {
  const items = await prisma.storeOrderItem.findMany({ where: { orderId }, select: { productId: true, quantity: true } });
  await restock(prisma, quantities(items));
}

// Chaque minute : une vente sans réponse de la boutique après 30 minutes est annulée, le stock remis et le client
// prévenu. Sans frais pour le client.
export async function expireShopOrders(prisma: PrismaClient, notifier: Notifier, now = new Date()) {
  const late = await prisma.order.findMany({
    where: { storeSale: true, status: "PENDING", createdAt: { lt: new Date(now.getTime() - ACCEPT_WITHIN_MS) } },
    take: 50,
    select: { id: true, code: true, customerId: true, total: true, paymentMethod: true, merchant: { select: { shopName: true, customerId: true } } },
  });
  let expired = 0;
  for (const o of late) {
    const { count } = await prisma.order.updateMany({
      where: { id: o.id, status: "PENDING" },
      data: { status: "CANCELLED", cancelledAt: now, cancellationReason: SHOP_TIMEOUT, cancellationFee: 0 },
    });
    if (!count) continue;
    expired++;
    await giveBack(prisma, o.id);
    if (o.customerId)
      void notifier
        .push("customer", o.customerId, { title: `Commande ${o.code} annulée`, body: `${o.merchant?.shopName ?? "La boutique"} n'a pas répondu à temps.${o.paymentMethod === "MOBILE_MONEY" ? " Vous serez remboursé." : ""}`, url: `/commande/${o.code}`, tag: `suivi-${o.id}` })
        .catch(() => {});
    if (o.merchant) void notifier.push("customer", o.merchant.customerId, { title: `Commande ${o.code} annulée`, body: "Pas de réponse en 30 minutes : le client a été prévenu.", url: `/marchand/commandes/${o.code}`, tag: `shop-order-${o.id}` }).catch(() => {});
  }
  return expired;
}

// Vente annulée par l'équipe Zedeka (fiche commande de l'admin) : les articles reviennent en stock, comme pour un
// refus du marchand, et le marchand est prévenu pour ne pas préparer ni remettre le paquet.
export async function shopSaleCancelledByStaff(prisma: PrismaClient, notifier: Notifier, order: { id: string; code: string; merchantId: string | null; cancellationReason: string | null }) {
  await giveBack(prisma, order.id);
  if (!order.merchantId) return;
  const merchant = await prisma.merchant.findUnique({ where: { id: order.merchantId }, select: { customerId: true } });
  if (!merchant) return;
  void notifier
    .push("customer", merchant.customerId, {
      title: `Commande ${order.code} annulée`,
      body: `Annulée par l'équipe Zedeka${order.cancellationReason ? ` : ${order.cancellationReason}` : ""}. Les articles sont remis en stock.`,
      url: `/marchand/commandes/${order.code}`,
      tag: `shop-order-${order.id}`,
      alarm: true,
    })
    .catch(() => {});
}
