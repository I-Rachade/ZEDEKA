"use client";

import { useState } from "react";
import { fcfa } from "@/lib/api";
import { adminFetch, STATUS_LABEL, type AdminOrderStatus, type Driver } from "@/lib/admin";
import { Card, ErrorNote, input, Loading, StatusBadge } from "../ui";
import { useAction, useAdmin } from "../useAdmin";

type AdminOrder = {
  id: string;
  code: string;
  status: AdminOrderStatus;
  customerName: string;
  customerPhone: string;
  address: string;
  note: string | null;
  paymentMethod: "CASH" | "MOBILE_MONEY";
  subtotal: number;
  deliveryFee: number;
  total: number;
  createdAt: string;
  restaurant: { name: string; phone: string };
  zone: { name: string };
  driver: { id: string; name: string } | null;
  items: { name: string; quantity: number; unitPrice: number }[];
};

// Étape suivante proposée pour chaque statut.
const NEXT: Partial<Record<AdminOrderStatus, AdminOrderStatus>> = {
  PENDING: "CONFIRMED",
  CONFIRMED: "PICKED_UP",
  PICKED_UP: "DELIVERED",
};

const FILTERS: (AdminOrderStatus | "")[] = ["", "PENDING", "CONFIRMED", "PICKED_UP", "DELIVERED", "CANCELLED"];

export default function OrdersPage() {
  const [filter, setFilter] = useState<AdminOrderStatus | "">("");
  const orders = useAdmin<AdminOrder[]>(`/orders${filter ? `?status=${filter}` : ""}`);
  const drivers = useAdmin<Driver[]>("/drivers");
  const { error, run } = useAction();

  const update = (id: string, body: { status?: AdminOrderStatus; driverId?: string | null }) =>
    run(async () => {
      await adminFetch(`/orders/${id}`, { method: "PATCH", body });
      await orders.reload();
    });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">Commandes</h1>
        <button onClick={() => orders.reload()} className="text-sm text-emerald-700">
          Actualiser
        </button>
      </div>
      <div className="flex flex-wrap gap-1 text-sm">
        {FILTERS.map((f) => (
          <button
            key={f || "all"}
            onClick={() => setFilter(f)}
            className={`rounded-full px-3 py-1 ${filter === f ? "bg-stone-800 text-white" : "bg-white"}`}
          >
            {f ? STATUS_LABEL[f] : "Toutes"}
          </button>
        ))}
      </div>
      <ErrorNote message={error ?? orders.error} />
      {!orders.data ? (
        <Loading />
      ) : orders.data.length === 0 ? (
        <p className="text-sm text-stone-500">Aucune commande.</p>
      ) : (
        orders.data.map((o) => {
          const next = NEXT[o.status];
          return (
            <Card key={o.id}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold">
                    {o.code} · {o.restaurant.name}
                  </p>
                  <p className="text-sm text-stone-500">
                    {new Date(o.createdAt).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}
                  </p>
                </div>
                <StatusBadge status={o.status} />
              </div>
              <ul className="mt-2 text-sm">
                {o.items.map((i) => (
                  <li key={i.name}>
                    {i.quantity} × {i.name}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-sm">
                <strong>{fcfa(o.total)}</strong> ({o.paymentMethod === "CASH" ? "espèces" : "mobile money"}) · livraison{" "}
                {fcfa(o.deliveryFee)}, {o.zone.name}
              </p>
              <p className="text-sm text-stone-700">
                {o.customerName},{" "}
                <a href={`tel:${o.customerPhone.replace(/ /g, "")}`} className="text-emerald-700">
                  {o.customerPhone}
                </a>{" "}
                · {o.address}
              </p>
              {o.note && <p className="text-sm italic text-stone-600">Note : {o.note}</p>}
              {o.status !== "DELIVERED" && o.status !== "CANCELLED" && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <select
                    aria-label="Livreur"
                    value={o.driver?.id ?? ""}
                    onChange={(e) => update(o.id, { driverId: e.target.value || null })}
                    className={`${input} w-auto`}
                  >
                    <option value="">Choisir un livreur</option>
                    {drivers.data
                      ?.filter((d) => d.active || d.id === o.driver?.id)
                      .map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name} ({d.ordersToday ?? 0} aujourd&apos;hui)
                        </option>
                      ))}
                  </select>
                  {next && (
                    <button
                      onClick={() => update(o.id, { status: next })}
                      className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white"
                    >
                      Passer à « {STATUS_LABEL[next]} »
                    </button>
                  )}
                  <button
                    onClick={() => confirm("Annuler cette commande ?") && update(o.id, { status: "CANCELLED" })}
                    className="px-2 py-2 text-sm text-red-700"
                  >
                    Annuler
                  </button>
                </div>
              )}
              {o.driver && (o.status === "DELIVERED" || o.status === "CANCELLED") && (
                <p className="mt-2 text-sm text-stone-500">Livreur : {o.driver.name}</p>
              )}
            </Card>
          );
        })
      )}
    </div>
  );
}
