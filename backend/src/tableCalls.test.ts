import type { PrismaClient } from "@prisma/client";
import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import type { Notifier, PushPayload } from "./notify.js";
import { restaurantRoleMay } from "./restaurantTeam.js";
import { CALL_COOLDOWN_MS, CALL_EXPIRE_MS, CALL_REMIND_MS, callLabel, remindTableCalls, tableCallPanelRouter, tableCallPublicRouter } from "./tableCalls.js";

const TOKEN = "AbCdEfGh1234";
type Row = Record<string, unknown> & { id: string; status: string; rungAt: Date };

// Juste ce que tableCalls.ts demande à la base : égalités, { in }, { lt }, { gte }, { not: null }.
function matches(row: Record<string, unknown>, where: Record<string, unknown>) {
  return Object.entries(where).every(([k, cond]) => {
    const v = row[k];
    if (cond && typeof cond === "object" && !(cond instanceof Date)) {
      const c = cond as { in?: unknown[]; lt?: Date; gte?: Date; not?: unknown };
      if (c.in && !c.in.includes(v)) return false;
      if (c.lt && !(v instanceof Date && v < c.lt)) return false;
      if (c.gte && !(v instanceof Date && v >= c.gte)) return false;
      if ("not" in c && c.not === null && (v === null || v === undefined)) return false;
      return true;
    }
    return (v ?? null) === (cond ?? null);
  });
}

function setup(opts: { enabled?: boolean } = {}) {
  let now = Date.parse("2026-11-07T12:00:00Z");
  const calls: Row[] = [];
  const pushes: { subject: string; payload: PushPayload }[] = [];
  const restaurant = { active: true, deletedAt: null, tableCallsEnabled: opts.enabled ?? true };
  const prisma = {
    restaurantTable: {
      findUnique: async ({ where }: { where: { token: string } }) => (where.token === TOKEN ? { id: "t7", number: 7, restaurantId: "r1", restaurant } : null),
    },
    tableCall: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) => [...calls].reverse().find((c) => matches(c, where)) ?? null,
      findMany: async ({ where }: { where: Record<string, unknown> }) => calls.filter((c) => matches(c, where)),
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const c = { id: `c${calls.length + 1}`, status: "OPEN", remindedAt: null, ackAt: null, ackBy: null, doneAt: null, ...data } as Row;
        calls.push(c);
        return c;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => Object.assign(calls.find((c) => c.id === where.id)!, data),
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const hit = calls.filter((c) => matches(c, where));
        hit.forEach((c) => Object.assign(c, data));
        return { count: hit.length };
      },
    },
  } as unknown as PrismaClient;
  const notifier: Notifier = { publicKey: "", push: async (_role, subject, payload) => (pushes.push({ subject, payload }), 1), staff: async () => 0, sms: async () => {} };
  const clock = () => now;
  const app = express();
  app.use(express.json());
  app.use("/api", tableCallPublicRouter(prisma, notifier, clock));
  let actor = "Ama Mensah";
  app.use(
    "/panel",
    (_req, res, next) => {
      res.locals.restaurantId = "r1";
      next();
    },
    tableCallPanelRouter(prisma, (res) => String(res.locals.restaurantId), () => actor, clock),
  );
  return { app, calls, pushes, prisma, notifier, tick: (ms: number) => (now += ms), at: () => new Date(now), setActor: (a: string) => (actor = a) };
}

describe("sonnerie de table", () => {
  it("le client appelle le serveur : le restaurant sonne avec le numéro de la table", async () => {
    const { app, pushes } = setup();
    const res = await request(app).post(`/api/tables/${TOKEN}/call`).send({ kind: "WAITER" }).expect(201);
    expect(res.body).toMatchObject({ rang: true, call: { kind: "WAITER", status: "OPEN" } });
    expect(pushes).toEqual([{ subject: "r1", payload: expect.objectContaining({ title: "Table 7", body: "Appel serveur", alarm: true }) }]);
  });

  it("addition avec le moyen de paiement, demande écrite obligatoire pour « Autre »", async () => {
    const { app, pushes, tick } = setup();
    await request(app).post(`/api/tables/${TOKEN}/call`).send({ kind: "BILL", payment: "MOBILE_MONEY", note: "ignorée" }).expect(201);
    expect(pushes[0].payload.body).toBe("Addition (mobile money)");
    tick(CALL_COOLDOWN_MS);
    const empty = await request(app).post(`/api/tables/${TOKEN}/call`).send({ kind: "OTHER", note: "  " }).expect(400);
    expect(empty.body.error).toBe("Écrivez votre demande");
    await request(app).post(`/api/tables/${TOKEN}/call`).send({ kind: "OTHER", note: "De l'eau svp" }).expect(200);
    expect(pushes[1].payload.body).toBe("Demande : De l'eau svp");
  });

  it("un seul appel par table : un nouvel appui ne resonne qu'après 30 s", async () => {
    const { app, calls, pushes, tick } = setup();
    await request(app).post(`/api/tables/${TOKEN}/call`).send({ kind: "WAITER" }).expect(201);
    const again = await request(app).post(`/api/tables/${TOKEN}/call`).send({ kind: "BILL", payment: "CASH" }).expect(200);
    expect(again.body.rang).toBe(false);
    expect(pushes).toHaveLength(1);
    tick(CALL_COOLDOWN_MS);
    const later = await request(app).post(`/api/tables/${TOKEN}/call`).send({ kind: "BILL", payment: "CASH" }).expect(200);
    expect(later.body).toMatchObject({ rang: true, call: { kind: "BILL", payment: "CASH" } });
    expect(calls).toHaveLength(1);
    expect(pushes).toHaveLength(2);
  });

  it("« J'arrive » : la sonnerie s'arrête et le client voit le prénom du serveur", async () => {
    const { app, tick } = setup();
    const { body } = await request(app).post(`/api/tables/${TOKEN}/call`).send({ kind: "WAITER" });
    tick(45_000);
    await request(app).post(`/panel/${body.call.id}/ack`).expect(204);
    // Déjà pris par un collègue.
    await request(app).post(`/panel/${body.call.id}/ack`).expect(409);
    const seen = await request(app).get(`/api/tables/${TOKEN}/call`).expect(200);
    expect(seen.body).toMatchObject({ enabled: true, call: { status: "ACK", ackBy: "Ama" } });
    const panel = await request(app).get("/panel").expect(200);
    expect(panel.body.calls).toEqual([expect.objectContaining({ tableNumber: 7, status: "ACK", ackBy: "Ama Mensah", label: "Appel serveur" })]);
    expect(panel.body.stats).toEqual({ answered: 1, avgResponseSec: 45 });
    await request(app).post(`/panel/${body.call.id}/done`).expect(204);
    expect((await request(app).get(`/api/tables/${TOKEN}/call`)).body.call).toBeNull();
    expect((await request(app).get("/panel")).body.calls).toEqual([]);
  });

  it("le client peut annuler son appel", async () => {
    const { app } = setup();
    await request(app).post(`/api/tables/${TOKEN}/call`).send({ kind: "WAITER" });
    await request(app).delete(`/api/tables/${TOKEN}/call`).expect(204);
    expect((await request(app).get(`/api/tables/${TOKEN}/call`)).body.call).toBeNull();
  });

  it("sans réponse en 2 min : une seule relance ; appel oublié fermé au bout de 15 min", async () => {
    const { app, prisma, notifier, pushes, calls, tick, at } = setup();
    await request(app).post(`/api/tables/${TOKEN}/call`).send({ kind: "WAITER" });
    tick(CALL_REMIND_MS - 1000);
    expect(await remindTableCalls(prisma, notifier, at())).toEqual({ expired: 0, reminded: 0 });
    tick(2000);
    await remindTableCalls(prisma, notifier, at());
    await remindTableCalls(prisma, notifier, at());
    expect(pushes.map((p) => p.payload.title)).toEqual(["Table 7", "Toujours en attente : Table 7"]);
    expect((await request(app).get("/panel")).body.calls[0].reminded).toBe(true);
    tick(CALL_EXPIRE_MS);
    await remindTableCalls(prisma, notifier, at());
    expect(calls[0].status).toBe("EXPIRED");
    // Le client peut sonner à nouveau.
    await request(app).post(`/api/tables/${TOKEN}/call`).send({ kind: "WAITER" }).expect(201);
  });

  it("sonnerie coupée par le restaurant, lien inconnu", async () => {
    const { app, pushes } = setup({ enabled: false });
    expect((await request(app).get(`/api/tables/${TOKEN}/call`)).body).toEqual({ enabled: false, call: null });
    await request(app).post(`/api/tables/${TOKEN}/call`).send({ kind: "WAITER" }).expect(409);
    await request(app).post("/api/tables/inconnu/call").send({ kind: "WAITER" }).expect(404);
    expect(pushes).toEqual([]);
  });

  it("le gérant répond sans prénom affiché au client", async () => {
    const { app, setActor } = setup();
    setActor("");
    const { body } = await request(app).post(`/api/tables/${TOKEN}/call`).send({ kind: "WAITER" });
    await request(app).post(`/panel/${body.call.id}/ack`).expect(204);
    expect((await request(app).get(`/api/tables/${TOKEN}/call`)).body.call.ackBy).toBeNull();
  });

  it("la caissière voit les appels et y répond, sans les autres réglages", () => {
    expect(restaurantRoleMay("CASHIER", "GET", "/table-calls")).toBe(true);
    expect(restaurantRoleMay("CASHIER", "POST", "/table-calls/c1/ack")).toBe(true);
    expect(restaurantRoleMay("CASHIER", "POST", "/table-calls/c1/done")).toBe(true);
    expect(restaurantRoleMay("CASHIER", "GET", "/tables")).toBe(false);
  });

  it("libellés", () => {
    expect(callLabel({ kind: "BILL", payment: "CASH", note: null })).toBe("Addition (espèces)");
    expect(callLabel({ kind: "WAITER", payment: null, note: null })).toBe("Appel serveur");
  });
});
