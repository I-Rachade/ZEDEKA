"use client";

import { adminFetch, EMPLOYMENT_LABEL, useStaff, VEHICLE_LABEL, type AdminZone, type Driver, type Employment, type Vehicle } from "@/lib/admin";
import { fcfa } from "@/lib/api";
import { button, buttonGhost, Card, ErrorNote, input, Loading, PageHeader } from "../ui";
import { useAction, useAdmin } from "../useAdmin";

export default function DriversPage() {
  const { data, error, reload } = useAdmin<Driver[]>("/drivers");
  const zones = useAdmin<AdminZone[]>("/zones");
  const action = useAction();
  // Statut salarié, salaire et ajout de livreurs : directeur seulement.
  const director = useStaff()?.role !== "DISPATCHER";

  const patch = (id: string, body: Partial<Driver>) =>
    action.run(async () => {
      await adminFetch(`/drivers/${id}`, { method: "PATCH", body });
      await reload();
    });

  const pending = data?.filter((d) => d.status === "PENDING") ?? [];
  const team = data?.filter((d) => d.status === "APPROVED") ?? [];
  const rejected = data?.filter((d) => d.status === "REJECTED") ?? [];
  const staff = team.filter((d) => d.active && d.employment === "STAFF");
  const payroll = staff.reduce((s, d) => s + (d.monthlySalary ?? 0), 0);

  return (
    <div className="space-y-4">
      <PageHeader
        icon="rider"
        title="Livreurs"
        description="Candidatures à examiner, livreurs salariés de Zedeka et indépendants, leur zone, leur véhicule et leur disponibilité."
      />
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
            {director && staff.length > 0 && (
              <p className="mb-2 rounded-lg bg-stone-50 p-3 text-sm text-stone-700">
                {staff.length} salarié(s) actif(s) · masse salariale <strong>{fcfa(payroll)}</strong> par mois. Les courses leur sont attribuées
                d&apos;office et ils ne touchent pas de part par course.
              </p>
            )}
            {team.length === 0 && <p className="text-sm text-stone-500">Aucun livreur pour l&apos;instant.</p>}
            <ul className="divide-y divide-stone-100">
              {team.map((d) => (
                <li key={d.id} className="space-y-2 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className={d.active ? "" : "opacity-50"}>
                      <p className="font-medium">
                        <span className={`mr-1 inline-block h-2 w-2 rounded-full ${d.online ? "bg-emerald-500" : "bg-stone-300"}`} />
                        {d.name}
                        <span
                          className={`ml-2 rounded-full px-2 py-0.5 text-xs font-medium ${d.employment === "STAFF" ? "bg-emerald-50 text-emerald-800" : "bg-stone-100 text-stone-600"}`}
                        >
                          {EMPLOYMENT_LABEL[d.employment]}
                        </span>
                      </p>
                      <p className="text-sm text-stone-500">
                        <a href={`tel:${d.phone.replace(/ /g, "")}`}>{d.phone}</a> · {d.ordersToday ?? 0} course(s) aujourd&apos;hui
                        {director && d.employment === "STAFF" && ` · ${d.monthlySalary ? `${fcfa(d.monthlySalary)} par mois` : "salaire à saisir"}`}
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
                    {director && (
                      <>
                        <select
                          aria-label={`Statut de ${d.name}`}
                          value={d.employment}
                          onChange={(e) => patch(d.id, { employment: e.target.value as Employment })}
                          className={`${input} w-auto!`}
                        >
                          {Object.entries(EMPLOYMENT_LABEL).map(([v, label]) => (
                            <option key={v} value={v}>
                              {label}
                            </option>
                          ))}
                        </select>
                        {d.employment === "STAFF" && (
                          <label className="flex items-center gap-1">
                            <input
                              key={d.monthlySalary ?? "vide"}
                              aria-label={`Salaire mensuel de ${d.name}`}
                              type="number"
                              min={0}
                              step={500}
                              defaultValue={d.monthlySalary ?? ""}
                              placeholder="Salaire mensuel"
                              onBlur={(e) => {
                                const v = e.target.value === "" ? null : Number(e.target.value);
                                if (v !== d.monthlySalary) patch(d.id, { monthlySalary: v });
                              }}
                              className={`${input} w-36!`}
                            />
                            FCFA / mois
                          </label>
                        )}
                      </>
                    )}
                    <select
                      aria-label={`Véhicule de ${d.name}`}
                      value={d.vehicle}
                      onChange={(e) => patch(d.id, { vehicle: e.target.value as Vehicle })}
                      className={`${input} w-auto!`}
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
                      className={`${input} w-auto!`}
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
            {director && (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  const form = e.currentTarget;
                  const f = new FormData(form);
                  const ok = await action.run(async () => {
                    await adminFetch("/drivers", {
                      method: "POST",
                      body: {
                        name: f.get("name"),
                        phone: f.get("phone"),
                        vehicle: f.get("vehicle"),
                        zoneId: f.get("zoneId") || null,
                        employment: f.get("employment"),
                        monthlySalary: f.get("employment") === "STAFF" && f.get("monthlySalary") ? Number(f.get("monthlySalary")) : null,
                      },
                    });
                    await reload();
                  });
                  if (ok) form.reset();
                }}
                className="mt-3 grid gap-2 border-t border-stone-100 pt-3 sm:grid-cols-5"
              >
                <select name="employment" aria-label="Statut du nouveau livreur" defaultValue="STAFF" className={`${input} sm:col-span-2`}>
                  {Object.entries(EMPLOYMENT_LABEL).map(([v, label]) => (
                    <option key={v} value={v}>
                      {label}
                    </option>
                  ))}
                </select>
                <input name="monthlySalary" aria-label="Salaire mensuel (salarié)" type="number" min={0} step={500} placeholder="Salaire mensuel (salarié)" className={`${input} sm:col-span-3`} />
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
            )}
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
