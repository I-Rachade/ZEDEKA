"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import DataTable, { type Column } from "@/components/panel/DataTable";
import { Icon } from "@/components/panel/icons";
import { fcfa } from "@/lib/api";
import { adminDownload, formatTime, orderTitle, STATUS_LABEL, type AdminOrder, type AdminOrderStatus } from "@/lib/admin";
import { buttonGhost, Card, ErrorNote, input, Loading, PageHeader, StatusBadge, Tabs } from "../ui";
import { useAction, useAdmin } from "../useAdmin";

const TABS: (AdminOrderStatus | "ALL")[] = ["ALL", "PENDING", "CONFIRMED", "PREPARING", "READY", "PICKED_UP", "DELIVERED", "CANCELLED"];

const COLUMNS: Column<AdminOrder>[] = [
  { header: "Commande", mobile: "title", cell: (o) => <span className="font-semibold">{o.code}</span> },
  { header: "Statut", mobile: "badge", cell: (o) => <StatusBadge status={o.status} /> },
  { header: "Date", cell: (o) => formatTime(o.createdAt) },
  { header: "Partenaire", cell: (o) => orderTitle(o) },
  { header: "Client", cell: (o) => `${o.customerName} · ${o.customerPhone}` },
  { header: "Zone", mobile: "hide", cell: (o) => o.zone.name.split(" – ")[0] },
  {
    header: "Livreur",
    cell: (o) => (o.driver ? o.driver.name : o.fulfillment === "PICKUP" ? "À emporter" : <span className="text-amber-700">Sans livreur</span>),
  },
  {
    header: "Total",
    align: "right",
    cell: (o) => (
      <>
        <span className="font-medium">{fcfa(o.total)}</span>
        <span className={`block text-xs ${o.paymentStatus === "PAID" ? "text-emerald-700" : "text-stone-500"}`}>{o.paymentStatus === "PAID" ? "payée" : "non payée"}</span>
      </>
    ),
  },
];

export default function OrdersPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Orders />
    </Suspense>
  );
}

function Orders() {
  const urlQ = useSearchParams().get("q") ?? "";
  const [tab, setTab] = useState<AdminOrderStatus | "ALL">("ALL");
  const [filters, setFilters] = useState({ q: urlQ, from: "", to: "", type: "", fulfillment: "" });
  const [search, setSearch] = useState(urlQ);

  // La recherche de l'en-tête arrive par l'adresse (?q=…).
  useEffect(() => {
    setSearch(urlQ);
    setFilters((f) => ({ ...f, q: urlQ }));
  }, [urlQ]);

  const params = new URLSearchParams(Object.entries(filters).filter(([, v]) => v));
  const listParams = new URLSearchParams(params);
  if (tab !== "ALL") listParams.set("status", tab);

  const orders = useAdmin<AdminOrder[]>(`/orders?${listParams}`);
  const counts = useAdmin<Record<AdminOrderStatus | "ALL", number>>(`/orders/counts?${params}`);
  const { error, run } = useAction();

  const set = (key: keyof typeof filters) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setFilters((f) => ({ ...f, [key]: e.target.value }));

  return (
    <div>
      <PageHeader
        icon="orders"
        title="Commandes"
        count={counts.data?.ALL}
        description="Toutes les commandes repas et colis, avec leur statut, leur paiement et leur livreur."
        actions={
          <>
            <button onClick={() => (orders.reload(), counts.reload())} className={buttonGhost}>
              Actualiser
            </button>
            <button onClick={() => run(() => adminDownload(`/orders?${listParams}&format=csv`, "commandes-zedeka.csv"))} className={buttonGhost}>
              <Icon name="download" className="h-4 w-4" />
              Export CSV
            </button>
          </>
        }
      />

      <Card>
        <Tabs
          tabs={TABS.map((t) => ({ value: t, label: t === "ALL" ? "Toutes" : STATUS_LABEL[t], count: counts.data?.[t] }))}
          value={tab}
          onChange={setTab}
        />
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setFilters((f) => ({ ...f, q: search }));
          }}
          className="grid gap-2 sm:grid-cols-5"
        >
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Code, nom ou téléphone" className={`${input} sm:col-span-2`} />
          <input type="date" value={filters.from} onChange={set("from")} aria-label="Du" className={input} />
          <input type="date" value={filters.to} onChange={set("to")} aria-label="Au" className={input} />
          <button className="rounded-lg bg-stone-800 px-3 py-2 text-sm text-white">Rechercher</button>
          <select value={filters.type} onChange={set("type")} className={input}>
            <option value="">Repas et colis</option>
            <option value="FOOD">Repas</option>
            <option value="PARCEL">Colis</option>
          </select>
          <select value={filters.fulfillment} onChange={set("fulfillment")} className={input}>
            <option value="">Livraison et à emporter</option>
            <option value="DELIVERY">Livraison</option>
            <option value="PICKUP">À emporter</option>
          </select>
          {(filters.q || filters.from || filters.to || filters.type || filters.fulfillment) && (
            <button
              type="button"
              onClick={() => {
                setSearch("");
                setFilters({ q: "", from: "", to: "", type: "", fulfillment: "" });
              }}
              className="text-left text-sm text-stone-500"
            >
              Effacer les filtres
            </button>
          )}
        </form>

        <div className="mt-4">
          <ErrorNote message={error ?? orders.error} />
          {!orders.data ? <Loading /> : <DataTable columns={COLUMNS} rows={orders.data} rowKey={(o) => o.id} rowHref={(o) => `/admin/commandes/${o.id}`} empty="Aucune commande." />}
        </div>
      </Card>
    </div>
  );
}
