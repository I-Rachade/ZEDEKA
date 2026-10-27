"use client";

import { adminFetch, type Driver } from "@/lib/admin";
import { button, buttonGhost, Card, ErrorNote, input, Loading } from "../ui";
import { useAction, useAdmin } from "../useAdmin";

export default function DriversPage() {
  const { data, error, reload } = useAdmin<Driver[]>("/drivers");
  const action = useAction();

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Livreurs</h1>
      <ErrorNote message={action.error ?? error} />
      {!data ? (
        <Loading />
      ) : (
        <Card>
          {data.length === 0 && <p className="text-sm text-stone-500">Aucun livreur pour l&apos;instant.</p>}
          <ul className="divide-y divide-stone-100">
            {data.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-2 py-2">
                <div className={d.active ? "" : "opacity-50"}>
                  <p className="font-medium">{d.name}</p>
                  <p className="text-sm text-stone-500">
                    <a href={`tel:${d.phone.replace(/ /g, "")}`}>{d.phone}</a> · {d.ordersToday ?? 0} course(s) aujourd&apos;hui
                  </p>
                </div>
                <button
                  onClick={() =>
                    action.run(async () => {
                      await adminFetch(`/drivers/${d.id}`, { method: "PATCH", body: { active: !d.active } });
                      await reload();
                    })
                  }
                  className={buttonGhost}
                >
                  {d.active ? "Désactiver" : "Activer"}
                </button>
              </li>
            ))}
          </ul>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const f = new FormData(form);
              const ok = await action.run(async () => {
                await adminFetch("/drivers", { method: "POST", body: { name: f.get("name"), phone: f.get("phone") } });
                await reload();
              });
              if (ok) form.reset();
            }}
            className="mt-3 flex flex-wrap gap-2 border-t border-stone-100 pt-3"
          >
            <input name="name" required placeholder="Nom" className={`${input} flex-1`} />
            <input name="phone" required type="tel" placeholder="Téléphone" className={`${input} w-40`} />
            <button className={button}>Ajouter</button>
          </form>
        </Card>
      )}
    </div>
  );
}
