"use client";

import { use, useState } from "react";
import DataTable from "@/components/panel/DataTable";
import { fcfa } from "@/lib/api";
import { adminFetch, formatTime, type AdminZone } from "@/lib/admin";
import { PRICING_LABEL, TripPill, type Provider, type RentalSettlement, type Trip } from "@/lib/rental";
import { button, buttonGhost, Card, ErrorNote, input, Loading, PageHeader } from "../../ui";
import { useAction, useAdmin } from "../../useAdmin";

type Detail = Provider & {
  active: boolean;
  trips: Trip[];
  pending: { tripCount: number; tripTotal: number; commission: number; amountDue: number };
  settlements: RentalSettlement[];
};

const text = (v: FormDataEntryValue | null) => String(v ?? "").trim();
const day = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { timeZone: "UTC" });

export default function AdminRentalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, error, reload } = useAdmin<Detail>(`/rentals/${id}`);
  const zones = useAdmin<AdminZone[]>("/zones");
  const action = useAction();
  const [notice, setNotice] = useState<string | null>(null);

  if (error) return <ErrorNote message={error} />;
  if (!data) return <Loading />;

  const run = async (fn: () => Promise<unknown>, done: string) => {
    setNotice(null);
    if (await action.run(async () => (await fn(), await reload()))) setNotice(done);
  };

  return (
    <div className="space-y-4">
      <PageHeader icon="car" title={data.name} description={`${data.address} · page de réservation /louer/${data.slug}`} />
      <ErrorNote message={action.error} />
      {notice && <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Informations" icon="store">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              run(
                () =>
                  adminFetch(`/rentals/${id}`, {
                    method: "PATCH",
                    body: {
                      name: text(f.get("name")),
                      phone: text(f.get("phone")),
                      address: text(f.get("address")),
                      commissionRate: Number(f.get("commissionRate")),
                      pickupZoneId: text(f.get("pickupZoneId")) || null,
                      active: f.get("active") === "on",
                    },
                  }),
                "Informations enregistrées.",
              );
            }}
            className="grid gap-2 sm:grid-cols-2"
          >
            <input name="name" required defaultValue={data.name} className={input} aria-label="Nom" />
            <input name="phone" required defaultValue={data.phone} className={input} aria-label="Téléphone" />
            <input name="address" required defaultValue={data.address} className={`${input} sm:col-span-2`} aria-label="Adresse" />
            <label className="flex items-center gap-2 text-sm">
              Commission
              <input name="commissionRate" type="number" min={0} max={50} defaultValue={data.commissionRate} className={`${input} w-20`} /> %
            </label>
            <select name="pickupZoneId" defaultValue={data.pickupZoneId ?? ""} className={input} aria-label="Zone">
              <option value="">Tout Lomé</option>
              {zones.data?.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.name}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-2 text-sm">
              <input name="active" type="checkbox" defaultChecked={data.active} /> Actif
            </label>
            <button className={`${button} sm:col-span-2`}>Enregistrer</button>
          </form>
        </Card>

        <Card title="Accès loueur" icon="user">
          <p className="mb-3 text-sm text-stone-600">
            {data.ownerEmail ? `Le loueur se connecte avec ${data.ownerEmail}.` : "Aucun accès pour le moment."} L&apos;espace loueur est sur /location.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const el = e.currentTarget;
              const f = new FormData(el);
              run(
                () => adminFetch(`/rentals/${id}/access`, { method: "PUT", body: { email: text(f.get("email")), password: text(f.get("password")) } }),
                "Accès enregistré. Transmettez le mot de passe au loueur.",
              ).then(() => ((el.elements.namedItem("password") as HTMLInputElement).value = ""));
            }}
            className="grid gap-2"
          >
            <input name="email" type="email" required defaultValue={data.ownerEmail ?? ""} placeholder="E-mail du loueur" className={input} />
            <input name="password" type="text" required minLength={8} placeholder="Nouveau mot de passe (8 caractères min.)" className={input} />
            <button className={button}>{data.ownerEmail ? "Changer l'accès" : "Créer l'accès"}</button>
          </form>
        </Card>
      </div>

      <Card
        title="Relevés"
        icon="wallet"
        action={
          data.pending.tripCount > 0 && (
            <button onClick={() => run(() => adminFetch(`/rentals/${id}/settlements`, { method: "POST", body: {} }), "Relevé établi.")} className={button}>
              Établir le relevé ({fcfa(data.pending.amountDue)})
            </button>
          )
        }
      >
        <p className="mb-3 text-sm text-stone-600">
          {data.pending.tripCount} course(s) terminée(s) à régler : {fcfa(data.pending.tripTotal)} TTC, commission {fcfa(data.pending.commission)}, à verser{" "}
          {fcfa(data.pending.amountDue)}.
        </p>
        <DataTable
          rows={data.settlements}
          rowKey={(s) => s.id}
          empty="Aucun relevé."
          columns={[
            { header: "Période", mobile: "title", cell: (s) => `${day(s.periodStart)} au ${day(s.periodEnd)}` },
            { header: "Courses", cell: (s) => s.tripCount },
            { header: "À verser", align: "right", cell: (s) => fcfa(s.amountDue) },
            {
              header: "Statut",
              mobile: "badge",
              cell: (s) => (
                <button
                  onClick={() => run(() => adminFetch(`/rental-settlements/${s.id}`, { method: "PATCH", body: { paid: !s.paidAt } }), s.paidAt ? "Relevé remis à verser." : "Versement enregistré.")}
                  className={buttonGhost}
                >
                  {s.paidAt ? `Versé le ${day(s.paidAt)}` : "Marquer versé"}
                </button>
              ),
            },
          ]}
        />
      </Card>

      <Card title="Dernières courses" icon="orders">
        <DataTable
          rows={data.trips}
          rowKey={(t) => t.id}
          empty="Aucune course."
          columns={[
            { header: "Course", mobile: "title", cell: (t) => <span className="font-semibold">{t.code}</span> },
            { header: "Statut", mobile: "badge", cell: (t) => <TripPill status={t.status} /> },
            { header: "Date", cell: (t) => formatTime(t.createdAt) },
            { header: "Client", cell: (t) => `${t.customerName} · ${t.customerPhone}` },
            { header: "Véhicules", cell: (t) => t.vehicles.map((v) => `${v.quantity}× ${v.name}`).join(", ") },
            { header: "Type", cell: (t) => PRICING_LABEL[t.pricing] },
            { header: "Total", align: "right", cell: (t) => fcfa(t.total) },
          ]}
        />
      </Card>
    </div>
  );
}
