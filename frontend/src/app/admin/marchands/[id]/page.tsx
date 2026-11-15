"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { fcfa } from "@/lib/api";
import { adminFetch, formatTime, telLink, whatsappLink } from "@/lib/admin";
import { useT } from "@/lib/i18n/client";
import { thumbOf } from "@/lib/media";
import { button, buttonDanger, buttonGhost, Card, ErrorNote, input, Loading, PageHeader } from "../../ui";
import { useAction, useAdmin } from "../../useAdmin";
import { REVIEW_LABEL, STORE_STATUS_LABEL, type AdminProduct, type StoreDetail } from "../store";

// Fiche d'une boutique en ligne : la demande (pièce ou IFU, présentation), la décision (en ligne, refus,
// suspension) avec la catégorie et la facturation, comme les restaurants (commission en % ou abonnement
// mensuel), puis la vérification des produits et l'aperçu des bannières.
export default function StoreAdminPage() {
  const t = useT();
  const { id } = useParams<{ id: string }>();
  const { data, error, reload } = useAdmin<StoreDetail>(`/stores/${id}`);
  const { error: actionError, run } = useAction();
  const [category, setCategory] = useState("");
  const [mode, setMode] = useState<"COMMISSION" | "SUBSCRIPTION">("COMMISSION");
  const [rate, setRate] = useState("10");
  const [fee, setFee] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!data) return;
    setCategory(data.category ?? "");
    setMode(data.billing.mode);
    setRate(String(data.billing.mode === "COMMISSION" ? data.billing.rate : 10));
    setFee(data.billing.fee ? String(data.billing.fee) : "");
    setNote(data.status === "ONLINE" ? "" : (data.note ?? ""));
  }, [data]);

  if (!data) return error ? <ErrorNote message={error} /> : <Loading />;

  const billing = mode === "SUBSCRIPTION" ? { storeCommissionRate: 0, storeSubscriptionFee: Number(fee) || null } : { storeCommissionRate: Number(rate), storeSubscriptionFee: null };
  const decide = (status?: "ONLINE" | "REJECTED" | "SUSPENDED") =>
    run(async () => {
      await adminFetch(`/stores/${id}`, { method: "PATCH", body: { ...(status ? { status, note: note.trim() || undefined } : {}), ...(category ? { storeCategory: category } : {}), ...billing } });
      await reload();
    });
  const approveAll = () =>
    run(async () => {
      await adminFetch(`/stores/${id}/approve-products`, { method: "POST", body: {} });
      await reload();
    });

  const [label, color] = STORE_STATUS_LABEL[data.status];
  const cat = data.categories.find((c) => c.key === data.category);
  return (
    <div className="space-y-4">
      <Link href="/admin/marchands?onglet=vente" className="text-sm text-emerald-700">
        ← {t("Vente en ligne")}
      </Link>
      <PageHeader
        icon="store"
        title={data.shopName}
        description={`${data.owner ?? "–"} · ${data.phone} · ${data.area}`}
        actions={
          <span className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2 py-1 text-xs font-semibold ${color}`}>{t(label)}</span>
            <a className={buttonGhost} href={telLink(data.phone)}>
              {t("Appeler")}
            </a>
            <a className={buttonGhost} href={whatsappLink(data.phone)} target="_blank" rel="noreferrer">
              WhatsApp
            </a>
          </span>
        }
      />
      <ErrorNote message={actionError} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Demande" icon="doc">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-stone-500">{t("Pièce ou IFU")}</dt>
            <dd className="font-semibold">{data.idNumber ?? <span className="text-red-700">{t("Manquante")}</span>}</dd>
            <dt className="text-stone-500">{t("Catégorie demandée")}</dt>
            <dd>{cat ? `${cat.emoji} ${t(cat.label)}` : "–"}</dd>
            <dt className="text-stone-500">{t("Présentation")}</dt>
            <dd>{data.description ?? "–"}</dd>
            <dt className="text-stone-500">{t("Logo")}</dt>
            <dd>
              {data.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- logo envoyé par le marchand
                <img src={data.logoUrl} alt="" className="h-12 w-12 rounded-full object-cover" />
              ) : (
                "–"
              )}
            </dd>
            <dt className="text-stone-500">{t("Produits")}</dt>
            <dd>
              {data.counts.total} · {data.counts.pending} {t("à vérifier")} · {data.counts.approved} {t("acceptés")}
            </dd>
            <dt className="text-stone-500">{t("Reversements")}</dt>
            <dd>{data.payoutPhone ?? "–"}</dd>
            <dt className="text-stone-500">{t("Demandée le")}</dt>
            <dd>{data.requestedAt ? formatTime(data.requestedAt) : "–"}</dd>
            {data.reviewedAt && (
              <>
                <dt className="text-stone-500">{t("Décision")}</dt>
                <dd>
                  {formatTime(data.reviewedAt)}
                  {data.reviewedBy ? ` · ${data.reviewedBy}` : ""}
                </dd>
              </>
            )}
          </dl>
        </Card>

        <Card title="Décision" icon="check">
          <div className="space-y-3 text-sm">
            <label className="block">
              <span className="mb-1 block font-medium">{t("Catégorie")}</span>
              <select className={`${input} w-full`} value={category} onChange={(e) => setCategory(e.target.value)} aria-label={t("Catégorie")}>
                <option value="">{t("Choisir…")}</option>
                {data.categories.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.emoji} {t(c.label)}
                  </option>
                ))}
              </select>
            </label>
            <fieldset className="space-y-2">
              <legend className="mb-1 font-medium">{t("Facturation")}</legend>
              <label className="flex items-center gap-2">
                <input type="radio" name="billing" checked={mode === "COMMISSION"} onChange={() => setMode("COMMISSION")} className="accent-emerald-600" />
                {t("Commission par vente")}
                <input type="number" min={1} max={50} value={rate} onChange={(e) => setRate(e.target.value)} disabled={mode !== "COMMISSION"} className={`${input} w-20`} aria-label={t("Taux de commission (%)")} />%
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" name="billing" checked={mode === "SUBSCRIPTION"} onChange={() => setMode("SUBSCRIPTION")} className="accent-emerald-600" />
                {t("Abonnement mensuel")}
                <input type="number" min={0} step={500} value={fee} onChange={(e) => setFee(e.target.value)} disabled={mode !== "SUBSCRIPTION"} placeholder="15000" className={`${input} w-28`} aria-label={t("Abonnement mensuel (FCFA)")} />
                FCFA
              </label>
              <p className="text-xs text-stone-500">{t("Comme pour les restaurants : soit un pourcentage sur chaque vente, soit un montant fixe par mois sans commission.")}</p>
            </fieldset>
            <label className="block">
              <span className="mb-1 block font-medium">{t("Motif (refus ou suspension)")}</span>
              <textarea className={`${input} min-h-16 w-full`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder={t("Montré au marchand. Ex. Photos floues, pièce illisible.")} />
            </label>
            <div className="flex flex-wrap gap-2">
              {data.status !== "ONLINE" && (
                <button className={button} onClick={() => decide("ONLINE")} disabled={!category}>
                  {data.status === "SUSPENDED" ? t("Réactiver") : t("Mettre en ligne")}
                </button>
              )}
              {data.status === "PENDING" && (
                <button className={buttonDanger} onClick={() => decide("REJECTED")} disabled={!note.trim()}>
                  {t("Refuser")}
                </button>
              )}
              {data.status === "ONLINE" && (
                <>
                  <button className={button} onClick={() => decide()}>
                    {t("Enregistrer")}
                  </button>
                  <button className={buttonDanger} onClick={() => decide("SUSPENDED")} disabled={!note.trim()}>
                    {t("Suspendre")}
                  </button>
                </>
              )}
            </div>
            {data.status === "ONLINE" && data.slug && <p className="text-xs text-stone-500">{t("Adresse de la page : /boutique/{slug}", { slug: data.slug })}</p>}
          </div>
        </Card>
      </div>

      <Card
        title={`${t("Produits")} (${data.counts.total})`}
        icon="bag"
        action={
          data.counts.pending > 0 ? (
            <button className={button} onClick={approveAll}>
              {t("Tout accepter ({n})", { n: data.counts.pending })}
            </button>
          ) : undefined
        }
      >
        {data.products.length === 0 ? (
          <p className="text-sm text-stone-600">{t("Aucun produit.")}</p>
        ) : (
          <ul className="divide-y divide-stone-100">
            {data.products.map((p) => (
              <ProductReview key={p.id} p={p} run={run} reload={reload} />
            ))}
          </ul>
        )}
      </Card>

      <Card title={`${t("Bannières")} (${data.banners.length})`} icon="grid">
        {data.banners.length === 0 ? (
          <p className="text-sm text-stone-600">{t("Aucune bannière.")}</p>
        ) : (
          <ul className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {data.banners.map((b) => (
              <li key={b.id} className={b.active ? "" : "opacity-50"}>
                <div className="aspect-[16/7] overflow-hidden rounded-lg bg-stone-200">
                  {b.kind === "VIDEO" ? (
                    <video src={b.posterUrl ? b.url : `${b.url}#t=0.5`} poster={b.posterUrl ?? undefined} controls muted playsInline preload="metadata" className="h-full w-full object-cover" />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element -- image envoyée par le marchand
                    <img src={b.url} alt={b.title} className="h-full w-full object-cover" />
                  )}
                </div>
                <p className="mt-1 truncate text-xs text-stone-600">
                  {b.kind === "VIDEO" ? t("Vidéo") : t("Image")}
                  {b.title ? ` · ${b.title}` : ""}
                  {!b.active ? ` · ${t("masquée")}` : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function ProductReview({ p, run, reload }: { p: AdminProduct; run: (fn: () => Promise<unknown>) => Promise<boolean>; reload: () => Promise<void> }) {
  const t = useT();
  const [refusing, setRefusing] = useState(false);
  const [reason, setReason] = useState(p.reviewNote ?? "");
  const [label, color] = REVIEW_LABEL[p.review];
  const decide = (review: "APPROVED" | "REJECTED") =>
    run(async () => {
      await adminFetch(`/stores/products/${p.id}`, { method: "PATCH", body: { review, ...(review === "REJECTED" ? { note: reason.trim() } : {}) } });
      setRefusing(false);
      await reload();
    });
  return (
    <li className="flex flex-wrap items-start gap-3 py-3">
      <div className="flex gap-1">
        {p.imageUrls.slice(0, 3).map((u) => (
          <a key={u} href={u} target="_blank" rel="noreferrer">
            {/* eslint-disable-next-line @next/next/no-img-element -- photo envoyée par le marchand */}
            <img src={thumbOf(u)} alt="" className="h-16 w-16 rounded-lg object-cover" />
          </a>
        ))}
      </div>
      <div className="min-w-[12rem] flex-1 text-sm">
        <p className="flex items-center gap-2">
          <span className="font-semibold">{p.name}</span>
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${color}`}>{t(label)}</span>
          {!p.visible && <span className="text-xs text-stone-500">{t("caché par le marchand")}</span>}
        </p>
        <p className="text-stone-600">
          {fcfa(p.price)} · {t("stock {n}", { n: p.stock })}
          {p.section ? ` · ${p.section}` : ""}
          {p.options.length ? ` · ${p.options.map((o) => `${o.name} : ${o.values.join(", ")}`).join(" · ")}` : ""}
        </p>
        {p.description && <p className="line-clamp-2 text-stone-500">{p.description}</p>}
        {p.review === "REJECTED" && p.reviewNote && <p className="text-red-700">{p.reviewNote}</p>}
        {refusing && (
          <div className="mt-2 flex gap-2">
            <input className={`${input} flex-1`} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder={t("Motif montré au marchand")} aria-label={t("Motif du refus")} />
            <button className={buttonDanger} disabled={!reason.trim()} onClick={() => decide("REJECTED")}>
              {t("Refuser")}
            </button>
          </div>
        )}
      </div>
      <div className="flex gap-2">
        {p.review !== "APPROVED" && (
          <button className={button} onClick={() => decide("APPROVED")}>
            {t("Accepter")}
          </button>
        )}
        {p.review !== "REJECTED" && !refusing && (
          <button className={buttonGhost} onClick={() => setRefusing(true)}>
            {t("Refuser")}
          </button>
        )}
      </div>
    </li>
  );
}
