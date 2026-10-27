"use client";

import { useState } from "react";
import { fcfa } from "@/lib/api";
import { adminFetch, type AdminZone } from "@/lib/admin";
import { button, buttonGhost, Card, ErrorNote, input, Loading, PageHeader } from "../ui";
import { useAction, useAdmin } from "../useAdmin";

const num = (v: FormDataEntryValue | null) => (v === null || v === "" ? null : Number(v));

function describe(z: AdminZone) {
  if (z.pricing === "FIXED") return fcfa(z.deliveryFee);
  const parts = [`${fcfa(z.perKmFee ?? 0)}/km`];
  if (z.minFee !== null) parts.push(`min ${fcfa(z.minFee)}`);
  if (z.maxFee !== null) parts.push(`max ${fcfa(z.maxFee)}`);
  return `${parts.join(", ")} · ${fcfa(z.deliveryFee)} sans position`;
}

function ZoneForm({ zone, onSubmit, onCancel }: { zone?: AdminZone; onSubmit: (body: Partial<AdminZone>) => Promise<boolean>; onCancel?: () => void }) {
  const [pricing, setPricing] = useState(zone?.pricing ?? "FIXED");
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const f = new FormData(form);
        const ok = await onSubmit({
          name: String(f.get("name")),
          pricing,
          deliveryFee: Number(f.get("deliveryFee")),
          minFee: pricing === "DISTANCE" ? num(f.get("minFee")) : null,
          perKmFee: pricing === "DISTANCE" ? num(f.get("perKmFee")) : null,
          maxFee: pricing === "DISTANCE" ? num(f.get("maxFee")) : null,
        });
        if (ok && !zone) form.reset();
      }}
      className="grid gap-2 text-sm sm:grid-cols-3"
    >
      <input name="name" required defaultValue={zone?.name} placeholder="Nom de la zone" className={`${input} sm:col-span-2`} />
      <select value={pricing} onChange={(e) => setPricing(e.target.value as AdminZone["pricing"])} className={input}>
        <option value="FIXED">Tarif fixe</option>
        <option value="DISTANCE">Selon la distance</option>
      </select>
      <label className="flex items-center justify-between gap-2">
        {pricing === "FIXED" ? "Tarif" : "Tarif sans position"}
        <input name="deliveryFee" type="number" min={0} step={50} required defaultValue={zone?.deliveryFee} className={`${input} w-28`} />
      </label>
      {pricing === "DISTANCE" && (
        <>
          <label className="flex items-center justify-between gap-2">
            Prix par km
            <input name="perKmFee" type="number" min={0} step={10} required defaultValue={zone?.perKmFee ?? ""} className={`${input} w-28`} />
          </label>
          <label className="flex items-center justify-between gap-2">
            Minimum
            <input name="minFee" type="number" min={0} step={50} defaultValue={zone?.minFee ?? ""} className={`${input} w-28`} />
          </label>
          <label className="flex items-center justify-between gap-2">
            Maximum
            <input name="maxFee" type="number" min={0} step={50} defaultValue={zone?.maxFee ?? ""} className={`${input} w-28`} />
          </label>
        </>
      )}
      <div className="flex gap-2 sm:col-span-3">
        <button className={button}>{zone ? "Enregistrer" : "Ajouter la zone"}</button>
        {onCancel && (
          <button type="button" onClick={onCancel} className={buttonGhost}>
            Annuler
          </button>
        )}
      </div>
    </form>
  );
}

export default function ZonesPage() {
  const { data, error, reload } = useAdmin<AdminZone[]>("/zones");
  const action = useAction();
  const [editing, setEditing] = useState<string | null>(null);

  const save = (id: string, body: Partial<AdminZone>) =>
    action.run(async () => {
      await adminFetch(`/zones/${id}`, { method: "PATCH", body });
      await reload();
      setEditing(null);
    });

  return (
    <div className="space-y-4">
      <PageHeader icon="map" title="Zones" description="Zones de livraison de Lomé et leur tarif, fixe ou calculé à la distance." />
      <ErrorNote message={action.error ?? error} />
      {!data ? (
        <Loading />
      ) : (
        <Card>
          <ul className="divide-y divide-stone-100">
            {data.map((z) =>
              editing === z.id ? (
                <li key={z.id} className="py-3">
                  <ZoneForm zone={z} onSubmit={(b) => save(z.id, b)} onCancel={() => setEditing(null)} />
                </li>
              ) : (
                <li key={z.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <div className={z.active ? "" : "opacity-50"}>
                    <p className="font-medium">{z.name}</p>
                    <p className="text-sm text-stone-500">{describe(z)}</p>
                  </div>
                  <div className="flex gap-1">
                    <button onClick={() => setEditing(z.id)} className={buttonGhost}>
                      Modifier
                    </button>
                    <button onClick={() => save(z.id, { active: !z.active })} className={buttonGhost}>
                      {z.active ? "Désactiver" : "Activer"}
                    </button>
                  </div>
                </li>
              ),
            )}
          </ul>
          <div className="mt-3 border-t border-stone-100 pt-3">
            <ZoneForm
              onSubmit={(body) =>
                action.run(async () => {
                  await adminFetch("/zones", { method: "POST", body });
                  await reload();
                })
              }
            />
          </div>
        </Card>
      )}
    </div>
  );
}
