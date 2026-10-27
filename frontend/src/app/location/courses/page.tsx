"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import DataTable, { type Column } from "@/components/panel/DataTable";
import { Icon } from "@/components/panel/icons";
import { buttonGhost, Card, ErrorNote, input, Loading, PageHeader, Tabs } from "@/components/panel/ui";
import { fcfa } from "@/lib/api";
import { formatTime } from "@/lib/admin";
import { driverName, PRICING_LABEL, PRICING_UNIT, rental, TRIP_LABEL, TripPill, type Trip, type TripStatus } from "@/lib/rental";

type Tab = TripStatus | "ALL" | "SCHEDULED";
const TABS: Tab[] = ["ALL", "SCHEDULED", "PENDING", "CONFIRMED", "ONGOING", "COMPLETED", "CANCELLED", "PAYMENT_FAILED"];
const TAB_LABEL = (t: Tab) => (t === "ALL" ? "Toutes" : t === "SCHEDULED" ? "Planifiées" : TRIP_LABEL[t]);

const COLUMNS: Column<Trip>[] = [
  { header: "Course", mobile: "title", cell: (t) => <span className="font-semibold">{t.code}</span> },
  { header: "Statut", mobile: "badge", cell: (t) => <TripPill status={t.status} /> },
  {
    header: "Horaire",
    cell: (t) => (
      <>
        <span className="block">{t.scheduledAt ? `Départ ${formatTime(t.scheduledAt)}` : "Départ immédiat"}</span>
        <span className="block text-xs text-stone-500">Réservée le {formatTime(t.createdAt)}</span>
      </>
    ),
  },
  { header: "Client", cell: (t) => `${t.customerName} · ${t.customerPhone}` },
  {
    header: "Chauffeur et véhicules",
    cell: (t) => (
      <>
        <span className="block">{t.vehicles.map((v) => `${v.quantity}× ${v.name}${v.unit ? ` (${v.unit.plateNumber})` : ""}`).join(", ")}</span>
        <span className="block text-xs text-stone-500">{t.driver ? driverName(t.driver) : "Sans chauffeur"}</span>
      </>
    ),
  },
  { header: "Type", cell: (t) => `${PRICING_LABEL[t.pricing]} · ${t.duration} ${PRICING_UNIT[t.pricing]}` },
  {
    header: "Montant",
    align: "right",
    cell: (t) => (
      <>
        <span className="font-medium">{fcfa(t.total)}</span>
        <span className={`block text-xs ${t.paymentStatus === "PAID" ? "text-emerald-700" : "text-stone-500"}`}>{t.paymentStatus === "PAID" ? "payée" : "non payée"}</span>
      </>
    ),
  },
];

export default function TripsPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Trips />
    </Suspense>
  );
}

function Trips() {
  const params = useSearchParams();
  const urlQ = params.get("q") ?? "";
  const urlTab = params.get("statut") as Tab | null;
  const [tab, setTab] = useState<Tab>(urlTab && TABS.includes(urlTab) ? urlTab : "ALL");
  const [q, setQ] = useState(urlQ);
  const [search, setSearch] = useState(urlQ);

  useEffect(() => {
    setQ(urlQ);
    setSearch(urlQ);
    if (urlQ) setTab("ALL");
  }, [urlQ]);
  useEffect(() => {
    if (urlTab && TABS.includes(urlTab)) setTab(urlTab);
  }, [urlTab]);

  const filter = new URLSearchParams(q ? { q } : {});
  const listParams = new URLSearchParams(filter);
  if (tab !== "ALL") listParams.set("status", tab);
  const trips = rental.useResource<Trip[]>(`/trips?${listParams}`);
  const counts = rental.useResource<Record<Tab, number>>(`/trips/counts?${filter}`);
  const { reload: reloadTrips } = trips;
  const { reload: reloadCounts } = counts;
  const refresh = useCallback(() => (reloadTrips(), reloadCounts()), [reloadTrips, reloadCounts]);
  useEffect(() => {
    window.addEventListener("zedeka:new-trip", refresh);
    return () => window.removeEventListener("zedeka:new-trip", refresh);
  }, [refresh]);

  return (
    <div>
      <PageHeader
        icon="orders"
        title="Courses"
        count={counts.data?.ALL}
        description="Réservations reçues, à confirmer, en cours et terminées."
        actions={
          <>
            <button onClick={refresh} className={buttonGhost}>
              Actualiser
            </button>
            <button onClick={() => window.print()} className={buttonGhost}>
              <Icon name="print" className="h-4 w-4" />
              Imprimer
            </button>
          </>
        }
      />
      <Card>
        <Tabs tabs={TABS.map((t) => ({ value: t, label: TAB_LABEL(t), count: counts.data?.[t] }))} value={tab} onChange={setTab} />
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setQ(search.trim());
          }}
          className="flex gap-2 print:hidden"
        >
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Code, nom ou téléphone du client" className={`${input} max-w-md`} />
          <button className={buttonGhost}>
            <Icon name="search" className="h-4 w-4" />
            Rechercher
          </button>
          {q && (
            <button type="button" onClick={() => (setQ(""), setSearch(""))} className="text-sm text-stone-500">
              Effacer
            </button>
          )}
        </form>
        <div className="mt-4">
          <ErrorNote message={trips.error} />
          {!trips.data ? <Loading /> : <DataTable columns={COLUMNS} rows={trips.data} rowKey={(t) => t.id} rowHref={(t) => `/location/courses/${t.id}`} empty="Aucune course ici." />}
        </div>
      </Card>
    </div>
  );
}
