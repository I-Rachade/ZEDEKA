"use client";

import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/components/panel/icons";
import { card, input, primary, secondary, Skeleton, TopBar } from "@/app/app/ui";
import { driverFetch, mapsUrl, tel, timeOf, type ZedRide } from "@/lib/driver";
import { useT } from "@/lib/i18n/client";
import { useDriver } from "../../../DriverShell";
import SwipeButton from "../../../SwipeButton";

const CANCEL_REASONS = ["Panne", "Client introuvable", "Trop loin finalement"];
// Montants les plus courants à Lomé, en un geste ; « Autre montant » pour le reste.
const QUICK_PRICES = [300, 400, 500, 700];

// Course Zed du conducteur : aller chercher le client, client à bord, course terminée (le conducteur redevient disponible).
export default function ZedCourse() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const t = useT();
  const { reload } = useDriver();
  const [ride, setRide] = useState<ZedRide | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState<"complete" | "cancel" | null>(null);
  const [reason, setReason] = useState("");
  const [price, setPrice] = useState("");

  const load = useCallback(async () => {
    try {
      setRide(await driverFetch<ZedRide>(`/zed/rides/${id}`));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);
  useEffect(() => {
    load();
    const timer = setInterval(load, 10_000);
    return () => clearInterval(timer);
  }, [load]);

  async function step(path: string, body?: unknown, leave = false) {
    setBusy(true);
    setError(null);
    try {
      const r = await driverFetch<ZedRide | { ok: true }>(`/zed/rides/${id}/${path}`, { method: "POST", body });
      await reload();
      if (leave) router.replace("/livreur");
      else if ("id" in r) setRide(r);
      setSheet(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!ride)
    return (
      <div>
        <TopBar title="Course Zed" back="/livreur" />
        <div className="p-4">{error ? <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p> : <Skeleton rows={3} />}</div>
      </div>
    );

  const open = ride.status === "ACCEPTED" || ride.status === "ONBOARD";
  const client = ride.customer.name || t("Client");

  return (
    <div>
      <TopBar title={`Zed ${ride.code}`} back="/livreur" />
      <div className="space-y-4 px-4 py-4">
        <ol className="grid grid-cols-3 gap-2 text-center text-xs font-semibold">
          {[
            { label: "Aller au client", at: ride.acceptedAt },
            { label: "Client à bord", at: ride.onboardAt },
            { label: "Terminée", at: ride.completedAt },
          ].map((s) => (
            <li key={s.label} className={`rounded-full px-2 py-1.5 ${s.at ? "bg-emerald-600 text-white" : "bg-stone-200 text-stone-500"}`}>
              {t(s.label)}
              {s.at && <span className="block font-normal opacity-80">{timeOf(s.at)}</span>}
            </li>
          ))}
        </ol>

        <section className={`${card} p-4`}>
          <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">{t("Client")}</p>
          <p className="mt-1 text-lg font-semibold">{client}</p>
          {ride.landmark && (
            <p className="mt-1 flex items-start gap-1.5 text-stone-700">
              <Icon name="pin" className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
              {ride.landmark}
            </p>
          )}
          {ride.accuracy !== null && ride.accuracy >= 5 && <p className="mt-1 text-xs text-stone-500">{t("Position à {n} m près", { n: Math.round(ride.accuracy) })}</p>}
          <div className="mt-3 grid grid-cols-2 gap-2">
            <a href={tel(ride.customer.phone)} className={secondary}>
              <Icon name="phone" className="h-5 w-5" /> {t("Appeler")}
            </a>
            <a href={mapsUrl(ride.latitude, ride.longitude, ride.landmark ?? "")} target="_blank" rel="noreferrer" className={secondary}>
              <Icon name="map" className="h-5 w-5" /> {t("Itinéraire")}
            </a>
          </div>
        </section>

        {ride.destination && (
          <section className={`${card} flex items-start gap-3 p-4`}>
            <Icon name="map" className="mt-0.5 h-5 w-5 shrink-0 text-coral" />
            <span>
              <span className="block text-xs font-semibold uppercase tracking-wide text-stone-500">{t("Destination du client")}</span>
              <span className="block text-lg font-semibold">{ride.destination}</span>
            </span>
          </section>
        )}

        <p className="rounded-2xl bg-sun/30 p-3 text-sm text-ink">{t("Pas de prix dans l'application : mettez-vous d'accord avec le client sur place.")}</p>

        {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}

        {ride.status === "ACCEPTED" && (
          <>
            <SwipeButton label="Client à bord" disabled={busy} onConfirm={() => step("onboard")} />
            <button onClick={() => setSheet("cancel")} className="w-full py-2 text-sm font-semibold text-red-700">
              {t("Je ne peux pas venir")}
            </button>
          </>
        )}
        {ride.status === "ONBOARD" && <SwipeButton label="Course terminée" disabled={busy} onConfirm={() => setSheet("complete")} />}
        {!open && (
          <div className={`${card} p-4 text-center`}>
            <p className="font-semibold">{ride.status === "COMPLETED" ? t("Course terminée") : t("Course annulée")}</p>
            <button onClick={() => router.replace("/livreur")} className={`${primary} mt-3`}>
              {t("Retour à l'accueil")}
            </button>
          </div>
        )}

        {sheet === "complete" && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const v = String(new FormData(e.currentTarget).get("price") ?? "").replace(/\D/g, "");
              step("complete", v ? { price: Number(v) } : {}, true);
            }}
            className={`${card} space-y-3 p-4`}
          >
            <p className="font-semibold">{t("Clôturer la course")}</p>
            <fieldset>
              <legend className="mb-1.5 block text-[13px] font-medium text-stone-600">{t("Prix convenu (facultatif)")}</legend>
              <div className="mb-2 grid grid-cols-4 gap-2">
                {QUICK_PRICES.map((p) => (
                  <button
                    type="button"
                    key={p}
                    onClick={() => setPrice(price === String(p) ? "" : String(p))}
                    aria-pressed={price === String(p)}
                    className={`rounded-xl py-2.5 text-[15px] font-semibold tabular-nums transition active:scale-95 ${price === String(p) ? "bg-emerald-600 text-white" : "bg-stone-100"}`}
                  >
                    {p}
                  </button>
                ))}
              </div>
              <input name="price" value={price} onChange={(e) => setPrice(e.target.value.replace(/\D/g, ""))} inputMode="numeric" placeholder={t("Autre montant")} aria-label={t("Autre montant")} className={input} />
            </fieldset>
            <button disabled={busy} className={primary}>
              {t("Terminer et redevenir disponible")}
            </button>
          </form>
        )}

        {sheet === "cancel" && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              step("cancel", { reason }, true);
            }}
            className={`${card} space-y-3 p-4`}
          >
            <p className="font-semibold">{t("Pourquoi ne pouvez-vous pas venir ?")}</p>
            <div className="flex flex-wrap gap-2">
              {CANCEL_REASONS.map((r) => (
                <button
                  type="button"
                  key={r}
                  onClick={() => setReason(t(r))}
                  aria-pressed={reason === t(r)}
                  className={`rounded-full border px-3 py-1.5 text-sm ${reason === t(r) ? "border-emerald-600 bg-emerald-50 text-emerald-800" : "border-stone-300"}`}
                >
                  {t(r)}
                </button>
              ))}
            </div>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
              minLength={3}
              maxLength={200}
              placeholder={t("Ou écrivez la raison")}
              aria-label={t("Raison")}
              className={input}
            />
            <p className="text-xs text-stone-500">{t("L'appel repart vers les autres conducteurs proches.")}</p>
            <div className="flex gap-2">
              <button type="button" onClick={() => setSheet(null)} className="flex-1 rounded-xl border border-stone-300 px-4 py-3">
                {t("Retour")}
              </button>
              <button disabled={busy || reason.trim().length < 3} className="flex-1 rounded-xl bg-red-600 px-4 py-3 font-semibold text-white disabled:opacity-50">
                {t("Libérer le client")}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
