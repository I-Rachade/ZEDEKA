"use client";

import Link from "next/link";
import { useEffect } from "react";
import { fcfa } from "@/lib/api";
import { PushBanner, type PartnerClient } from "@/components/panel/partner";
import { adminFetch, formatTime, orderTitle, setToken, VEHICLE_LABEL, type AdminOrder, type Driver } from "@/lib/admin";
import { buttonGhost, Card, ErrorNote, input, Loading, PageHeader, StatusBadge } from "../ui";
import { useAction, useAdmin } from "../useAdmin";

type LateTrip = { id: string; code: string; total: number; createdAt: string; provider: { id: string; name: string; phone: string } };
type Assignment = { status: "SENT" | "ACCEPTED" | "REJECTED" | "EXPIRED" | "WITHDRAWN"; reason: string | null; createdAt: string; respondedAt: string | null; driver: { name: string } };
type DispatchOrder = AdminOrder & { assignments?: Assignment[] };
type Issue = { id: string; label: string; note: string | null; createdAt: string; latitude: number | null; longitude: number | null; driver: { name: string; phone: string }; order: { id: string; code: string } | null };
type Dispatch = { unanswered?: AdminOrder[]; lateTrips?: LateTrip[]; unassigned: DispatchOrder[]; ongoing: DispatchOrder[]; drivers: Driver[]; issues?: Issue[] };

function minutesSince(iso: string) {
  return Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
}

function ago(iso: string) {
  const m = minutesSince(iso);
  if (m < 1) return "à l'instant";
  if (m < 60) return `il y a ${m} min`;
  if (m < 24 * 60) return `il y a ${Math.floor(m / 60)} h`;
  return `il y a ${Math.floor(m / 1440)} j`;
}

const mapUrl = (lat: number, lng: number) => `https://www.google.com/maps?q=${lat},${lng}`;

// Réponse du livreur à la dernière affectation.
function AssignmentNote({ a }: { a?: Assignment }) {
  if (!a || a.status === "WITHDRAWN") return null;
  const tone = { SENT: "bg-amber-50 text-amber-900", ACCEPTED: "bg-emerald-50 text-emerald-800", REJECTED: "bg-red-50 text-red-800", EXPIRED: "bg-red-50 text-red-800" }[a.status];
  const text = {
    SENT: `Envoyée à ${a.driver.name}, en attente de réponse`,
    ACCEPTED: `Acceptée par ${a.driver.name}`,
    REJECTED: `Refusée par ${a.driver.name}${a.reason ? ` : ${a.reason}` : ""}`,
    EXPIRED: `${a.driver.name} n'a pas répondu en 60 s`,
  }[a.status];
  return <p className={`mt-2 rounded-md px-2 py-1 text-xs ${tone}`}>{text}</p>;
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

  const resolveIssue = (id: string) =>
    action.run(async () => {
      await adminFetch(`/dispatch/issues/${id}/resolve`, { method: "POST" });
      await reload();
    });

  const OrderCard = ({ o }: { o: DispatchOrder }) => (
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
      <AssignmentNote a={o.assignments?.[0]} />
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
      <PushBanner api={adminPush} what="commande sans réponse, course refusée ou problème signalé" />
      {(data.issues?.length ?? 0) > 0 && (
        <section className="rounded-xl border border-red-200 bg-red-50 p-4">
          <h2 className="mb-2 font-semibold text-red-800">Problèmes signalés par les livreurs</h2>
          <ul className="space-y-3 text-sm">
            {data.issues?.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-red-900">
                  <p className="font-medium">
                    {i.label} · {i.driver.name}
                    {i.order && (
                      <>
                        {" · "}
                        <Link href={`/admin/commandes/${i.order.id}`} className="underline">
                          {i.order.code}
                        </Link>
                      </>
                    )}
                  </p>
                  <p className="text-xs">
                    {ago(i.createdAt)}
                    {i.note ? ` · ${i.note}` : ""}
                    {i.latitude !== null && i.longitude !== null && (
                      <>
                        {" · "}
                        <a href={mapUrl(i.latitude, i.longitude)} target="_blank" rel="noreferrer" className="underline">
                          position
                        </a>
                      </>
                    )}
                  </p>
                </div>
                <div className="flex gap-2">
                  <a href={`tel:${i.driver.phone.replace(/ /g, "")}`} className={buttonGhost}>
                    Appeler
                  </a>
                  <button onClick={() => resolveIssue(i.id)} className={buttonGhost}>
                    Réglé
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
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
                    <p className="text-xs text-stone-500">
                      {d.lastSeenAt ? `Application vue ${ago(d.lastSeenAt)}` : "Application jamais ouverte"}
                      {d.lastLocationAt && d.lastLatitude != null && d.lastLongitude != null && (
                        <>
                          {" · "}
                          <a href={mapUrl(d.lastLatitude, d.lastLongitude)} target="_blank" rel="noreferrer" className="text-emerald-700 underline">
                            position {ago(d.lastLocationAt)}
                          </a>
                        </>
                      )}
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
