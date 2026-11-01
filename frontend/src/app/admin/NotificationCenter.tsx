"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { beep } from "@/components/panel/beep";
import { Icon, type IconName } from "@/components/panel/icons";
import { usePush } from "@/components/panel/partner";
import { adminFetch, getToken, type TeamRole } from "@/lib/admin";
import { useT } from "@/lib/i18n/client";

// Centre de notifications de l'admin, pour tous les rôles de l'équipe : cloche avec le nombre de non lues,
// fil des événements (commandes, restaurants, livreurs, candidatures, espèces) filtrable par catégorie,
// et réglages. Page visible : bandeau dans le coin et bip. Page en arrière-plan ou fermée : pop-up du système
// (Web Push par le service worker, sinon notification du navigateur tant que l'onglet reste ouvert).

export type Category = "ORDERS" | "RESTAURANTS" | "DRIVERS" | "APPLICATIONS" | "FINANCE";
export type StaffNotification = { id: string; category: Category; title: string; body: string; url: string; alarm: boolean; createdAt: string };
type Feed = { items: StaffNotification[]; unread: number; seenAt: string; categories: Category[]; muted: Category[] };

export const CATEGORY: Record<Category, { label: string; icon: IconName; tone: string }> = {
  ORDERS: { label: "Commandes", icon: "orders", tone: "bg-emerald-100 text-emerald-800" },
  RESTAURANTS: { label: "Restaurants", icon: "store", tone: "bg-amber-100 text-amber-800" },
  DRIVERS: { label: "Livreurs", icon: "rider", tone: "bg-sky-100 text-sky-800" },
  APPLICATIONS: { label: "Candidatures", icon: "doc", tone: "bg-violet-100 text-violet-800" },
  FINANCE: { label: "Finances", icon: "wallet", tone: "bg-rose-100 text-rose-800" },
};

const POLL_MS = 15_000;
const SOUND_KEY = "zedeka.admin.notificationSound";
const adminApi = { apiFetch: adminFetch };

// Écrans fermés au dispatcheur (même liste que AdminShell) : la notification s'affiche sans lien.
const DIRECTOR_ONLY = /^\/admin\/(candidatures|restaurants|zones|finances|rapport|reglages|equipe)(\/|$)/;
export const canOpen = (url: string, role: TeamRole | undefined) => role !== "DISPATCHER" || !DIRECTOR_ONLY.test(url);

function readSound() {
  try {
    return localStorage.getItem(SOUND_KEY) !== "0";
  } catch {
    return true;
  }
}

function ago(iso: string, t: ReturnType<typeof useT>) {
  const m = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60_000));
  if (m < 1) return t("à l'instant");
  if (m < 60) return t("il y a {n} min", { n: m });
  if (m < 24 * 60) return t("il y a {n} h", { n: Math.floor(m / 60) });
  return t("il y a {n} j", { n: Math.floor(m / 1440) });
}

// Pop-up du système quand l'onglet est en arrière-plan et que le Web Push n'est pas actif sur ce navigateur.
async function systemPopup(n: StaffNotification) {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  const options = { body: n.body, tag: n.id, icon: "/pwa-icon/192", data: { url: n.url }, requireInteraction: n.alarm };
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) return void (await reg.showNotification(n.title, options));
    const popup = new Notification(n.title, options);
    popup.onclick = () => {
      window.focus();
      window.location.href = n.url;
    };
  } catch {
    // notifications indisponibles : la cloche suffit
  }
}

function useFeed(enabled: boolean, onNew: (items: StaffNotification[]) => void) {
  const [feed, setFeed] = useState<Feed | null>(null);
  const known = useRef<Set<string> | null>(null);
  const onNewRef = useRef(onNew);
  onNewRef.current = onNew;

  const load = useCallback(async () => {
    if (!getToken()) return;
    try {
      const next = await adminFetch<Feed>("/notifications?limit=50");
      // Premier chargement : rien n'est annoncé, seuls les événements arrivés ensuite le sont.
      if (known.current) {
        const fresh = next.items.filter((n) => !known.current!.has(n.id));
        if (fresh.length) onNewRef.current(fresh);
      }
      known.current = new Set(next.items.map((n) => n.id));
      setFeed(next);
    } catch {
      // réseau coupé ou session expirée : on réessaie au prochain tour
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    load();
    const timer = setInterval(load, POLL_MS);
    const onVisible = () => document.visibilityState === "visible" && load();
    // Le service worker prévient la page ouverte qu'un événement vient d'arriver.
    const onMessage = (e: MessageEvent) => e.data?.type === "zedeka-staff-notification" && load();
    document.addEventListener("visibilitychange", onVisible);
    navigator.serviceWorker?.addEventListener("message", onMessage);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      navigator.serviceWorker?.removeEventListener("message", onMessage);
    };
  }, [enabled, load]);

  return { feed, setFeed, reload: load };
}

export default function NotificationCenter({ role }: { role: TeamRole | undefined }) {
  const t = useT();
  const router = useRouter();
  const push = usePush(adminApi);
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState(false);
  const [filter, setFilter] = useState<Category | "ALL">("ALL");
  const [toasts, setToasts] = useState<StaffNotification[]>([]);
  const [sound, setSound] = useState(true);
  const [lastSeen, setLastSeen] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => setSound(readSound()), []);

  const pushOn = push.state === "on";
  const announce = useCallback(
    (items: StaffNotification[], muted: Category[]) => {
      const loud = items.filter((n) => !muted.includes(n.category));
      if (!loud.length) return;
      if (document.visibilityState === "visible") {
        setToasts((list) => [...loud.slice(0, 3), ...list].slice(0, 4));
        if (sound || loud.some((n) => n.alarm)) beep();
      } else if (!pushOn) {
        // Avec le Web Push, le service worker affiche déjà le pop-up.
        loud.slice(0, 3).forEach(systemPopup);
      }
    },
    [pushOn, sound],
  );

  const mutedRef = useRef<Category[]>([]);
  const { feed, setFeed, reload } = useFeed(true, (items) => announce(items, mutedRef.current));
  mutedRef.current = feed?.muted ?? [];

  // Bandeaux : effacés au bout de 8 s, sauf les alarmes qui attendent un clic.
  useEffect(() => {
    if (!toasts.some((n) => !n.alarm)) return;
    const timer = setTimeout(() => setToasts((list) => list.filter((n) => n.alarm)), 8000);
    return () => clearTimeout(timer);
  }, [toasts]);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);

  const markSeen = useCallback(async () => {
    const r = await adminFetch<{ unread: number; seenAt: string }>("/notifications/seen", { method: "POST" }).catch(() => null);
    if (r) setFeed((f) => f && { ...f, unread: 0, seenAt: r.seenAt });
  }, [setFeed]);

  const toggle = () => {
    if (open) return setOpen(false);
    // Les éléments arrivés depuis la dernière ouverture restent marqués « nouveau » pendant que le fil est ouvert.
    setLastSeen(feed?.seenAt ?? null);
    setSettings(false);
    setOpen(true);
    if (feed?.unread) markSeen();
  };

  const go = (n: StaffNotification) => {
    setToasts((list) => list.filter((x) => x.id !== n.id));
    setOpen(false);
    if (canOpen(n.url, role)) router.push(n.url);
  };

  const setMuted = async (category: Category, mute: boolean) => {
    if (!feed) return;
    const muted = mute ? [...feed.muted, category] : feed.muted.filter((c) => c !== category);
    setFeed({ ...feed, muted });
    const r = await adminFetch<{ muted: Category[] }>("/notifications/prefs", { method: "PUT", body: { muted } }).catch(() => null);
    if (!r) reload();
  };

  const setSoundOn = (on: boolean) => {
    setSound(on);
    try {
      localStorage.setItem(SOUND_KEY, on ? "1" : "0");
    } catch {
      // réglage gardé le temps de la page
    }
  };

  const categories = feed?.categories ?? [];
  const items = (feed?.items ?? []).filter((n) => filter === "ALL" || n.category === filter);
  const unread = feed?.unread ?? 0;

  return (
    <>
      <div ref={box} className="relative">
        <button
          onClick={toggle}
          aria-label={unread ? t("Notifications ({n} nouvelles)", { n: unread }) : t("Notifications")}
          aria-expanded={open}
          className="relative grid h-9 w-9 place-items-center rounded-lg text-stone-600 hover:bg-stone-100"
        >
          <Icon name="bell" />
          {unread > 0 && (
            <span className="absolute -right-0.5 -top-0.5 min-w-[18px] rounded-full bg-rose-600 px-1 text-center text-[10px] font-bold leading-[18px] text-white">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </button>

        {open && (
          <div className="fixed inset-x-2 top-14 z-50 flex max-h-[80vh] flex-col overflow-hidden rounded-xl border border-stone-200 bg-white shadow-xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-11 sm:w-96">
            <div className="flex items-center justify-between border-b border-stone-100 px-4 py-3">
              <p className="font-semibold">{settings ? t("Réglages des notifications") : t("Notifications")}</p>
              <button onClick={() => setSettings((s) => !s)} className="rounded-lg p-1.5 text-stone-500 hover:bg-stone-100" aria-label={settings ? t("Retour aux notifications") : t("Réglages des notifications")}>
                <Icon name={settings ? "back" : "settings"} className="h-4 w-4" />
              </button>
            </div>

            {settings ? (
              <div className="space-y-4 overflow-y-auto p-4 text-sm">
                <section>
                  <p className="font-medium">{t("Pop-ups sur cet appareil")}</p>
                  <p className="mt-0.5 text-xs text-stone-500">{t("Une fenêtre du système vous prévient quand l'admin est en arrière-plan ou fermé.")}</p>
                  <div className="mt-2">
                    {push.state === "on" && (
                      <button onClick={push.disable} className="rounded-lg border border-stone-300 px-3 py-1.5 font-medium">
                        {t("Désactiver sur cet appareil")}
                      </button>
                    )}
                    {push.state === "off" && (
                      <>
                        <button onClick={push.enable} className="rounded-lg bg-emerald-600 px-3 py-1.5 font-semibold text-white">
                          {t("Activer les pop-ups")}
                        </button>
                        {typeof Notification !== "undefined" && Notification.permission === "granted" && (
                          <p className="mt-1.5 text-xs text-stone-500">{t("En attendant, les pop-ups s'affichent tant qu'un onglet de l'admin reste ouvert.")}</p>
                        )}
                      </>
                    )}
                    {push.state === "loading" && <span className="text-stone-500">{t("Chargement…")}</span>}
                    {push.state === "denied" && <p className="text-amber-700">{t("Bloquées par le navigateur : autorisez les notifications pour ce site dans ses réglages (icône du cadenas).")}</p>}
                    {push.state === "unsupported" && <p className="text-stone-500">{t("Ce navigateur ne propose pas les notifications. Le fil reste disponible ici.")}</p>}
                  </div>
                </section>
                <label className="flex items-center justify-between gap-3">
                  <span>{t("Son à l'arrivée d'un événement")}</span>
                  <input type="checkbox" checked={sound} onChange={(e) => setSoundOn(e.target.checked)} className="h-4 w-4 accent-emerald-600" />
                </label>
                <section>
                  <p className="font-medium">{t("Recevoir")}</p>
                  <p className="mt-0.5 text-xs text-stone-500">{t("Une catégorie décochée reste dans le fil, sans pop-up ni son.")}</p>
                  <ul className="mt-2 space-y-1.5">
                    {categories.map((c) => (
                      <li key={c}>
                        <label className="flex items-center justify-between gap-3">
                          <span className="flex items-center gap-2">
                            <span className={`grid h-6 w-6 place-items-center rounded-full ${CATEGORY[c].tone}`}>
                              <Icon name={CATEGORY[c].icon} className="h-3.5 w-3.5" />
                            </span>
                            {t(CATEGORY[c].label)}
                          </span>
                          <input type="checkbox" checked={!feed?.muted.includes(c)} onChange={(e) => setMuted(c, !e.target.checked)} className="h-4 w-4 accent-emerald-600" />
                        </label>
                      </li>
                    ))}
                  </ul>
                </section>
                {push.state === "on" && (
                  <button onClick={() => push.test()} className="text-xs font-medium text-emerald-700 underline">
                    {t("Envoyer une notification de test")}
                  </button>
                )}
              </div>
            ) : (
              <>
                {push.state === "off" && (
                  <div className="flex items-center gap-2 border-b border-emerald-100 bg-emerald-50 px-4 py-2 text-xs text-emerald-900">
                    <span className="flex-1">{t("Activez les pop-ups pour être prévenu même quand l'admin est en arrière-plan.")}</span>
                    <button onClick={push.enable} className="shrink-0 rounded-md bg-emerald-600 px-2 py-1 font-semibold text-white">
                      {t("Activer")}
                    </button>
                  </div>
                )}
                <div className="flex gap-1.5 overflow-x-auto border-b border-stone-100 px-3 py-2">
                  {(["ALL", ...categories] as const).map((c) => (
                    <button
                      key={c}
                      onClick={() => setFilter(c)}
                      className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${filter === c ? "bg-stone-900 text-white" : "bg-stone-100 text-stone-700"}`}
                    >
                      {c === "ALL" ? t("Tout") : t(CATEGORY[c].label)}
                    </button>
                  ))}
                </div>
                <ul className="flex-1 divide-y divide-stone-100 overflow-y-auto">
                  {!feed && <li className="p-4 text-sm text-stone-500">{t("Chargement…")}</li>}
                  {feed && !items.length && <li className="p-6 text-center text-sm text-stone-500">{t("Aucune notification pour le moment.")}</li>}
                  {items.map((n) => {
                    const isNew = lastSeen !== null && n.createdAt > lastSeen;
                    const c = CATEGORY[n.category] ?? CATEGORY.ORDERS;
                    return (
                      <li key={n.id}>
                        <button onClick={() => go(n)} className={`flex w-full gap-3 px-4 py-3 text-left hover:bg-stone-50 ${isNew ? "bg-emerald-50/60" : ""}`}>
                          <span className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full ${c.tone}`}>
                            <Icon name={c.icon} className="h-4 w-4" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-start gap-2">
                              <span className="flex-1 text-sm font-medium leading-snug">{n.title}</span>
                              {isNew && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-emerald-600" aria-label={t("Nouveau")} />}
                            </span>
                            <span className="mt-0.5 block text-xs text-stone-600">{n.body}</span>
                            <span className="mt-1 block text-[11px] text-stone-400">
                              {t(c.label)} · {ago(n.createdAt, t)}
                              {n.alarm && <span className="ml-1 font-semibold text-rose-600">· {t("Urgent")}</span>}
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </div>
        )}
      </div>

      {/* Bandeaux quand la page est ouverte */}
      {toasts.length > 0 && (
        <div className="pointer-events-none fixed right-3 top-16 z-50 flex w-[min(22rem,calc(100vw-1.5rem))] flex-col gap-2 print:hidden" aria-live="polite">
          {toasts.map((n) => {
            const c = CATEGORY[n.category] ?? CATEGORY.ORDERS;
            return (
              <div key={n.id} className={`pointer-events-auto flex gap-3 rounded-xl border bg-white p-3 shadow-lg ${n.alarm ? "border-rose-300" : "border-stone-200"}`}>
                <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full ${c.tone}`}>
                  <Icon name={c.icon} className="h-4 w-4" />
                </span>
                <button onClick={() => go(n)} className="min-w-0 flex-1 text-left">
                  <span className="block text-sm font-semibold leading-snug">{n.title}</span>
                  <span className="mt-0.5 block text-xs text-stone-600">{n.body}</span>
                </button>
                <button onClick={() => setToasts((list) => list.filter((x) => x.id !== n.id))} aria-label={t("Fermer")} className="self-start text-stone-400 hover:text-stone-700">
                  <Icon name="close" className="h-4 w-4" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
