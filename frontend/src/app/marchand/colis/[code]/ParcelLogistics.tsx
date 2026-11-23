"use client";

import { useState } from "react";
import { card, input, secondary } from "@/app/app/ui";
import { fcfa } from "@/lib/api";
import { useT } from "@/lib/i18n/client";
import { RETURN_REASON_OPTIONS, RETURN_STATUS, type ReturnStatus } from "@/lib/logistics";
import { merchantFetch } from "@/lib/merchant";

export type ParcelExtras = {
  stockLines?: { stockItemId: string; name: string; quantity: number }[];
  parcelReturn?: { status: ReturnStatus; reason: string; fee: number; createdAt: string } | null;
  deliveredAt: string | null;
};

// Logistique d'un colis : articles sortis de l'entrepôt, retour en cours, ou demande de retour (colis en route que le
// client refuse, ou colis livré que le client renvoie dans les 14 jours).
export default function ParcelLogistics({ parcel: p, code, onChange }: { parcel: ParcelExtras & { status: string }; code: string; onChange: () => Promise<void> }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<string>(p.status === "DELIVERED" ? "CUSTOMER_RETURN" : "REFUSED");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canReturn = !p.parcelReturn && (p.status === "PICKED_UP" || (p.status === "DELIVERED" && !!p.deliveredAt && Date.now() - new Date(p.deliveredAt).getTime() < 14 * 86_400_000));

  return (
    <>
      {!!p.stockLines?.length && (
        <section className={`${card} p-4 text-sm`}>
          <p className="mb-1 font-semibold">{t("Expédié depuis l'entrepôt")}</p>
          <p className="text-stone-600">{p.stockLines.map((l) => `${l.quantity} × ${l.name}`).join(", ")}</p>
        </section>
      )}
      {p.parcelReturn && (
        <section className={`${card} flex items-center justify-between gap-2 p-4 text-sm`}>
          <span>
            <span className="block font-semibold">{t("Retour")}</span>
            {p.parcelReturn.fee > 0 && <span className="block text-stone-600">{t("Frais de retour : {amount}", { amount: fcfa(p.parcelReturn.fee) })}</span>}
          </span>
          <span className={`rounded-full px-2 py-1 text-xs font-semibold ${RETURN_STATUS[p.parcelReturn.status][1]}`}>{t(RETURN_STATUS[p.parcelReturn.status][0])}</span>
        </section>
      )}
      {canReturn &&
        (open ? (
          <section className={`${card} space-y-3 p-4`}>
            <p className="font-semibold">{t("Demander un retour")}</p>
            <select value={reason} onChange={(e) => setReason(e.target.value)} aria-label={t("Motif")} className={input}>
              {RETURN_REASON_OPTIONS.map(([k, label]) => (
                <option key={k} value={k}>
                  {t(label)}
                </option>
              ))}
            </select>
            <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder={t("Précisions (facultatif)")} aria-label={t("Précisions")} className={input} />
            {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  await merchantFetch(`/parcels/${encodeURIComponent(code)}/return`, { method: "POST", body: { reason, note: note || undefined } });
                  setOpen(false);
                  await onChange();
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
              className={secondary}
            >
              {t("Envoyer la demande de retour")}
            </button>
          </section>
        ) : (
          <button type="button" onClick={() => setOpen(true)} className={secondary}>
            {t("Demander un retour")}
          </button>
        ))}
    </>
  );
}
