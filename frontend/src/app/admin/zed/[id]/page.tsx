"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import { Icon } from "@/components/panel/icons";
import { API_URL, fcfa } from "@/lib/api";
import { adminFetch, formatTime, getToken, telLink } from "@/lib/admin";
import { useT } from "@/lib/i18n/client";
import { button, buttonDanger, buttonGhost, Card, ErrorNote, input, Loading, PageHeader } from "../../ui";
import { useAction, useAdmin } from "../../useAdmin";
import { DocsEditor, IdExpiry } from "../../livreurs/DriverDocs";
import type { Driver } from "@/lib/admin";
import { RIDE_STATUS, ZedPill, type ZedDriverRow } from "../shared";

type Detail = ZedDriverRow & {
  zedPayments: {
    id: string;
    plan: string;
    days: number;
    amount: number;
    method: string;
    reference: string | null;
    status: string;
    startsAt: string | null;
    endsAt: string | null;
    createdAt: string;
  }[];
  rides: {
    id: string;
    code: string;
    status: keyof typeof RIDE_STATUS;
    price: number | null;
    rating: number | null;
    createdAt: string;
  }[];
};

const DOCS = [
  { kind: "SELFIE", label: "Photo du conducteur" },
  { kind: "ID_CARD", label: "Pièce d'identité" },
  { kind: "LICENCE", label: "Permis de conduire" },
  { kind: "MOTO", label: "Moto et plaque" },
];

// Les photos du dossier ne sont pas publiques : chargées avec le jeton admin.
function Doc({ id, kind, label, present, version }: { id: string; kind: string; label: string; present: boolean; version?: string }) {
  const t = useT();
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!present) return;
    let objectUrl: string | null = null;
    fetch(`${API_URL}/api/admin/zed/drivers/${id}/documents/${kind}`, {
      headers: { Authorization: `Bearer ${getToken() ?? ""}` },
    })
      .then((r) => (r.ok ? r.blob() : null))
      .then((b) => {
        if (b) setUrl((objectUrl = URL.createObjectURL(b)));
      })
      .catch(() => {});
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [id, kind, present, version]);
  return (
    <figure className="space-y-1">
      <div className="grid aspect-[4/3] place-items-center overflow-hidden rounded-lg border border-stone-200 bg-stone-100">
        {url ? (
          <a href={url} target="_blank" rel="noreferrer" className="h-full w-full">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt={t(label)} className="h-full w-full object-cover" />
          </a>
        ) : (
          <span className="text-xs text-stone-500">{present ? t("Chargement…") : t("Non fournie")}</span>
        )}
      </div>
      <figcaption className="text-xs text-stone-600">{t(label)}</figcaption>
    </figure>
  );
}

export default function ZedDriverPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const t = useT();
  const { data: d, error, reload } = useAdmin<Detail>(`/zed/drivers/${id}`);
  const action = useAction();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function review(decision: "APPROVE" | "REJECT" | "SUSPEND") {
    setBusy(true);
    await action.run(() =>
      adminFetch(`/zed/drivers/${id}/review`, {
        method: "POST",
        body: { decision, note: note.trim() || undefined },
      }),
    );
    setBusy(false);
    reload();
  }

  if (!d) return error ? <ErrorNote message={error} /> : <Loading />;
  const has = (k: string) => d.zedDocuments.some((doc) => doc.kind === k);

  return (
    <div className="space-y-4">
      <Link href="/admin/zed" className="inline-flex items-center gap-1 text-sm text-emerald-700">
        <Icon name="back" className="h-4 w-4" /> {t("Zed")}
      </Link>
      <PageHeader
        icon="rider"
        title={d.name}
        description={d.deliveries ? "Livreur indépendant qui fait aussi du Zed" : "Conducteur Zed inscrit seul (pas de livraisons)"}
        actions={<ZedPill status={d.zedStatus} available={d.zedAvailable && Boolean(d.planEndsAt)} />}
      />

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <Card title="Pièces du dossier" icon="doc">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {DOCS.map((doc) => (
              <Doc key={doc.kind} id={id} kind={doc.kind} label={doc.label} present={has(doc.kind)} version={d.zedDocuments.find((x) => x.kind === doc.kind)?.createdAt} />
            ))}
          </div>
          {has("ID_CARD") && (
            <p className="mt-3 flex flex-wrap items-center gap-2 text-sm">
              <IdExpiry doc={d.zedDocuments.find((doc) => doc.kind === "ID_CARD")} />
              {d.zedDocuments.find((doc) => doc.kind === "ID_CARD")?.issuedAt && (
                <span className="text-stone-500">
                  {t("Délivrée le {date}", { date: new Date(d.zedDocuments.find((doc) => doc.kind === "ID_CARD")!.issuedAt!).toLocaleDateString("fr-FR", { timeZone: "UTC" }) })}
                </span>
              )}
            </p>
          )}
          {/* Seule l'équipe dépose la photo et les pièces : le conducteur les apporte au bureau. */}
          <div className="mt-3">
            {(!has("SELFIE") || !has("ID_CARD")) && <p className="mb-2 text-sm text-amber-800">{t("Ajoutez la photo du conducteur et sa pièce d'identité avec ses dates avant de valider.")}</p>}
            <DocsEditor driver={{ id: d.id, name: d.name, zedDocuments: d.zedDocuments as Driver["zedDocuments"] }} onSaved={reload} />
          </div>
        </Card>
        <Card title="Conducteur" icon="user">
          <dl className="space-y-2 text-sm">
            <div>
              <dt className="text-xs text-stone-500">{t("Téléphone")}</dt>
              <dd>
                <a href={telLink(d.phone)} className="text-emerald-700">
                  {d.phone}
                </a>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-stone-500">{t("Plaque")}</dt>
              <dd className="font-mono font-semibold">{d.plate ?? "–"}</dd>
            </div>
            <div>
              <dt className="text-xs text-stone-500">{t("Inscrit le")}</dt>
              <dd>{d.zedAppliedAt ? formatTime(d.zedAppliedAt) : "–"}</dd>
            </div>
            <div>
              <dt className="text-xs text-stone-500">{t("Plan Zed")}</dt>
              <dd>{d.planEndsAt ? t("Jusqu'au {date}", { date: formatTime(d.planEndsAt) }) : t("Aucun plan en cours")}</dd>
            </div>
            {d.zedReviewedBy && (
              <div>
                <dt className="text-xs text-stone-500">{t("Vérifié par")}</dt>
                <dd>
                  {d.zedReviewedBy} · {d.zedReviewedAt ? formatTime(d.zedReviewedAt) : ""}
                </dd>
              </div>
            )}
          </dl>
        </Card>
      </div>

      <Card title="Décision" icon="shield">
        <ErrorNote message={action.error} />
        <label className="mb-3 block text-sm">
          <span className="mb-1 block text-stone-600">{t("Note pour le conducteur (facultative)")}</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} className={input} />
        </label>
        <div className="flex flex-wrap gap-2">
          {d.zedStatus !== "ACTIVE" && (
            <button disabled={busy} onClick={() => review("APPROVE")} className={button}>
              <Icon name="check" className="h-4 w-4" /> {t("Valider et ouvrir le mode Zed")}
            </button>
          )}
          {d.zedStatus === "PENDING" && (
            <button disabled={busy} onClick={() => review("REJECT")} className={buttonDanger}>
              {t("Refuser le dossier")}
            </button>
          )}
          {d.zedStatus === "ACTIVE" && (
            <button disabled={busy} onClick={() => review("SUSPEND")} className={buttonGhost}>
              {t("Suspendre le mode Zed")}
            </button>
          )}
        </div>
        {d.zedStatus === "PENDING" && <p className="mt-2 text-xs text-stone-500">{t("La validation ouvre le mode Zed avec le premier mois offert.")}</p>}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Paiements du plan" icon="wallet">
          {d.zedPayments.length === 0 ? (
            <p className="text-sm text-stone-500">{t("Aucun paiement.")}</p>
          ) : (
            <ul className="divide-y divide-stone-100 text-sm">
              {d.zedPayments.map((p) => (
                <li key={p.id} className="flex justify-between gap-2 py-2">
                  <span>
                    {p.plan === "TRIAL" ? t("Mois offert") : p.plan === "MONTH" ? t("30 jours") : t("{n} jour(s)", { n: p.days })} · {p.amount ? fcfa(p.amount) : t("Offert")}
                    {p.reference && <span className="block text-xs text-stone-500">{p.reference}</span>}
                  </span>
                  <span className="text-right text-xs text-stone-600">
                    {t(p.status === "CONFIRMED" ? "Confirmé" : p.status === "PENDING" ? "À confirmer" : "Refusé")}
                    {p.endsAt && <span className="block">{t("jusqu'au {date}", { date: formatTime(p.endsAt) })}</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Dernières courses" icon="rider">
          {d.rides.length === 0 ? (
            <p className="text-sm text-stone-500">{t("Aucune course.")}</p>
          ) : (
            <ul className="divide-y divide-stone-100 text-sm">
              {d.rides.map((r) => (
                <li key={r.id} className="flex justify-between gap-2 py-2">
                  <span>
                    {r.code} · {formatTime(r.createdAt)}
                  </span>
                  <span>
                    {t(RIDE_STATUS[r.status].label)}
                    {r.rating ? ` · ${r.rating}/5` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
