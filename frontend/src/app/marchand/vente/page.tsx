"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { card, input, primary, secondary, Skeleton, TopBar } from "@/app/app/ui";
import { PhotoField } from "@/components/panel/MenuEditor";
import { useT } from "@/lib/i18n/client";
import { merchantFetch, merchantUpload, STORE_STATUS, type StoreState } from "@/lib/merchant";

// Présentation de la boutique en ligne (catégorie, description, logo) et demande de mise en ligne avec le numéro
// de pièce d'identité ou d'IFU, vérifié par l'équipe Zedeka.
export default function StoreRequestPage() {
  const t = useT();
  const router = useRouter();
  const [state, setState] = useState<StoreState | null>(null);
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [idNumber, setIdNumber] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    merchantFetch<StoreState>("/store")
      .then((s) => {
        setState(s);
        if (s.store) {
          setCategory(s.store.category ?? "");
          setDescription(s.store.description ?? "");
          setIdNumber(s.store.idNumber ?? "");
        }
      })
      .catch((e) => setNote({ ok: false, text: (e as Error).message }));
  }, []);

  if (!state || !("counts" in state)) {
    return (
      <div>
        <TopBar title="Présentation" back="/marchand/produits" />
        <div className="p-4">{note ? <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{note.text}</p> : <Skeleton rows={4} />}</div>
      </div>
    );
  }
  const { store, categories, counts } = state;
  const canRequest = store.status === "NONE" || store.status === "REJECTED";

  async function submit(form: HTMLFormElement, request: boolean) {
    setBusy(true);
    setNote(null);
    const logo = new FormData(form).get("storeLogoUrl");
    // Boutique déjà envoyée à l'équipe : la catégorie et la pièce ne changent plus ici (le marchand passe par Zedeka).
    const locked = !canRequest ? {} : { storeCategory: category, ...(idNumber.trim() || request ? { storeIdNumber: idNumber } : {}) };
    const body = { storeDescription: description, storeLogoUrl: typeof logo === "string" ? logo : "", ...locked };
    try {
      await merchantFetch(request ? "/store/request" : "/store", { method: request ? "POST" : "PATCH", body });
      if (request) router.replace("/marchand/produits");
      else setNote({ ok: true, text: t("Enregistré.") });
    } catch (err) {
      setNote({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const [label, color] = STORE_STATUS[store.status];
  return (
    <div>
      <TopBar title="Présentation" back="/marchand/produits" />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit(e.currentTarget, canRequest);
        }} className="space-y-4 px-4 pb-8 pt-4">
        <div className="flex items-center justify-between">
          <p className="text-[15px] text-stone-600">{t("État de la boutique")}</p>
          <span className={`rounded-full px-2 py-1 text-xs font-semibold ${color}`}>{t(label)}</span>
        </div>

        <section className={`${card} card-line space-y-3 p-4`}>
          <p className="text-[12px] uppercase tracking-wide text-stone-500">{t("Logo de la boutique")}</p>
          <PhotoField name="storeLogoUrl" kind="logo" className="" initial={store.logoUrl} upload={(photo, query) => merchantUpload("/store/images", photo, query)} onBusy={setUploading} />
          <div>
            <p className="mb-2 text-[12px] uppercase tracking-wide text-stone-500">{t("Catégorie")}</p>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t("Catégorie")}>
              {categories.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  role="radio"
                  aria-checked={category === c.key}
                  disabled={!canRequest}
                  onClick={() => setCategory(c.key)}
                  className={`rounded-full px-3 py-2 text-[14px] font-medium ${category === c.key ? "bg-emerald-600 text-white" : "bg-stone-100 text-stone-700"}`}
                >
                  {c.emoji} {t(c.label)}
                </button>
              ))}
            </div>
          </div>
          <label className="block">
            <span className="mb-1 block text-[12px] uppercase tracking-wide text-stone-500">{t("Description courte")}</span>
            <textarea className={`${input} min-h-20`} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} placeholder={t("Ex. Mode femme, pagnes et sacs faits main à Akpakpa.")} />
          </label>
        </section>

        <section className={`${card} card-line space-y-3 p-4`}>
          <h2 className="text-[17px] font-bold">{t("Vérification")}</h2>
          <label className="block">
            <span className="mb-1 block text-[12px] uppercase tracking-wide text-stone-500">{t("N° de pièce d'identité ou IFU")}</span>
            <input className={input} value={idNumber} onChange={(e) => setIdNumber(e.target.value)} maxLength={40} required={canRequest} readOnly={!canRequest} placeholder={t("Ex. IFU 3201912345678")} />
          </label>
          {!canRequest && <p className="text-[13px] text-stone-500">{t("Catégorie et pièce déjà vérifiées par l'équipe : contactez Zedeka pour les changer.")}</p>}
          <p className="text-[13px] text-stone-500">{t("L'équipe Zedeka peut vous appeler pour voir la pièce. Elle n'est jamais montrée aux clients.")}</p>
        </section>

        {canRequest && counts.total === 0 && <p className="rounded-xl bg-sun-soft p-3 text-[14px] text-ink-deep">{t("Ajoutez au moins un produit avant de demander la mise en ligne.")}</p>}
        {note && (
          <p role={note.ok ? "status" : "alert"} className={`rounded-xl p-3 text-sm ${note.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`}>
            {note.text}
          </p>
        )}
        {canRequest ? (
          <>
            <button type="submit" disabled={busy || uploading || !category || counts.total === 0} className={primary}>
              {busy ? t("Envoi…") : store.status === "REJECTED" ? t("Renvoyer la demande") : t("Demander la mise en ligne")}
            </button>
            <button type="button" disabled={busy || uploading || !category} onClick={(e) => e.currentTarget.form && void submit(e.currentTarget.form, false)} className={secondary}>
              {t("Enregistrer sans envoyer")}
            </button>
          </>
        ) : (
          <button type="submit" disabled={busy || uploading || !category} className={primary}>
            {busy ? t("Enregistrement…") : t("Enregistrer")}
          </button>
        )}
      </form>
    </div>
  );
}
