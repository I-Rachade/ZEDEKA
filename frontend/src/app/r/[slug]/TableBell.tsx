"use client";

import { useCallback, useEffect, useState } from "react";
import { DialogBox } from "@/components/DialogBox";
import { Icon } from "@/components/panel/icons";
import { apiGet, apiPost, API_URL, type TableCall, type TableCallKind } from "@/lib/api";
import { useT } from "@/lib/i18n/client";

// Sonnerie de table : depuis le QR code, le client appelle le serveur, demande l'addition ou écrit une demande.
// Le restaurant sonne ; dès qu'un serveur répond « J'arrive », le client le voit ici.

type State = { enabled: boolean; call: TableCall | null };
type Step = "menu" | "bill" | "other";

export default function TableBell({ token, number, lifted }: { token: string; number: number; lifted: boolean }) {
  const t = useT();
  const base = `/api/tables/${encodeURIComponent(token)}/call`;
  const [state, setState] = useState<State | null>(null);
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("menu");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(() => apiGet<State>(base).then((s) => s && setState(s), () => {}), [base]);
  const call = state?.call ?? null;

  // Suivi : toutes les 5 s tant qu'un appel est en cours, sinon une fois à l'ouverture.
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    if (!call) return;
    const poll = setInterval(load, 5000);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [call, load]);

  if (!state?.enabled) return null;

  const send = async (kind: TableCallKind, extra: { payment?: "CASH" | "MOBILE_MONEY"; note?: string } = {}) => {
    setBusy(true);
    setError(null);
    try {
      const res = await apiPost<{ call: TableCall }>(base, { kind, ...extra });
      setState({ enabled: true, call: res.call });
      setStep("menu");
      setNote("");
    } catch (e) {
      setError(e instanceof Error ? e.message : t("L'envoi n'a pas abouti."));
    } finally {
      setBusy(false);
    }
  };
  const cancel = async () => {
    setBusy(true);
    await fetch(`${API_URL}${base}`, { method: "DELETE" }).catch(() => {});
    setState({ enabled: true, call: null });
    setBusy(false);
    setOpen(false);
  };
  const close = () => {
    setOpen(false);
    setStep("menu");
    setError(null);
  };

  const coming = call?.status === "ACK";
  const waitLeft = call ? Math.max(0, Math.ceil((Date.parse(call.canRingAgainAt) - now) / 1000)) : 0;
  const what = call ? (call.kind === "BILL" ? t("Addition demandée") : call.kind === "OTHER" ? t("Demande envoyée") : t("Serveur appelé")) : "";

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label={call ? what : t("Sonner le serveur")}
        className={`fixed right-4 z-40 flex items-center gap-2 rounded-full px-4 py-3 font-semibold shadow-[0_8px_30px_rgb(0_0_0/0.25)] active:scale-95 lg:bottom-6 ${lifted ? "bottom-24" : "bottom-[calc(1rem+env(safe-area-inset-bottom))]"} ${coming ? "bg-emerald-600 text-white" : "bg-sun text-ink-deep"}`}
      >
        <span className="relative grid h-7 w-7 place-items-center">
          {call && !coming && <span className="anim-wave absolute inset-0 rounded-full border-2 border-ink-deep/40" aria-hidden="true" />}
          <Icon name={coming ? "check" : "bell"} className={`h-6 w-6 ${call && !coming ? "anim-shake" : ""}`} />
        </span>
        <span>{coming ? (call?.ackBy ? t("{name} arrive", { name: call.ackBy }) : t("Le serveur arrive")) : call ? t("En attente…") : t("Sonner")}</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={close}>
          <DialogBox onClose={close} aria-label={t("Sonner le serveur")} onClick={(e) => e.stopPropagation()} className="anim-slide-up w-full max-w-md rounded-t-[14px] bg-surface p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:rounded-2xl">
            <div className="mb-4 flex items-center gap-3">
              <span className="grid h-11 min-w-11 place-items-center rounded-xl bg-emerald-600 px-2 text-lg font-bold text-white">{number}</span>
              <div className="flex-1">
                <p className="text-lg font-bold text-ink">{call ? what : t("Besoin du serveur ?")}</p>
                <p className="text-sm text-stone-500">{t("Table {number} · sur place", { number })}</p>
              </div>
              <button onClick={close} aria-label={t("Fermer")} className="grid h-9 w-9 place-items-center rounded-full bg-stone-100 text-stone-600">
                <Icon name="close" className="h-5 w-5" />
              </button>
            </div>

            {call ? (
              <div className="space-y-3">
                <p role="status" className={`rounded-xl p-4 text-[15px] ${coming ? "bg-emerald-50 text-emerald-900" : "bg-amber-50 text-amber-900"}`}>
                  {coming ? (
                    <strong>{call.ackBy ? t("{name} a vu votre appel et arrive.", { name: call.ackBy }) : t("Le serveur a vu votre appel et arrive.")}</strong>
                  ) : (
                    <>
                      <strong>{t("Le restaurant est prévenu.")}</strong> {t("Un serveur va répondre dans un instant.")}
                    </>
                  )}
                </p>
                {!coming && (
                  <button disabled={busy || waitLeft > 0} onClick={() => send(call.kind, { payment: call.payment ?? undefined, note: call.note ?? undefined })} className="w-full rounded-2xl bg-sun px-4 py-3.5 font-semibold text-ink-deep disabled:opacity-50">
                    {waitLeft > 0 ? t("Sonner à nouveau dans {s} s", { s: waitLeft }) : t("Sonner à nouveau")}
                  </button>
                )}
                <button disabled={busy} onClick={cancel} className="w-full rounded-2xl border border-stone-300 px-4 py-3 font-medium text-stone-700">
                  {coming ? t("C'est réglé, merci") : t("Annuler l'appel")}
                </button>
              </div>
            ) : step === "menu" ? (
              <div className="grid gap-2">
                <Choice icon="bell" title={t("Appeler le serveur")} hint={t("Commander, une question, un souci")} onClick={() => send("WAITER")} disabled={busy} />
                <Choice icon="receipt" title={t("Demander l'addition")} hint={t("Le serveur vous apporte la note")} onClick={() => setStep("bill")} disabled={busy} />
                <Choice icon="edit" title={t("Autre demande")} hint={t("De l'eau, des couverts, du piment…")} onClick={() => setStep("other")} disabled={busy} />
              </div>
            ) : step === "bill" ? (
              <div className="grid gap-2">
                <p className="text-sm text-stone-600">{t("Comment allez-vous payer ?")}</p>
                <Choice icon="wallet" title={t("Espèces")} onClick={() => send("BILL", { payment: "CASH" })} disabled={busy} />
                <Choice icon="phone" title={t("Mobile money")} onClick={() => send("BILL", { payment: "MOBILE_MONEY" })} disabled={busy} />
                <button onClick={() => setStep("menu")} className="mt-1 text-sm font-medium text-stone-500">{t("Retour")}</button>
              </div>
            ) : (
              <form
                className="grid gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  send("OTHER", { note });
                }}
              >
                <label htmlFor="table-note" className="text-sm text-stone-600">{t("Votre demande")}</label>
                <textarea id="table-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={120} rows={2} placeholder={t("ex. une bouteille d'eau, des serviettes")} className="rounded-xl border border-stone-300 p-3 text-[16px]" />
                <button disabled={busy || !note.trim()} className="rounded-2xl bg-sun px-4 py-3.5 font-semibold text-ink-deep disabled:opacity-50">{t("Sonner")}</button>
                <button type="button" onClick={() => setStep("menu")} className="text-sm font-medium text-stone-500">{t("Retour")}</button>
              </form>
            )}
            {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
          </DialogBox>
        </div>
      )}
    </>
  );
}

function Choice({ icon, title, hint, onClick, disabled }: { icon: "bell" | "receipt" | "edit" | "wallet" | "phone"; title: string; hint?: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} className="flex items-center gap-3 rounded-2xl border border-stone-200 bg-surface p-4 text-left active:scale-[0.98] disabled:opacity-50">
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-sun/30 text-ink-deep">
        <Icon name={icon} className="h-6 w-6" />
      </span>
      <span>
        <span className="block font-semibold text-ink">{title}</span>
        {hint && <span className="block text-sm text-stone-500">{hint}</span>}
      </span>
    </button>
  );
}
