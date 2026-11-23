import type { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { availability, book, cleanPlate, dayStart, minutesOf, slotsOf, type StationLike } from "./charging.js";
import { HttpError } from "./routes/adminWrite.js";

const station: StationLike & { id: string; active: boolean } = {
  id: "s1",
  active: true,
  kind: "BOTH",
  chargePoints: 2,
  swapBays: 1,
  chargePrice: 1000,
  swapPrice: 1500,
  slotMinutes: 60,
  opensAt: "08:00",
  closesAt: "12:00",
};
const day = new Date("2026-11-24T00:00:00Z");
const at = (hhmm: string) => new Date(`2026-11-24T${hhmm}:00Z`);

describe("horaires et créneaux", () => {
  it("lit HH:MM et refuse le reste", () => {
    expect(minutesOf("08:30")).toBe(510);
    expect(minutesOf("24:00")).toBe(1440);
    expect(minutesOf("24:01")).toBeNull();
    expect(minutesOf("8:30")).toBeNull();
    expect(minutesOf("ab:cd")).toBeNull();
  });
  it("lit une date AAAA-MM-JJ", () => {
    expect(dayStart("2026-11-24")?.toISOString()).toBe("2026-11-24T00:00:00.000Z");
    expect(dayStart("2026-13-40")).toBeNull();
    expect(dayStart("24/11/2026")).toBeNull();
  });
  it("découpe la journée en créneaux complets", () => {
    const slots = slotsOf({ ...station, closesAt: "11:30" }, day);
    expect(slots.map((s) => s.startsAt.toISOString().slice(11, 16))).toEqual(["08:00", "09:00", "10:00"]);
    expect(slotsOf({ ...station, opensAt: "12:00", closesAt: "08:00" }, day)).toEqual([]);
  });
  it("compte les places restantes et ferme les créneaux trop proches", () => {
    const bookings = [
      { service: "CHARGE", startsAt: at("09:00"), endsAt: at("10:00"), status: "BOOKED" },
      { service: "CHARGE", startsAt: at("09:30"), endsAt: at("10:30"), status: "CHECKED_IN" },
      { service: "CHARGE", startsAt: at("10:00"), endsAt: at("11:00"), status: "CANCELLED" },
      { service: "SWAP", startsAt: at("11:00"), endsAt: at("12:00"), status: "BOOKED" },
    ];
    const r = availability(station, "CHARGE", day, bookings, at("08:55"));
    expect(r.map((s) => s.left)).toEqual([0, 0, 1, 2]);
    expect(availability(station, "SWAP", day, bookings, at("07:00")).map((s) => s.left)).toEqual([1, 1, 1, 0]);
  });
  it("nettoie la plaque", () => {
    expect(cleanPlate("  tg 1234  ab ")).toBe("TG 1234 AB");
    expect(cleanPlate("ab")).toBeNull();
    expect(cleanPlate("TG<script>")).toBeNull();
  });
});

// Base en mémoire : une station et ses réservations.
function fakeDb() {
  const rows: Record<string, unknown>[] = [];
  let seq = 0;
  const overlaps = (r: Record<string, unknown>, w: Record<string, any>) =>
    (!w.stationId || r.stationId === w.stationId) &&
    (!w.service || r.service === w.service) &&
    (!w.status || (typeof w.status === "string" ? r.status === w.status : w.status.in.includes(r.status))) &&
    (!w.phone || r.phone === w.phone) &&
    (!w.startsAt?.lt || (r.startsAt as Date) < w.startsAt.lt) &&
    (!w.startsAt?.gte || (r.startsAt as Date) >= w.startsAt.gte) &&
    (!w.endsAt?.gt || (r.endsAt as Date) > w.endsAt.gt);
  const prisma = {
    chargingStation: { findFirst: async ({ where }: { where: { id: string } }) => (where.id === station.id ? station : null) },
    driver: { findFirst: async () => null },
    chargingBooking: {
      count: async ({ where }: { where: Record<string, unknown> }) => rows.filter((r) => overlaps(r, where)).length,
      findMany: async ({ where }: { where: Record<string, unknown> }) => rows.filter((r) => overlaps(r, where)),
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const r = { id: `b${++seq}`, createdAt: new Date(seq), ...data, station };
        rows.push(r);
        return r;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => Object.assign(rows.find((r) => r.id === where.id)!, data),
    },
  };
  return { prisma: prisma as unknown as PrismaClient, rows };
}

const input = (over: Record<string, unknown> = {}) => ({ stationId: "s1", service: "SWAP" as const, startsAt: at("09:00"), name: "Kossi", phone: "90123456", plate: "tg 12 ab", ...over });
const now = at("07:00");

describe("réservation", () => {
  it("réserve un créneau libre au prix de la station", async () => {
    const { prisma } = fakeDb();
    const b = (await book(prisma, input(), { now })) as unknown as Record<string, unknown>;
    expect(b).toMatchObject({ status: "BOOKED", source: "ONLINE", price: 1500, plate: "TG 12 AB" });
    expect(String(b.code).startsWith("ZR")).toBe(true);
  });
  it("refuse un créneau complet, inexistant ou passé", async () => {
    const { prisma } = fakeDb();
    await book(prisma, input(), { now });
    await expect(book(prisma, input({ phone: "91000000" }), { now })).rejects.toMatchObject({ status: 409 });
    await expect(book(prisma, input({ startsAt: at("09:15") }), { now })).rejects.toMatchObject({ status: 400 });
    await expect(book(prisma, input(), { now: at("08:55") })).rejects.toBeInstanceOf(HttpError);
  });
  it("limite les réservations à venir par numéro", async () => {
    const { prisma } = fakeDb();
    for (const h of ["08:00", "09:00", "10:00"]) await book(prisma, input({ service: "CHARGE", startsAt: at(h) }), { now });
    await expect(book(prisma, input({ service: "CHARGE", startsAt: at("11:00") }), { now })).rejects.toMatchObject({ status: 429 });
  });
  it("note un passage sans réservation, même station pleine", async () => {
    const { prisma } = fakeDb();
    await book(prisma, input({ startsAt: at("08:00") }), { now });
    const b = (await book(prisma, input({ phone: "92000000" }), { now: at("08:10"), source: "STATION", handledBy: "Ama" })) as unknown as Record<string, unknown>;
    expect(b).toMatchObject({ status: "CHECKED_IN", source: "STATION", handledBy: "Ama" });
  });
});
