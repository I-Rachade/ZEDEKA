import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { channelOf, issueLiveTicket, orderChannels, orderSignal, readLiveTicket, targetsOf, writeTargets } from "./live.js";

const SECRET = "secret-de-test";

describe("temps réel : tickets", () => {
  it("rend les canaux d'un ticket valide", () => {
    const t = issueLiveTicket(SECRET, ["restaurant:r1"], 1_000);
    expect(readLiveTicket(t, SECRET, 2_000)).toEqual(["restaurant:r1"]);
  });
  it("refuse un ticket expiré, falsifié ou signé avec un autre secret", () => {
    const t = issueLiveTicket(SECRET, ["driver:d1"], 1_000);
    expect(readLiveTicket(t, SECRET, 1_000 + 6 * 60_000)).toBeNull();
    expect(readLiveTicket(t, "autre", 2_000)).toBeNull();
    const [, sig] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ c: ["admin"], e: Date.now() + 60_000 })).toString("base64url");
    expect(readLiveTicket(`${forged}.${sig}`, SECRET)).toBeNull();
    expect(readLiveTicket("", SECRET)).toBeNull();
  });
  it("n'accepte pas un jeton de connexion comme ticket", () => {
    // Même secret, mais signature de domaine différente.
    const body = Buffer.from(JSON.stringify({ c: ["admin"], e: Date.now() + 60_000 })).toString("base64url");
    const loginLike = `${body}.${createHmac("sha256", SECRET).update(body).digest("base64url")}`;
    expect(readLiveTicket(loginLike, SECRET)).toBeNull();
  });
  it("écarte les canaux inconnus", () => {
    expect(readLiveTicket(issueLiveTicket(SECRET, ["hack:x", "order:ZD-AB12"]), SECRET)).toEqual(["order:ZD-AB12"]);
    expect(channelOf("rental", "x")).toBeNull();
    expect(channelOf("driver", "d1")).toBe("driver:d1");
  });
});

describe("temps réel : destinataires d'une commande", () => {
  it("prévient le suivi, le restaurant, le livreur, le client, le marchand et l'équipe", () => {
    expect(orderChannels({ code: "ZD-AB12", restaurantId: "r1", driverId: "d1", customerId: "c1", merchantId: "m1" })).toEqual([
      "order:ZD-AB12",
      "restaurant:r1",
      "driver:d1",
      "customer:c1",
      "merchant:m1",
      "admin",
    ]);
    expect(orderChannels({ code: "ZD-AB12", restaurantId: null, driverId: null, customerId: null, merchantId: null })).toEqual(["order:ZD-AB12", "admin"]);
  });
  it("retrouve les commandes visées par une écriture", () => {
    expect(targetsOf({ id: "o1", status: "READY" })).toEqual({ ids: ["o1"], codes: [], drivers: [] });
    expect(targetsOf({ id: { in: ["o1", "o2"] }, driverId: "d9" })).toEqual({ ids: ["o1", "o2"], codes: [], drivers: ["d9"] });
    expect(targetsOf({ code: "ZD-AB12" })).toEqual({ ids: [], codes: ["ZD-AB12"], drivers: [] });
    expect(writeTargets("create", {}, { id: "o3" })).toEqual({ ids: ["o3"], codes: [], drivers: [] });
    expect(writeTargets("updateMany", { where: { id: "o1" } }, { count: 0 })).toBeNull();
    expect(writeTargets("update", { where: { id: "o1" } }, { id: "o1" })?.ids).toEqual(["o1", "o1"]);
  });
  it("publie le signal après lecture des destinataires, ancien livreur compris", async () => {
    const publish = vi.fn();
    const pending: Promise<unknown>[] = [];
    const findKeys = vi.fn(async () => [{ id: "o1", code: "ZD-AB12", restaurantId: "r1", driverId: null, customerId: null, merchantId: null }]);
    const signal = orderSignal(findKeys, publish, (p) => pending.push(p));
    signal(writeTargets("updateMany", { where: { id: "o1", driverId: "d1" } }, { count: 1 }));
    await Promise.all(pending);
    expect(findKeys).toHaveBeenCalledWith({ OR: [{ id: { in: ["o1"] } }] });
    expect(new Set(publish.mock.calls[0][0])).toEqual(new Set(["driver:d1", "order:ZD-AB12", "restaurant:r1", "admin"]));
  });
  it("ne prévient que l'équipe pour un traitement de masse", () => {
    const publish = vi.fn();
    const findKeys = vi.fn();
    orderSignal(findKeys, publish, () => {})({ ids: Array.from({ length: 60 }, (_, i) => `o${i}`), codes: [], drivers: [] });
    expect(findKeys).not.toHaveBeenCalled();
    expect(publish).toHaveBeenCalledWith(["admin"]);
  });
});
