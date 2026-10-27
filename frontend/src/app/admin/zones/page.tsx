"use client";

import { fcfa } from "@/lib/api";
import { adminFetch, type AdminZone } from "@/lib/admin";
import { button, buttonGhost, Card, ErrorNote, input, Loading } from "../ui";
import { useAction, useAdmin } from "../useAdmin";

export default function ZonesPage() {
  const { data, error, reload } = useAdmin<AdminZone[]>("/zones");
  const action = useAction();

  const save = (id: string, body: Partial<AdminZone>) =>
    action.run(async () => {
      await adminFetch(`/zones/${id}`, { method: "PATCH", body });
      await reload();
    });

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Zones et tarifs de livraison</h1>
      <ErrorNote message={action.error ?? error} />
      {!data ? (
        <Loading />
      ) : (
        <Card>
          <ul className="divide-y divide-stone-100">
            {data.map((z) => (
              <li key={z.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div className={z.active ? "" : "opacity-50"}>
                  <p className="font-medium">{z.name}</p>
                  <p className="text-sm text-stone-500">{fcfa(z.deliveryFee)}</p>
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={() => {
                      const fee = prompt(`Nouveau tarif pour ${z.name} (FCFA)`, String(z.deliveryFee));
                      if (fee !== null && fee.trim() !== "") save(z.id, { deliveryFee: Number(fee) });
                    }}
                    className={buttonGhost}
                  >
                    Tarif
                  </button>
                  <button onClick={() => save(z.id, { active: !z.active })} className={buttonGhost}>
                    {z.active ? "Désactiver" : "Activer"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const f = new FormData(form);
              const ok = await action.run(async () => {
                await adminFetch("/zones", {
                  method: "POST",
                  body: { name: f.get("name"), deliveryFee: Number(f.get("deliveryFee")) },
                });
                await reload();
              });
              if (ok) form.reset();
            }}
            className="mt-3 flex flex-wrap gap-2 border-t border-stone-100 pt-3"
          >
            <input name="name" required placeholder="Nom de la zone" className={`${input} flex-1`} />
            <input name="deliveryFee" type="number" min={0} step={50} required placeholder="Tarif FCFA" className={`${input} w-32`} />
            <button className={button}>Ajouter</button>
          </form>
        </Card>
      )}
    </div>
  );
}
