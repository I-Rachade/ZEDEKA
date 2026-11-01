"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { secondary } from "@/app/app/ui";
import { Icon } from "@/components/panel/icons";
import { createLocationRequest, readLocationAnswer, type LocationRequest } from "@/lib/api";
import type { Point } from "@/components/MapPicker";
import { useT } from "@/lib/i18n/client";

const WAIT_SECONDS = 59;
const POLL_MS = 4000;

export type SharedPosition = Point & {
  accuracy?: number | null;
  landmark?: string | null;
};

// Demande de position au destinataire, depuis le formulaire : un lien à copier et à envoyer soi-même, puis
// 59 secondes d'attente pendant lesquelles la réponse est relevée. Le lien reste valable 24 h : sans réponse,
// on peut attendre encore, ou valider la commande qui attendra la position.
export default function RecipientRequest({
  senderName,
  recipientName,
  request,
  onRequest,
  onShared,
  kind = "PARCEL",
}: {
  kind?: "FOOD" | "PARCEL";
  senderName: string;
  recipientName: string;
  request: LocationRequest | null;
  onRequest: (r: LocationRequest) => void;
  onShared: (p: SharedPosition) => void;
}) {
  const [left, setLeft] = useState(WAIT_SECONDS);
  const [status, setStatus] = useState<string>("PENDING");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const done = useRef(false);
  const t = useT();

  const absolute = request && request.url.startsWith("/") && typeof window !== "undefined" ? `${window.location.origin}${request.url}` : (request?.url ?? "");

  async function create() {
    if (senderName.trim().length < 2) {
      setError(t(kind === "FOOD" ? "Indiquez d'abord votre nom, il apparaît dans le message." : "Indiquez d'abord votre nom (en haut), il apparaît dans le message."));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onRequest(await createLocationRequest(senderName.trim(), recipientName.trim() || undefined, kind));
      setLeft(WAIT_SECONDS);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const check = useCallback(async () => {
    if (!request || done.current) return;
    const answer = await readLocationAnswer(request.pollKey).catch(() => undefined);
    if (answer === null) return setStatus("EXPIRED");
    if (!answer) return;
    setStatus(answer.status);
    if (answer.status === "SHARED" && answer.latitude !== undefined && answer.longitude !== undefined) {
      done.current = true;
      onShared({
        latitude: answer.latitude,
        longitude: answer.longitude,
        accuracy: answer.accuracy,
        landmark: answer.landmark,
      });
    }
  }, [request, onShared]);

  // Compte à rebours et relevé de la réponse toutes les 4 secondes, tant qu'il reste du temps.
  useEffect(() => {
    if (!request || left <= 0 || done.current) return;
    const tick = setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000);
    const poll = setInterval(check, POLL_MS);
    return () => {
      clearInterval(tick);
      clearInterval(poll);
    };
  }, [request, left > 0, check]); // eslint-disable-line react-hooks/exhaustive-deps

  // Dernier relevé à la fin du compte à rebours.
  useEffect(() => {
    if (request && left === 0) void check();
  }, [left, request, check]);

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      window.prompt(t("Copiez ce lien :"), text);
    }
  }

  async function share() {
    if (!request) return;
    const text = request.text?.replace(request.url, absolute) ?? absolute;
    if (navigator.share) await navigator.share({ text }).catch(() => undefined);
    else await copy(text);
  }

  if (!request)
    return (
      <div className="space-y-2 rounded-[14px] bg-emerald-600/5 p-3 text-sm text-stone-700">
        <p>{t("Un lien est créé : copiez-le et envoyez-le au destinataire (SMS, WhatsApp…). Quand il l'ouvre et accepte, sa position arrive ici.")}</p>
        <button type="button" onClick={create} disabled={busy} className={secondary}>
          {busy ? t("Création du lien…") : t("Créer le lien")}
        </button>
        {error && <p className="text-red-700">{error}</p>}
      </div>
    );

  const waiting = left > 0 && status !== "DECLINED" && status !== "EXPIRED";
  const pct = (left / WAIT_SECONDS) * 100;
  return (
    <div className="space-y-3 rounded-[14px] bg-emerald-600/5 p-3 text-sm">
      <div className="flex items-center gap-2 rounded-xl bg-white p-2.5">
        <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-stone-700">{absolute}</span>
        <button type="button" onClick={() => copy(absolute)} className="shrink-0 rounded-lg bg-emerald-600 px-3 py-1.5 font-semibold text-white">
          {copied ? t("Copié") : t("Copier")}
        </button>
      </div>
      <button type="button" onClick={share} className="text-emerald-700 underline">
        {t("Partager le lien avec un message")}
      </button>

      {waiting ? (
        <div className="flex items-center gap-3" role="status" aria-live="polite">
          <span
            className="grid h-14 w-14 shrink-0 place-items-center rounded-full text-lg font-semibold tabular-nums text-emerald-800"
            style={{
              background: `conic-gradient(rgb(5 150 105) ${pct}%, rgb(231 229 228) 0)`,
            }}
          >
            <span className="grid h-11 w-11 place-items-center rounded-full bg-white">{left}</span>
          </span>
          <p className="text-stone-700">
            {status === "OPENED" ? t("Le destinataire a ouvert le lien…") : t("En attente du destinataire…")}
            <span className="block text-stone-500">{t("Envoyez-lui le lien maintenant ; sa position s'affichera ici.")}</span>
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="flex items-start gap-2 text-stone-700">
            <Icon name="clock" className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            {t(
              status === "DECLINED"
                ? "Le destinataire n'a pas partagé sa position. Placez le point, collez un lien, ou écrivez l'adresse."
                : status === "EXPIRED"
                  ? "Ce lien n'est plus valable. Créez-en un nouveau."
                  : kind === "FOOD"
                    ? "Pas encore de réponse. Le lien reste valable 24 h : attendez encore, ou placez le point vous-même. Le repas part dès que la position est connue."
                    : "Pas encore de réponse. Le lien reste valable 24 h : vous pouvez attendre encore, ou continuer et la commande attendra sa position.",
            )}
          </p>
          {status === "EXPIRED" || status === "DECLINED" ? (
            <button type="button" onClick={create} disabled={busy} className={secondary}>
              {t("Créer un nouveau lien")}
            </button>
          ) : (
            <button type="button" onClick={() => setLeft(WAIT_SECONDS)} className={secondary}>
              {t("Attendre encore {n} s", { n: WAIT_SECONDS })}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
