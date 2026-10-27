"use client";

import DataTable from "@/components/panel/DataTable";
import { Card, ErrorNote, Loading, PageHeader, StatTile } from "@/components/panel/ui";
import { fcfa } from "@/lib/api";
import { rental, type RentalSettlement } from "@/lib/rental";

type Data = { settlements: RentalSettlement[]; pending: { trips: number; sales: number; commission: number; amountDue: number } };

const day = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { timeZone: "UTC" });

export default function RentalSettlementsPage() {
  const { data, error } = rental.useResource<Data>("/settlements");
  if (error) return <ErrorNote message={error} />;
  if (!data) return <Loading />;

  return (
    <div className="space-y-4">
      <PageHeader icon="wallet" title="Relevés" count={data.settlements.length} description="Ce que Zedeka vous doit pour les courses terminées, et les versements déjà faits." />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Courses à régler" value={data.pending.trips} hint="terminées, pas encore versées" />
        <StatTile label="Montant TTC" value={fcfa(data.pending.sales)} />
        <StatTile label="Commission Zedeka" value={fcfa(data.pending.commission)} />
        <StatTile label="À vous verser" value={fcfa(data.pending.amountDue)} />
      </div>
      <Card title="Historique des relevés" icon="receipt">
        <DataTable
          rows={data.settlements}
          rowKey={(s) => s.id}
          empty="Aucun relevé pour le moment. Zedeka établit les relevés depuis son espace admin."
          columns={[
            { header: "Période", mobile: "title", cell: (s) => `${day(s.periodStart)} au ${day(s.periodEnd)}` },
            {
              header: "Statut",
              mobile: "badge",
              cell: (s) =>
                s.paidAt ? (
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800">Versé le {day(s.paidAt)}</span>
                ) : (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">À verser</span>
                ),
            },
            { header: "Courses", cell: (s) => s.tripCount },
            { header: "Montant TTC", align: "right", cell: (s) => fcfa(s.tripTotal) },
            { header: "Commission", align: "right", cell: (s) => fcfa(s.commission) },
            { header: "À verser", align: "right", cell: (s) => <span className="font-semibold">{fcfa(s.amountDue)}</span> },
          ]}
        />
      </Card>
    </div>
  );
}
