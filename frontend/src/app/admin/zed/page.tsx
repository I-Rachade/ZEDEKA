"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import DataTable from "@/components/panel/DataTable";
import { fcfa } from "@/lib/api";
import { adminFetch, formatTime } from "@/lib/admin";
import { useT } from "@/lib/i18n/client";
import { button, buttonGhost, Card, ErrorNote, Loading, PageHeader, StatTile, Tabs } from "../ui";
import { useAction, useAdmin } from "../useAdmin";
import { RIDE_STATUS, ZedPill, type ZedDriverRow } from "./shared";

type Summary = {
  pendingDrivers: number;
  pendingPayments: number;
  active: number;
  withPlan: number;
  available: number;
  week: {
    total: number;
    completed: number;
    noDriver: number;
    cancelled: number;
  };
  rating: number | null;
  ratingCount: number;
};
type Payment = {
  id: string;
  plan: "TRIAL" | "MONTH" | "DAY";
  days: number;
  amount: number;
  method: string;
  reference: string | null;
  status: string;
  createdAt: string;
  endsAt: string | null;
  driver: { id: string; name: string; phone: string; plate: string | null };
};
type Ride = {
  id: string;
  code: string;
  status: keyof typeof RIDE_STATUS;
  landmark: string | null;
  price: number | null;
  rating: number | null;
  createdAt: string;
  customer: { name: string | null; phone: string };
  driver: { name: string; plate: string | null } | null;
  _count: { offers: number };
};

type Tab = "dossiers" | "paiements" | "conducteurs" | "courses";

export default function ZedAdminPage() {
  return (
    <Suspense fallback={<Loading />}>
      <ZedAdmin />
    </Suspense>
  );
}

function ZedAdmin() {
  const params = useSearchParams();
  const [tab, setTab] = useState<Tab>((params.get("onglet") as Tab | null) ?? "dossiers");
  const { data: s, reload } = useAdmin<Summary>("/zed/summary");

  return (
    <div>
      <PageHeader
        icon="rider"
        title="Zed"
        count={s ? s.pendingDrivers + s.pendingPayments : undefined}
        description="Moto-taxi : dossiers des conducteurs, paiements du plan Zed et courses. Le service s'ouvre aux clients dans Réglages."
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Dossiers à vérifier" value={s?.pendingDrivers ?? "–"} icon="doc" />
        <StatTile label="Paiements à confirmer" value={s?.pendingPayments ?? "–"} icon="wallet" />
        <StatTile label="Conducteurs disponibles" value={s ? `${s.available} / ${s.withPlan}` : "–"} hint="disponibles / avec plan en cours" icon="rider" />
        <StatTile label="Courses (7 jours)" value={s ? s.week.total : "–"} hint={s ? `${s.week.completed} terminées · ${s.week.noDriver} sans Zed` : undefined} icon="chart" />
      </div>
      <Card>
        <Tabs
          tabs={[
            {
              value: "dossiers" as const,
              label: "Dossiers à vérifier",
              count: s?.pendingDrivers,
            },
            {
              value: "paiements" as const,
              label: "Paiements à confirmer",
              count: s?.pendingPayments,
            },
            {
              value: "conducteurs" as const,
              label: "Conducteurs",
              count: s?.active,
            },
            { value: "courses" as const, label: "Courses" },
          ]}
          value={tab}
          onChange={setTab}
        />
        {tab === "dossiers" && <Drivers status="PENDING" />}
        {tab === "paiements" && <Payments onChange={reload} />}
        {tab === "conducteurs" && <Drivers status="ACTIVE" />}
        {tab === "courses" && <Rides />}
      </Card>
    </div>
  );
}

function Drivers({ status }: { status: "PENDING" | "ACTIVE" }) {
  const t = useT();
  const { data, error } = useAdmin<ZedDriverRow[]>(`/zed/drivers?status=${status}`);
  if (!data) return error ? <ErrorNote message={error} /> : <Loading />;
  return (
    <DataTable
      rows={data}
      rowKey={(d) => d.id}
      rowHref={(d) => `/admin/zed/${d.id}`}
      empty={status === "PENDING" ? "Aucun dossier à vérifier." : "Aucun conducteur Zed actif."}
      columns={[
        {
          header: "Conducteur",
          mobile: "title",
          cell: (d) => (
            <span>
              <span className="font-semibold">{d.name}</span>
              <span className="block text-xs text-stone-500">{d.phone}</span>
            </span>
          ),
        },
        {
          header: "Statut",
          mobile: "badge",
          cell: (d) => <ZedPill status={d.zedStatus} available={d.zedAvailable && Boolean(d.planEndsAt)} />,
        },
        { header: "Plaque", cell: (d) => d.plate ?? "–" },
        {
          header: "Compte",
          cell: (d) => (d.deliveries ? t("Livreur et Zed") : t("Zed seulement")),
        },
        { header: "Pièces", cell: (d) => `${d.zedDocuments.length} / 4` },
        status === "PENDING"
          ? {
              header: "Inscrit le",
              cell: (d) => (d.zedAppliedAt ? formatTime(d.zedAppliedAt) : "–"),
            }
          : {
              header: "Plan jusqu'au",
              cell: (d) => (d.planEndsAt ? formatTime(d.planEndsAt) : <span className="text-red-700">{t("Expiré")}</span>),
            },
        ...(status === "ACTIVE" ? [{ header: "Courses", cell: (d: ZedDriverRow) => d.completedRides }] : []),
      ]}
    />
  );
}

function Payments({ onChange }: { onChange: () => void }) {
  const t = useT();
  const { data, error, reload } = useAdmin<Payment[]>("/zed/payments?status=PENDING");
  const action = useAction();
  const [busy, setBusy] = useState<string | null>(null);

  async function review(p: Payment, decision: "CONFIRM" | "REJECT") {
    const note = decision === "REJECT" ? (window.prompt(t("Raison du refus (envoyée au conducteur)")) ?? undefined) : undefined;
    if (decision === "REJECT" && note === undefined) return;
    setBusy(p.id);
    await action.run(() =>
      adminFetch(`/zed/payments/${p.id}/review`, {
        method: "POST",
        body: { decision, note },
      }),
    );
    setBusy(null);
    reload();
    onChange();
  }

  if (!data) return error ? <ErrorNote message={error} /> : <Loading />;
  return (
    <>
      <ErrorNote message={action.error} />
      <DataTable
        rows={data}
        rowKey={(p) => p.id}
        empty="Aucun paiement à confirmer."
        columns={[
          {
            header: "Conducteur",
            mobile: "title",
            cell: (p) => (
              <span>
                <span className="font-semibold">{p.driver.name}</span>
                <span className="block text-xs text-stone-500">
                  {p.driver.phone} · {p.driver.plate}
                </span>
              </span>
            ),
          },
          {
            header: "Plan",
            cell: (p) => (p.plan === "MONTH" ? t("30 jours") : t("{n} jour(s)", { n: p.days })),
          },
          {
            header: "Montant",
            mobile: "badge",
            cell: (p) => <span className="font-semibold">{fcfa(p.amount)}</span>,
          },
          {
            header: "Référence",
            cell: (p) => `${p.method === "FLOOZ" ? "Flooz" : "T-Money"} · ${p.reference}`,
          },
          { header: "Envoyé le", cell: (p) => formatTime(p.createdAt) },
          {
            header: "",
            cell: (p) => (
              <span className="flex gap-2">
                <button disabled={busy === p.id} onClick={() => review(p, "CONFIRM")} className={button}>
                  {t("Confirmer")}
                </button>
                <button disabled={busy === p.id} onClick={() => review(p, "REJECT")} className={buttonGhost}>
                  {t("Refuser")}
                </button>
              </span>
            ),
          },
        ]}
      />
    </>
  );
}

function Rides() {
  const t = useT();
  const { data, error } = useAdmin<Ride[]>("/zed/rides");
  if (!data) return error ? <ErrorNote message={error} /> : <Loading />;
  return (
    <DataTable
      rows={data}
      rowKey={(r) => r.id}
      empty="Aucune course Zed pour l'instant."
      columns={[
        {
          header: "Course",
          mobile: "title",
          cell: (r) => <span className="font-semibold">{r.code}</span>,
        },
        {
          header: "Statut",
          mobile: "badge",
          cell: (r) => <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${RIDE_STATUS[r.status].tone}`}>{t(RIDE_STATUS[r.status].label)}</span>,
        },
        {
          header: "Client",
          cell: (r) => `${r.customer.name ?? ""} · ${r.customer.phone}`,
        },
        {
          header: "Conducteur",
          cell: (r) => (r.driver ? `${r.driver.name} (${r.driver.plate ?? "–"})` : "–"),
        },
        { header: "Alertés", cell: (r) => r._count.offers },
        {
          header: "Prix",
          cell: (r) => (r.price !== null ? fcfa(r.price) : "–"),
        },
        { header: "Note", cell: (r) => (r.rating ? `${r.rating}/5` : "–") },
        { header: "Le", cell: (r) => formatTime(r.createdAt) },
      ]}
    />
  );
}
