import { describe, expect, it, vi } from "vitest";
import { customerNotice, notifyCustomer } from "./customerNotify.js";
import { silentNotifier } from "./notify.js";

const food = { id: "o1", code: "ZD-1234", type: "FOOD", fulfillment: "DELIVERY", customerId: "c1", tableNumber: null, cancellationReason: null, prepMinutes: null } as const;

describe("notifications de suivi du client", () => {
  it("prévient à l'acceptation, au départ du livreur, à la remise et à l'annulation", () => {
    expect(customerNotice({ ...food, prepMinutes: 20 }, "PREPARING")).toMatchObject({ title: "Commande ZD-1234 acceptée", url: "/commande/ZD-1234", tag: "suivi-o1" });
    expect(customerNotice({ ...food, prepMinutes: 20 }, "PREPARING")?.body).toContain("20 min");
    expect(customerNotice(food, "PICKED_UP")).toMatchObject({ title: "Commande ZD-1234 en route", alarm: true });
    expect(customerNotice(food, "HANDED_OVER")?.body).toContain("Confirmez");
    expect(customerNotice({ ...food, cancellationReason: "Plat épuisé" }, "CANCELLED")?.body).toBe("Motif : Plat épuisé");
  });

  it("« prête » ne sonne que pour un retrait ou une table, pas pour une livraison", () => {
    expect(customerNotice(food, "READY")).toBeNull();
    expect(customerNotice({ ...food, fulfillment: "PICKUP" }, "READY")?.body).toContain("récupérer");
    expect(customerNotice({ ...food, fulfillment: "PICKUP", tableNumber: 4 }, "READY")?.body).toContain("table 4");
    expect(customerNotice({ ...food, fulfillment: "PICKUP" }, "PICKED_UP")).toBeNull();
  });

  it("un colis annonce le livreur trouvé, pas une préparation", () => {
    const parcel = { ...food, type: "PARCEL" } as const;
    expect(customerNotice(parcel, "CONFIRMED")?.title).toBe("Colis ZD-1234 : livreur trouvé");
    expect(customerNotice(parcel, "PREPARING")).toBeNull();
    expect(customerNotice(parcel, "PICKED_UP")?.title).toBe("Colis ZD-1234 en route");
    expect(customerNotice(parcel, "DELIVERED")?.body).not.toContain("appétit");
  });

  it("envoie au compte du client, rien pour une commande sans compte", () => {
    const push = vi.fn(async () => 1);
    const notifier = { ...silentNotifier, push };
    notifyCustomer(notifier, food, "PICKED_UP");
    expect(push).toHaveBeenCalledWith("customer", "c1", expect.objectContaining({ url: "/commande/ZD-1234" }));
    push.mockClear();
    notifyCustomer(notifier, { ...food, customerId: null }, "PICKED_UP");
    notifyCustomer(notifier, food, "PENDING");
    expect(push).not.toHaveBeenCalled();
  });
});
