"use client";

import Link from "next/link";
import { useState } from "react";
import { fcfa } from "@/lib/api";
import { adminDownload, formatTime, orderTitle, STATUS_LABEL, type AdminOrder, type AdminOrderStatus } from "@/lib/admin";
import { buttonGhost, Card, ErrorNote, input, Loading, StatusBadge } from "../ui";
import { useAction, useAdmin } from "../useAdmin";

const TABS: (AdminOrderStatus | "ALL")[] = ["ALL", "PENDING", "CONFIRMED", "PICKED_UP", "DELIVERED", "CANCELLED"];

export default function OrdersPage() {
  const [tab, setTab] = useState<AdminOrderStatus | "ALL">("ALL");
  const [filters, setFilters] = useState({ q: "", from: "", to: "", type: "", fulfillment: "" });
  const [search, setSearch] = useState("");

  const params = new URLSearchParams(Object.entries(filters).filter(([, v]) => v));
  const listParams = new URLSearchParams(params);
  if (tab !== "ALL") listParams.set("status", tab);

  const orders = useAdmin<AdminOrder[]>(`/orders?${listParams}`);
  const counts = useAdmin<Record<AdminOrderStatus | "ALL", number>>(`/orders/counts?${params}`);
  const { error, run } = useAction();

  const set = (key: keyof typeof filters) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setFilters((f) => ({ ...f, [key]: e.target.value }));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">Commandes</h1>
        <div className="flex gap-2">
          <button onClick={() => (orders.reload(), counts.reload())} className={buttonGhost}>
            Actualiser
          </button>
          <button onClick={() => run(() => adminDownload(`/orders?${listParams}&format=csv`, "commandes-zedeka.csv"))} className={buttonGhost}>
            Export CSV
          </button>
        </div>
      </div>

      <div className="-mx-4 flex gap-1 overflow-x-auto px-4 text-sm">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`whitespace-nowrap rounded-full px-3 py-1 ${tab === t ? "bg-stone-800 text-white" : "bg-white"}`}
          >
            {t === "ALL" ? "Toutes" : STATUS_LABEL[t]} <span className="opacity-70">{counts.data?.[t] ?? ""}</span>
          </button>
        ))}
      </div>

      <Card>
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
      </Card>

      <ErrorNote message={error ?? orders.error} />
      {!orders.data ? (
        <Loading />
      ) : orders.data.length === 0 ? (
        <p className="text-sm text-stone-500">Aucune commande.</p>
      ) : (
        <ul className="space-y-2">
          {orders.data.map((o) => (
            <li key={o.id}>
              <Link href={`/admin/commandes/${o.id}`} className="block rounded-xl bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold">
                      {o.code} · {orderTitle(o)}
                    </p>
                    <p className="text-sm text-stone-500">
                      {formatTime(o.createdAt)} · {o.customerName} · {o.zone.name.split(" – ")[0]}
                      {o.fulfillment === "PICKUP" && " · à emporter"}
                    </p>
                  </div>
                  <div className="text-right">
                    <StatusBadge status={o.status} />
                    <p className="mt-1 text-sm font-medium">{fcfa(o.total)}</p>
                    <p className={`text-xs ${o.paymentStatus === "PAID" ? "text-emerald-700" : "text-stone-500"}`}>
                      {o.paymentStatus === "PAID" ? "payée" : "non payée"}
                    </p>
                  </div>
                </div>
                <p className="mt-1 text-sm text-stone-600">{o.driver ? `Livreur : ${o.driver.name}` : o.fulfillment === "DELIVERY" ? "Sans livreur" : ""}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
