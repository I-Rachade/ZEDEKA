"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { card, input, primary, secondary, TopBar } from "@/app/app/ui";
import { Icon } from "@/components/panel/icons";
import type { Point } from "@/components/MapPicker";
import { apiGet, fcfa, type ParcelCategory } from "@/lib/api";
import { useT } from "@/lib/i18n/client";
import { merchantFetch, parsePastedList, type ParcelLine, type Quote, type Sent } from "@/lib/merchant";
import { useMerchant } from "../MerchantShell";

const MapPicker = dynamic(() => import("@/components/MapPicker"), { ssr: false });

// Mêmes classes de poids que le formulaire colis du site.
const WEIGHTS = [
  { label: "Moins de 1 kg", kg: 0.5 },
  { label: "1 à 5 kg", kg: 3 },
  { label: "5 à 10 kg", kg: 8 },
  { label: "10 à 20 kg", kg: 15 },
  { label: "Plus de 20 kg", kg: 25 },
];

const PHONE = /^\+?[0-9 ]{8,15}$/;
type Mode = "link" | "address" | "map";
type Row = {
  key: number;
  recipientName: string;
  recipientPhone: string;
  mode: Mode;
  address: string;
  point: Point | null;
  codAmount: string;
  payer: "SENDER" | "RECIPIENT";
  merchantRef: string;
  parcelCategoryId: string;
  weightKg: number;
};

const MODES: { value: Mode; label: string }[] = [
  { value: "link", label: "Lien au client" },
  { value: "address", label: "Adresse" },
  { value: "map", label: "Sur la carte" },
];

let nextKey = 1;

const segment = (on: boolean) =>
  `flex-1 rounded-[10px] px-2 py-2 text-[13px] font-semibold transition ${on ? "bg-surface text-ink shadow-[0_1px_3px_rgb(0_0_0/0.12)]" : "text-stone-600"}`;

// Problème d'une ligne, ou null si elle peut partir.
function problem(r: Row): string | null {
  if (r.recipientName.trim().length < 2) return "Nom du destinataire";
  if (!PHONE.test(r.recipientPhone.trim())) return "Téléphone du destinataire";
  if (r.mode === "address" && r.address.trim().length < 3) return "Adresse et repère";
  if (r.mode === "map" && !r.point) return "Point de livraison sur la carte";
  if (!r.parcelCategoryId) return "Type de colis";
  return null;
}

function toLine(r: Row): ParcelLine {
  return {
    recipientName: r.recipientName.trim(),
    recipientPhone: r.recipientPhone.trim(),
    address: r.mode === "map" ? r.address.trim() : r.mode === "address" ? r.address.trim() : "",
    ...(r.mode === "map" && r.point ? { latitude: r.point.latitude, longitude: r.point.longitude } : {}),
    askRecipientLocation: r.mode === "link",
    codAmount: Number(r.codAmount.replace(/[^\d]/g, "")) || 0,
    payer: r.payer,
    merchantRef: r.merchantRef.trim() || undefined,
    parcelCategoryId: r.parcelCategoryId,
    weightKg: r.weightKg,
  };
}

// Nouvel envoi : un ou plusieurs colis (jusqu'à 50) ramassés au point de la boutique. Pour chaque client :
// contre-remboursement, qui paie la livraison, et comment le livreur le trouve (lien de position par WhatsApp,
// adresse écrite ou point sur la carte). Le prix s'affiche ligne par ligne avant de valider.
export default function SendPage() {
  const t = useT();
  const { me } = useMerchant();
  const m = me?.merchant;
  const [categories, setCategories] = useState<ParcelCategory[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [mapFor, setMapFor] = useState<number | null>(null);
  const [paste, setPaste] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [sent, setSent] = useState<Sent | null>(null);

  const blank = (base?: Partial<Row>): Row => ({
    key: nextKey++,
    recipientName: "",
    recipientPhone: "",
    mode: "link",
    address: "",
    point: null,
    codAmount: "",
    payer: base?.payer ?? "SENDER",
    merchantRef: "",
    parcelCategoryId: base?.parcelCategoryId ?? categories[0]?.id ?? "",
    weightKg: base?.weightKg ?? WEIGHTS[0].kg,
  });

  useEffect(() => {
    apiGet<ParcelCategory[]>("/api/parcel-categories").then((list) => {
      const cats = list ?? [];
      setCategories(cats);
      setRows((r) => (r.length ? r.map((x) => ({ ...x, parcelCategoryId: x.parcelCategoryId || cats[0]?.id || "" })) : [{ ...blank(), parcelCategoryId: cats[0]?.id ?? "" }]));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- une seule fois
  }, []);

  const update = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const add = () => setRows((rs) => [...rs, blank(rs[rs.length - 1])]);
  const remove = (key: number) => setRows((rs) => (rs.length > 1 ? rs.filter((r) => r.key !== key) : rs));

  // Devis : dès que toutes les lignes sont complètes, une demande après une courte pause de saisie.
  const ready = rows.length > 0 && rows.every((r) => !problem(r));
  const lines = useMemo(() => (ready ? rows.map(toLine) : null), [ready, rows]);
  const lastQuote = useRef(0);
  useEffect(() => {
    if (!lines) {
      setQuote(null);
      return;
    }
    const id = ++lastQuote.current;
    const timer = setTimeout(() => {
      merchantFetch<Quote>("/parcels/quote", { method: "POST", body: { parcels: lines } })
        .then((q) => id === lastQuote.current && setQuote(q))
        .catch(() => id === lastQuote.current && setQuote(null));
    }, 600);
    return () => clearTimeout(timer);
  }, [lines]);

  function importPasted() {
    const parsed = parsePastedList(paste ?? "");
    if (!parsed.length) {
      setError(t("Aucune ligne reconnue. Une ligne par client : Nom ; Téléphone ; Adresse ; Montant ; Réf."));
      return;
    }
    setError(null);
    setRows((rs) => {
      const last = rs[rs.length - 1];
      const kept = rs.filter((r) => r.recipientName || r.recipientPhone);
      const added = parsed.map((p) => ({ ...blank(last), ...p, codAmount: p.codAmount ? String(p.codAmount) : "", mode: (p.address.length >= 3 ? "address" : "link") as Mode }));
      return [...kept, ...added].slice(0, 50);
    });
    setPaste(null);
  }

  async function send() {
    if (!ready) {
      setShowErrors(true);
      const first = rows.find((r) => problem(r));
      if (first) document.getElementById(`colis-${first.key}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setSent(await merchantFetch<Sent>("/parcels", { method: "POST", body: { parcels: rows.map(toLine) } }));
      window.scrollTo({ top: 0 });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!m) return null;
  if (sent) return <SentView sent={sent} onAgain={() => { setSent(null); setRows([blank(rows[rows.length - 1])]); setShowErrors(false); }} />;

  const cod = rows.reduce((s, r) => s + (Number(r.codAmount.replace(/[^\d]/g, "")) || 0), 0);
  return (
    <div>
      <TopBar title="Nouvel envoi" back="/marchand" />
      <div className="space-y-4 px-4 pb-44 pt-4">
        <Link href="/marchand/boutique" className={`${card} card-line flex items-center gap-3 p-4`}>
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[12px] bg-emerald-600/10 text-emerald-700">
            <Icon name="store" className="h-5 w-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[12px] uppercase tracking-wide text-stone-500">{t("Ramassage")}</span>
            <span className="block truncate font-medium">{m.pickupAddress}</span>
          </span>
          <Icon name="edit" className="h-4 w-4 text-stone-400" />
        </Link>

        {rows.map((r, i) => {
          const issue = showErrors ? problem(r) : null;
          const q = quote?.lines[i];
          return (
            <section key={r.key} id={`colis-${r.key}`} aria-label={t("Colis {n}", { n: i + 1 })} className={`${card} card-line space-y-3 p-4 ${issue ? "ring-2 ring-red-400" : ""}`}>
              <div className="flex items-center justify-between">
                <h2 className="text-[17px] font-bold">{t("Colis {n}", { n: i + 1 })}</h2>
                {rows.length > 1 && (
                  <button type="button" onClick={() => remove(r.key)} aria-label={t("Retirer le colis {n}", { n: i + 1 })} className="grid h-9 w-9 place-items-center rounded-full text-stone-400 active:bg-stone-100">
                    <Icon name="trash" className="h-5 w-5" />
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input className={input} value={r.recipientName} onChange={(e) => update(r.key, { recipientName: e.target.value })} placeholder={t("Nom du client")} aria-label={t("Nom du client")} autoComplete="off" />
                <input className={input} value={r.recipientPhone} onChange={(e) => update(r.key, { recipientPhone: e.target.value })} placeholder={t("Téléphone")} aria-label={t("Téléphone du client")} inputMode="tel" autoComplete="off" />
              </div>

              <div>
                <p className="mb-2 text-[12px] uppercase tracking-wide text-stone-500">{t("Où livrer")}</p>
                <div role="radiogroup" aria-label={t("Où livrer")} className="flex gap-1 rounded-xl bg-stone-100 p-1">
                  {MODES.map((mo) => (
                    <button key={mo.value} type="button" role="radio" aria-checked={r.mode === mo.value} onClick={() => update(r.key, { mode: mo.value })} className={segment(r.mode === mo.value)}>
                      {t(mo.label)}
                    </button>
                  ))}
                </div>
                {r.mode === "link" && <p className="mt-2 text-[13px] text-stone-600">{t("Après l'envoi, un message WhatsApp prêt à partir demande au client de partager sa position (24 h).")}</p>}
                {r.mode !== "link" && (
                  <input
                    className={`${input} mt-2`}
                    value={r.address}
                    onChange={(e) => update(r.key, { address: e.target.value })}
                    placeholder={t("Quartier et repère (portail bleu, face à la pharmacie…)")}
                    aria-label={t("Adresse et repère")}
                  />
                )}
                {r.mode === "map" && (
                  <button type="button" onClick={() => setMapFor(r.key)} className={`${secondary} mt-2 !py-3 !text-[15px]`}>
                    <Icon name="pin" className="h-5 w-5" />
                    {r.point ? t("Point placé · modifier") : t("Placer le point sur la carte")}
                  </button>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="mb-1 block text-[12px] uppercase tracking-wide text-stone-500">{t("À encaisser (FCFA)")}</span>
                  <input className={input} value={r.codAmount} onChange={(e) => update(r.key, { codAmount: e.target.value.replace(/[^\d]/g, "") })} placeholder={t("0 : déjà payé")} inputMode="numeric" />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[12px] uppercase tracking-wide text-stone-500">{t("N° de commande")}</span>
                  <input className={input} value={r.merchantRef} onChange={(e) => update(r.key, { merchantRef: e.target.value })} placeholder={t("Facultatif")} maxLength={40} />
                </label>
              </div>

              <div>
                <p className="mb-2 text-[12px] uppercase tracking-wide text-stone-500">{t("Livraison payée par")}</p>
                <div role="radiogroup" aria-label={t("Livraison payée par")} className="flex gap-1 rounded-xl bg-stone-100 p-1">
                  <button type="button" role="radio" aria-checked={r.payer === "SENDER"} onClick={() => update(r.key, { payer: "SENDER" })} className={segment(r.payer === "SENDER")}>
                    {t("Ma boutique")}
                  </button>
                  <button type="button" role="radio" aria-checked={r.payer === "RECIPIENT"} onClick={() => update(r.key, { payer: "RECIPIENT" })} className={segment(r.payer === "RECIPIENT")}>
                    {t("Le client")}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <select className={input} value={r.parcelCategoryId} onChange={(e) => update(r.key, { parcelCategoryId: e.target.value })} aria-label={t("Type de colis")}>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <select className={input} value={r.weightKg} onChange={(e) => update(r.key, { weightKg: Number(e.target.value) })} aria-label={t("Poids")}>
                  {WEIGHTS.map((w) => (
                    <option key={w.kg} value={w.kg}>
                      {t(w.label)}
                    </option>
                  ))}
                </select>
              </div>

              {issue && (
                <p role="alert" className="text-sm text-red-700">
                  {t("À compléter")} : {t(issue)}
                </p>
              )}
              {q && (
                <p className="hairline-t flex flex-wrap justify-between gap-x-3 pt-3 text-[13px] text-stone-600">
                  <span>
                    {t("Livraison")} <strong className="text-ink">{fcfa(q.fee)}</strong>
                    {q.km !== null ? ` · ${q.km} km` : q.waiting ? ` · ${t("prix fixé à la réception de la position")}` : q.toConfirm ? ` · ${t("prix minimum, à confirmer")}` : ""}
                  </span>
                  <span>
                    {t("Le livreur encaisse")} <strong className="text-ink">{fcfa(q.toCollect)}</strong>
                  </span>
                </p>
              )}
            </section>
          );
        })}

        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={add} disabled={rows.length >= 50} className={secondary}>
            <Icon name="plus" className="h-5 w-5" /> {t("Un colis")}
          </button>
          <button type="button" onClick={() => setPaste("")} className={secondary}>
            <Icon name="doc" className="h-5 w-5" /> {t("Coller une liste")}
          </button>
        </div>
      </div>

      {/* Récapitulatif fixe au-dessus des onglets. */}
      <div className="fixed inset-x-0 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-30 mx-auto max-w-md px-3">
        <div className="glass space-y-2 rounded-[22px] p-3 shadow-[0_8px_30px_rgb(0_0_0/0.14)] ring-1 ring-black/5">
          <p className="flex justify-between px-1 text-[13px] text-stone-600">
            <span>
              {t("{n} colis", { n: rows.length })} · {t("à encaisser")} <strong className="text-ink">{fcfa(cod)}</strong>
            </span>
            <span>
              {t("Livraison")} <strong className="text-ink">{quote ? fcfa(quote.fees) : "–"}</strong>
            </span>
          </p>
          {error && (
            <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">
              {error}
            </p>
          )}
          <button type="button" onClick={send} disabled={busy || !m.active} className={primary}>
            {busy ? t("Envoi…") : rows.length > 1 ? t("Envoyer les {n} colis", { n: rows.length }) : t("Envoyer le colis")}
          </button>
        </div>
      </div>

      {mapFor !== null && (
        <MapPicker
          title={t("Point de livraison")}
          initial={rows.find((r) => r.key === mapFor)?.point ?? (m.pickupLatitude !== null && m.pickupLongitude !== null ? { latitude: m.pickupLatitude, longitude: m.pickupLongitude } : null)}
          onPick={(p) => {
            update(mapFor, { point: p });
            setMapFor(null);
          }}
          onClose={() => setMapFor(null)}
        />
      )}

      {paste !== null && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/35 backdrop-blur-[2px]" role="dialog" aria-label={t("Coller une liste")}>
          <div className="anim-slide-up mx-auto w-full max-w-md space-y-3 rounded-t-[24px] bg-surface p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
            <span className="mx-auto block h-[5px] w-9 rounded-full bg-stone-300" aria-hidden="true" />
            <p className="text-[19px] font-bold">{t("Coller une liste")}</p>
            <p className="text-sm text-stone-600">{t("Une ligne par client, depuis votre tableur ou WhatsApp : Nom ; Téléphone ; Adresse ; Montant ; Réf. Seuls le nom et le téléphone sont obligatoires.")}</p>
            <textarea
              className={`${input} h-40 font-mono text-[13px]`}
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              placeholder={"Ama Koffi ; 90 11 22 33 ; Bè Kpota, portail bleu ; 15000 ; #1042"}
              aria-label={t("Liste des clients")}
            />
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setPaste(null)} className={secondary}>
                {t("Annuler")}
              </button>
              <button type="button" onClick={importPasted} className={primary}>
                {t("Ajouter")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Envoi validé : codes des colis et, pour chaque client, le message WhatsApp à envoyer (lien de position ou suivi).
function SentView({ sent, onAgain }: { sent: Sent; onAgain: () => void }) {
  const t = useT();
  const waiting = sent.parcels.filter((p) => p.awaitingPosition).length;
  return (
    <div>
      <TopBar title="Envoi validé" back="/marchand" />
      <div className="space-y-4 px-4 pb-8 pt-5">
        <div className="text-center">
          <span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-emerald-600 text-white shadow-[0_10px_24px_-8px_rgb(7_90_52/0.7)]">
            <Icon name="check" className="h-8 w-8" />
          </span>
          <h1 className="mt-3 text-[24px] font-bold">{sent.parcels.length > 1 ? t("{n} colis envoyés", { n: sent.parcels.length }) : t("Colis envoyé")}</h1>
          <p className="mt-1 text-sm text-stone-600">
            {t("Livraison")} : {fcfa(sent.fees)}. {t("Un livreur vient les chercher à votre point de ramassage.")}
          </p>
          {waiting > 0 && <p className="mt-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{t("Envoyez le message WhatsApp à chaque client : le colis part dès qu'il a partagé sa position.")}</p>}
        </div>
        <ul className="space-y-3">
          {sent.parcels.map((p) => (
            <li key={p.code} className={`${card} card-line space-y-3 p-4`}>
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{p.recipientName}</span>
                  <span className="block text-[13px] text-stone-500">
                    {p.code} · {p.total ? `${t("à encaisser")} ${fcfa(p.total)}` : t("rien à encaisser")}
                  </span>
                </span>
                <Link href={`/marchand/colis/${p.code}`} className="text-[15px] text-emerald-700">
                  {t("Suivre")}
                </Link>
              </div>
              <a href={p.message.whatsappUrl} target="_blank" rel="noreferrer" className={`${p.awaitingPosition ? primary : secondary} !py-3 !text-[15px]`}>
                <Icon name="phone" className="h-5 w-5" />
                {p.awaitingPosition ? t("Demander sa position sur WhatsApp") : t("Envoyer le suivi sur WhatsApp")}
              </a>
            </li>
          ))}
        </ul>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={onAgain} className={secondary}>
            {t("Nouvel envoi")}
          </button>
          <Link href="/marchand/colis" className={primary}>
            {t("Mes colis")}
          </Link>
        </div>
      </div>
    </div>
  );
}
