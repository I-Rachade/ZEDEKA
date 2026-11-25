"use client";

import { askConfirm } from "@/components/AlertDialog";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { fcfa } from "@/lib/api";
import { customerFetch, useSession } from "@/lib/customer";
import { useHydrated } from "@/lib/device";
import { tel } from "@/lib/driver";
import { useI18n } from "@/lib/i18n/client";
import { useModuleText } from "@/lib/services";
import { MODULE_EMOJI, OPEN_STATUSES, slotLabel, STATUS_TEXT, stepIndex, STEPS, type ServiceRequest } from "@/lib/serviceRequests";
import { card, primary, Skeleton, TopBar } from "../../../ui";

const POLL_MS = 8_000;

// Suivi d'une demande de service : étape, prestataire (numéro pendant la mission), prix, annulation et note.
export default function ServiceTracking() {
  const { id } = useParams<{ id: string }>();
  const hydrated = useHydrated();
  const session = useSession();
  const text = useModuleText();
  const { t, locale } = useI18n();
  const [request, setRequest] = useState<ServiceRequest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [stars, setStars] = useState(0);

  const load = useCallback(() => {
    customerFetch<ServiceRequest>(`/service-requests/${id}`)
      .then((r) => {
        setRequest(r);
        setError(null);
      })
      .catch((e) => setError((e as Error).message));
  }, [id]);

  const open = request ? OPEN_STATUSES.includes(request.status) : true;
  useEffect(() => {
    if (!session) return;
    load();
    if (!open) return;
    const timer = setInterval(load, POLL_MS);
    return () => clearInterval(timer);
  }, [session, load, open]);

  async function act(path: string, body: unknown) {
    setBusy(true);
    try {
      setRequest(await customerFetch<ServiceRequest>(`/service-requests/${id}/${path}`, { method: "POST", body }));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!hydrated) return null;
  if (!session)
    return (
      <div>
        <TopBar title="Ma demande" back="/app/commandes" />
        <section className={`${card} m-4 space-y-3 p-4`}>
          <p className="font-semibold">{t("Connectez-vous pour suivre votre demande")}</p>
          <Link href={`/app/connexion?suite=/app/services/demande/${id}`} className={primary}>
            {t("Se connecter")}
          </Link>
        </section>
      </div>
    );
  if (!request)
    return (
      <div>
        <TopBar title="Ma demande" back="/app/commandes" />
        <div className="p-4">{error ? <p className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p> : <Skeleton rows={3} />}</div>
      </div>
    );

  const label = text({ code: request.module, label: request.module, hint: "" }).label;
  const reached = stepIndex(request.status);
  const cancellable = ["PENDING", "ACCEPTED", "ON_THE_WAY"].includes(request.status);

  return (
    <div className="min-h-screen space-y-4 pb-10">
      <TopBar title={label} back="/app/commandes" />
      <div className="space-y-4 px-4">
        <section className="space-y-4 rounded-[12px] bg-ink-deep p-5 text-white" aria-live="polite">
          <div className="flex items-center gap-3">
            <span className="grid h-14 w-14 shrink-0 place-items-center rounded-[12px] bg-white/10 text-[30px]" aria-hidden="true">
              {MODULE_EMOJI[request.module]}
            </span>
            <span className="min-w-0">
              <span className="block text-[13px] text-white/60">{request.code}</span>
              <span className="block text-xl font-bold" data-testid="status">
                {t(STATUS_TEXT[request.status])}
              </span>
            </span>
          </div>
          {request.status === "PENDING" && <p className="text-sm text-white/75">{t("Votre demande est envoyée aux prestataires proches. Le premier disponible l'accepte.")}</p>}
          {request.status === "CANCELLED" ? (
            <p className="text-sm text-white/75">{request.cancelledBy === "CUSTOMER" ? t("Vous avez annulé cette demande.") : t("Demande annulée par Zedeka.")}</p>
          ) : (
            <ol className="grid grid-cols-5 gap-1" aria-label={t("Étapes")}>
              {STEPS.map((s, i) => (
                <li key={s.status} className="space-y-1 text-center">
                  <span className={`block h-1.5 rounded-full ${i <= reached ? "bg-sun" : "bg-white/20"}`} />
                  <span className={`block text-[11px] ${i <= reached ? "font-semibold text-white" : "text-white/50"}`}>{t(s.label)}</span>
                </li>
              ))}
            </ol>
          )}
        </section>

        {request.provider && (
          <section className={`${card} flex items-center gap-3 p-4`}>
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-emerald-600/10 text-lg font-bold text-emerald-700" aria-hidden="true">
              {request.provider.name.slice(0, 1)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] text-stone-500">{t("Votre prestataire")}</span>
              <span className="block font-semibold">{request.provider.name}</span>
            </span>
            {request.provider.phone && (
              <a href={tel(request.provider.phone)} className="rounded-[10px] bg-emerald-600 px-4 py-2 font-semibold text-white">
                {t("Appeler")}
              </a>
            )}
          </section>
        )}

        <section className={`${card} divide-y divide-stone-100 px-4`}>
          <p className="py-3">
            <span className="block text-[13px] text-stone-500">{t("Demande")}</span>
            <span className="font-medium">{request.summary}</span>
          </p>
          {typeof request.details.items === "string" && (
            <p className="whitespace-pre-line py-3 text-sm text-stone-700">{request.details.items}</p>
          )}
          {typeof request.details.problem === "string" && <p className="py-3 text-sm text-stone-700">{request.details.problem}</p>}
          <p className="py-3">
            <span className="block text-[13px] text-stone-500">{t("Adresse")}</span>
            <span className="font-medium">{request.address}</span>
          </p>
          <p className="py-3">
            <span className="block text-[13px] text-stone-500">{t("Quand ?")}</span>
            <span className="font-medium">{request.scheduledFor ? slotLabel(request.scheduledFor, locale) : t("Dès que possible")}</span>
          </p>
          {request.note && (
            <p className="py-3">
              <span className="block text-[13px] text-stone-500">{t("Précision")}</span>
              <span className="font-medium">{request.note}</span>
            </p>
          )}
        </section>

        <section className={`${card} space-y-1 p-4`} aria-label={t("Prix")}>
          <p className="flex justify-between">
            <span>{t("Estimation")}</span>
            <span className="font-semibold">{fcfa(request.estimate)}</span>
          </p>
          {request.extra ? (
            <p className="flex justify-between text-stone-600">
              <span>{request.module === "ERRAND" ? t("Achats") : request.module === "GAS" ? t("Gaz ou eau") : t("Pièces et extras")}</span>
              <span>{fcfa(request.extra)}</span>
            </p>
          ) : null}
          {request.finalPrice !== null && (
            <p className="flex justify-between border-t border-stone-100 pt-2 text-lg font-bold">
              <span>{t("Total à payer")}</span>
              <span data-testid="total">{fcfa(request.finalPrice)}</span>
            </p>
          )}
        </section>

        {error && (
          <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">
            {error}
          </p>
        )}

        {request.status === "DONE" && request.rating === null && (
          <section className={`${card} space-y-3 p-4 text-center`}>
            <p className="font-semibold">{t("Notez votre prestataire")}</p>
            <div className="flex justify-center gap-2" role="radiogroup" aria-label={t("Note")}>
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} type="button" role="radio" aria-checked={stars === n} aria-label={t("{n} sur 5", { n })} onClick={() => setStars(n)} className={`text-[34px] ${n <= stars ? "text-sun" : "text-stone-300"}`}>
                  ★
                </button>
              ))}
            </div>
            <button type="button" disabled={!stars || busy} onClick={() => act("rate", { rating: stars })} className={primary}>
              {t("Envoyer la note")}
            </button>
          </section>
        )}
        {request.rating !== null && (
          <p className="text-center text-[17px] text-sun" aria-label={t("{n} sur 5", { n: request.rating })}>
            {"★".repeat(request.rating)}
            <span className="text-stone-300">{"★".repeat(5 - request.rating)}</span>
          </p>
        )}

        {cancellable && (
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              if (await askConfirm(t("Annuler cette demande ?"), t("Annuler la demande"))) act("cancel", {});
            }}
            className="w-full rounded-2xl bg-stone-100 py-4 font-semibold text-red-700"
          >
            {t("Annuler la demande")}
          </button>
        )}
        {!open && (
          <Link href={`/app/services/${request.module}`} className="block rounded-2xl bg-emerald-600/10 py-4 text-center font-semibold text-emerald-700">
            {t("Refaire une demande")}
          </Link>
        )}
      </div>
    </div>
  );
}
