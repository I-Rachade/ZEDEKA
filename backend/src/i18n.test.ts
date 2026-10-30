import type { PrismaClient } from "@prisma/client";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { translateMessage } from "./i18n.js";

// Les routes testées ici s'arrêtent avant la base.
const prisma = {} as PrismaClient;
const app = createApp(prisma, { frontendOrigin: "", zedekaWhatsapp: "", adminPassword: "un-mot-de-passe-solide", adminSecret: "a".repeat(64) });

describe("messages de l'API en anglais", () => {
  it("garde le français par défaut", async () => {
    const res = await request(app).post("/api/track").send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Indiquez le code de la commande et le numéro utilisé");
  });

  it("traduit selon le cookie de langue du site", async () => {
    const res = await request(app).post("/api/track").set("Cookie", "theme=x; lang=en").send({});
    expect(res.body.error).toBe("Enter the order code and the number used");
  });

  it("traduit selon l'en-tête x-lang (pages rendues par le serveur du site)", async () => {
    const res = await request(app).get("/api/livreur/current").set("x-lang", "en");
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Sign-in required");
  });

  it("traduit les messages construits avec une valeur et les erreurs de champ", () => {
    expect(translateMessage("Commande minimum : 3 000 FCFA (hors livraison)", "en")).toBe("Minimum order: 3 000 FCFA (excluding delivery)");
    expect(translateMessage("Code incorrect. Encore 1 essai.", "en")).toBe("Wrong code. 1 attempt left.");
    expect(translateMessage("customerName : au moins 2 caractère(s)", "en")).toBe("customerName: at least 2 character(s)");
    expect(translateMessage("Champ manquant : phone", "en")).toBe("Missing field: phone");
  });

  it("laisse tel quel un texte inconnu", () => {
    expect(translateMessage("Chez Tante Ama", "en")).toBe("Chez Tante Ama");
    expect(translateMessage("Commande introuvable", "fr")).toBe("Commande introuvable");
  });
});
