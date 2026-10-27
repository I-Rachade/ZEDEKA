import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import bcrypt from "bcryptjs";
import type { PrismaClient } from "@prisma/client";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { normalizeTogoPhone } from "./vendorApplications.js";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);

type Row = Record<string, unknown>;

function fakePrisma(existing: Row[] = []) {
  const created: Row[] = [];
  const prisma = {
    zone: {
      findFirst: async ({ where }: { where: { id: string } }) =>
        where.id === "zone-1" ? { id: "zone-1", name: "Centre", deliveryFee: 1000, active: true } : null,
    },
    vendorApplication: {
      findFirst: async ({ where }: { where: { email: string } }) =>
        [...existing, ...created].find((r) => r.email === where.email && r.status !== "REJECTED") ?? null,
      create: async ({ data }: { data: Row }) => {
        created.push({ ...data, status: "PENDING" });
        return { reference: data.reference, status: "PENDING" };
      },
    },
  };
  return { prisma: prisma as unknown as PrismaClient, created };
}

function validRequest(app: ReturnType<typeof createApp>, zoneId = "zone-1") {
  return request(app)
    .post("/api/vendor-applications")
    .field("businessName", "Chez Tantie Ama")
    .field("businessType", "restaurant")
    .field("zoneId", zoneId)
    .field("address", "Tokoin, face pharmacie")
    .field("deliveryTimeMin", "20")
    .field("deliveryTimeMax", "40")
    .field("ownerFirstName", "Ama")
    .field("ownerLastName", "Mensah")
    .field("phone", "90 12 34 56")
    .field("momoOperator", "flooz")
    .field("momoNumber", "+228 99 11 22 33")
    .field("email", "Ama@Example.tg")
    .field("password", "Secret123")
    .field("plan", "COMMISSION")
    .field("termsAccepted", "true")
    .attach("logo", PNG, "logo.png")
    .attach("cover", JPG, "cover.jpg");
}

let uploadDir: string;
beforeEach(async () => {
  uploadDir = await mkdtemp(path.join(tmpdir(), "zedeka-"));
});
afterEach(async () => {
  await rm(uploadDir, { recursive: true, force: true });
});

const config = () => ({ frontendOrigin: "*", zedekaWhatsapp: "", uploadDir });

describe("normalizeTogoPhone", () => {
  it("accepte les formats courants et normalise en +228", () => {
    expect(normalizeTogoPhone("90 12 34 56")).toBe("+22890123456");
    expect(normalizeTogoPhone("+228 70-12-34-56")).toBe("+22870123456");
    expect(normalizeTogoPhone("0022899112233")).toBe("+22899112233");
  });
  it("refuse les numéros non mobiles ou trop courts", () => {
    expect(normalizeTogoPhone("22 21 34 56")).toBeNull();
    expect(normalizeTogoPhone("9012345")).toBeNull();
  });
});

describe("GET /api/vendor-plans", () => {
  it("liste les formules", async () => {
    const res = await request(createApp(fakePrisma().prisma, config())).get("/api/vendor-plans");
    expect(res.status).toBe(200);
    expect(res.body.map((p: { id: string }) => p.id)).toEqual(["COMMISSION", "SUBSCRIPTION"]);
  });
});

describe("POST /api/vendor-applications", () => {
  it("enregistre une candidature valide avec ses fichiers", async () => {
    const { prisma, created } = fakePrisma();
    const res = await validRequest(createApp(prisma, config()));

    expect(res.status).toBe(201);
    expect(res.body.reference).toMatch(/^ZP-[A-Z2-9]{5}$/);
    const row = created[0];
    expect(row).toMatchObject({
      email: "ama@example.tg",
      phone: "+22890123456",
      momoOperator: "FLOOZ",
      momoNumber: "+22899112233",
      plan: "COMMISSION",
      logoPath: `vendor-applications/${res.body.reference}/logo.png`,
      coverPath: `vendor-applications/${res.body.reference}/cover.jpg`,
    });
    expect(row.whatsapp).toBeUndefined();
    expect(await bcrypt.compare("Secret123", row.passwordHash as string)).toBe(true);
    expect(await readFile(path.join(uploadDir, row.logoPath as string))).toEqual(PNG);
  });

  it("renvoie les erreurs par champ sans rien enregistrer", async () => {
    const { prisma, created } = fakePrisma();
    const res = await request(createApp(prisma, config()))
      .post("/api/vendor-applications")
      .field("businessName", "A")
      .field("phone", "123")
      .field("password", "faible")
      .field("deliveryTimeMin", "40")
      .field("deliveryTimeMax", "20")
      .attach("logo", Buffer.from("<script>"), "logo.png");

    expect(res.status).toBe(400);
    expect(res.body.errors).toMatchObject({
      businessName: expect.any(String),
      phone: "Numéro togolais invalide",
      password: expect.any(String),
      deliveryTimeMax: "Doit être ≥ au minimum",
      logo: "Format non accepté",
      cover: "Fichier obligatoire",
      termsAccepted: "Vous devez accepter les conditions",
    });
    expect(created).toHaveLength(0);
  });

  it("refuse une zone inconnue", async () => {
    const res = await validRequest(createApp(fakePrisma().prisma, config()), "inconnue");
    expect(res.status).toBe(400);
    expect(res.body.errors.zoneId).toBe("Zone inconnue");
  });

  it("refuse un doublon d'e-mail tant que la première candidature n'est pas rejetée", async () => {
    const { prisma } = fakePrisma([{ email: "ama@example.tg", status: "PENDING" }]);
    const res = await validRequest(createApp(prisma, config()));
    expect(res.status).toBe(409);
    expect(res.body.errors.email).toBeDefined();
  });

  it("accepte à nouveau l'e-mail après un rejet", async () => {
    const { prisma } = fakePrisma([{ email: "ama@example.tg", status: "REJECTED" }]);
    const res = await validRequest(createApp(prisma, config()));
    expect(res.status).toBe(201);
  });

  it("refuse un fichier de plus de 2 Mo", async () => {
    const big = Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024)]);
    const res = await request(createApp(fakePrisma().prisma, config()))
      .post("/api/vendor-applications")
      .attach("logo", big, "logo.png");
    expect(res.status).toBe(400);
    expect(res.body.errors.logo).toBe("Fichier trop lourd (max 2 Mo)");
  });
});
