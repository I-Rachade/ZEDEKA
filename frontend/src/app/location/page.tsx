"use client";

import Link from "next/link";
import DataTable from "@/components/panel/DataTable";
import { Card, ErrorNote, Loading, PageHeader, StatTile } from "@/components/panel/ui";
import { fcfa } from "@/lib/api";
import { formatTime } from "@/lib/admin";
import { PRICING_LABEL, rental, TripPill, type Provider, type Trip, type TripStatus } from "@/lib/rental";

type Dashboard = {
  byStatus: Record<TripStatus, number>;
  scheduled: number;
  today: { trips: number; total: number; net: number };
  week: { trips: number; total: number; net: number };
  vehicles: number;
  drivers: number;
};

export default function RentalDashboard() {
  const me = rental.useResource<Provider>("/me");
  const stats = rental.useResource<Dashboard>("/dashboard");
  const pending = rental.useResource<Trip[]>("/trips?status=PENDING");

  if (stats.error || me.error) return <ErrorNote message={stats.error ?? me.error} />;
  if (!stats.data || !me.data) return <Loading />;
  const s = stats.data.byStatus;

  return (
    <div className="space-y-4">
      <PageHeader icon="home" title={me.data.name} description="Vos réservations, vos courses en cours et vos revenus." />

      <div className={`flex flex-wrap items-center justify-between gap-2 rounded-xl p-3 text-sm ${me.data.availability.open ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-900"}`}>
        <span>{me.data.availability.open ? "Ouvert : les clients peuvent réserver." : `Fermé : ${me.data.availability.reason}`}</span>
        <Link href="/location/reglages" className="font-medium underline">
          Réglages
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <StatTile label="En attente" value={s.PENDING} icon="bell" href="/location/courses?statut=PENDING" />
        <StatTile label="Confirmées" value={s.CONFIRMED} icon="check" href="/location/courses?statut=CONFIRMED" />
        <StatTile label="En cours" value={s.ONGOING} icon="car" href="/location/courses?statut=ONGOING" />
        <StatTile label="Terminées" value={s.COMPLETED} icon="receipt" href="/location/courses?statut=COMPLETED" />
        <StatTile label="Planifiées" value={stats.data.scheduled} hint="à venir" icon="clock" href="/location/courses?statut=SCHEDULED" />
        <StatTile label="Annulées" value={s.CANCELLED + s.PAYMENT_FAILED} hint={`dont ${s.PAYMENT_FAILED} paiement échoué`} icon="close" />
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <Card title="Aujourd'hui" icon="receipt">
          <p className="text-2xl font-bold">{fcfa(stats.data.today.total)}</p>
          <p className="text-sm text-stone-600">
            {stats.data.today.trips} course(s) terminée(s) · {fcfa(stats.data.today.net)} pour vous
          </p>
        </Card>
        <Card title="7 derniers jours" icon="chart">
          <p className="text-2xl font-bold">{fcfa(stats.data.week.total)}</p>
          <p className="text-sm text-stone-600">
            {stats.data.week.trips} course(s) · {fcfa(stats.data.week.net)} pour vous après commission
          </p>
        </Card>
        <Card title="Flotte" icon="car">
          <p className="text-2xl font-bold">{stats.data.vehicles} véhicule(s)</p>
          <p className="text-sm text-stone-600">{stats.data.drivers} chauffeur(s) actif(s)</p>
        </Card>
      </div>

      <Card title="Réservations en attente" icon="bell" action={<Link href="/location/courses" className="text-sm text-emerald-700">Tout voir</Link>}>
        {!pending.data ? (
          <Loading />
        ) : (
          <DataTable
            rows={pending.data}
            rowKey={(t) => t.id}
            rowHref={(t) => `/location/courses/${t.id}`}
            empty="Aucune réservation en attente."
            columns={[
              { header: "Course", mobile: "title", cell: (t) => <span className="font-semibold">{t.code}</span> },
              { header: "Statut", mobile: "badge", cell: (t) => <TripPill status={t.status} /> },
              { header: "Départ", cell: (t) => (t.scheduledAt ? formatTime(t.scheduledAt) : "Immédiat") },
              { header: "Client", cell: (t) => t.customerName },
              { header: "Véhicules", cell: (t) => t.vehicles.map((v) => `${v.quantity}× ${v.name}`).join(", ") },
              { header: "Type", cell: (t) => PRICING_LABEL[t.pricing] },
              { header: "Montant", align: "right", cell: (t) => fcfa(t.total) },
            ]}
          />
        )}
      </Card>
    </div>
  );
}
