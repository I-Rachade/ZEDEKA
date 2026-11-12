"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import DataTable, { type Column } from "@/components/panel/DataTable";
import { Icon } from "@/components/panel/icons";
import { fcfa } from "@/lib/api";
import { adminDownload, adminFetch, formatTime, orderTitle, STATUS_LABEL, type AdminOrder, type AdminOrderStatus } from "@/lib/admin";
import type { T } from "@/lib/i18n";
import { useT } from "@/lib/i18n/client";
import { buttonGhost, Card, ErrorNote, input, Loading, PageHeader, StatusBadge, Tabs } from "../ui";
import { useAction, useAdmin } from "../useAdmin";
import { useLiveRefresh } from "@/lib/live";

// Taille d'une page de la liste (même valeur que l'API, routes/adminOrders.ts).
const ORDERS_PAGE = 50;

const TABS: (AdminOrderStatus | "ALL")[] = ["ALL", "PENDING", "CONFIRMED", "PREPARING", "READY", "PICKED_UP", "DELIVERED", "CANCELLED"];

const columns = (t: T): Column<AdminOrder>[] => [
  { header: "Commande", mobile: "title", cell: (o) => <span className="font-semibold">{o.code}</span> },
  { header: "Statut", mobile: "badge", cell: (o) => <StatusBadge status={o.status} /> },
  { header: "Date", cell: (o) => formatTime(o.createdAt) },
  { header: "Partenaire", cell: (o) => orderTitle(o, t) },
  { header: "Client", cell: (o) => `${o.customerName} · ${o.customerPhone}` },
  { header: "Zone", mobile: "hide", cell: (o) => o.zone.name.split(" – ")[0] },
  {
    header: "Livreur",
    cell: (o) => (o.driver ? o.driver.name : o.tableNumber != null ? t("Table {number}", { number: o.tableNumber }) : o.fulfillment === "PICKUP" ? t("À emporter") : <span className="text-amber-700">{t("Sans livreur")}</span>),
  },
  {
    header: "Total",
    align: "right",
    cell: (o) => (
      <>
        <span className="font-medium">{fcfa(o.total)}</span>
        <span className={`block text-xs ${o.paymentStatus === "PAID" ? "text-emerald-700" : "text-stone-500"}`}>{o.paymentStatus === "PAID" ? t("payée") : t("non payée")}</span>
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
  const t = useT();

  // La recherche de l'en-tête arrive par l'adresse (?q=…).
  useEffect(() => {
    setSearch(urlQ);
    setFilters((f) => ({ ...f, q: urlQ }));
  }, [urlQ]);

  const params = new URLSearchParams(Object.entries(filters).filter(([, v]) => v));
  const listParams = new URLSearchParams(params);
  if (tab !== "ALL") listParams.set("status", tab);

  const orders = useAdmin<AdminOrder[]>(`/orders?${listParams}`);
  // Pages suivantes (50 commandes chacune), ajoutées sous la première ; remises à zéro quand la liste change.
  const listKey = listParams.toString();
  const [more, setMore] = useState<{ key: string; rows: AdminOrder[]; full: boolean }>({ key: "", rows: [], full: true });
  const extra = more.key === listKey ? more : { key: listKey, rows: [], full: true };
  const rows = orders.data ? [...orders.data, ...extra.rows] : null;
  const canLoadMore = !!orders.data && (extra.rows.length ? extra.full : orders.data.length >= ORDERS_PAGE);
  const [loadingMore, setLoadingMore] = useState(false);
  useEffect(() => setMore({ key: "", rows: [], full: true }), [orders.data]);
  const loadMore = async () => {
    const last = rows?.[rows.length - 1];
    if (!last) return;
    setLoadingMore(true);
    const next = new URLSearchParams(listParams);
    next.set("before", last.createdAt);
    await run(async () => {
      const page = await adminFetch<AdminOrder[]>(`/orders?${next}`);
      setMore({ key: listKey, rows: [...extra.rows, ...page], full: page.length >= ORDERS_PAGE });
    });
    setLoadingMore(false);
  };
  const counts = useAdmin<Record<AdminOrderStatus | "ALL", number>>(`/orders/counts?${params}`);
  // Statuts et compteurs suivent les livreurs et les restaurants sans recharger la page. Pas pendant qu'on
  // parcourt les pages suivantes : une relecture les remettrait à zéro.
  useLiveRefresh(
    () => {
      void orders.reload();
      void counts.reload();
    },
    { every: 15_000, enabled: extra.rows.length === 0 },
  );
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
              {t("Actualiser")}
            </button>
            <button onClick={() => run(() => adminDownload(`/orders?${listParams}&format=csv`, "commandes-zedeka.csv"))} className={buttonGhost}>
              <Icon name="download" className="h-4 w-4" />
              {t("Export CSV")}
            </button>
          </>
        }
      />

      <Card>
        <Tabs
          tabs={TABS.map((s) => ({ value: s, label: s === "ALL" ? "Toutes" : STATUS_LABEL[s], count: counts.data?.[s] }))}
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
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("Code, nom ou téléphone")} className={`${input} sm:col-span-2`} />
          <input type="date" value={filters.from} onChange={set("from")} aria-label={t("Du")} className={input} />
          <input type="date" value={filters.to} onChange={set("to")} aria-label={t("Au")} className={input} />
          <button className="rounded-lg bg-night-soft px-3 py-2 text-sm text-white">{t("Rechercher")}</button>
          <select value={filters.type} onChange={set("type")} className={input}>
            <option value="">{t("Repas et colis")}</option>
            <option value="FOOD">{t("Repas")}</option>
            <option value="PARCEL">{t("Colis")}</option>
          </select>
          <select value={filters.fulfillment} onChange={set("fulfillment")} className={input}>
            <option value="">{t("Livraison et à emporter")}</option>
            <option value="DELIVERY">{t("Livraison")}</option>
            <option value="PICKUP">{t("À emporter")}</option>
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
              {t("Effacer les filtres")}
            </button>
          )}
        </form>

        <div className="mt-4">
          <ErrorNote message={error ?? orders.error} />
          {!rows ? <Loading /> : <DataTable columns={columns(t)} rows={rows} rowKey={(o) => o.id} rowHref={(o) => `/admin/commandes/${o.id}`} empty="Aucune commande." />}
          {canLoadMore && (
            <button type="button" onClick={loadMore} disabled={loadingMore} className={`${buttonGhost} mt-3 w-full`}>
              {loadingMore ? t("Chargement…") : t("Charger plus")}
            </button>
          )}
        </div>
      </Card>
    </div>
  );
}
