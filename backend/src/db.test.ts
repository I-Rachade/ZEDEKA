import { describe, expect, it } from "vitest";
import { uniqueToFirst } from "./db.js";

describe("findUnique sans regroupement entre requêtes", () => {
  it("garde une clé simple telle quelle", () => {
    expect(uniqueToFirst({ where: { id: "r1" }, select: { name: true } })).toEqual({ where: { id: "r1" }, select: { name: true } });
  });
  it("déplie une clé unique composée pour findFirst", () => {
    expect(uniqueToFirst({ where: { driverId_kind: { driverId: "d1", kind: "ID" }, active: true } })).toEqual({ where: { driverId: "d1", kind: "ID", active: true } });
  });
  it("ne touche pas un filtre de relation", () => {
    const where = { order: { restaurantId: "r1" }, id: "x" };
    expect(uniqueToFirst({ where }).where).toEqual(where);
  });
});
