"use client";

import { useState } from "react";
import DataTable from "@/components/panel/DataTable";
import { Icon } from "@/components/panel/icons";
import { adminFetch, type AdminZone } from "@/lib/admin";
import { button, buttonGhost, Card, ErrorNote, input, Loading, PageHeader } from "../ui";
import { useAction, useAdmin } from "../useAdmin";

type Row = {
  id: string;
  slug: string;
  name: string;
  phone: string;
  active: boolean;
  commissionRate: number;
  temporarilyClosed: boolean;
  ownerEmail: string | null;
  pickupZone: { name: string } | null;
  _count: { vehicles: number; trips: number; drivers: number };
};

const text = (v: FormDataEntryValue | null) => String(v ?? "").trim();

export default function AdminRentalsPage() {
  const { data, error, reload } = useAdmin<Row[]>("/rentals");
  const zones = useAdmin<AdminZone[]>("/zones");
  const action = useAction();
  const [adding, setAdding] = useState(false);

  return (
    <div className="space-y-4">
      <PageHeader
        icon="car"
        title="Location"
        count={data?.length}
        description="Les loueurs de véhicules partenaires, leur flotte, leurs courses et leur accès à l'espace loueur."
        actions={
          !adding && (
            <button onClick={() => setAdding(true)} className={button}>
              <Icon name="plus" className="h-4 w-4" /> Ajouter un loueur
            </button>
          )
        }
      />
      {adding && (
        <Card title="Nouveau loueur">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const ok = await action.run(async () => {
                await adminFetch("/rentals", {
                  method: "POST",
                  body: {
                    slug: text(f.get("slug")),
                    name: text(f.get("name")),
                    phone: text(f.get("phone")),
                    address: text(f.get("address")),
                    commissionRate: Number(f.get("commissionRate")),
                    pickupZoneId: text(f.get("pickupZoneId")) || null,
                  },
                });
                await reload();
              });
              if (ok) setAdding(false);
            }}
            className="grid gap-2 sm:grid-cols-3"
          >
            <input name="name" required placeholder="Nom (ex. Lomé Auto Location)" className={input} />
            <input name="slug" required pattern="[a-z0-9]+(-[a-z0-9]+)*" placeholder="Lien (ex. lome-auto)" className={input} />
            <input name="phone" required placeholder="Téléphone" className={input} />
            <input name="address" required placeholder="Adresse" className={input} />
            <label className="flex items-center gap-2 text-sm">
              Commission
              <input name="commissionRate" type="number" min={0} max={50} defaultValue={10} className={`${input} w-20`} /> %
            </label>
            <select name="pickupZoneId" className={input} aria-label="Zone">
              <option value="">Tout Lomé</option>
              {zones.data?.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.name}
                </option>
              ))}
            </select>
            <div className="flex gap-2 sm:col-span-3">
              <button className={button}>Créer</button>
              <button type="button" onClick={() => setAdding(false)} className={buttonGhost}>
                Annuler
              </button>
            </div>
          </form>
        </Card>
      )}
      <Card>
        <ErrorNote message={action.error ?? error} />
        {!data ? (
          <Loading />
        ) : (
          <DataTable
            rows={data}
            rowKey={(r) => r.id}
            rowHref={(r) => `/admin/location/${r.id}`}
            empty="Aucun loueur."
            columns={[
              { header: "Loueur", mobile: "title", cell: (r) => <span className="font-semibold">{r.name}</span> },
              {
                header: "Statut",
                mobile: "badge",
                cell: (r) => (
                  <span className={`rounded-full px-2 py-0.5 text-xs ${!r.active ? "bg-stone-200 text-stone-600" : r.temporarilyClosed ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"}`}>
                    {!r.active ? "Inactif" : r.temporarilyClosed ? "Fermé" : "Ouvert"}
                  </span>
                ),
              },
              { header: "Zone", cell: (r) => r.pickupZone?.name.split(" – ")[0] ?? "Tout Lomé" },
              { header: "Véhicules", cell: (r) => r._count.vehicles },
              { header: "Chauffeurs", cell: (r) => r._count.drivers },
              { header: "Courses", cell: (r) => r._count.trips },
              { header: "Commission", cell: (r) => `${r.commissionRate} %` },
              { header: "Accès", cell: (r) => r.ownerEmail ?? <span className="text-amber-700">à créer</span> },
            ]}
          />
        )}
      </Card>
    </div>
  );
}
