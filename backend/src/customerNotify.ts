import type { Order, OrderStatus } from "@prisma/client";
import type { Notifier, PushPayload } from "./notify.js";

// Notifications de suivi pour le client connecté (application Zedeka ou navigateur abonné) : chaque étape
// importante de sa commande, sans attendre qu'il rouvre le suivi. Les commandes sans compte ne reçoivent rien.

export type CustomerEvent = OrderStatus | "HANDED_OVER";

type OrderForNotice = Pick<Order, "id" | "code" | "type" | "fulfillment" | "customerId" | "tableNumber" | "cancellationReason" | "prepMinutes">;

export function customerNotice(o: OrderForNotice, event: CustomerEvent): PushPayload | null {
  const parcel = o.type === "PARCEL";
  const pickup = o.fulfillment === "PICKUP";
  const what = parcel ? `Colis ${o.code}` : `Commande ${o.code}`;
  const base = { url: `/commande/${o.code}`, tag: `suivi-${o.id}` };
  switch (event) {
    case "CONFIRMED":
      if (parcel) return { ...base, title: `${what} : livreur trouvé`, body: "Un livreur va venir chercher votre colis." };
    // falls through
    case "PREPARING":
      if (parcel) return null;
      return { ...base, title: `${what} acceptée`, body: o.prepMinutes ? `Le restaurant la prépare, prête dans environ ${o.prepMinutes} min.` : "Le restaurant prépare votre commande." };
    case "READY":
      // En livraison, l'étape suivante (livreur en route) suffit ; sur place ou à emporter, c'est le moment de venir.
      if (!pickup || parcel) return null;
      return { ...base, title: `${what} prête`, body: o.tableNumber ? `Elle arrive à votre table ${o.tableNumber}.` : "Vous pouvez venir la récupérer au restaurant.", alarm: true };
    case "PICKED_UP":
      if (pickup) return null;
      return { ...base, title: `${what} en route`, body: "Le livreur arrive. Gardez votre code de livraison sous la main.", alarm: true };
    case "HANDED_OVER":
      return { ...base, title: `${what} remise`, body: "Confirmez la réception et notez la livraison." };
    case "DELIVERED":
      return { ...base, title: `${what} ${pickup ? "remise" : "livrée"}`, body: parcel ? "Merci d'avoir choisi Zedeka." : "Merci d'avoir choisi Zedeka. Bon appétit !" };
    case "CANCELLED":
      return { ...base, title: `${what} annulée`, body: o.cancellationReason ? `Motif : ${o.cancellationReason}` : "Ouvrez le suivi pour en savoir plus." };
    default:
      return null;
  }
}

// Ne bloque jamais l'action qui l'appelle : une notification manquée ne doit pas faire échouer un changement de statut.
export function notifyCustomer(notifier: Notifier, o: OrderForNotice, event: CustomerEvent): void {
  if (!o.customerId) return;
  const payload = customerNotice(o, event);
  if (!payload) return;
  void notifier.push("customer", o.customerId, payload).catch(() => {});
}
