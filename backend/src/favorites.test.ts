import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { FAVORITE_NAME, favoriteDispatch, inviteFavorite, nextFavorite, sortFavorites, wantsFavorite } from "./favorites.js";
import type { Notifier } from "./notify.js";

const now = new Date("2026-11-14T12:00:00Z");
const notifier = { push: async () => 1, staff: async () => 1, sms: async () => {}, publicKey: "" } as unknown as Notifier;

describe("livreur favori : choix du favori", () => {
  const favs = [
    { driverId: "b", rank: 2 },
    { driverId: "a", rank: 1 },
    { driverId: "c", rank: 3 },
  ];
  it("prend le premier dans l'ordre, s'il est libre", () => {
    expect(nextFavorite(favs, new Set(["a", "b", "c"]), new Set())?.driverId).toBe("a");
  });
  it("passe au suivant quand le premier n'est pas libre ou a déjà été sollicité", () => {
    expect(nextFavorite(favs, new Set(["b", "c"]), new Set())?.driverId).toBe("b");
    expect(nextFavorite(favs, new Set(["a", "b", "c"]), new Set(["a", "b"]))?.driverId).toBe("c");
  });
  it("ne rend personne quand tous ont été sollicités ou sont hors ligne", () => {
    expect(nextFavorite(favs, new Set(["a"]), new Set(["a"]))).toBeNull();
    expect(nextFavorite(favs, new Set(), new Set())).toBeNull();
  });
  it("range les refus à la fin, les autres dans l'ordre", () => {
    const rows = sortFavorites([
      { id: "x", status: "DECLINED", rank: 1 },
      { id: "y", status: "ACTIVE", rank: 2 },
      { id: "z", status: "INVITED", rank: 1 },
    ]);
    expect(rows.map((r) => r.id)).toEqual(["z", "y", "x"]);
  });
});

describe("livreur favori : quelles courses passent d'abord par les favoris", () => {
  it("toujours quand le commerce l'a demandé", () => {
    expect(wantsFavorite({ dispatchRoute: "FAVORITE", assignments: [{ driverId: "x", assignedBy: "Dispatch" }] }, false)).toBe(true);
  });
  it("jamais en demande ouverte", () => {
    expect(wantsFavorite({ dispatchRoute: "OPEN", assignments: [] }, true)).toBe(false);
  });
  it("par le réglage « favori d'abord », tant que la course n'a été proposée à personne d'autre", () => {
    expect(wantsFavorite({ dispatchRoute: null, assignments: [] }, true)).toBe(true);
    expect(wantsFavorite({ dispatchRoute: null, assignments: [] }, false)).toBe(false);
    expect(wantsFavorite({ dispatchRoute: null, assignments: [{ driverId: "x", assignedBy: "Attribution automatique" }] }, true)).toBe(false);
  });
});

// Base factice : commandes, favoris et livreurs libres ; garde les écritures pour les vérifier.
function fakeDb(opts: {
  orders: { id: string; code: string; restaurantId?: string; merchantId?: string; dispatchRoute?: string | null; assignments?: { driverId: string; assignedBy: string | null }[] }[];
  favorites: { restaurantId?: string; merchantId?: string; driverId: string; rank: number }[];
  free: string[];
  favoriteFirst?: boolean;
}) {
  const assigned: { orderId: string; driverId: string }[] = [];
  const routed: { ids: string[]; route: string }[] = [];
  const orders = opts.orders.map((o) => ({ restaurantId: null, merchantId: null, dispatchRoute: null, assignments: [], ...o }));
  const prisma = {
    order: {
      findMany: async () => orders,
      findUnique: async () => ({ pickupAt: null }),
      updateMany: async (args: { where: { id: string | { in: string[] } }; data: { driverId?: string; dispatchRoute?: string; slotReminderAt?: null } }) => {
        if (typeof args.where.id === "object") routed.push({ ids: args.where.id.in, route: args.data.dispatchRoute! });
        else if (args.data.driverId) assigned.push({ orderId: args.where.id, driverId: args.data.driverId });
        return { count: 1 };
      },
    },
    restaurant: { findMany: async () => [...new Set(orders.map((o) => o.restaurantId).filter(Boolean))].map((id) => ({ id, name: "Chez Ami", favoriteFirst: opts.favoriteFirst ?? true })) },
    merchant: { findMany: async () => [...new Set(orders.map((o) => o.merchantId).filter(Boolean))].map((id) => ({ id, shopName: "Boutique", favoriteFirst: opts.favoriteFirst ?? true, customerId: "c1" })) },
    favoriteDriver: { findMany: async () => opts.favorites.map((f) => ({ restaurantId: null, merchantId: null, ...f })) },
    driver: {
      findMany: async () => opts.free.map((id) => ({ id })),
      findUnique: async () => ({ employment: "FREELANCE" }),
    },
    driverAssignment: { updateMany: async () => ({ count: 0 }), create: async () => ({}) },
  } as unknown as PrismaClient;
  return { prisma, assigned, routed };
}

describe("livreur favori : répartition", () => {
  it("propose une course prête du restaurant à son 1er favori libre", async () => {
    const db = fakeDb({
      orders: [{ id: "o1", code: "ZD-1", restaurantId: "r1" }],
      favorites: [
        { restaurantId: "r1", driverId: "d2", rank: 2 },
        { restaurantId: "r1", driverId: "d1", rank: 1 },
      ],
      free: ["d1", "d2"],
    });
    expect(await favoriteDispatch(db.prisma, notifier, now)).toBe(1);
    expect(db.assigned).toEqual([{ orderId: "o1", driverId: "d1" }]);
  });

  it("après un refus du 1er, passe au 2e", async () => {
    const db = fakeDb({
      orders: [{ id: "o1", code: "ZD-1", restaurantId: "r1", dispatchRoute: "FAVORITE", assignments: [{ driverId: "d1", assignedBy: FAVORITE_NAME }] }],
      favorites: [
        { restaurantId: "r1", driverId: "d1", rank: 1 },
        { restaurantId: "r1", driverId: "d2", rank: 2 },
      ],
      free: ["d1", "d2"],
    });
    await favoriteDispatch(db.prisma, notifier, now);
    expect(db.assigned).toEqual([{ orderId: "o1", driverId: "d2" }]);
  });

  it("sans favori disponible, la course passe en demande ouverte", async () => {
    const db = fakeDb({ orders: [{ id: "o1", code: "ZD-1", restaurantId: "r1" }], favorites: [{ restaurantId: "r1", driverId: "d1", rank: 1 }], free: [] });
    expect(await favoriteDispatch(db.prisma, notifier, now)).toBe(0);
    expect(db.routed).toEqual([{ ids: ["o1"], route: "OPEN" }]);
  });

  it("donne tout l'envoi d'un marchand au même favori (un seul ramassage)", async () => {
    const db = fakeDb({
      orders: [
        { id: "p1", code: "ZD-P1", merchantId: "m1" },
        { id: "p2", code: "ZD-P2", merchantId: "m1" },
        { id: "p3", code: "ZD-P3", merchantId: "m1" },
      ],
      favorites: [{ merchantId: "m1", driverId: "d9", rank: 1 }],
      free: ["d9"],
    });
    expect(await favoriteDispatch(db.prisma, notifier, now)).toBe(3);
    expect(db.assigned.map((a) => a.driverId)).toEqual(["d9", "d9", "d9"]);
  });

  it("laisse les courses à la répartition habituelle quand le commerce a coupé « favori d'abord »", async () => {
    const db = fakeDb({ orders: [{ id: "o1", code: "ZD-1", restaurantId: "r1" }], favorites: [{ restaurantId: "r1", driverId: "d1", rank: 1 }], free: ["d1"], favoriteFirst: false });
    expect(await favoriteDispatch(db.prisma, notifier, now)).toBe(0);
    expect(db.assigned).toEqual([]);
    expect(db.routed).toEqual([]);
  });
});

describe("livreur favori : invitation", () => {
  const driver = { id: "d1", name: "Kodjo", status: "APPROVED", active: true, deliveries: true };
  const prismaWith = (existing: { id: string; driverId: string; status: string; rank: number }[], found = driver) =>
    ({
      driver: { findFirst: async () => found },
      favoriteDriver: {
        findMany: async () => existing,
        create: async (args: { data: { rank: number; status: string } }) => ({
          id: "f-new",
          rank: args.data.rank,
          status: args.data.status,
          createdAt: now,
          respondedAt: null,
          driver: { id: "d1", name: "Kodjo", phone: "+22890000000", vehicle: "MOTO", employment: "FREELANCE", online: false, active: true, deletedAt: null },
        }),
      },
    }) as unknown as PrismaClient;

  it("invite un livreur validé, à la suite des autres", async () => {
    const fav = await inviteFavorite(prismaWith([{ id: "f1", driverId: "d0", status: "ACTIVE", rank: 1 }]), notifier, { restaurantId: "r1" }, "+22890000000", "Gérant", "Chez Ami");
    expect(fav.status).toBe("INVITED");
    expect(fav.rank).toBe(2);
  });

  it("refuse un 4e favori", async () => {
    const three = ["a", "b", "c"].map((d, i) => ({ id: `f${i}`, driverId: d, status: "ACTIVE", rank: i + 1 }));
    await expect(inviteFavorite(prismaWith(three), notifier, { restaurantId: "r1" }, "+22890000000", "Gérant", "Chez Ami")).rejects.toThrow("3 livreurs favoris au plus");
  });

  it("refuse un numéro qui n'est pas un livreur validé", async () => {
    await expect(inviteFavorite(prismaWith([], { ...driver, status: "PENDING" }), notifier, { merchantId: "m1" }, "+22890000000", "Ama", "Boutique")).rejects.toThrow("Aucun livreur");
  });
});
