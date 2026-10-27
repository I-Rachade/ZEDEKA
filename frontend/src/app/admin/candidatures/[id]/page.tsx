"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import { Icon } from "@/components/panel/icons";
import { API_URL } from "@/lib/api";
import { adminFetch, formatTime, getToken } from "@/lib/admin";
import { button, buttonDanger, buttonGhost, Card, ErrorNote, input, Loading, PageHeader } from "../../ui";
import { useAction, useAdmin } from "../../useAdmin";
import { ApplicationPill, BUSINESS_LABEL, type ApplicationStatus } from "../shared";

type Application = {
  id: string;
  reference: string;
  status: ApplicationStatus;
  businessName: string;
  businessType: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  deliveryTimeMin: number;
  deliveryTimeMax: number;
  legalDocPath: string | null;
  ownerFirstName: string;
  ownerLastName: string;
  phone: string;
  whatsapp: string | null;
  momoOperator: "TMONEY" | "FLOOZ";
  momoNumber: string;
  rccm: string | null;
  nif: string | null;
  email: string;
  plan: string;
  createdAt: string;
  reviewedAt: string | null;
  rejectionReason: string | null;
  zone: { name: string };
  restaurant: { id: string; slug: string; name: string } | null;
  planDetails: { name: string; commissionPercent: number; monthlyFee: number } | null;
};

// Les pièces ne sont pas publiques : on les charge avec le jeton admin.
function useFile(id: string, kind: string, enabled = true) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let objectUrl: string | null = null;
    fetch(`${API_URL}/api/admin/vendor-applications/${id}/files/${kind}`, { headers: { Authorization: `Bearer ${getToken() ?? ""}` } })
      .then((r) => (r.ok ? r.blob() : null))
      .then((b) => {
        if (b) setUrl((objectUrl = URL.createObjectURL(b)));
      })
      .catch(() => {});
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [id, kind, enabled]);
  return url;
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-stone-500">{label}</dt>
      <dd>{value || "–"}</dd>
    </div>
  );
}

export default function ApplicationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: a, error, reload } = useAdmin<Application>(`/vendor-applications/${id}`);
  const action = useAction();
  const logo = useFile(id, "logo");
  const cover = useFile(id, "cover");
  const legal = useFile(id, "legalDoc", Boolean(a?.legalDocPath));
  const [rejecting, setRejecting] = useState(false);

  if (error) return <ErrorNote message={error} />;
  if (!a) return <Loading />;

  const decide = (path: string, body: unknown) =>
    action.run(async () => {
      await adminFetch(`/vendor-applications/${id}/${path}`, { method: "POST", body });
      await reload();
    });

  return (
    <div className="space-y-4">
      <PageHeader
        icon="store"
        title={a.businessName}
        description={`${BUSINESS_LABEL[a.businessType] ?? a.businessType} · candidature ${a.reference} reçue le ${formatTime(a.createdAt)}`}
        actions={
          <>
            <ApplicationPill status={a.status} />
            {a.status === "PENDING" && (
              <button onClick={() => decide("approve", {})} className={button}>
                <Icon name="check" className="h-4 w-4" /> Valider et créer le restaurant
              </button>
            )}
          </>
        }
      />
      <ErrorNote message={action.error} />
      {a.restaurant && (
        <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">
          Restaurant créé :{" "}
          <Link href={`/admin/restaurants/${a.restaurant.id}`} className="font-medium underline">
            {a.restaurant.name}
          </Link>{" "}
          (page /r/{a.restaurant.slug}). Le gérant se connecte sur /restaurant avec {a.email} et le mot de passe choisi à l&apos;inscription. Ajoutez maintenant sa carte.
        </p>
      )}
      {a.rejectionReason && <p className="rounded-lg bg-stone-100 p-3 text-sm">Refusée le {formatTime(a.reviewedAt!)} : {a.rejectionReason}</p>}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title="Commerce" icon="store">
            {cover && (
              // eslint-disable-next-line @next/next/no-img-element -- image téléversée par le partenaire
              <img src={cover} alt="Couverture" className="mb-3 h-40 w-full rounded-lg object-cover" />
            )}
            <div className="flex gap-4">
              {logo && (
                // eslint-disable-next-line @next/next/no-img-element -- image téléversée par le partenaire
                <img src={logo} alt="Logo" className="h-16 w-16 rounded-full object-cover" />
              )}
              <dl className="grid flex-1 gap-3 text-sm sm:grid-cols-2">
                <Field label="Adresse" value={a.address} />
                <Field label="Zone" value={a.zone.name} />
                <Field label="Délai de préparation et livraison" value={`${a.deliveryTimeMin}–${a.deliveryTimeMax} min`} />
                <Field
                  label="Position"
                  value={
                    a.latitude !== null && a.longitude !== null ? (
                      <a href={`https://www.google.com/maps?q=${a.latitude},${a.longitude}`} target="_blank" rel="noopener noreferrer" className="text-emerald-700 underline">
                        Voir sur la carte
                      </a>
                    ) : null
                  }
                />
              </dl>
            </div>
          </Card>
          <Card title="Légal et paiement" icon="receipt">
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <Field label="RCCM" value={a.rccm} />
              <Field label="NIF" value={a.nif} />
              <Field label="Mobile money" value={`${a.momoOperator === "TMONEY" ? "T-Money" : "Flooz"} · ${a.momoNumber}`} />
              <Field
                label="Formule"
                value={a.planDetails ? `${a.planDetails.name} · ${a.planDetails.commissionPercent} % de commission${a.planDetails.monthlyFee ? ` + ${a.planDetails.monthlyFee} FCFA / mois` : ""}` : a.plan}
              />
              <Field
                label="Document légal"
                value={
                  legal ? (
                    <a href={legal} target="_blank" rel="noopener noreferrer" className="text-emerald-700 underline">
                      Ouvrir le document
                    </a>
                  ) : null
                }
              />
            </dl>
          </Card>
        </div>
        <div className="space-y-4">
          <Card title="Gérant" icon="user">
            <dl className="space-y-2 text-sm">
              <Field label="Nom" value={`${a.ownerFirstName} ${a.ownerLastName}`} />
              <Field label="Téléphone" value={<a href={`tel:${a.phone}`} className="text-emerald-700">{a.phone}</a>} />
              <Field label="WhatsApp" value={a.whatsapp} />
              <Field label="E-mail (identifiant)" value={a.email} />
            </dl>
          </Card>
          {a.status === "PENDING" && (
            <Card title="Décision" icon="check">
              <p className="text-sm text-stone-600">
                La validation crée le restaurant avec la commission de la formule choisie. Vous ajouterez ensuite la carte.
              </p>
              <button onClick={() => decide("approve", {})} className={`${button} mt-3 w-full`}>
                Valider
              </button>
              <button onClick={() => setRejecting((r) => !r)} className={`${buttonGhost} mt-2 w-full`}>
                Refuser
              </button>
              {rejecting && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    decide("reject", { reason: String(new FormData(e.currentTarget).get("reason") ?? "") });
                  }}
                  className="mt-2 space-y-2"
                >
                  <input name="reason" required minLength={3} placeholder="Motif (ex. documents illisibles)" className={input} />
                  <button className={buttonDanger}>Confirmer le refus</button>
                </form>
              )}
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
