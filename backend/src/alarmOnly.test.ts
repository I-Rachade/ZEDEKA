import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { createNotifier, isCritical, NATIVE_PREFIX } from "./notify.js";

// Appli mobile de l'admin : un appareil réglé sur « alertes critiques seulement » ne reçoit que les alarmes et
// les alertes techniques ; les autres appareils du même membre reçoivent tout.

describe("alertes critiques seulement", () => {
  it("reconnaît une alerte critique", () => {
    expect(isCritical("ORDERS", { alarm: true })).toBe(true);
    expect(isCritical("TECH", {})).toBe(true);
    expect(isCritical("ORDERS", {})).toBe(false);
  });

  it("filtre par appareil", async () => {
    const subs = [
      { id: "pc", role: "admin", subject: "admin", endpoint: `${NATIVE_PREFIX}pc`, p256dh: "", auth: "android", alarmOnly: false },
      { id: "tel", role: "admin", subject: "admin", endpoint: `${NATIVE_PREFIX}tel`, p256dh: "", auth: "android", alarmOnly: true },
    ];
    const prisma = {
      staffNotification: { create: async () => ({ id: "n1" }) },
      pushSubscription: { findMany: async () => subs, delete: async () => ({}), deleteMany: async () => ({ count: 0 }) },
      teamMember: { findMany: async () => [] },
      staffNotificationPrefs: { findMany: async () => [] },
    } as unknown as PrismaClient;
    const fcm = vi.fn(async () => "sent" as const);
    const notifier = createNotifier(prisma, { vapid: null, fcm, silent: true });

    await notifier.staff("ORDERS", { title: "Nouvelle commande", body: "b", url: "/admin" });
    expect(fcm.mock.calls.map((c) => (c as unknown[])[0])).toEqual(["pc"]);

    fcm.mockClear();
    await notifier.staff("ORDERS", { title: "Sans réponse", body: "b", url: "/admin", alarm: true });
    expect(fcm.mock.calls.map((c) => (c as unknown[])[0]).sort()).toEqual(["pc", "tel"]);

    fcm.mockClear();
    await notifier.staff("TECH", { title: "API lente", body: "b", url: "/admin/performance" });
    expect(fcm.mock.calls.map((c) => (c as unknown[])[0]).sort()).toEqual(["pc", "tel"]);
  });
});
