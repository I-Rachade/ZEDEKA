"use client";

import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n/client";
import { ZED_COLORS, type ZedColor } from "./zed";

// Modules du bouton « Services » (API /api/services, page Services de l'admin). ON : proposé, SOON : « Bientôt »,
// les modules cachés ne sont pas envoyés. Les repas ne sont pas un module : ils restent toujours là.
export type ModuleCode = "PARCEL" | "RIDE" | "ERRAND" | "GAS" | "LAUNDRY" | "CLEANING" | "REPAIR";
export type ServiceModule = { code: ModuleCode; family: "DELIVERY" | "ERRAND" | "HOME"; emoji: string; label: string; hint: string; href: string | null; state: "ON" | "SOON" };
export type Services = { modules: ServiceModule[]; color: ZedColor };

// Avant la première réponse : le colis seul, comme l'appli l'a toujours proposé.
const DEFAULT: Services = {
  modules: [{ code: "PARCEL", family: "DELIVERY", emoji: "📦", label: "Envoyer un colis", hint: "Un livreur récupère et dépose où vous voulez.", href: "/colis", state: "ON" }],
  color: "SUN",
};
const KEY = "zedeka.services";

// Lecture rapide : la dernière liste gardée sur le téléphone s'affiche tout de suite, la réponse de l'API la remplace
// (une requête par lancement de l'appli, partagée par tous les écrans ; l'API répond depuis son cache).
let pending: Promise<Services | null> | null = null;
let latest: Services | null = null;

function stored(): Services | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Services) : null;
  } catch {
    return null;
  }
}

function clean(s: Partial<Services> | null): Services | null {
  if (!s || !Array.isArray(s.modules)) return null;
  return { modules: s.modules.filter((m) => m && (m.state === "ON" || m.state === "SOON")), color: s.color && s.color in ZED_COLORS ? s.color : "SUN" };
}

function load(): Promise<Services | null> {
  pending ??= fetch("/api/services")
    .then((r) => (r.ok ? r.json() : null))
    .then((s: Partial<Services> | null) => {
      const value = clean(s);
      if (value) {
        latest = value;
        try {
          localStorage.setItem(KEY, JSON.stringify(value));
        } catch {
          // Stockage plein ou interdit : la liste reste en mémoire pour cette visite.
        }
      }
      return value;
    })
    .catch(() => null);
  return pending;
}

export function useServices(): Services & { ready: boolean } {
  const [value, setValue] = useState<Services>(latest ?? DEFAULT);
  const [ready, setReady] = useState(latest !== null);
  useEffect(() => {
    let live = true;
    if (!latest) {
      const kept = clean(stored());
      if (kept) setValue(kept);
    }
    load().then((s) => {
      if (!live) return;
      if (s) setValue(s);
      setReady(true);
    });
    return () => {
      live = false;
    };
  }, []);
  return { ...value, ready };
}

export const moduleOn = (s: Services, code: ModuleCode) => s.modules.some((m) => m.code === code && m.state === "ON");

// Libellés traduits des modules (le serveur envoie le français).
export function useModuleText() {
  const t = useT();
  const text: Record<ModuleCode, { label: string; hint: string; short: string }> = {
    PARCEL: { label: t("Envoyer un colis"), hint: t("Un livreur récupère et dépose où vous voulez."), short: t("Colis") },
    RIDE: { label: t("Une course pour moi"), hint: t("Un Zed vient vous chercher là où vous êtes."), short: t("Course Zed") },
    ERRAND: { label: t("Courses pour moi"), hint: t("Un livreur achète votre liste et vous l'apporte."), short: t("Courses") },
    GAS: { label: t("Gaz et eau"), hint: t("Bouteille de gaz ou bidons d'eau livrés chez vous."), short: t("Gaz et eau") },
    LAUNDRY: { label: t("Lessive"), hint: t("Ramassage du linge, retour lavé et plié."), short: t("Lessive") },
    CLEANING: { label: t("Ménage"), hint: t("Un prestataire vérifié fait le ménage chez vous."), short: t("Ménage") },
    REPAIR: { label: t("Dépannage"), hint: t("Plomberie, électricité, petites réparations."), short: t("Dépannage") },
  };
  return (m: Pick<ServiceModule, "code" | "label" | "hint">) => text[m.code] ?? { label: m.label, hint: m.hint, short: m.label };
}
