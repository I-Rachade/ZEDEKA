"use client";

import { usePathname } from "next/navigation";
import { useEffect, useSyncExternalStore } from "react";
import { FIRST_ORDER_KEY, useStored, writeStored } from "@/lib/device";
import { isNativeApp, openNotificationTarget } from "@/lib/native";
import { useT } from "@/lib/i18n/client";
import { LAST_FRESH_KEY, fcfa } from "@/lib/api";
import { useApplyEco } from "@/lib/eco";
import { drop, isNetworkFailure, send, useOutbox } from "@/lib/outbox";
import { useRouter } from "next/navigation";
import { useState } from "react";

// Installation sur l'écran d'accueil et mode hors ligne, pour tout le site public et l'application.

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

let deferred: InstallEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as InstallEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    notify();
  });
}

const subscribeInstall = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

function subscribeOnline(l: () => void) {
  window.addEventListener("online", l);
  window.addEventListener("offline", l);
  return () => {
    window.removeEventListener("online", l);
    window.removeEventListener("offline", l);
  };
}

export function useOnline() {
  return useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
}

// Dans les applications Android et iOS (mobile/), Zedeka est déjà installée.
function standalone() {
  return (
    isNativeApp() ||
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as { standalone?: boolean }).standalone === true
  );
}

const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent);

const DISMISSED_KEY = "zedeka.installDismissed";

// Proposé après la première commande, tant que l'application n'est pas installée ni la proposition refusée.
export function InstallPrompt({ always = false }: { always?: boolean }) {
  const t = useT();
  const ordered = useStored<boolean>(FIRST_ORDER_KEY);
  const dismissed = useStored<boolean>(DISMISSED_KEY);
  const event = useSyncExternalStore(subscribeInstall, () => deferred, () => null);
  const mode = useSyncExternalStore(
    () => () => {},
    () => (standalone() ? "installed" : isIos() ? "ios" : "browser"),
    () => "installed",
  );

  if (always && mode === "installed") return <p className="text-sm text-emerald-700">{t("Installée sur cet appareil.")}</p>;
  if (always && mode === "browser" && !event) return <p className="text-sm text-stone-500">{t("Dans le menu du navigateur, choisissez « Installer l'application » ou « Ajouter à l'écran d'accueil ».")}</p>;
  if ((!always && (!ordered || dismissed)) || mode === "installed" || (mode === "browser" && !event)) return null;

  async function install() {
    if (!event) return;
    await event.prompt();
    const choice = await event.userChoice;
    deferred = null;
    notify();
    if (choice.outcome === "dismissed") writeStored(DISMISSED_KEY, true);
  }

  return (
    <div className="flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-600 text-lg font-bold text-white">Z</span>
      <div className="flex-1 space-y-2">
        <p className="font-semibold">{t("Ajouter Zedeka à l'écran d'accueil")}</p>
        {mode === "ios" ? (
          <p>{t("Touchez le bouton Partager de Safari, puis « Sur l'écran d'accueil ». Vous retrouverez vos commandes en un geste.")}</p>
        ) : (
          <p>{t("Ouvrez Zedeka comme une application, sans passer par le navigateur.")}</p>
        )}
        <div className="flex gap-2">
          {mode === "browser" && (
            <button onClick={install} className="rounded-lg bg-emerald-600 px-3 py-2 font-semibold text-white">
              {t("Ajouter")}
            </button>
          )}
          <button onClick={() => writeStored(DISMISSED_KEY, true)} className="rounded-lg px-3 py-2 text-emerald-800">
            {t("Plus tard")}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AppRuntime() {
  const online = useOnline();
  const pathname = usePathname();

  useEffect(openNotificationTarget, []);

  useEffect(() => {
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);

  useApplyEco();

  // L'application livreur, l'espace restaurant et l'admin affichent leur propre bandeau.
  if (/^\/(livreur|restaurant|admin)(\/|$)/.test(pathname)) return null;
  if (online) return <OutboxPrompt />;
  return <OfflineBanner />;
}

// Bandeau fin (planche 7) : ce qui est affiché date de la dernière réponse fraîche ; « Réessayer » recharge.
function OfflineBanner() {
  const t = useT();
  let at: number | null = null;
  try {
    at = Number(localStorage.getItem(LAST_FRESH_KEY)) || null;
  } catch {
    at = null;
  }
  const time = at ? new Date(at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lome" }) : null;
  return (
    <div role="status" className="sticky top-0 z-50 flex items-center justify-between gap-3 bg-night-soft px-4 py-2 text-sm text-white">
      <span>
        <span aria-hidden>📡 </span>
        <span className="font-semibold text-amber-300">{t("Hors ligne.")}</span> {time ? t("Données du {time} affichées.", { time }) : t("Données gardées sur le téléphone.")}
      </span>
      <button onClick={() => location.reload()} className="shrink-0 underline">
        {t("Réessayer")}
      </button>
    </div>
  );
}

// Au retour du réseau : les envois en attente demandent une confirmation, rien ne part en silence.
function OutboxPrompt() {
  const t = useT();
  const items = useOutbox();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (items.length === 0) return null;
  const item = items[0];
  const go = async () => {
    setBusy(item.id);
    setError(null);
    try {
      const order = await send(item);
      router.push(`/commande/${order.code}`);
    } catch (e) {
      setError(isNetworkFailure(e) ? t("Toujours pas de réseau : réessayez dans un instant.") : (e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  return (
    <div role="status" className="sticky top-0 z-50 border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
      <p>
        <span aria-hidden>⏳ </span>
        <span className="font-semibold">{t("Réseau revenu.")}</span> {item.label}
        {item.estimate != null && ` · ${t("environ {amount}, recalculé à l'envoi", { amount: fcfa(item.estimate) })}`}
        {items.length > 1 && ` · ${t("{n} envois en attente", { n: items.length })}`}
      </p>
      {error && <p className="mt-1 text-red-700">{error}</p>}
      <div className="mt-2 flex gap-2">
        <button onClick={go} disabled={busy === item.id} className="rounded-md bg-[#0e7c4a] px-3 py-2 font-bold text-white disabled:opacity-60">
          {busy ? t("Envoi…") : t("Confirmer et envoyer")}
        </button>
        <button onClick={() => drop(item.id)} className="rounded-md px-3 py-2 text-amber-900">
          {t("Supprimer")}
        </button>
      </div>
    </div>
  );
}
