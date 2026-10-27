"use client";

import Link from "next/link";
import { useState } from "react";
import DataTable from "@/components/panel/DataTable";
import { Icon } from "@/components/panel/icons";
import { button, Card, ErrorNote, input, Loading, PageHeader } from "@/components/panel/ui";
import { fcfa } from "@/lib/api";
import { rental, type Vehicle } from "@/lib/rental";

const NEW_DAYS = 14;

function prices(v: Vehicle) {
  return [v.hourlyPrice !== null && `${fcfa(v.hourlyPrice)} / h`, v.dailyPrice !== null && `${fcfa(v.dailyPrice)} / j`, v.perKmPrice !== null && `${fcfa(v.perKmPrice)} / km`]
    .filter(Boolean)
    .join(" · ");
}

export default function VehiclesPage() {
  const { data, error, reload } = rental.useResource<Vehicle[]>("/vehicles");
  const action = rental.useAction();
  const [filters, setFilters] = useState({ q: "", category: "", brand: "" });

  if (error) return <ErrorNote message={error} />;
  if (!data) return <Loading />;

  const categories = [...new Set(data.map((v) => v.category))].sort();
  const brands = [...new Set(data.map((v) => v.brand))].sort();
  const rows = data.filter(
    (v) =>
      (!filters.category || v.category === filters.category) &&
      (!filters.brand || v.brand === filters.brand) &&
      (!filters.q || `${v.name} ${v.model} ${v.units.map((u) => u.plateNumber).join(" ")}`.toLowerCase().includes(filters.q.toLowerCase())),
  );
  const isNew = (v: Vehicle) => Date.now() - new Date(v.createdAt).getTime() < NEW_DAYS * 86_400_000;

  return (
    <div>
      <PageHeader
        icon="car"
        title="Véhicules"
        count={data.length}
        description="Votre flotte : chaque modèle avec ses tarifs et ses immatriculations."
        actions={
          <Link href="/location/vehicules/nouveau" className={button}>
            <Icon name="plus" className="h-4 w-4" /> Ajouter un véhicule
          </Link>
        }
      />
      <Card>
        <div className="mb-4 grid gap-2 sm:grid-cols-3">
          <input value={filters.q} onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))} placeholder="Nom, modèle ou immatriculation" className={input} />
          <select value={filters.category} onChange={(e) => setFilters((f) => ({ ...f, category: e.target.value }))} className={input} aria-label="Catégorie">
            <option value="">Toutes les catégories</option>
            {categories.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <select value={filters.brand} onChange={(e) => setFilters((f) => ({ ...f, brand: e.target.value }))} className={input} aria-label="Marque">
            <option value="">Toutes les marques</option>
            {brands.map((b) => (
              <option key={b}>{b}</option>
            ))}
          </select>
        </div>
        <ErrorNote message={action.error} />
        <DataTable
          rows={rows}
          rowKey={(v) => v.id}
          rowHref={(v) => `/location/vehicules/${v.id}`}
          empty="Aucun véhicule. Ajoutez votre premier véhicule."
          columns={[
            {
              header: "Véhicule",
              mobile: "title",
              cell: (v) => (
                <span className="flex items-center gap-2">
                  {v.imageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element -- photo fournie par le loueur
                    <img src={v.imageUrl} alt="" className="h-9 w-12 rounded object-cover" />
                  )}
                  <span>
                    <span className="font-semibold">{v.name}</span>
                    {isNew(v) && <span className="ml-1.5 rounded bg-emerald-100 px-1 text-[10px] font-semibold uppercase text-emerald-800">nouveau</span>}
                    <span className="block text-xs text-stone-500">
                      {v.brand} {v.model}
                    </span>
                  </span>
                </span>
              ),
            },
            {
              header: "Statut",
              mobile: "badge",
              cell: (v) => (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    action.run(async () => {
                      await rental.apiFetch(`/vehicles/${v.id}`, { method: "PATCH", body: { active: !v.active } });
                      await reload();
                    });
                  }}
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${v.active ? "bg-emerald-100 text-emerald-800" : "bg-stone-200 text-stone-600"}`}
                >
                  {v.active ? "Actif" : "Inactif"}
                </button>
              ),
            },
            { header: "Catégorie", cell: (v) => `${v.category} · ${v.type}` },
            { header: "Places", cell: (v) => `${v.seats}${v.airConditioning ? " · clim" : ""}` },
            { header: "Immatriculations", cell: (v) => v.units.filter((u) => u.active).length },
            { header: "Courses", cell: (v) => v._count?.tripVehicles ?? 0 },
            { header: "Tarifs", align: "right", cell: (v) => <span className="text-xs">{prices(v)}</span> },
          ]}
        />
        <p className="mt-3 text-xs text-stone-500">
          Le lien de votre page de réservation est indiqué dans les réglages.
        </p>
      </Card>
    </div>
  );
}
