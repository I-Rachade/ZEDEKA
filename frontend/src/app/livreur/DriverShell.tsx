"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useOnline } from "@/components/AppRuntime";
import { Icon, type IconName } from "@/components/panel/icons";
import { useWakeLock } from "@/components/panel/partner";
import { driverFetch, flushQueue, useDriverSession, useQueue, type Current } from "@/lib/driver";
import OfferAlarm from "./OfferAlarm";

const TABS: { href: string; label: string; icon: IconName }[] = [
  { href: "/livreur", label: "Courses", icon: "rider" },
  { href: "/livreur/especes", label: "Espèces", icon: "wallet" },
  { href: "/livreur/gains", label: "Gains", icon: "chart" },
  { href: "/livreur/profil", label: "Profil", icon: "user" },
];

const PUBLIC = ["/livreur/connexion", "/livreur/candidature"];
const POLL_MS = 10_000;
const LOCATION_MS = 30_000;

type Ctx = { current: Current | null; reload: () => Promise<void>; notice: string | null; setNotice: (n: string | null) => void };
const DriverContext = createContext<Ctx>({ current: null, reload: async () => {}, notice: null, setNotice: () => {} });
export const useDriver = () => useContext(DriverContext);

// Position envoyée toutes les 30 s tant qu'une course est en cours.
function useLocationReporter(orderId: string | null) {
  const last = useRef<GeolocationPosition | null>(null);
  useEffect(() => {
    if (!orderId || !("geolocation" in navigator)) return;
    const watch = navigator.geolocation.watchPosition(
      (p) => (last.current = p),
      () => {},
      { enableHighAccuracy: true, maximumAge: 20_000, timeout: 30_000 },
    );
    const send = () => {
      const p = last.current;
      if (!p) return;
      driverFetch("/location", { method: "POST", body: { latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy: p.coords.accuracy, orderId } }).catch(() => {});
    };
    const first = setTimeout(send, 3000);
    const t = setInterval(send, LOCATION_MS);
    return () => {
      navigator.geolocation.clearWatch(watch);
      clearTimeout(first);
      clearInterval(t);
    };
  }, [orderId]);
}

export default function DriverShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const session = useDriverSession();
  const online = useOnline();
  const queue = useQueue();
  const isPublic = PUBLIC.some((p) => pathname.startsWith(p));
  const [ready, setReady] = useState(false);
  const [current, setCurrent] = useState<Current | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [assigned, setAssigned] = useState<{ id: string; code: string } | null>(null);
  const known = useRef<Set<string> | null>(null);

  useEffect(() => setReady(true), []);
  useEffect(() => {
    if (ready && !session && !isPublic) router.replace("/livreur/connexion");
  }, [ready, session, isPublic, router]);

  const reload = useCallback(async () => {
    if (!session) return;
    try {
      setCurrent(await driverFetch<Current>("/current"));
    } catch {
      // hors réseau : on garde le dernier état connu
    }
  }, [session]);

  // Interrogation régulière (vaut aussi signe de vie pour le passage automatique hors ligne).
  useEffect(() => {
    if (!session || isPublic) return;
    reload();
    const t = setInterval(reload, POLL_MS);
    const onVisible = () => document.visibilityState === "visible" && reload();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [session, isPublic, reload]);

  // Au retour du réseau, les étapes en attente partent dans l'ordre.
  const queued = queue.length;
  useEffect(() => {
    if (!session || !online || !queued) return;
    flushQueue().then((errors) => {
      if (errors.length) setNotice(`Étape refusée par le serveur : ${errors.join(" · ")}`);
      reload();
    });
  }, [session, online, queued, reload]);

  const active = current?.active ?? [];
  // Course attribuée d'office (livreurs salariés) : elle arrive directement dans « en cours », sans offre à accepter.
  useEffect(() => {
    if (!current) return;
    const ids = new Set(current.active.map((o) => o.id));
    if (known.current) {
      const fresh = current.active.find((o) => !known.current!.has(o.id));
      if (fresh) {
        setAssigned({ id: fresh.id, code: fresh.code });
        navigator.vibrate?.([300, 150, 300]);
      }
    }
    known.current = ids;
  }, [current]);
  const tracked = active.find((o) => o.status === "PICKED_UP") ?? active[0];
  useLocationReporter(tracked?.id ?? null);
  useWakeLock(Boolean(session && (current?.online || active.length)));

  if (isPublic) return <div className="mx-auto min-h-screen max-w-md bg-stone-50">{children}</div>;
  if (!ready || !session) return <div className="min-h-screen bg-stone-50" />;

  const isActive = (href: string) => (href === "/livreur" ? pathname === "/livreur" || pathname.startsWith("/livreur/course") : pathname.startsWith(href));

  return (
    <DriverContext.Provider value={{ current, reload, notice, setNotice }}>
      <div className="mx-auto min-h-screen max-w-md overflow-x-clip bg-stone-50 pb-[calc(4.5rem+env(safe-area-inset-bottom))]">
        {!online && (
          <p role="status" className="sticky top-0 z-40 bg-stone-900 px-4 py-2 text-center text-sm text-white">
            Pas de réseau. {queued ? `${queued} étape(s) en attente, envoi automatique au retour du réseau.` : "Vos étapes seront envoyées au retour du réseau."}
          </p>
        )}
        {online && queued > 0 && <p className="bg-amber-100 px-4 py-2 text-center text-sm text-amber-900">Envoi de {queued} étape(s) en attente…</p>}
        {notice && (
          <div className="flex items-start gap-2 bg-red-50 px-4 py-2 text-sm text-red-800">
            <p className="flex-1">{notice}</p>
            <button onClick={() => setNotice(null)} aria-label="Fermer" className="shrink-0">
              <Icon name="close" className="h-4 w-4" />
            </button>
          </div>
        )}
        {assigned && (
          <div role="alert" className="flex items-center gap-2 bg-emerald-600 px-4 py-3 text-sm text-white">
            <p className="flex-1">
              Course attribuée par le dispatch : <strong>{assigned.code}</strong>
            </p>
            <Link href={`/livreur/course/${assigned.id}`} onClick={() => setAssigned(null)} className="rounded-full bg-white px-3 py-1 font-semibold text-emerald-800">
              Voir
            </Link>
            <button onClick={() => setAssigned(null)} aria-label="Fermer" className="shrink-0">
              <Icon name="close" className="h-4 w-4" />
            </button>
          </div>
        )}
        {children}
        {current?.offers[0] && <OfferAlarm key={current.offers[0].id} offer={current.offers[0]} serverTime={current.serverTime} onDone={reload} />}
        <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-stone-200 bg-white pb-[env(safe-area-inset-bottom)]">
          <ul className="mx-auto grid max-w-md grid-cols-4">
            {TABS.map((t) => (
              <li key={t.href}>
                <Link
                  href={t.href}
                  aria-current={isActive(t.href) ? "page" : undefined}
                  className={`flex flex-col items-center gap-0.5 py-2 text-xs ${isActive(t.href) ? "font-semibold text-emerald-700" : "text-stone-500"}`}
                >
                  <span className={`grid h-7 w-12 place-items-center rounded-full transition-colors ${isActive(t.href) ? "bg-emerald-100" : ""}`}>
                    <Icon name={t.icon} className="h-6 w-6" />
                  </span>
                  {t.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </DriverContext.Provider>
  );
}
