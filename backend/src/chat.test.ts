import type { PrismaClient } from "@prisma/client";
import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { issueToken } from "./auth.js";
import { BURST_LIMIT, chatNotice, chatOpen, customerChatRouter, customerConversations, driverChatRoutes, messageInput, readThread, sendMessage } from "./chat.js";
import type { Notifier, PushPayload } from "./notify.js";
import { newReceiptKey } from "./receipt.js";

type Row = Record<string, unknown> & { id: string };
const SECRET = "secret-de-test";

// Base en mémoire : commandes, propositions aux livreurs, livreurs, clients et messages.
function setup() {
  const orders: Row[] = [];
  const assignments: Row[] = [];
  const messages: Row[] = [];
  const drivers: Row[] = [
    { id: "d1", name: "Koffi Mensah", phone: "+22890112233" },
    { id: "d2", name: "Ama Doe", phone: "+22891445566" },
  ];
  const customers: Row[] = [{ id: "c1", deletedAt: null, sessionsValidFrom: null }];
  const pushes: { role: string; subject: string; payload: PushPayload }[] = [];
  let n = 0;
  const matchMsg = (m: Row, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) => {
      if (k === "createdAt") return (m.createdAt as Date) >= (v as { gte: Date }).gte;
      if (k === "id") return (v as { in: string[] }).in.includes(m.id);
      return m[k] === v;
    });
  const hasAccepted = (orderId: string, driverId: unknown) => assignments.some((a) => a.orderId === orderId && a.driverId === driverId && a.status === "ACCEPTED");
  const prisma = {
    order: {
      findUnique: async ({ where }: { where: { code: string } }) => {
        const o = orders.find((x) => x.code === where.code);
        return o ? { ...o, driver: drivers.find((d) => d.id === o.driverId) ?? null } : null;
      },
      findFirst: async ({ where }: { where: { id: string; assignments: { some: { driverId: string } } } }) =>
        orders.find((o) => o.id === where.id && hasAccepted(o.id, where.assignments.some.driverId)) ?? null,
      findMany: async ({ where }: { where: { customerId: string } }) =>
        orders
          .filter((o) => o.customerId === where.customerId)
          .map((o) => {
            const own = messages.filter((m) => m.orderId === o.id).sort((a, b) => (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime());
            return {
              ...o,
              assignments: assignments.filter((a) => a.orderId === o.id && a.status === "ACCEPTED"),
              restaurant: { name: "Chez Tante" },
              merchant: null,
              driver: drivers.find((d) => d.id === o.driverId) ?? null,
              messages: own.slice(0, 1),
              _count: { messages: own.filter((m) => m.sender === "DRIVER" && !m.readAt).length },
            };
          })
          .filter((o) => (["PENDING", "CONFIRMED", "PREPARING", "READY", "PICKED_UP"].includes(o.status as string) && o.driverId) || o.messages.length),
    },
    driverAssignment: {
      count: async ({ where }: { where: { orderId: string; driverId: string } }) => (hasAccepted(where.orderId, where.driverId) ? 1 : 0),
    },
    driver: { findUnique: async ({ where }: { where: { id: string } }) => drivers.find((d) => d.id === where.id) ?? null },
    customer: { findUnique: async ({ where }: { where: { id: string } }) => customers.find((c) => c.id === where.id) ?? null },
    chatMessage: {
      findMany: async ({ where }: { where: Record<string, unknown> }) =>
        messages.filter((m) => matchMsg(m, where)).map((m) => ({ id: m.id, sender: m.sender, body: m.body, readAt: m.readAt, createdAt: m.createdAt })),
      count: async ({ where }: { where: Record<string, unknown> }) => messages.filter((m) => matchMsg(m, where)).length,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `m${++n}`, readAt: null, createdAt: new Date(Date.now() + n), ...data };
        messages.push(row);
        return row;
      },
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const hit = messages.filter((m) => matchMsg(m, where));
        hit.forEach((m) => Object.assign(m, data));
        return { count: hit.length };
      },
    },
  } as unknown as PrismaClient;
  const notifier: Notifier = {
    publicKey: "",
    push: async (role, subject, payload) => {
      pushes.push({ role, subject, payload });
      return 1;
    },
    staff: async () => 0,
    sms: async () => {},
  };
  const order = (o: Partial<Row> & { id: string }) => {
    const row = { code: `ZD-${o.id.toUpperCase()}`, status: "PICKED_UP", driverId: "d1", customerId: null, receiptKeyHash: null, fulfillment: "DELIVERY", tableNumber: null, customerName: "Afi Kodjo", createdAt: new Date(), type: "FOOD", storeSale: false, ...o };
    orders.push(row);
    return row;
  };
  const accept = (orderId: string, driverId: string, status = "ACCEPTED") => assignments.push({ id: `a${++n}`, orderId, driverId, status });

  const app = express();
  app.use(express.json());
  app.use("/api", customerChatRouter(prisma, { secret: SECRET, notifier }));
  const driverRouter = express.Router();
  driverRouter.use((req, res, next) => {
    res.locals.driverId = req.get("x-driver");
    next();
  });
  driverChatRoutes(driverRouter, prisma, notifier);
  app.use("/api/livreur", driverRouter);
  return { prisma, notifier, pushes, messages, assignments, order, accept, app };
}

describe("messagerie : règles", () => {
  it("s'ouvre quand le livreur a accepté, se ferme à la livraison ou à l'annulation", () => {
    expect(chatOpen({ status: "CONFIRMED", driverId: "d1" }, true)).toBe(true);
    expect(chatOpen({ status: "PICKED_UP", driverId: "d1" }, true)).toBe(true);
    // Simple proposition : le livreur n'a pas encore accepté.
    expect(chatOpen({ status: "CONFIRMED", driverId: "d1" }, false)).toBe(false);
    expect(chatOpen({ status: "PENDING", driverId: null }, false)).toBe(false);
    expect(chatOpen({ status: "DELIVERED", driverId: "d1" }, true)).toBe(false);
    expect(chatOpen({ status: "CANCELLED", driverId: "d1" }, true)).toBe(false);
  });

  it("refuse un message vide ou trop long, nettoie les espaces", () => {
    expect(messageInput.safeParse({ body: "   " }).success).toBe(false);
    expect(messageInput.safeParse({ body: "x".repeat(501) }).success).toBe(false);
    expect(messageInput.parse({ body: "  Je descends  " }).body).toBe("Je descends");
  });

  it("notifie le livreur vers sa course, le client vers son suivi", () => {
    const o = { id: "o1", code: "ZD-AB12" };
    expect(chatNotice(o, "CUSTOMER", "Je descends", null)).toMatchObject({ url: "/livreur/course/o1?chat=1", tag: "chat-o1" });
    const toCustomer = chatNotice(o, "DRIVER", "Je suis arrivé", "Koffi");
    expect(toCustomer.title).toContain("Koffi");
    expect(toCustomer.url).toBe("/commande/ZD-AB12?chat=1");
    expect(chatNotice(o, "DRIVER", "x".repeat(300), null).body.length).toBeLessThanOrEqual(120);
  });
});

describe("messagerie : envoi et archive", () => {
  it("envoie, prévient l'autre personne et marque comme lu à l'ouverture", async () => {
    const s = setup();
    const o = s.order({ id: "o1", customerId: "c1" });
    s.accept("o1", "d1");
    await sendMessage(s.prisma, s.notifier, o as never, "DRIVER", "Je suis arrivé.");
    expect(s.pushes).toEqual([expect.objectContaining({ role: "customer", subject: "c1" })]);
    await sendMessage(s.prisma, s.notifier, o as never, "CUSTOMER", "Je descends.");
    expect(s.pushes[1]).toMatchObject({ role: "driver", subject: "d1" });

    // Badge : le client voit 1 non lu sans le marquer.
    const peek = await readThread(s.prisma, "o1", "CUSTOMER", null, true);
    expect(peek.unread).toBe(1);
    const opened = await readThread(s.prisma, "o1", "CUSTOMER", null);
    expect(opened.messages.map((m) => [m.mine, m.body])).toEqual([
      [false, "Je suis arrivé."],
      [true, "Je descends."],
    ]);
    expect((await readThread(s.prisma, "o1", "CUSTOMER", null, true)).unread).toBe(0);
    // Le livreur voit que son message a été lu.
    expect((await readThread(s.prisma, "o1", "DRIVER", "d1")).messages[0]).toMatchObject({ mine: true, read: true });
  });

  it("garde la conversation après la livraison, en lecture seule", async () => {
    const s = setup();
    const o = s.order({ id: "o1" });
    s.accept("o1", "d1");
    await sendMessage(s.prisma, s.notifier, o as never, "CUSTOMER", "Merci !");
    o.status = "DELIVERED";
    await expect(sendMessage(s.prisma, s.notifier, o as never, "CUSTOMER", "Encore")).rejects.toMatchObject({ status: 409 });
    expect((await readThread(s.prisma, "o1", "DRIVER", "d1")).messages).toHaveLength(1);
  });

  it("n'ouvre pas la conversation sur une simple proposition", async () => {
    const s = setup();
    const o = s.order({ id: "o1", status: "CONFIRMED" });
    s.accept("o1", "d1", "SENT");
    await expect(sendMessage(s.prisma, s.notifier, o as never, "CUSTOMER", "Allô")).rejects.toMatchObject({ status: 409 });
  });

  it("freine les rafales", async () => {
    const s = setup();
    const o = s.order({ id: "o1" });
    s.accept("o1", "d1");
    for (let i = 0; i < BURST_LIMIT; i++) await sendMessage(s.prisma, s.notifier, o as never, "DRIVER", `m${i}`);
    await expect(sendMessage(s.prisma, s.notifier, o as never, "DRIVER", "de trop")).rejects.toMatchObject({ status: 429 });
    // Le client, lui, peut encore répondre.
    await expect(sendMessage(s.prisma, s.notifier, o as never, "CUSTOMER", "ok")).resolves.toMatchObject({ mine: true });
  });

  it("un nouveau livreur ne lit pas ce qui a été écrit avec le précédent", async () => {
    const s = setup();
    const o = s.order({ id: "o1" });
    s.accept("o1", "d1");
    await sendMessage(s.prisma, s.notifier, o as never, "CUSTOMER", "Code portail 1234");
    o.driverId = "d2";
    s.assignments[0].status = "WITHDRAWN";
    s.accept("o1", "d2");
    await sendMessage(s.prisma, s.notifier, o as never, "DRIVER", "Bonjour, je reprends la course.");
    expect((await readThread(s.prisma, "o1", "DRIVER", "d2")).messages.map((m) => m.body)).toEqual(["Bonjour, je reprends la course."]);
    expect((await readThread(s.prisma, "o1", "CUSTOMER", null)).messages).toHaveLength(2);
  });
});

describe("messagerie : accès", () => {
  it("WhatsApp du livreur : seulement pour qui a commandé, pendant la course", async () => {
    const s = setup();
    const { key, hash } = newReceiptKey();
    const o = s.order({ id: "o1", receiptKeyHash: hash });
    s.order({ id: "o2", receiptKeyHash: hash });
    s.accept("o1", "d1");
    s.accept("o2", "d1", "OFFERED");
    // Le code seul (page publique, lien partagé) ne donne rien.
    await request(s.app).get("/api/chat/ZD-O1").expect(404);
    const open = await request(s.app).get("/api/chat/ZD-O1?peek=1").set("X-Receipt-Key", key).expect(200);
    expect(open.body.driverWhatsapp).toBe("22890112233");
    // Simple proposition : pas encore de numéro.
    const offered = await request(s.app).get("/api/chat/ZD-O2?peek=1").set("X-Receipt-Key", key).expect(200);
    expect(offered.body.driverWhatsapp).toBeNull();
    // Livrée : le fil reste lisible, le numéro n'est plus donné.
    o.status = "DELIVERED";
    const done = await request(s.app).get("/api/chat/ZD-O1?peek=1").set("X-Receipt-Key", key).expect(200);
    expect(done.body.driverWhatsapp).toBeNull();
  });

  it("client sans compte : seulement depuis l'appareil qui a commandé", async () => {
    const s = setup();
    const { key, hash } = newReceiptKey();
    s.order({ id: "o1", receiptKeyHash: hash });
    s.accept("o1", "d1");
    await request(s.app).get("/api/chat/ZD-O1").expect(404);
    await request(s.app).post("/api/chat/ZD-O1").send({ body: "Bonjour" }).expect(404);
    const res = await request(s.app).post("/api/chat/ZD-O1").set("X-Receipt-Key", key).send({ body: "Bonjour" }).expect(200);
    expect(res.body).toMatchObject({ mine: true, body: "Bonjour" });
    const thread = await request(s.app).get("/api/chat/ZD-O1").set("X-Receipt-Key", key).expect(200);
    expect(thread.body).toMatchObject({ open: true, driverFirstName: "Koffi", driverWhatsapp: "22890112233", messages: [expect.objectContaining({ body: "Bonjour" })] });
    await request(s.app).get("/api/chat/ZD-NOPE").set("X-Receipt-Key", key).expect(404);
  });

  it("client connecté : seulement son compte", async () => {
    const s = setup();
    s.order({ id: "o1", customerId: "c1" });
    s.accept("o1", "d1");
    const token = issueToken(SECRET, Date.now(), "customer", "c1", 60_000);
    const other = issueToken(SECRET, Date.now(), "customer", "c2", 60_000);
    await request(s.app).get("/api/chat/ZD-O1").set("Authorization", `Bearer ${other}`).expect(404);
    await request(s.app).get("/api/chat/ZD-O1").set("Authorization", `Bearer ${token}`).expect(200);
  });

  it("livreur : seulement une course qu'il a acceptée", async () => {
    const s = setup();
    s.order({ id: "o1" });
    s.accept("o1", "d1");
    await request(s.app).post("/api/livreur/orders/o1/chat").set("x-driver", "d2").send({ body: "Salut" }).expect(404);
    await request(s.app).post("/api/livreur/orders/o1/chat").set("x-driver", "d1").send({ body: "J'arrive." }).expect(200);
    const res = await request(s.app).get("/api/livreur/orders/o1/chat?peek=1").set("x-driver", "d1").expect(200);
    expect(res.body).toMatchObject({ open: true, customerFirstName: "Afi", customerNotified: false, unread: 0 });
    expect(res.body.quickReplies.length).toBeGreaterThan(2);
  });

  it("liste des conversations du client : en cours et archivées", async () => {
    const s = setup();
    const live = s.order({ id: "o1", customerId: "c1" });
    s.accept("o1", "d1");
    const old = s.order({ id: "o2", customerId: "c1", status: "DELIVERED", driverId: "d2" });
    s.accept("o2", "d2");
    await sendMessage(s.prisma, s.notifier, live as never, "DRIVER", "Je suis en route.");
    old.status = "PICKED_UP";
    await sendMessage(s.prisma, s.notifier, old as never, "CUSTOMER", "Merci");
    old.status = "DELIVERED";
    // Proposée seulement, pas encore acceptée : rien.
    s.order({ id: "o3", customerId: "c1", status: "CONFIRMED" });
    const list = await customerConversations(s.prisma, "c1");
    expect(list.map((c) => [c.code, c.open, c.unread])).toEqual([
      ["ZD-O2", false, 0],
      ["ZD-O1", true, 1],
    ]);
  });
});
