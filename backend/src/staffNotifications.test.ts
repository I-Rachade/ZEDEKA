import type { PrismaClient } from "@prisma/client";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import { issueToken } from "./auth.js";
import { createNotifier, NATIVE_PREFIX } from "./notify.js";
import { notificationCategoriesFor } from "./team.js";

// Notifications de l'équipe : chaque rôle reçoit ses catégories, chacun peut en couper, le fil suit le rôle.

describe("catégories par rôle", () => {
  it("le directeur reçoit tout, le dispatcheur ni candidatures ni finances, un rôle inconnu reçoit l'essentiel", () => {
    expect(notificationCategoriesFor("DIRECTOR")).toEqual(["ORDERS", "RESTAURANTS", "DRIVERS", "APPLICATIONS", "FINANCE"]);
    expect(notificationCategoriesFor("DISPATCHER")).toEqual(["ORDERS", "RESTAURANTS", "DRIVERS"]);
    expect(notificationCategoriesFor("MANAGER")).toEqual(["ORDERS", "RESTAURANTS", "DRIVERS"]);
  });
});

describe("envoi aux navigateurs de l'équipe", () => {
  const subs = [
    { id: "s-admin", role: "admin", subject: "admin", endpoint: `${NATIVE_PREFIX}directeur`, p256dh: "", auth: "android" },
    { id: "s-koffi", role: "admin", subject: "m1", endpoint: `${NATIVE_PREFIX}koffi`, p256dh: "", auth: "android" },
    { id: "s-ama", role: "admin", subject: "m2", endpoint: `${NATIVE_PREFIX}ama`, p256dh: "", auth: "android" },
    { id: "s-old", role: "admin", subject: "m3", endpoint: `${NATIVE_PREFIX}ancien`, p256dh: "", auth: "android" },
  ];
  function setup() {
    const created: unknown[] = [];
    const prisma = {
      staffNotification: { create: async (q: { data: unknown }) => (created.push(q.data), { id: "n1" }) },
      pushSubscription: { findMany: async () => subs, delete: async () => ({}) },
      // m3 est désactivé : absent de la liste des membres actifs.
      teamMember: {
        findMany: async () => [
          { id: "m1", role: "DISPATCHER" },
          { id: "m2", role: "DISPATCHER" },
        ],
      },
      staffNotificationPrefs: { findMany: async () => [{ subject: "m2", muted: '["ORDERS"]' }] },
    } as unknown as PrismaClient;
    const fcm = vi.fn(async () => "sent" as const);
    return { created, fcm, notifier: createNotifier(prisma, { vapid: null, fcm, silent: true }) };
  }

  it("respecte le rôle, les catégories coupées et les comptes désactivés", async () => {
    const { created, fcm, notifier } = setup();
    expect(await notifier.staff("ORDERS", { title: "Commande A1", body: "b", url: "/admin/commandes/1" })).toBe(2);
    expect(fcm.mock.calls.map(([t]) => t).sort()).toEqual(["directeur", "koffi"]);
    expect(created).toEqual([{ category: "ORDERS", title: "Commande A1", body: "b", url: "/admin/commandes/1", alarm: false }]);
    expect((fcm.mock.calls[0] as unknown[])[1]).toMatchObject({ id: "n1", tag: "ORDERS" });

    fcm.mockClear();
    // Finances : directeur seulement.
    expect(await notifier.staff("FINANCE", { title: "Écart", body: "b", url: "/" })).toBe(1);
    expect(fcm.mock.calls.map(([t]) => t)).toEqual(["directeur"]);
  });
});

describe("fil des notifications dans l'admin", () => {
  const STRONG = { adminPassword: "un-mot-de-passe-solide", adminSecret: "a".repeat(64) };
  function setup() {
    const queries: { where: { category: { in: string[] } } }[] = [];
    const saved: unknown[] = [];
    const prisma = {
      teamMember: { findUnique: async () => ({ id: "m1", name: "Koffi", role: "DISPATCHER", active: true }) },
      staffNotificationPrefs: {
        upsert: async (q: { create: unknown; update: unknown }) => {
          saved.push(q.update);
          return { subject: "m1", muted: '["DRIVERS","FINANCE"]', seenAt: new Date("2026-11-01T10:00:00Z") };
        },
      },
      staffNotification: {
        findMany: async (q: (typeof queries)[number]) => (queries.push(q), []),
        count: async () => 3,
      },
    } as unknown as PrismaClient;
    const app = createApp(prisma, { frontendOrigin: "", zedekaWhatsapp: "", ...STRONG });
    const auth = { Authorization: `Bearer ${issueToken(STRONG.adminSecret, Date.now(), "admin", "m1")}` };
    return { app, auth, queries, saved };
  }

  it("ne montre au dispatcheur que ses catégories", async () => {
    const { app, auth, queries } = setup();
    const res = await request(app).get("/api/admin/notifications?category=FINANCE").set(auth);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ unread: 3, categories: ["ORDERS", "RESTAURANTS", "DRIVERS"], muted: ["DRIVERS"] });
    // Catégorie interdite demandée : on retombe sur celles du rôle.
    expect(queries[0].where.category.in).toEqual(["ORDERS", "RESTAURANTS", "DRIVERS"]);
  });

  it("enregistre les catégories coupées (seulement celles du rôle) et la lecture", async () => {
    const { app, auth, saved } = setup();
    const res = await request(app).put("/api/admin/notifications/prefs").set(auth).send({ muted: ["ORDERS", "FINANCE", "ORDERS"] });
    expect(res.body).toEqual({ muted: ["ORDERS"] });
    expect(saved).toEqual([{ muted: '["ORDERS"]' }]);
    const seen = await request(app).post("/api/admin/notifications/seen").set(auth);
    expect(seen.body.unread).toBe(0);
  });
});
