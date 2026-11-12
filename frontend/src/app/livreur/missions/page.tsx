"use client";

import { useCallback, useEffect, useState } from "react";
import { card, input, primary, Skeleton, TopBar } from "@/app/app/ui";
import { fcfa } from "@/lib/api";
import { driverFetch, mapsUrl, tel } from "@/lib/driver";
import NavigationScreen from "@/components/NavigationScreen";
import { useI18n } from "@/lib/i18n/client";
import { MODULE_EMOJI, slotLabel, STATUS_COLOR, STATUS_TEXT, type RequestModule, type ServiceRequest } from "@/lib/serviceRequests";
import { useDriver } from "../DriverShell";

// Missions de service du livreur ou prestataire : demandes à prendre (services de son profil), missions en cours
// (en route, sur place, terminer avec les achats ou pièces), et celles terminées aujourd'hui.

type Missions = { codes: RequestModule[]; available: ServiceRequest[]; active: ServiceRequest[]; done: ServiceRequest[] };
const POLL_MS = 10_000;

const SERVICE_NAME: Record<RequestModule, string> = { ERRAND: "Courses pour moi", GAS: "Gaz et eau", LAUNDRY: "Lessive", CLEANING: "Ménage", REPAIR: "Dépannage" };
// Ce que le prestataire peut ajouter à la fin.
const EXTRA_LABEL: Partial<Record<RequestModule, string>> = { ERRAND: "Montant des achats (ticket)", GAS: "Prix du gaz ou de l'eau", REPAIR: "Pièces et réparation", LAUNDRY: "Supplément (repassage, kilos en plus)", CLEANING: "Supplément" };

function Mission({ r, mine, onChange }: { r: ServiceRequest; mine: boolean; onChange: () => void }) {
  const { t, locale } = useI18n();
  const { reload } = useDriver();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const [extra, setExtra] = useState("");
  const [navigating, setNavigating] = useState(false);

  async function post(path: string, body: unknown = {}) {
    setBusy(true);
    setError(null);
    try {
      await driverFetch(`/missions/${r.id}/${path}`, { method: "POST", body });
      onChange();
      reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const items = typeof r.details.items === "string" ? r.details.items : typeof r.details.problem === "string" ? r.details.problem : null;
  return (
    <li className={`${card} space-y-3 p-4`}>
      <div className="flex items-start gap-3">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-emerald-600/10 text-[24px]" aria-hidden="true">
          {MODULE_EMOJI[r.module]}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[12px] font-semibold uppercase tracking-wide text-stone-500">
            {t(SERVICE_NAME[r.module])} · {r.code}
          </span>
          {mine && <span className={`mb-1 inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLOR[r.status]}`}>{t(STATUS_TEXT[r.status])}</span>}
          <span className="block font-semibold">{r.summary}</span>
          <span className="block text-[13px] text-stone-600">📍 {r.address}</span>
          <span className="block text-[13px] text-stone-600">🕒 {r.scheduledFor ? slotLabel(r.scheduledFor, locale) : t("Dès que possible")}</span>
        </span>
      </div>
      {items && <p className="whitespace-pre-line rounded-[10px] bg-stone-50 p-3 text-sm text-stone-700">{items}</p>}
      {r.note && <p className="text-sm text-stone-600">« {r.note} »</p>}
      <p className="flex justify-between text-sm">
        <span className="text-stone-500">{t("Prix estimé")}</span>
        <span className="font-bold">{fcfa(r.finalPrice ?? r.estimate)}</span>
      </p>
      {error && (
        <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">
          {error}
        </p>
      )}
      {!mine ? (
        <button type="button" disabled={busy} onClick={() => post("accept")} className={primary}>
          {t("Accepter la mission")}
        </button>
      ) : r.status === "DONE" ? null : (
        <>
          <div className="grid grid-cols-2 gap-2">
            {r.customer && (
              <a href={tel(r.customer.phone)} className="rounded-[10px] bg-stone-100 py-3 text-center font-semibold">
                📞 {r.customer.name ?? t("Client")}
              </a>
            )}
            {r.latitude !== null && r.longitude !== null ? (
              <button type="button" onClick={() => setNavigating(true)} className="rounded-[10px] bg-stone-100 py-3 text-center font-semibold">
                🧭 {t("Naviguer")}
              </button>
            ) : (
              <a href={mapsUrl(r.latitude, r.longitude, r.address)} target="_blank" rel="noreferrer" className="rounded-[10px] bg-stone-100 py-3 text-center font-semibold">
                🧭 {t("Itinéraire")}
              </a>
            )}
            {/* Rendu dans <body> : ne prend pas de place dans la grille. */}
            {navigating && r.latitude !== null && r.longitude !== null && (
              <NavigationScreen to={{ latitude: r.latitude, longitude: r.longitude }} label={r.address || t("Mission")} fallbackUrl={mapsUrl(r.latitude, r.longitude, r.address)} onClose={() => setNavigating(false)} />
            )}
          </div>
          {r.status === "ACCEPTED" && (
            <button type="button" disabled={busy} onClick={() => post("step", { status: "ON_THE_WAY" })} className={primary}>
              {t("Je suis en route")}
            </button>
          )}
          {(r.status === "ACCEPTED" || r.status === "ON_THE_WAY") && (
            <button type="button" disabled={busy} onClick={() => post("step", { status: "IN_PROGRESS" })} className={r.status === "ON_THE_WAY" ? primary : "w-full rounded-2xl bg-emerald-600/10 py-3 font-semibold text-emerald-700"}>
              {t("Je suis sur place, je commence")}
            </button>
          )}
          {r.status === "IN_PROGRESS" &&
            (closing ? (
              <div className="space-y-2">
                <label className="block">
                  <span className="mb-1 block text-sm font-medium">{t(EXTRA_LABEL[r.module] ?? "Supplément")}</span>
                  <input type="number" inputMode="numeric" min={0} max={500000} value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="0" className={input} />
                </label>
                <p className="text-sm text-stone-600">{t("Total à encaisser : {total}", { total: fcfa(r.estimate + (Number(extra) || 0)) })}</p>
                <button type="button" disabled={busy} onClick={() => post("complete", { extra: Number(extra) || 0 })} className={primary}>
                  {t("Confirmer la fin")}
                </button>
              </div>
            ) : (
              <button type="button" onClick={() => setClosing(true)} className={primary}>
                {t("Terminer la mission")}
              </button>
            ))}
          {(r.status === "ACCEPTED" || r.status === "ON_THE_WAY") && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                const reason = window.prompt(t("Pourquoi ne pouvez-vous plus venir ?"));
                if (reason && reason.trim().length >= 3) post("release", { reason: reason.trim() });
              }}
              className="w-full py-2 text-sm font-semibold text-red-700"
            >
              {t("Je ne peux plus venir")}
            </button>
          )}
        </>
      )}
    </li>
  );
}

export default function DriverMissions() {
  const { t } = useI18n();
  const [data, setData] = useState<Missions | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    driverFetch<Missions>("/missions")
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e) => setError((e as Error).message));
  }, []);
  useEffect(() => {
    load();
    const timer = setInterval(load, POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  return (
    <div className="min-h-screen pb-28">
      <TopBar title="Missions" back="/livreur" />
      <div className="space-y-4 p-4">
        {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}
        {!data ? (
          <Skeleton rows={3} />
        ) : !data.codes.length && !data.active.length ? (
          <section className={`${card} space-y-2 p-5 text-center`}>
            <p className="text-[36px]" aria-hidden="true">
              🧰
            </p>
            <p className="font-semibold">{t("Aucun service dans votre profil")}</p>
            <p className="text-sm text-stone-600">{t("Demandez à Zedeka d'ajouter les services que vous savez faire (courses, gaz, lessive, ménage, dépannage).")}</p>
          </section>
        ) : (
          <>
            <p className="flex flex-wrap gap-2" aria-label={t("Mes services")}>
              {data.codes.map((c) => (
                <span key={c} className="rounded-[8px] bg-emerald-50 px-2 py-1 text-[13px] font-semibold text-emerald-900">
                  {MODULE_EMOJI[c]} {t(SERVICE_NAME[c])}
                </span>
              ))}
            </p>
            {data.active.length > 0 && (
              <section className="space-y-3" aria-label={t("En cours")}>
                <h2 className="text-[13px] font-semibold uppercase tracking-wide text-emerald-700">{t("En cours")}</h2>
                <ul className="space-y-3">
                  {data.active.map((r) => (
                    <Mission key={r.id} r={r} mine onChange={load} />
                  ))}
                </ul>
              </section>
            )}
            <section className="space-y-3" aria-label={t("À prendre")}>
              <h2 className="text-[13px] font-semibold uppercase tracking-wide text-stone-500">{t("À prendre")}</h2>
              {data.available.length ? (
                <ul className="space-y-3">
                  {data.available.map((r) => (
                    <Mission key={r.id} r={r} mine={false} onChange={load} />
                  ))}
                </ul>
              ) : (
                <p className={`${card} p-4 text-sm text-stone-600`}>{t("Aucune demande pour le moment. Vous recevez une alerte dès qu'un client en fait une.")}</p>
              )}
            </section>
            {data.done.length > 0 && (
              <section className="space-y-3" aria-label={t("Terminées")}>
                <h2 className="text-[13px] font-semibold uppercase tracking-wide text-stone-500">{t("Terminées (24 h)")}</h2>
                <ul className="space-y-2">
                  {data.done.map((r) => (
                    <li key={r.id} className={`${card} flex items-center justify-between gap-3 p-3 text-sm`}>
                      <span className="truncate">
                        {MODULE_EMOJI[r.module]} {r.summary}
                      </span>
                      <span className="shrink-0 font-bold">{fcfa(r.finalPrice ?? r.estimate)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
