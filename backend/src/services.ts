import type { PrismaClient } from "@prisma/client";
import { getSettings } from "./util.js";

// Modules du bouton « Services » de l'appli client. Chaque module s'active ou se coupe dans l'admin (page Services) :
// ON (proposé aux clients), SOON (tuile « Bientôt », non cliquable) ou OFF (caché). Les repas restent le cœur de
// Zedeka et ne sont pas un module.
//
// - PARCEL : envoi de colis. Coupé, l'API refuse aussi les nouveaux colis des clients.
// - RIDE : course Zed (moto). Son état est le réglage « Mode Zed » (Settings.zedEnabled), une seule source.
// - Les autres sont prévus mais pas encore construits : seulement SOON ou OFF tant que `built` est faux.

export type ModuleState = "ON" | "SOON" | "OFF";
export type ModuleFamily = "DELIVERY" | "ERRAND" | "HOME";

export type ModuleDef = {
  code: string;
  family: ModuleFamily;
  emoji: string;
  label: string;
  hint: string;
  href: string | null;
  built: boolean;
  defaultState: ModuleState;
};

export const MODULES: readonly ModuleDef[] = [
  { code: "PARCEL", family: "DELIVERY", emoji: "📦", label: "Envoyer un colis", hint: "Un livreur récupère et dépose où vous voulez.", href: "/colis", built: true, defaultState: "ON" },
  { code: "RIDE", family: "DELIVERY", emoji: "🛵", label: "Une course pour moi", hint: "Un Zed vient vous chercher là où vous êtes.", href: "/app/zed", built: true, defaultState: "OFF" },
  { code: "ERRAND", family: "ERRAND", emoji: "🛒", label: "Courses pour moi", hint: "Un livreur achète votre liste et vous l'apporte.", href: null, built: false, defaultState: "OFF" },
  { code: "GAS", family: "ERRAND", emoji: "🔥", label: "Gaz et eau", hint: "Bouteille de gaz ou bidons d'eau livrés chez vous.", href: null, built: false, defaultState: "OFF" },
  { code: "LAUNDRY", family: "HOME", emoji: "🧺", label: "Lessive", hint: "Ramassage du linge, retour lavé et plié.", href: null, built: false, defaultState: "OFF" },
  { code: "CLEANING", family: "HOME", emoji: "🧹", label: "Ménage", hint: "Un prestataire vérifié fait le ménage chez vous.", href: null, built: false, defaultState: "OFF" },
  { code: "REPAIR", family: "HOME", emoji: "🔧", label: "Dépannage", hint: "Plomberie, électricité, petites réparations.", href: null, built: false, defaultState: "OFF" },
];

export const MODULE_CODES = MODULES.map((m) => m.code) as [string, ...string[]];
export const NOT_BUILT = "Ce service n'est pas encore prêt : choisissez « Bientôt » ou « Caché ».";
export const PARCEL_CLOSED = "L'envoi de colis est fermé pour le moment.";

export type ModuleView = Omit<ModuleDef, "defaultState"> & { state: ModuleState; sortOrder: number };

// État de chaque module, dans l'ordre choisi par l'admin. Un module sans ligne en base prend son état par défaut.
export async function listModules(prisma: PrismaClient): Promise<ModuleView[]> {
  const [rows, settings] = await Promise.all([readRows(prisma), getSettings(prisma)]);
  return MODULES.map((def, i) => {
    const row = rows.find((r) => r.code === def.code);
    let state = (row?.state as ModuleState | undefined) ?? def.defaultState;
    if (def.code === "RIDE") state = settings.zedEnabled ? "ON" : row?.state === "SOON" ? "SOON" : "OFF";
    if (!def.built && state === "ON") state = "SOON";
    const { defaultState: _d, ...rest } = def;
    return { ...rest, state, sortOrder: row?.sortOrder ?? i * 10 };
  }).sort((a, b) => a.sortOrder - b.sortOrder);
}

// Ce que voit l'appli client : seulement les modules visibles, et la couleur du bouton.
export type PublicServices = {
  modules: Pick<ModuleView, "code" | "family" | "emoji" | "label" | "hint" | "href" | "state">[];
  color: string;
};

// Cache en mémoire de l'isolat : la feuille Services s'ouvre à chaque lancement de l'appli, la base n'est lue
// qu'une fois toutes les 30 secondes par isolat, quel que soit le nombre de clients.
const TTL_MS = 30_000;
let cache: { at: number; value: PublicServices; etag: string } | null = null;

export function invalidateServices() {
  cache = null;
}

export async function publicServices(prisma: PrismaClient, now = Date.now()): Promise<{ value: PublicServices; etag: string }> {
  if (cache && now - cache.at < TTL_MS) return cache;
  const [modules, settings] = await Promise.all([listModules(prisma), getSettings(prisma)]);
  const value: PublicServices = {
    modules: modules.filter((m) => m.state !== "OFF").map(({ code, family, emoji, label, hint, href, state }) => ({ code, family, emoji, label, hint, href: state === "ON" ? href : null, state })),
    color: settings.zedButtonColor,
  };
  const etag = `W/"${hash(JSON.stringify(value))}"`;
  cache = { at: now, value, etag };
  return cache;
}

// Table illisible (migration pas encore appliquée, panne passagère) : chaque module garde son état par défaut,
// pour ne jamais fermer le colis par accident.
async function readRows(prisma: PrismaClient): Promise<{ code: string; state: string; sortOrder: number }[]> {
  try {
    return await prisma.serviceModule.findMany({ select: { code: true, state: true, sortOrder: true } });
  } catch (e) {
    console.error("service modules", e);
    return [];
  }
}

// Le module est-il ouvert aux clients ? (lecture directe, pour refuser une création côté serveur)
export async function moduleOn(prisma: PrismaClient, code: string): Promise<boolean> {
  const modules = await listModules(prisma);
  return modules.find((m) => m.code === code)?.state === "ON";
}

function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
