import type { PrismaClient } from "@prisma/client";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { merchantNet, orderTotal } from "./parcel.js";
import { balanceOf, batchInput, daysOf, recipientMessage } from "./routes/merchantApp.js";

const parcel = { recipientName: "Ama Koffi", recipientPhone: "90112233", address: "Bè Kpota, portail bleu", parcelCategoryId: "cat", weightKg: 1 };

describe("contre-remboursement des marchands", () => {
  it("le livreur encaisse les articles, plus la livraison si le destinataire la paie", () => {
    const base = { subtotal: 15_000, discount: 0, deliveryFee: 1_000, extraFee: 200, merchantId: "m1" };
    expect(orderTotal({ ...base, payer: "SENDER" })).toBe(15_000);
    expect(orderTotal({ ...base, payer: "RECIPIENT" })).toBe(16_200);
    // Colis ordinaire (sans marchand) : inchangé, l'expéditeur paie la livraison.
    expect(orderTotal({ ...base, merchantId: null, subtotal: 0, payer: "SENDER" })).toBe(1_200);
  });

  it("le marchand reçoit le contre-remboursement moins la livraison qu'il paie", () => {
    const fees = { deliveryFee: 1_000, extraFee: 200, discount: 0 };
    expect(merchantNet({ ...fees, total: 15_000, cashCollected: 15_000 })).toBe(13_800);
    expect(merchantNet({ ...fees, total: 16_200, cashCollected: null })).toBe(15_000);
    // Déjà payé en ligne, livraison à sa charge : le marchand doit les frais.
    expect(merchantNet({ ...fees, total: 0, cashCollected: null })).toBe(-1_200);
    // Une remise réduit ce que paie le marchand.
    expect(merchantNet({ ...fees, discount: 500, total: 15_000, cashCollected: 15_000 })).toBe(14_300);
    expect(balanceOf([{ ...fees, total: 15_000, cashCollected: 15_000 }, { ...fees, total: 0, cashCollected: null }])).toBe(12_600);
  });

  it("valide un envoi de plusieurs colis", () => {
    expect(batchInput.safeParse({ parcels: [parcel, { ...parcel, address: "", askRecipientLocation: true, codAmount: 5000 }] }).success).toBe(true);
    expect(batchInput.safeParse({ parcels: [] }).success).toBe(false);
    expect(batchInput.safeParse({ parcels: Array.from({ length: 51 }, () => parcel) }).success).toBe(false);
    // Ni adresse, ni position, ni lien au destinataire.
    expect(batchInput.safeParse({ parcels: [{ ...parcel, address: "" }] }).success).toBe(false);
    expect(batchInput.safeParse({ parcels: [{ ...parcel, latitude: 6.13 }] }).success).toBe(false);
  });

  it("prépare le message WhatsApp du destinataire au nom de la boutique", () => {
    const m = recipientMessage("https://zedeka.example/", "Boutique Ama", { recipientName: "Kossi Mensah", recipientPhone: "90 11 22 33", code: "ZD-AB12" }, "https://zedeka.example/position/x");
    expect(m.text).toContain("Bonjour Kossi, votre commande Boutique Ama arrive");
    expect(m.whatsappUrl.startsWith("https://wa.me/22890112233?text=")).toBe(true);
    expect(m.trackUrl).toBe("https://zedeka.example/commande/ZD-AB12");
  });

  it("lit les jours de ramassage", () => {
    expect(daysOf("1,3,5")).toEqual([1, 3, 5]);
    expect(daysOf("")).toEqual([]);
  });
});

describe("API marchand", () => {
  const app = createApp({} as PrismaClient, { frontendOrigin: "", zedekaWhatsapp: "", adminPassword: "un-mot-de-passe-solide", adminSecret: "a".repeat(64) });
  it("demande la connexion du compte", async () => {
    const res = await request(app).get("/api/marchand/me");
    expect(res.status).toBe(401);
  });
});
