"use client";

import Link from "next/link";
import { useEffect } from "react";
import { fcfa } from "@/lib/api";
import { PushBanner, type PartnerClient } from "@/components/panel/partner";
import { adminFetch, formatTime, orderTitle, setToken, VEHICLE_LABEL, type AdminOrder, type Driver } from "@/lib/admin";
import { buttonGhost, Card, ErrorNote, input, Loading, PageHeader, StatusBadge } from "../ui";
import { useAction, useAdmin } from "../useAdmin";

type LateTrip = { id: string; code: string; total: number; createdAt: string; provider: { id: string; name: string; phone: string } };
type Dispatch = { unanswered?: AdminOrder[]; lateTrips?: LateTrip[]; unassigned: AdminOrder[]; ongoing: AdminOrder[]; drivers: Driver[] };

function minutesSince(iso: string) {
  return Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
}

// Alertes de la répartition sur le navigateur de l'admin.
const adminPush: PartnerClient = { area: "admin", base: "/admin", apiFetch: adminFetch, saveSession: () => {}, logout: () => setToken(null) };

export default function DispatchPage() {
  const { data, error, reload } = useAdmin<Dispatch>("/dispatch");
  const action = useAction();

  // Rafraîchissement automatique toutes les 30 secondes.
  useEffect(() => {
    const t = setInterval(reload, 30_000);
    return () => clearInterval(t);
  }, [reload]);

  const patchOrder = (id: string, body: Record<string, unknown>) =>
    action.run(async () => {
      await adminFetch(`/orders/${id}`, { method: "PATCH", body });
      await reload();
    });
  const toggleOnline = (d: Driver) =>
    action.run(async () => {
      await adminFetch(`/drivers/${d.id}`, { method: "PATCH", body: { online: !d.online } });
      await reload();
    });

  if (error) return <ErrorNote message={error} />;
  if (!data) return <Loading />;

  const OrderCard = ({ o }: { o: AdminOrder }) => (
    <li className="rounded-lg border border-stone-100 p-3">
      <div className="flex items-start justify-between gap-2">
        <Link href={`/admin/commandes/${o.id}`} className="font-medium">
          {o.code} · {orderTitle(o)}
        </Link>
        <StatusBadge status={o.status} />
      </div>
      <p className="text-sm text-stone-600">
        {o.type === "PARCEL" && o.pickupAddress ? `${o.pickupAddress} → ` : ""}
        {o.address}
      </p>
      <p className="text-xs text-stone-500">
        {formatTime(o.createdAt)} · il y a {minutesSince(o.createdAt)} min · {fcfa(o.total)}
        {o.paymentMethod === "CASH" && " à encaisser"}
      </p>
      <select
        aria-label={`Livreur pour ${o.code}`}
        value={o.driver?.id ?? ""}
        onChange={(e) => patchOrder(o.id, { driverId: e.target.value || null })}
        className={`${input} mt-2`}
      >
        <option value="">{o.driver ? "Retirer le livreur" : "Affecter à…"}</option>
        {data.drivers.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name} · {d.online ? "en ligne" : "hors ligne"} · {d.activeOrders ?? 0} en cours
          </option>
        ))}
      </select>
    </li>
  );

  return (
    <div className="space-y-4">
      <PageHeader
        icon="dispatch"
        title="Répartition"
        description="Commandes prêtes à partir et colis à affecter, livraisons en cours et livreurs en ligne."
        actions={
          <button onClick={reload} className={buttonGhost}>
            Actualiser
          </button>
        }
      />
      <ErrorNote message={action.error} />
      <PushBanner api={adminPush} what="commande sans réponse ou colis à affecter" />
      {(data.unanswered?.length ?? 0) + (data.lateTrips?.length ?? 0) > 0 && (
        <section className="rounded-xl border border-red-200 bg-red-50 p-4">
          <h2 className="mb-2 font-semibold text-red-800">Sans réponse du partenaire</h2>
          <ul className="space-y-2 text-sm">
            {data.unanswered?.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center justify-between gap-2">
                <Link href={`/admin/commandes/${o.id}`} className="font-medium text-red-900">
                  {o.code} · {o.restaurant?.name} · il y a {minutesSince(o.createdAt)} min · {fcfa(o.total)}
                </Link>
                {o.restaurant?.phone && (
                  <a href={`tel:${o.restaurant.phone.replace(/ /g, "")}`} className={buttonGhost}>
                    Appeler le restaurant
                  </a>
                )}
              </li>
            ))}
            {data.lateTrips?.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-2">
                <Link href={`/admin/location/${t.provider.id}`} className="font-medium text-red-900">
                  {t.code} · {t.provider.name} · il y a {minutesSince(t.createdAt)} min · {fcfa(t.total)}
                </Link>
                <a href={`tel:${t.provider.phone.replace(/ /g, "")}`} className={buttonGhost}>
                  Appeler le loueur
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title={`À affecter (${data.unassigned.length})`}>
          {data.unassigned.length === 0 ? (
            <p className="text-sm text-stone-500">Rien en attente.</p>
          ) : (
            <ul className="space-y-2">{data.unassigned.map((o) => <OrderCard key={o.id} o={o} />)}</ul>
          )}
        </Card>
        <Card title={`En cours (${data.ongoing.length})`}>
          {data.ongoing.length === 0 ? (
            <p className="text-sm text-stone-500">Aucune course en cours.</p>
          ) : (
            <ul className="space-y-2">{data.ongoing.map((o) => <OrderCard key={o.id} o={o} />)}</ul>
          )}
        </Card>
        <Card title="Livreurs">
          {data.drivers.length === 0 ? (
            <p className="text-sm text-stone-500">
              Aucun livreur validé. <Link href="/admin/livreurs" className="text-emerald-700 underline">Gérer les livreurs</Link>
            </p>
          ) : (
            <ul className="divide-y divide-stone-100">
              {data.drivers.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <div>
                    <p className="font-medium">
                      <span className={`mr-1 inline-block h-2 w-2 rounded-full ${d.online ? "bg-emerald-500" : "bg-stone-300"}`} />
                      {d.name}
                    </p>
                    <p className="text-stone-500">
                      {VEHICLE_LABEL[d.vehicle]}
                      {d.zone ? ` · ${d.zone.name.split(" – ")[0]}` : ""} · {d.activeOrders ?? 0} en cours
                    </p>
                  </div>
                  <button onClick={() => toggleOnline(d)} className={buttonGhost}>
                    {d.online ? "Hors ligne" : "En ligne"}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
