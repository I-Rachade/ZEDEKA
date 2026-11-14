"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Icon } from "@/components/panel/icons";
import { PushBanner } from "@/components/panel/partner";
import { card, Empty, Skeleton } from "@/app/app/ui";
import { fcfa } from "@/lib/api";
import { driverFetch, shownStatus, useDriverSession, useQueue, type DriverOrder } from "@/lib/driver";
import { driverClient } from "./client";
import { useDriver } from "./DriverShell";
import ZedHomeCard from "./zed/ZedHomeCard";
import UpcomingRides from "./zed/UpcomingRides";
import MissionsCard from "./missions/MissionsCard";
import ScheduledPickups from "./ScheduledPickups";
import MotoPicker from "./MotoPicker";
import { useI18n, useT } from "@/lib/i18n/client";

type Today = {
  rating: number | null;
  count: number;
  earnings: number;
  cash: number;
  done: { id: string; code: string; type: "FOOD" | "PARCEL"; driverEarning: number; deliveredAt: string; address: string; restaurant: { name: string } | null }[];
  zed: { count: number; prices: number; rating: number | null; recent: { id: string; code: string; landmark: string | null; destination: string | null; completedAt: string; price: number | null; rating: number | null }[] };
};

// Interrupteur en carte, comme sur la planche : titre, explication, bascule.
function Toggle({ emoji, title, hint, on, disabled, onClick }: { emoji: string; title: string; hint: string; on: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button role="switch" aria-checked={on} aria-label={title} disabled={disabled} onClick={onClick} className="card-gloss flex w-full items-center gap-3 rounded-[12px] bg-surface p-4 text-left">
      <span className="min-w-0 flex-1">
        <span className="block font-bold">
          <span aria-hidden="true">{emoji}</span> {title}
        </span>
        <span className="block text-[13px] text-stone-500">{hint}</span>
      </span>
      <span className={`relative h-8 w-14 shrink-0 rounded-full transition ${on ? "bg-emerald-600" : "bg-stone-300"}`}>
        <span className={`absolute top-1 h-6 w-6 rounded-full bg-surface shadow transition-all ${on ? "left-7" : "left-1"}`} />
      </span>
    </button>
  );
}

// Barre en quatre étapes, la même que côté client.
function stageOf(o: DriverOrder, status: DriverOrder["status"]) {
  const labels = o.type === "FOOD" ? ["Acceptée", "Au resto", "Récupérée", "Livrée"] : ["Acceptée", "Au départ", "Récupéré", "Livré"];
  const reached = status === "DELIVERED" ? 3 : status === "PICKED_UP" ? 2 : status === "READY" ? 1 : 0;
  return { labels, reached };
}

// Pastille « En direct » : étape et chrono depuis son début.
function liveOf(o: DriverOrder, status: DriverOrder["status"]): { label: string; since: string } {
  if (status === "PICKED_UP") return { label: "En route", since: o.pickedUpAt ?? o.createdAt };
  if (o.type === "PARCEL") return { label: "À récupérer", since: o.confirmedAt ?? o.createdAt };
  if (status === "READY") return { label: "Prête au restaurant", since: o.readyAt ?? o.createdAt };
  return { label: "En préparation", since: o.confirmedAt ?? o.createdAt };
}

const chrono = (since: string, now: number) => {
  const s = Math.max(0, Math.floor((now - new Date(since).getTime()) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

// Accueil du livreur : en ligne ou non, courses en cours.
export default function DriverHome() {
  const session = useDriverSession();
  const { current, reload, setNotice } = useDriver();
  const queue = useQueue();
  const [busy, setBusy] = useState(false);
  const t = useT();

  // Salarié sans moto du parc : il en choisit une avant de passer en ligne.
  const [picking, setPicking] = useState(false);
  async function toggle() {
    if (!current) return;
    setBusy(true);
    try {
      await driverFetch("/online", { method: "PATCH", body: { online: !current.online } });
      await reload();
    } catch (e) {
      if ((e as { needsMotorbike?: boolean }).needsMotorbike) setPicking(true);
      else setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const online = current?.online ?? false;
  const active = current?.active ?? [];
  const awaiting = current?.awaiting ?? [];
  // Conducteur Zed inscrit seul : pas de livraisons, ni interrupteur « En ligne » ni liste des courses.
  const deliveries = current?.deliveries !== false;
  const now = useNow();
  const { locale } = useI18n();
  const [today, setToday] = useState<Today | null>(null);
  const doneCount = active.length + awaiting.length;
  useEffect(() => {
    driverFetch<Today>("/today").then(setToday, () => {});
  }, [doneCount]);
  const zed = current?.zed;
  const zedActive = zed?.status === "ACTIVE";
  async function toggleZed() {
    if (!zed) return;
    setBusy(true);
    try {
      await driverFetch("/zed/available", { method: "PATCH", body: { available: !zed.available } });
      await reload();
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const messages = active.filter((o) => o.restaurantMessage && o.restaurantMessageAt && o.status !== "PICKED_UP");
  const hm = (iso: string) => new Date(iso).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lome" });
  const ago = (iso: string) => Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));

  return (
    <div>
      <header className="hero-shine px-4 pb-5 pt-[calc(1rem+env(safe-area-inset-top))] text-white">
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-sun text-[17px] font-bold text-ink-deep" aria-hidden="true">
            {session?.name?.[0]?.toUpperCase() ?? "Z"}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] text-[#d3eede]">{t("Bonjour")}</p>
            <p className="truncate text-[17px] font-bold">
              {session?.name}
              {today?.rating != null && <span className="font-semibold"> · ★ {today.rating.toFixed(1).replace(".", ",")}</span>}
            </p>
          </div>
          {deliveries && (
            <button
              onClick={toggle}
              disabled={!current || busy}
              role="switch"
              aria-checked={online}
              aria-label={online ? t("En ligne") : t("Hors ligne")}
              className={`inline-flex shrink-0 items-center gap-2 rounded-full px-3 py-2 text-[14px] font-semibold ${online ? "bg-surface text-emerald-700" : "bg-white/15 text-white"}`}
            >
              <span className={`h-2 w-2 rounded-full ${online ? "bg-emerald-600" : "bg-white/60"}`} />
              {online ? t("En ligne") : t("Hors ligne")}
            </button>
          )}
        </div>
        {zedActive && (
          <Link href="/livreur/zed" className="mt-4 flex items-center justify-between rounded-[10px] bg-white/12 px-4 py-3">
            <span>
              <span className="block text-[13px] text-[#d3eede]">{zed!.planEndsAt ? t("Plan Zed actif") : t("Plan Zed")}</span>
              <span className="block text-[17px] font-bold">
                {zed!.planEndsAt ? t("Jusqu'au {date}", { date: new Date(zed!.planEndsAt).toLocaleDateString(locale, { day: "numeric", month: "short", timeZone: "Africa/Lome" }) }) : t("Aucun plan en cours")}
              </span>
            </span>
            <span className="text-[14px] font-bold">{t("Mes paiements")} ›</span>
          </Link>
        )}
        {deliveries && !zedActive && (
          <div className="mt-4 grid grid-cols-3 gap-2">
            {[
              [t("Aujourd'hui"), today ? t("{n} course(s)", { n: today.count }) : "…"],
              [t("Gains"), today ? fcfa(today.earnings) : "…"],
              [t("Espèces"), today ? fcfa(today.cash) : "…"],
            ].map(([label, value]) => (
              <div key={label} className="rounded-[10px] bg-white/12 px-3 py-3">
                <p className="text-[12px] text-[#d3eede]">{label}</p>
                <p className="text-[17px] font-bold leading-tight">{value}</p>
              </div>
            ))}
          </div>
        )}
        {deliveries && !online && !zedActive && <p className="mt-3 text-[13px] text-[#d3eede]">{t("Passez en ligne pour recevoir des courses")}</p>}
        <div className="mt-3 empty:hidden">
          <ZedHomeCard />
        </div>
        <div className="mt-3 empty:hidden">
          <MissionsCard />
        </div>
      </header>

      {picking && (
        <MotoPicker
          onClose={() => setPicking(false)}
          onDone={() => {
            setPicking(false);
            reload();
          }}
        />
      )}
      <div className="space-y-4 px-4 py-4">
        <PushBanner api={driverClient} what="course proposée" />
        {!!current?.missingDocuments?.length && (
          <Link href="/livreur/profil" className="flex items-center gap-3 rounded-[12px] bg-amber-50 p-4 text-amber-950">
            <Icon name="user" className="h-6 w-6 shrink-0" />
            <span className="min-w-0 flex-1 text-[14px]">
              <span className="block font-bold">{t("Pièces à fournir")}</span>
              {current.missingDocuments.includes("SELFIE") && current.missingDocuments.includes("ID_CARD")
                ? t("Passez voir l'équipe Zedeka pour votre photo de profil et votre pièce d'identité. Le client voit votre photo.")
                : current.missingDocuments.includes("SELFIE")
                  ? t("Passez voir l'équipe Zedeka pour votre photo de profil : le client la voit pendant la livraison.")
                  : t("Apportez votre pièce d'identité à l'équipe Zedeka, ou la nouvelle si elle a expiré.")}
            </span>
            <span className="font-bold">›</span>
          </Link>
        )}
        {!!current?.favoriteInvites && (
          <Link href="/livreur/favoris" className="flex items-center gap-3 rounded-[12px] bg-emerald-50 p-4 text-emerald-950">
            <Icon name="heart" className="h-6 w-6 shrink-0" />
            <span className="min-w-0 flex-1 text-[14px]">
              <span className="block font-bold">{t("Invitation : livreur favori")}</span>
              {t("Un restaurant ou une boutique veut vous confier ses courses en premier. Acceptez ou refusez.")}
            </span>
            <span className="font-bold">›</span>
          </Link>
        )}
        {current?.motorbike && (
          <p className="flex items-center gap-2 rounded-[12px] bg-stone-100 px-4 py-3 text-[14px]">
            <Icon name="rider" className="h-5 w-5 shrink-0 text-stone-500" />
            <span className="min-w-0 flex-1">
              {t("Moto du parc")} <strong className="font-mono">{current.motorbike.plate}</strong>
              {current.motorbike.label ? ` · ${current.motorbike.label}` : ""}
            </span>
          </p>
        )}
        {zedActive && (
          <>
            {deliveries && <Toggle emoji="📦" title={t("Livraisons")} hint={t("Repas et colis de la répartition")} on={online} disabled={!current || busy} onClick={toggle} />}
            <Toggle emoji="🛵" title={t("Disponible pour les Zed")} hint={t("Clients à moins de 1 km de vous")} on={zed!.available} disabled={busy} onClick={toggleZed} />
            <h2 className="pt-1 text-[17px] font-bold">{t("Aujourd'hui")}</h2>
            <dl className="grid grid-cols-2 gap-2">
              {[
                [t("Zed"), today ? t("{n} course(s)", { n: today.zed.count }) : "…"],
                [t("Livraisons"), today ? String(today.count) : "…"],
                [t("Prix notés"), today ? fcfa(today.zed.prices) : "…"],
                [t("Note"), today?.zed.rating != null ? `★ ${today.zed.rating.toFixed(1).replace(".", ",")}` : today?.rating != null ? `★ ${today.rating.toFixed(1).replace(".", ",")}` : "–"],
              ].map(([label, value]) => (
                <div key={label} className="rounded-[10px] bg-stone-100 px-3 py-3">
                  <dt className="text-[12px] text-stone-500">{label}</dt>
                  <dd className="text-[16px] font-bold">{value}</dd>
                </div>
              ))}
            </dl>
            <UpcomingRides />
          </>
        )}
        {deliveries && <h2 className="text-[17px] font-bold">{t("Course en cours")}</h2>}
        {!deliveries ? (
          current?.zed?.status === "ACTIVE" &&
          !current.zed.ride && (
            <div className={card}>
              <Empty icon="rider" title={current.zed.available ? "En attente d'un appel Zed" : "Zed : pas disponible"}>
                {current.zed.available ? t("Gardez l'application ouverte : une alarme sonne dès qu'un client proche vous appelle.") : t("Activez « Disponible pour les Zed » pour recevoir les appels.")}
              </Empty>
            </div>
          )
        ) : !current ? (
          <Skeleton rows={2} />
        ) : active.length === 0 ? (
          <div className={card}>
            <Empty icon="rider" title={online ? "En attente d'une course" : "Aucune course"}>
              {online ? t("Gardez l'application ouverte : une alarme sonne dès qu'une course vous est proposée.") : t("Vous êtes hors ligne.")}
            </Empty>
          </div>
        ) : (
          <ul className="space-y-3">
            {active.map((o) => {
              const status = shownStatus(o, queue);
              const pending = queue.some((q) => q.orderId === o.id);
              const bar = stageOf(o, status);
              const live = liveOf(o, status);
              const where = status === "PICKED_UP" ? o.address : o.restaurant ? o.restaurant.address : o.pickupAddress;
              return (
                <li key={o.id}>
                  <Link href={`/livreur/course/${o.id}`} className={`${card} block p-4`}>
                    <span className="flex gap-3">
                      <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-[10px] text-[22px] ${o.type === "FOOD" ? "bg-emerald-50" : "bg-sun-soft"}`} aria-hidden="true">
                        {o.type === "FOOD" ? "🍗" : "📦"}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-bold">
                          {o.code} · {o.type === "FOOD" ? o.restaurant?.name : t("Colis")}
                        </span>
                        <span className="block truncate text-[13px] text-stone-500">
                          → {[where, o.distanceKm != null ? t("{km} km", { km: o.distanceKm.toFixed(1).replace(".", ",") }) : null, o.cashDue ? t("{amount} en espèces", { amount: fcfa(o.cashDue) }) : t("Déjà payé")].filter(Boolean).join(" · ")}
                        </span>
                      </span>
                    </span>
                    <span className="mt-3 flex gap-1" aria-hidden="true">
                      {bar.labels.map((l, i) => (
                        <span key={l} className={`h-1.5 flex-1 rounded-full ${i < bar.reached ? "bg-emerald-600" : i === bar.reached ? "step-now" : "bg-stone-200"}`} />
                      ))}
                    </span>
                    <span className="mt-1 flex gap-1 text-[11px]">
                      {bar.labels.map((l, i) => (
                        <span key={l} className={`flex-1 truncate ${i === bar.reached ? "font-semibold text-stone-900" : "text-stone-400"}`}>
                          {t(l)}
                        </span>
                      ))}
                    </span>
                    <span className="mt-3 flex items-center justify-between">
                      <span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-[13px] font-semibold text-emerald-800">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-600" />
                        {t(live.label)} · <span className="tabular-nums">{chrono(live.since, now)}</span>
                      </span>
                      <span className="text-[14px] font-bold text-emerald-700">
                        {pending ? t("étape en attente de réseau") : `${t("Ouvrir")} ›`}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}

        {deliveries && <ScheduledPickups list={current?.scheduled ?? []} now={now} onChange={reload} />}

        {messages.map((o) => (
          <Link key={o.id} href={`/livreur/course/${o.id}`} className="flex gap-3 rounded-[12px] border border-sun/40 bg-sun-soft p-4">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[10px] bg-sun text-[20px]" aria-hidden="true">
              📣
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-bold">{o.restaurant?.name ?? o.code}</span>
              <span className="block text-[13px] text-stone-600">
                « {o.restaurantMessage} » · {t("il y a {n} min", { n: ago(o.restaurantMessageAt!) })}
              </span>
            </span>
          </Link>
        ))}

        {awaiting.length > 0 && (
          <>
            <h2 className="text-[17px] font-bold">{t("En attente du client")}</h2>
            <ul className="space-y-3">
              {awaiting.map((o) => (
                <li key={o.id}>
                  <Link href={`/livreur/course/${o.id}`} className={`${card} block p-4`}>
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-semibold">
                        {o.code} · {o.type === "FOOD" ? o.restaurant?.name : t("Colis")}
                      </p>
                      <span className={`rounded-full px-2 py-1 text-xs font-semibold ${o.receiptDisputedAt ? "bg-red-100 text-red-800" : "bg-sky-100 text-sky-800"}`}>
                        {o.receiptDisputedAt ? t("Contestée") : t("À confirmer")}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-stone-500">{t("Le client confirme la réception, ou donnez son code pour clôturer.")}</p>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}

        {zedActive && today && today.zed.recent.length > 0 && (
          <section>
            <h2 className="text-[17px] font-bold">{t("Dernières courses Zed")}</h2>
            <ul className="divide-y divide-stone-200/70">
              {today.zed.recent.map((r) => (
                <li key={r.id} className="flex items-center gap-3 py-3">
                  <span className="text-[20px]" aria-hidden="true">
                    🛵
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">
                      {r.landmark ?? t("Course Zed")}
                      {r.destination && ` → ${r.destination}`}
                    </span>
                    <span className="block text-[13px] text-stone-500">{[hm(r.completedAt), r.price !== null ? fcfa(r.price) : null, r.rating !== null ? `★ ${r.rating}` : null].filter(Boolean).join(" · ")}</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {deliveries && today && today.done.length > 0 && (
          <section>
            <h2 className="text-[17px] font-bold">{t("Terminées aujourd'hui")}</h2>
            <ul className="divide-y divide-stone-200/70">
              {today.done.map((o) => (
                <li key={o.id} className="flex items-center gap-3 py-3">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">
                      {o.code} · {o.restaurant?.name ?? t("Colis")}
                    </span>
                    <span className="block text-[13px] text-stone-500">
                      {t("Livrée à {time}", { time: hm(o.deliveredAt) })} · {fcfa(o.driverEarning)}
                    </span>
                  </span>
                  <span className="grid h-7 w-7 place-items-center rounded-full bg-emerald-50 text-emerald-700" aria-hidden="true">
                    <Icon name="check" className="h-4 w-4" />
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
