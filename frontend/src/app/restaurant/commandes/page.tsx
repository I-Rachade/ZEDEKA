"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import DataTable, { type Column } from "@/components/panel/DataTable";
import { Icon } from "@/components/panel/icons";
import { STATUS_LABEL, StatusPill, type OrderStatus } from "@/components/panel/status";
import { buttonGhost, Card, ErrorNote, input, Loading, PageHeader, Tabs } from "@/components/panel/ui";
import { fcfa, lineLabel } from "@/lib/api";
import { formatTime } from "@/lib/admin";
import type { RestaurantOrder } from "@/lib/restaurant";
import { useOnNewOrder } from "../useNewOrders";
import { useRestaurant } from "../useRestaurant";
import type { T } from "@/lib/i18n";
import { useT } from "@/lib/i18n/client";

type Tab = OrderStatus | "ALL";
const TABS: Tab[] = ["PENDING", "CONFIRMED", "PREPARING", "READY", "PICKED_UP", "DELIVERED", "CANCELLED", "ALL"];

const columns = (t: T): Column<RestaurantOrder>[] => [
  { header: "Commande", mobile: "title", cell: (o) => <span className="font-semibold">{o.code}</span> },
  { header: "Statut", mobile: "badge", cell: (o) => <StatusPill status={o.status} /> },
  { header: "Heure", cell: (o) => formatTime(o.createdAt) },
  { header: "Client", cell: (o) => o.customerName },
  {
    header: "Plats",
    cell: (o) => (
      <span className="line-clamp-2 max-w-xs">
        {o.items.map((i) => `${i.quantity}× ${lineLabel(i)}`).join(", ")}
      </span>
    ),
  },
  { header: "Mode", cell: (o) => (o.fulfillment === "PICKUP" ? t("À emporter") : t("Livraison")) },
  { header: "Montant", align: "right", cell: (o) => <span className="font-medium">{fcfa(o.subtotal)}</span> },
];

export default function RestaurantOrdersPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Orders />
    </Suspense>
  );
}

function Orders() {
  const params = useSearchParams();
  const urlQ = params.get("q") ?? "";
  const urlTab = params.get("statut") as Tab | null;
  const [tab, setTab] = useState<Tab>(urlTab && TABS.includes(urlTab) ? urlTab : urlQ ? "ALL" : "PENDING");
  const [q, setQ] = useState(urlQ);
  const [search, setSearch] = useState(urlQ);
  const tr = useT();

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
  const orders = useRestaurant<RestaurantOrder[]>(`/orders?${listParams}`);
  const counts = useRestaurant<Record<Tab, number>>(`/orders/counts?${filter}`);
  const { reload: reloadOrders } = orders;
  const { reload: reloadCounts } = counts;
  const refresh = useCallback(() => (reloadOrders(), reloadCounts()), [reloadOrders, reloadCounts]);
  useOnNewOrder(refresh);

  return (
    <div>
      <PageHeader
        icon="orders"
        title="Commandes"
        count={counts.data?.ALL}
        description="Acceptez les nouvelles commandes, suivez la préparation et signalez quand elles sont prêtes."
        actions={
          <>
            <button onClick={refresh} className={buttonGhost}>
              {tr("Actualiser")}
            </button>
            <button onClick={() => window.print()} className={buttonGhost}>
              <Icon name="print" className="h-4 w-4" />
              {tr("Imprimer la liste")}
            </button>
          </>
        }
      />
      <Card>
        <Tabs tabs={TABS.map((t) => ({ value: t, label: t === "ALL" ? "Toutes" : STATUS_LABEL[t], count: counts.data?.[t] }))} value={tab} onChange={setTab} />
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setQ(search.trim());
          }}
          className="flex gap-2 print:hidden"
        >
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={tr("Code, nom ou téléphone du client")} className={`${input} max-w-md`} />
          <button className={buttonGhost}>
            <Icon name="search" className="h-4 w-4" />
            {tr("Rechercher")}
          </button>
          {q && (
            <button type="button" onClick={() => (setQ(""), setSearch(""))} className="text-sm text-stone-500">
              {tr("Effacer")}
            </button>
          )}
        </form>
        <div className="mt-4">
          <ErrorNote message={orders.error} />
          {!orders.data ? (
            <Loading />
          ) : (
            <DataTable columns={columns(tr)} rows={orders.data} rowKey={(o) => o.id} rowHref={(o) => `/restaurant/commandes/${o.id}`} empty="Aucune commande ici." />
          )}
        </div>
      </Card>
    </div>
  );
}
