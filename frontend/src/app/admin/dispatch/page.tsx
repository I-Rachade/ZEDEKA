"use client";

import Link from "next/link";
import { useEffect } from "react";
import { fcfa } from "@/lib/api";
import { PushBanner, type PartnerClient } from "@/components/panel/partner";
import { adminFetch, formatTime, orderTitle, setToken, VEHICLE_LABEL, type AdminOrder, type Driver } from "@/lib/admin";
import type { T } from "@/lib/i18n";
import { useT } from "@/lib/i18n/client";
import { buttonGhost, Card, ErrorNote, input, Loading, PageHeader, StatusBadge } from "../ui";
import { useAction, useAdmin } from "../useAdmin";

type Assignment = { status: "SENT" | "ACCEPTED" | "REJECTED" | "EXPIRED" | "WITHDRAWN"; reason: string | null; createdAt: string; respondedAt: string | null; driver: { name: string } };
type DispatchOrder = AdminOrder & { assignments?: Assignment[] };
type Issue = { id: string; label: string; note: string | null; createdAt: string; latitude: number | null; longitude: number | null; driver: { name: string; phone: string }; order: { id: string; code: string } | null };
type Dispatch = { unanswered?: AdminOrder[]; unassigned: DispatchOrder[]; ongoing: DispatchOrder[]; drivers: Driver[]; issues?: Issue[] };

function minutesSince(iso: string) {
  return Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
}

function ago(iso: string, t: T) {
  const m = minutesSince(iso);
  if (m < 1) return t("à l'instant");
  if (m < 60) return t("il y a {n} min", { n: m });
  if (m < 24 * 60) return t("il y a {n} h", { n: Math.floor(m / 60) });
  return t("il y a {n} j", { n: Math.floor(m / 1440) });
}

const mapUrl = (lat: number, lng: number) => `https://www.google.com/maps?q=${lat},${lng}`;

// Réponse du livreur à la dernière affectation.
function AssignmentNote({ a }: { a?: Assignment }) {
  const t = useT();
  if (!a || a.status === "WITHDRAWN") return null;
  const tone = { SENT: "bg-amber-50 text-amber-900", ACCEPTED: "bg-emerald-50 text-emerald-800", REJECTED: "bg-red-50 text-red-800", EXPIRED: "bg-red-50 text-red-800" }[a.status];
  const name = a.driver.name;
  const text = {
    SENT: t("Envoyée à {name}, en attente de réponse", { name }),
    ACCEPTED: t("Acceptée par {name}", { name }),
    REJECTED: `${t("Refusée par {name}", { name })}${a.reason ? ` : ${t(a.reason)}` : ""}`,
    EXPIRED: t("{name} n'a pas répondu en 60 s", { name }),
  }[a.status];
  return <p className={`mt-2 rounded-md px-2 py-1 text-xs ${tone}`}>{text}</p>;
}

// Alertes de la répartition sur le navigateur de l'admin.
const adminPush: PartnerClient = { area: "admin", base: "/admin", apiFetch: adminFetch, saveSession: () => {}, logout: () => setToken(null) };

export default function DispatchPage() {
  const { data, error, reload } = useAdmin<Dispatch>("/dispatch");
  const action = useAction();
  const t = useT();

  // Rafraîchissement automatique toutes les 30 secondes.
  useEffect(() => {
    const timer = setInterval(reload, 30_000);
    return () => clearInterval(timer);
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
          {o.code} · {orderTitle(o, t)}
        </Link>
        <StatusBadge status={o.status} />
      </div>
      <p className="text-sm text-stone-600">
        {o.type === "PARCEL" && o.pickupAddress ? `${o.pickupAddress} → ` : ""}
        {o.address}
      </p>
      <p className="text-xs text-stone-500">
        {formatTime(o.createdAt)} · {t("il y a {n} min", { n: minutesSince(o.createdAt) })} · {fcfa(o.total)}
        {o.paymentMethod === "CASH" && ` ${t("à encaisser")}`}
      </p>
      <AssignmentNote a={o.assignments?.[0]} />
      <select
        aria-label={t("Livreur pour {code}", { code: o.code })}
        value={o.driver?.id ?? ""}
        onChange={(e) => patchOrder(o.id, { driverId: e.target.value || null })}
        className={`${input} mt-2`}
      >
        <option value="">{o.driver ? t("Retirer le livreur") : t("Affecter à…")}</option>
        {data.drivers.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name} · {d.online ? t("en ligne") : t("hors ligne")} · {t("{n} en cours", { n: d.activeOrders ?? 0 })}
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
            {t("Actualiser")}
          </button>
        }
      />
      <ErrorNote message={action.error} />
      <PushBanner api={adminPush} what="commande sans réponse, course refusée ou problème signalé" />
      {(data.issues?.length ?? 0) > 0 && (
        <section className="rounded-xl border border-red-200 bg-red-50 p-4">
          <h2 className="mb-2 font-semibold text-red-800">{t("Problèmes signalés par les livreurs")}</h2>
          <ul className="space-y-3 text-sm">
            {data.issues?.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-red-900">
                  <p className="font-medium">
                    {t(i.label)} · {i.driver.name}
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
                    {ago(i.createdAt, t)}
                    {i.note ? ` · ${i.note}` : ""}
                    {i.latitude !== null && i.longitude !== null && (
                      <>
                        {" · "}
                        <a href={mapUrl(i.latitude, i.longitude)} target="_blank" rel="noreferrer" className="underline">
                          {t("position")}
                        </a>
                      </>
                    )}
                  </p>
                </div>
                <div className="flex gap-2">
                  <a href={`tel:${i.driver.phone.replace(/ /g, "")}`} className={buttonGhost}>
                    {t("Appeler")}
                  </a>
                  <button onClick={() => resolveIssue(i.id)} className={buttonGhost}>
                    {t("Réglé")}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      {(data.unanswered?.length ?? 0) > 0 && (
        <section className="rounded-xl border border-red-200 bg-red-50 p-4">
          <h2 className="mb-2 font-semibold text-red-800">{t("Sans réponse du partenaire")}</h2>
          <ul className="space-y-2 text-sm">
            {data.unanswered?.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center justify-between gap-2">
                <Link href={`/admin/commandes/${o.id}`} className="font-medium text-red-900">
                  {o.code} · {o.restaurant?.name} · {t("il y a {n} min", { n: minutesSince(o.createdAt) })} · {fcfa(o.total)}
                </Link>
                {o.restaurant?.phone && (
                  <a href={`tel:${o.restaurant.phone.replace(/ /g, "")}`} className={buttonGhost}>
                    {t("Appeler le restaurant")}
                  </a>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title={`${t("À affecter")} (${data.unassigned.length})`}>
          {data.unassigned.length === 0 ? (
            <p className="text-sm text-stone-500">{t("Rien en attente.")}</p>
          ) : (
            <ul className="space-y-2">{data.unassigned.map((o) => <OrderCard key={o.id} o={o} />)}</ul>
          )}
        </Card>
        <Card title={`${t("En cours")} (${data.ongoing.length})`}>
          {data.ongoing.length === 0 ? (
            <p className="text-sm text-stone-500">{t("Aucune course en cours.")}</p>
          ) : (
            <ul className="space-y-2">{data.ongoing.map((o) => <OrderCard key={o.id} o={o} />)}</ul>
          )}
        </Card>
        <Card title="Livreurs">
          {data.drivers.length === 0 ? (
            <p className="text-sm text-stone-500">
              {t("Aucun livreur validé.")} <Link href="/admin/livreurs" className="text-emerald-700 underline">{t("Gérer les livreurs")}</Link>
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
                      {t(VEHICLE_LABEL[d.vehicle])}
                      {d.zone ? ` · ${d.zone.name.split(" – ")[0]}` : ""} · {t("{n} en cours", { n: d.activeOrders ?? 0 })}
                    </p>
                    <p className="text-xs text-stone-500">
                      {d.lastSeenAt ? t("Application vue {ago}", { ago: ago(d.lastSeenAt, t) }) : t("Application jamais ouverte")}
                      {d.lastLocationAt && d.lastLatitude != null && d.lastLongitude != null && (
                        <>
                          {" · "}
                          <a href={mapUrl(d.lastLatitude, d.lastLongitude)} target="_blank" rel="noreferrer" className="text-emerald-700 underline">
                            {t("position {ago}", { ago: ago(d.lastLocationAt, t) })}
                          </a>
                        </>
                      )}
                    </p>
                  </div>
                  <button onClick={() => toggleOnline(d)} className={buttonGhost}>
                    {d.online ? t("Hors ligne") : t("En ligne")}
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
