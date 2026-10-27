"use client";

import Link from "next/link";
import { Card, ErrorNote, Loading, PageHeader, StatTile } from "@/components/panel/ui";
import { StatusPill } from "@/components/panel/status";
import DataTable from "@/components/panel/DataTable";
import { fcfa } from "@/lib/api";
import { formatTime } from "@/lib/admin";
import type { Me, RestaurantOrder } from "@/lib/restaurant";
import { useCallback } from "react";
import { useOnNewOrder } from "./useNewOrders";
import { useRestaurant } from "./useRestaurant";

type Dashboard = {
  byStatus: Record<string, number>;
  today: { orders: number; sales: number; net: number };
  week: { orders: number; sales: number; net: number };
};

export default function RestaurantDashboard() {
  const me = useRestaurant<Me>("/me");
  const stats = useRestaurant<Dashboard>("/dashboard");
  const open = useRestaurant<RestaurantOrder[]>("/orders?status=PENDING");
  const { reload: reloadStats } = stats;
  const { reload: reloadOpen } = open;
  useOnNewOrder(useCallback(() => (reloadStats(), reloadOpen()), [reloadStats, reloadOpen]));

  if (stats.error || me.error) return <ErrorNote message={stats.error ?? me.error} />;
  if (!stats.data || !me.data) return <Loading />;
  const s = stats.data.byStatus;

  return (
    <div className="space-y-4">
      <PageHeader icon="home" title={me.data.name} description="Vos commandes du jour, en cours et vos ventes de la semaine." />

      <div className={`flex flex-wrap items-center justify-between gap-2 rounded-xl p-3 text-sm ${me.data.availability.open ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-900"}`}>
        <span>{me.data.availability.open ? "Ouvert : les clients peuvent commander." : `Fermé : ${me.data.availability.reason}`}</span>
        <Link href="/restaurant/reglages" className="font-medium underline">
          Horaires et réglages
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Nouvelles" value={s.PENDING} hint="à accepter" icon="bell" href="/restaurant/commandes?statut=PENDING" />
        <StatTile label="En cuisine" value={s.CONFIRMED + s.PREPARING} hint="acceptées ou en préparation" icon="fire" href="/restaurant/commandes?statut=PREPARING" />
        <StatTile label="Prêtes" value={s.READY} hint="attendent le livreur" icon="bag" href="/restaurant/commandes?statut=READY" />
        <StatTile label="Livrées aujourd'hui" value={s.DELIVERED} hint={`${s.CANCELLED} annulée(s)`} icon="check" />
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <Card title="Aujourd'hui" icon="receipt">
          <p className="text-2xl font-bold">{fcfa(stats.data.today.sales)}</p>
          <p className="text-sm text-stone-600">
            {stats.data.today.orders} commande(s) · {fcfa(stats.data.today.net)} pour vous après commission
          </p>
        </Card>
        <Card title="7 derniers jours" icon="chart">
          <p className="text-2xl font-bold">{fcfa(stats.data.week.sales)}</p>
          <p className="text-sm text-stone-600">
            {stats.data.week.orders} commande(s) · {fcfa(stats.data.week.net)} pour vous après commission
          </p>
        </Card>
      </div>

      <Card title="Nouvelles commandes" icon="bell" action={<Link href="/restaurant/commandes" className="text-sm text-emerald-700">Tout voir</Link>}>
        {!open.data ? (
          <Loading />
        ) : (
          <DataTable
            rows={open.data}
            rowKey={(o) => o.id}
            rowHref={(o) => `/restaurant/commandes/${o.id}`}
            empty="Aucune commande en attente."
            columns={[
              { header: "Commande", mobile: "title", cell: (o) => <span className="font-semibold">{o.code}</span> },
              { header: "Statut", mobile: "badge", cell: (o) => <StatusPill status={o.status} /> },
              { header: "Heure", cell: (o) => formatTime(o.createdAt) },
              { header: "Client", cell: (o) => o.customerName },
              { header: "Plats", cell: (o) => o.items.reduce((n, i) => n + i.quantity, 0) },
              { header: "Montant", align: "right", cell: (o) => fcfa(o.subtotal) },
            ]}
          />
        )}
      </Card>
    </div>
  );
}
