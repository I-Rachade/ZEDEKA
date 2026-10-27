"use client";

import { adminFetch, VEHICLE_LABEL, type AdminZone, type Driver, type Vehicle } from "@/lib/admin";
import { button, buttonGhost, Card, ErrorNote, input, Loading, PageHeader } from "../ui";
import { useAction, useAdmin } from "../useAdmin";

export default function DriversPage() {
  const { data, error, reload } = useAdmin<Driver[]>("/drivers");
  const zones = useAdmin<AdminZone[]>("/zones");
  const action = useAction();

  const patch = (id: string, body: Partial<Driver>) =>
    action.run(async () => {
      await adminFetch(`/drivers/${id}`, { method: "PATCH", body });
      await reload();
    });

  const pending = data?.filter((d) => d.status === "PENDING") ?? [];
  const team = data?.filter((d) => d.status === "APPROVED") ?? [];
  const rejected = data?.filter((d) => d.status === "REJECTED") ?? [];

  return (
    <div className="space-y-4">
      <PageHeader icon="rider" title="Livreurs" description="Candidatures à examiner, livreurs actifs, leur zone, leur véhicule et leur disponibilité." />
      <ErrorNote message={action.error ?? error} />
      {!data ? (
        <Loading />
      ) : (
        <>
          {pending.length > 0 && (
            <Card title={`Candidatures à examiner (${pending.length})`}>
              <ul className="divide-y divide-stone-100">
                {pending.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <div>
                      <p className="font-medium">{d.name}</p>
                      <p className="text-sm text-stone-500">
                        <a href={`tel:${d.phone.replace(/ /g, "")}`}>{d.phone}</a> · {VEHICLE_LABEL[d.vehicle]}
                        {d.zone ? ` · ${d.zone.name}` : ""}
                      </p>
                    </div>
                    <div className="flex gap-1">
                      <button onClick={() => patch(d.id, { status: "APPROVED" })} className={button}>
                        Valider
                      </button>
                      <button onClick={() => patch(d.id, { status: "REJECTED" })} className={buttonGhost}>
                        Refuser
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card title="Équipe">
            {team.length === 0 && <p className="text-sm text-stone-500">Aucun livreur pour l&apos;instant.</p>}
            <ul className="divide-y divide-stone-100">
              {team.map((d) => (
                <li key={d.id} className="space-y-2 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className={d.active ? "" : "opacity-50"}>
                      <p className="font-medium">
                        <span className={`mr-1 inline-block h-2 w-2 rounded-full ${d.online ? "bg-emerald-500" : "bg-stone-300"}`} />
                        {d.name}
                      </p>
                      <p className="text-sm text-stone-500">
                        <a href={`tel:${d.phone.replace(/ /g, "")}`}>{d.phone}</a> · {d.ordersToday ?? 0} course(s) aujourd&apos;hui
                      </p>
                    </div>
                    <div className="flex gap-1">
                      <button onClick={() => patch(d.id, { online: !d.online })} className={buttonGhost} disabled={!d.active}>
                        {d.online ? "Hors ligne" : "En ligne"}
                      </button>
                      <button onClick={() => patch(d.id, { active: !d.active, online: false })} className={buttonGhost}>
                        {d.active ? "Désactiver" : "Activer"}
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 text-sm">
                    <select
                      aria-label={`Véhicule de ${d.name}`}
                      value={d.vehicle}
                      onChange={(e) => patch(d.id, { vehicle: e.target.value as Vehicle })}
                      className={`${input} w-auto`}
                    >
                      {Object.entries(VEHICLE_LABEL).map(([v, label]) => (
                        <option key={v} value={v}>
                          {label}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label={`Zone de ${d.name}`}
                      value={d.zoneId ?? ""}
                      onChange={(e) => patch(d.id, { zoneId: e.target.value || null })}
                      className={`${input} w-auto`}
                    >
                      <option value="">Toutes zones</option>
                      {zones.data?.map((z) => (
                        <option key={z.id} value={z.id}>
                          {z.name}
                        </option>
                      ))}
                    </select>
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
                  await adminFetch("/drivers", {
                    method: "POST",
                    body: { name: f.get("name"), phone: f.get("phone"), vehicle: f.get("vehicle"), zoneId: f.get("zoneId") || null },
                  });
                  await reload();
                });
                if (ok) form.reset();
              }}
              className="mt-3 grid gap-2 border-t border-stone-100 pt-3 sm:grid-cols-5"
            >
              <input name="name" required placeholder="Nom" className={`${input} sm:col-span-2`} />
              <input name="phone" required type="tel" placeholder="Téléphone" className={input} />
              <select name="vehicle" defaultValue="MOTO" className={input}>
                {Object.entries(VEHICLE_LABEL).map(([v, label]) => (
                  <option key={v} value={v}>
                    {label}
                  </option>
                ))}
              </select>
              <select name="zoneId" defaultValue="" className={input}>
                <option value="">Toutes zones</option>
                {zones.data?.map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.name}
                  </option>
                ))}
              </select>
              <button className={`${button} sm:col-span-5`}>Ajouter un livreur</button>
            </form>
          </Card>

          {rejected.length > 0 && (
            <Card title="Candidatures refusées">
              <ul className="text-sm text-stone-500">
                {rejected.map((d) => (
                  <li key={d.id} className="flex items-center justify-between py-1">
                    {d.name} · {d.phone}
                    <button onClick={() => patch(d.id, { status: "APPROVED" })} className="text-emerald-700">
                      Valider quand même
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
