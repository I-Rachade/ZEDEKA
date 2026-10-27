"use client";

import Link from "next/link";
import { fcfa } from "@/lib/api";
import { STATUS_LABEL, type AdminOrderStatus } from "@/lib/admin";
import { Card, ErrorNote, Loading, PageHeader, StatusBadge } from "./ui";
import { useAdmin } from "./useAdmin";

type Dashboard = {
  today: { orders: number; parcels: number; revenue: number; orderValue: number; breakEven: number };
  pendingDrivers: number;
  byStatus: Record<AdminOrderStatus, number>;
  recent: {
    id: string;
    code: string;
    type: "FOOD" | "PARCEL";
    status: AdminOrderStatus;
    total: number;
    createdAt: string;
    restaurant: { name: string } | null;
    driver: { name: string } | null;
  }[];
};

export default function DashboardPage() {
  const { data, error } = useAdmin<Dashboard>("/dashboard");
  if (error) return <ErrorNote message={error} />;
  if (!data) return <Loading />;

  const { today } = data;
  const progress = Math.min(100, Math.round((today.revenue / today.breakEven) * 100));

  return (
    <div className="space-y-4">
      <PageHeader icon="home" title="Aujourd'hui" description="Courses et revenu Zedeka du jour, face au seuil de rentabilité de 13 500 FCFA." />
      {data.pendingDrivers > 0 && (
        <Link href="/admin/livreurs" className="block rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
          {data.pendingDrivers} candidature(s) de livreur à examiner
        </Link>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Card>
          <p className="text-sm text-stone-600">Courses</p>
          <p className="text-2xl font-bold">{today.orders}</p>
          <p className="text-xs text-stone-500">dont {today.parcels} colis</p>
        </Card>
        <Card>
          <p className="text-sm text-stone-600">Revenu Zedeka</p>
          <p className="text-2xl font-bold">{fcfa(today.revenue)}</p>
        </Card>
      </div>
      <Card title="Seuil de rentabilité du jour">
        <div className="h-3 overflow-hidden rounded-full bg-stone-100">
          <div
            className={`h-full ${progress >= 100 ? "bg-emerald-600" : "bg-amber-500"}`}
            style={{ width: `${progress}%` }}
          />
        </div>
        <p className="mt-2 text-sm text-stone-600">
          {fcfa(today.revenue)} sur {fcfa(today.breakEven)} ({progress} %). Valeur des commandes :{" "}
          {fcfa(today.orderValue)}.
        </p>
      </Card>
      <Card title="Commandes du jour par statut">
        <ul className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-5">
          {(Object.keys(STATUS_LABEL) as AdminOrderStatus[]).map((s) => (
            <li key={s} className="rounded-lg bg-stone-50 p-2">
              <p className="text-stone-600">{STATUS_LABEL[s]}</p>
              <p className="text-lg font-semibold">{data.byStatus[s]}</p>
            </li>
          ))}
        </ul>
      </Card>
      <Card title="Dernières commandes" action={<Link href="/admin/commandes" className="text-sm text-emerald-700">Tout voir</Link>}>
        {data.recent.length === 0 ? (
          <p className="text-sm text-stone-500">Aucune commande pour l&apos;instant.</p>
        ) : (
          <ul className="divide-y divide-stone-100 text-sm">
            {data.recent.map((o) => (
              <li key={o.id} className="flex items-center justify-between gap-2 py-2">
                <div>
                  <p className="font-medium">
                    {o.code} · {o.type === "PARCEL" ? "Colis" : o.restaurant?.name}
                  </p>
                  <p className="text-stone-500">
                    {new Date(o.createdAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })} ·{" "}
                    {o.driver?.name ?? "sans livreur"}
                  </p>
                </div>
                <div className="text-right">
                  <StatusBadge status={o.status} />
                  <p className="mt-1">{fcfa(o.total)}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
