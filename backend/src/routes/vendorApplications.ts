import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { Router } from "express";
import multer from "multer";
import type { FileStore } from "../storage.js";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { getSettings } from "../util.js";

// Formule unique : un abonnement mensuel fixe, sans commission sur les commandes.
// Le prix se règle dans l'admin (Réglages > vendorSubscriptionFee), en FCFA.
export function vendorPlan(monthlyFee: number) {
  return {
    id: "SUBSCRIPTION" as const,
    name: "Abonnement",
    description: "Un prix fixe chaque mois, aucune commission sur vos ventes.",
    commissionPercent: 0,
    monthlyFee,
    features: [
      "Page commerce et QR code",
      "Commandes reçues sur votre espace partenaire",
      "Livraison par les livreurs Zedeka",
      "Aucune commission sur les commandes",
    ],
  };
}

const MAX_FILE_BYTES = 2 * 1024 * 1024;

// Vérifie la signature binaire plutôt que de faire confiance au type annoncé par le navigateur.
const SIGNATURES = {
  jpg: (b: Buffer) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  png: (b: Buffer) => b.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])),
  webp: (b: Buffer) => b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP",
  pdf: (b: Buffer) => b.toString("ascii", 0, 4) === "%PDF",
};
type Ext = keyof typeof SIGNATURES;

const CONTENT_TYPES: Record<Ext, string> = { png: "image/png", jpg: "image/jpeg", webp: "image/webp", pdf: "application/pdf" };

function detect(buf: Buffer, allowed: Ext[]): Ext | null {
  return allowed.find((ext) => SIGNATURES[ext](buf)) ?? null;
}

// Numéros mobiles togolais : +228 puis 8 chiffres commençant par 7 ou 9.
export function normalizeTogoPhone(input: string): string | null {
  const digits = input.replace(/[\s.-]/g, "").replace(/^(\+|00)228/, "");
  return /^[79]\d{7}$/.test(digits) ? `+228${digits}` : null;
}

const togoPhone = (message: string) =>
  z.string().transform((v, ctx) => {
    const phone = normalizeTogoPhone(v);
    if (!phone) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message });
      return z.NEVER;
    }
    return phone;
  });

const optionalText = (max: number) =>
  z.string().trim().max(max).optional().transform((v) => v || undefined);

const minutes = z.coerce.number().int().min(5, "Entre 5 et 180 min").max(180, "Entre 5 et 180 min");

const applicationInput = z
  .object({
    businessName: z.string().trim().min(2, "Indiquez le nom du commerce").max(100),
    businessType: z.enum(["restaurant", "fast_food", "patisserie", "epicerie", "pharmacie", "boutique"], {
      errorMap: () => ({ message: "Choisissez un type de commerce" }),
    }),
    zoneId: z.string().min(1, "Choisissez une zone"),
    address: z.string().trim().min(5, "Indiquez une adresse ou un repère").max(300),
    latitude: z.coerce.number().min(-90).max(90).optional(),
    longitude: z.coerce.number().min(-180).max(180).optional(),
    deliveryTimeMin: minutes,
    deliveryTimeMax: minutes,
    ownerFirstName: z.string().trim().min(1, "Prénom obligatoire").max(60),
    ownerLastName: z.string().trim().min(1, "Nom obligatoire").max(60),
    phone: togoPhone("Numéro togolais invalide"),
    whatsapp: z.preprocess((v) => v || undefined, togoPhone("Numéro togolais invalide").optional()),
    momoOperator: z.enum(["tmoney", "flooz"], { errorMap: () => ({ message: "Choisissez un opérateur" }) }),
    momoNumber: togoPhone("Numéro Mobile Money invalide"),
    rccm: optionalText(50),
    nif: optionalText(50),
    email: z.string().trim().toLowerCase().email("Adresse e-mail invalide").max(120),
    password: z
      .string()
      .min(8, "8 caractères minimum")
      .max(100)
      .regex(/[a-z]/, "Une minuscule requise")
      .regex(/[A-Z]/, "Une majuscule requise")
      .regex(/\d/, "Un chiffre requis"),
    plan: z.literal("SUBSCRIPTION", { errorMap: () => ({ message: "Choisissez une formule" }) }).default("SUBSCRIPTION"),
    termsAccepted: z.literal("true", { errorMap: () => ({ message: "Vous devez accepter les conditions" }) }),
  });

function reference() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(5);
  return "ZP-" + Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

type Config = { files: FileStore };

export function vendorApplicationsRouter(prisma: PrismaClient, config: Config) {
  const router = Router();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_FILE_BYTES, files: 3, fields: 40 },
  }).fields([
    { name: "logo", maxCount: 1 },
    { name: "cover", maxCount: 1 },
    { name: "legalDoc", maxCount: 1 },
  ]);

  router.get("/vendor-plans", async (_req, res) => {
    const settings = await getSettings(prisma);
    res.json([vendorPlan(settings.vendorSubscriptionFee)]);
  });

  router.post("/vendor-applications", (req, res, next) => {
    upload(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        const field = err.field ?? "logo";
        const message = err.code === "LIMIT_FILE_SIZE" ? "Fichier trop lourd (max 2 Mo)" : "Fichier refusé";
        res.status(400).json({ message, errors: { [field]: message } });
        return;
      }
      if (err) return next(err);
      handle(req.body, req.files as Record<string, Express.Multer.File[]> | undefined).then(
        ({ status, body }) => res.status(status).json(body),
        next,
      );
    });
  });

  async function handle(body: unknown, files: Record<string, Express.Multer.File[]> = {}) {
    const errors: Record<string, string> = {};
    const parsed = applicationInput.safeParse(body);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0]);
        errors[key] ??= issue.message;
      }
    }
    // Vérifié à part : un .refine() zod ne s'exécute que si tous les autres champs sont valides.
    const times = body as { deliveryTimeMin?: string; deliveryTimeMax?: string };
    if (!errors.deliveryTimeMin && !errors.deliveryTimeMax && Number(times.deliveryTimeMax) < Number(times.deliveryTimeMin)) {
      errors.deliveryTimeMax = "Doit être ≥ au minimum";
    }

    const fileSpecs: { field: string; allowed: Ext[]; required: boolean }[] = [
      { field: "logo", allowed: ["jpg", "png", "webp"], required: true },
      { field: "cover", allowed: ["jpg", "png", "webp"], required: true },
      { field: "legalDoc", allowed: ["pdf", "jpg", "png"], required: false },
    ];
    const accepted: Record<string, { buffer: Buffer; ext: Ext }> = {};
    for (const spec of fileSpecs) {
      const file = files[spec.field]?.[0];
      if (!file) {
        if (spec.required) errors[spec.field] = "Fichier obligatoire";
        continue;
      }
      const ext = detect(file.buffer, spec.allowed);
      if (!ext) errors[spec.field] = "Format non accepté";
      else accepted[spec.field] = { buffer: file.buffer, ext };
    }

    if (!parsed.success || Object.keys(errors).length) {
      return { status: 400, body: { message: "Certains champs sont à corriger.", errors } };
    }
    const input = parsed.data;

    const zone = await prisma.zone.findFirst({ where: { id: input.zoneId, active: true } });
    if (!zone) {
      return { status: 400, body: { message: "Zone inconnue.", errors: { zoneId: "Zone inconnue" } } };
    }

    const existing = await prisma.vendorApplication.findFirst({
      where: { email: input.email, status: { not: "REJECTED" } },
      select: { id: true },
    });
    if (existing) {
      const message = "Une candidature existe déjà avec cet e-mail.";
      return { status: 409, body: { message, errors: { email: message } } };
    }

    const ref = reference();
    const saved: Record<string, string> = {};
    for (const [field, { buffer, ext }] of Object.entries(accepted)) {
      const key = `vendor-applications/${ref}/${field}.${ext}`;
      await config.files.put(key, new Uint8Array(buffer), CONTENT_TYPES[ext]);
      saved[field] = key;
    }

    const application = await prisma.vendorApplication.create({
      data: {
        reference: ref,
        businessName: input.businessName,
        businessType: input.businessType,
        zoneId: zone.id,
        address: input.address,
        latitude: input.latitude,
        longitude: input.longitude,
        deliveryTimeMin: input.deliveryTimeMin,
        deliveryTimeMax: input.deliveryTimeMax,
        logoPath: saved.logo,
        coverPath: saved.cover,
        ownerFirstName: input.ownerFirstName,
        ownerLastName: input.ownerLastName,
        phone: input.phone,
        whatsapp: input.whatsapp,
        momoOperator: input.momoOperator === "tmoney" ? "TMONEY" : "FLOOZ",
        momoNumber: input.momoNumber,
        rccm: input.rccm,
        nif: input.nif,
        legalDocPath: saved.legalDoc,
        email: input.email,
        passwordHash: await bcrypt.hash(input.password, 10),
        plan: input.plan,
        monthlyFee: (await getSettings(prisma)).vendorSubscriptionFee,
        termsAcceptedAt: new Date(),
      },
      select: { reference: true, status: true },
    });

    return { status: 201, body: application };
  }

  return router;
}
