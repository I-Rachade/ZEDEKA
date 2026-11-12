"use client";

import { useEffect, useState } from "react";
import { adminFetch, adminImage, roleOf, seesEverything, useStaff, type FleetDriver, type Motorbike, type MotorbikeShift } from "@/lib/admin";
import { photoDataUrl } from "@/lib/photo";
import { useT } from "@/lib/i18n/client";
import { button, buttonGhost, Card, Empty, ErrorNote, input, Loading, PageHeader, StatTile } from "../ui";
import { useAction, useAdmin } from "../useAdmin";

type Fleet = { motorbikes: Motorbike[]; drivers: FleetDriver[] };

const hm = (iso: string) => new Date(iso).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lome" });

function BikePhoto({ bike }: { bike: Motorbike }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!bike.hasPhoto) return;
    let local: string | null = null;
    adminImage(`/fleet/${bike.id}/photo`).then((u) => setUrl((local = u)));
    return () => {
      if (local) URL.revokeObjectURL(local);
    };
  }, [bike.id, bike.hasPhoto]);
  return (
    <span className="grid h-16 w-20 shrink-0 place-items-center overflow-hidden rounded-lg bg-stone-100 text-2xl" aria-hidden="true">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {url ? <img src={url} alt="" className="h-full w-full object-cover" /> : "🛵"}
    </span>
  );
}

function History({ id }: { id: string }) {
  const t = useT();
  const { data } = useAdmin<MotorbikeShift[]>(`/fleet/${id}/history`);
  if (!data) return <Loading />;
  if (!data.length) return <p className="text-sm text-stone-500">{t("Pas encore utilisée.")}</p>;
  return (
    <ul className="divide-y divide-stone-100 text-sm">
      {data.map((s) => (
        <li key={s.id} className="flex flex-wrap justify-between gap-2 py-1">
          <span className="font-medium">{s.driver.name}</span>
          <span className="text-stone-600">
            {hm(s.startedAt)} → {s.endedAt ? hm(s.endedAt) : t("en cours")}
            {s.assignedBy ? ` · ${t("donnée par {name}", { name: s.assignedBy })}` : ` · ${t("prise par le livreur")}`}
          </span>
        </li>
      ))}
    </ul>
  );
}

// Parc de motos de Zedeka : les motos, qui roule avec laquelle, et l'attribution aux livreurs salariés.
// Les salariés prennent eux-mêmes une moto libre en passant en ligne ; la répartition peut aussi en donner ou en reprendre une.
export default function FleetPage() {
  const t = useT();
  const { data, error, reload } = useAdmin<Fleet>("/fleet");
  const action = useAction();
  const manages = seesEverything(roleOf(useStaff()));
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  const run = (fn: () => Promise<unknown>) =>
    action.run(async () => {
      await fn();
      await reload();
    });
  const uploadPhoto = (id: string, file: File) => run(async () => adminFetch(`/fleet/${id}/photo`, { method: "PUT", body: { photo: await photoDataUrl(file) } }));

  const bikes = data?.motorbikes ?? [];
  const inService = bikes.filter((b) => b.active);
  const taken = inService.filter((b) => b.driver);
  // Salariés à moto qui n'en ont pas : à qui en donner une.
  const withoutBike = (data?.drivers ?? []).filter((d) => d.active && d.vehicle === "MOTO" && !d.motorbike);

  return (
    <div className="space-y-4">
      <PageHeader
        icon="rider"
        title="Parc motos"
        description="Les motos de Zedeka pour les livreurs salariés. Le livreur prend une moto libre en passant en ligne et la rend en passant hors ligne ; vous pouvez aussi en donner ou en reprendre une ici."
      />
      <ErrorNote message={action.error ?? error} />
      {!data ? (
        <Loading />
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2">
            <StatTile label="En service" value={inService.length} icon="rider" />
            <StatTile label="Sur la route" value={taken.length} hint="prises par un livreur" />
            <StatTile label="Libres" value={inService.length - taken.length} />
          </div>

          <Card title={t("Motos ({n})", { n: bikes.length })}>
            {bikes.length === 0 && <Empty>{t("Aucune moto enregistrée. Ajoutez la première ci-dessous : dès qu'une moto est en service, les salariés à moto en choisissent une pour passer en ligne.")}</Empty>}
            <ul className="divide-y divide-stone-100">
              {bikes.map((b) => (
                <li key={b.id} className={`space-y-2 py-3 ${b.active ? "" : "opacity-60"}`}>
                  <div className="flex flex-wrap items-center gap-3">
                    <BikePhoto bike={b} />
                    <div className="min-w-0 flex-1">
                      <p className="font-mono text-lg font-bold tracking-wide">
                        {b.plate}
                        {!b.active && <span className="ml-2 rounded-full bg-stone-200 px-2 py-1 font-sans text-xs font-semibold text-stone-700">{t("Retirée du service")}</span>}
                      </p>
                      <p className="text-sm text-stone-600">
                        {b.label || t("Sans description")}
                        {b.note ? ` · ${b.note}` : ""}
                      </p>
                      <p className="text-sm">
                        {b.driver ? (
                          <>
                            <span className={`mr-1 inline-block h-2 w-2 rounded-full ${b.driver.online ? "bg-emerald-500" : "bg-stone-300"}`} />
                            <strong>{b.driver.name}</strong> · {t("depuis {date}", { date: hm(b.assignedAt ?? b.createdAt) })}
                          </>
                        ) : b.active ? (
                          <span className="font-semibold text-emerald-700">{t("Libre")}</span>
                        ) : null}
                        <span className="text-stone-500"> · {t("{n} service(s) en 30 jours", { n: b.shifts30d })}</span>
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {b.driver ? (
                        <button onClick={() => run(() => adminFetch(`/fleet/${b.id}/release`, { method: "POST" }))} className={buttonGhost}>
                          {t("Reprendre la moto")}
                        </button>
                      ) : (
                        b.active && (
                          <select
                            aria-label={t("Donner {plate} à un livreur", { plate: b.plate })}
                            value=""
                            onChange={(e) => e.target.value && run(() => adminFetch(`/fleet/${b.id}/assign`, { method: "POST", body: { driverId: e.target.value } }))}
                            className={`${input} w-auto!`}
                          >
                            <option value="">{t("Donner à…")}</option>
                            {data.drivers
                              .filter((d) => d.active)
                              .map((d) => (
                                <option key={d.id} value={d.id}>
                                  {d.name}
                                  {d.motorbike ? ` (${t("a déjà {plate}", { plate: d.motorbike.plate })})` : ""}
                                </option>
                              ))}
                          </select>
                        )
                      )}
                      <button onClick={() => setOpen(open === b.id ? null : b.id)} className={buttonGhost} aria-expanded={open === b.id}>
                        {t("Historique")}
                      </button>
                      {manages && (
                        <button onClick={() => setEditing(editing === b.id ? null : b.id)} className={buttonGhost} aria-expanded={editing === b.id}>
                          {t("Modifier")}
                        </button>
                      )}
                    </div>
                  </div>
                  {open === b.id && <History id={b.id} />}
                  {manages && editing === b.id && (
                    <form
                      onSubmit={async (e) => {
                        e.preventDefault();
                        const f = new FormData(e.currentTarget);
                        const ok = await run(() => adminFetch(`/fleet/${b.id}`, { method: "PATCH", body: { plate: f.get("plate"), label: f.get("label") || null, note: f.get("note") || null } }));
                        if (ok) setEditing(null);
                      }}
                      className="grid gap-2 rounded-lg bg-stone-50 p-3 sm:grid-cols-3"
                    >
                      <input name="plate" defaultValue={b.plate} required aria-label={t("Plaque")} className={`${input} font-mono uppercase`} />
                      <input name="label" defaultValue={b.label ?? ""} placeholder={t("Modèle, couleur")} aria-label={t("Modèle, couleur")} className={input} />
                      <input name="note" defaultValue={b.note ?? ""} placeholder={t("Note (entretien, assurance…)")} aria-label={t("Note")} className={input} />
                      <label className={`${buttonGhost} cursor-pointer text-center`}>
                        {b.hasPhoto ? t("Changer la photo") : t("Ajouter une photo")}
                        <input type="file" accept="image/*" className="sr-only" onChange={(e) => e.target.files?.[0] && uploadPhoto(b.id, e.target.files[0])} />
                      </label>
                      <button type="button" onClick={() => run(() => adminFetch(`/fleet/${b.id}`, { method: "PATCH", body: { active: !b.active } }))} className={buttonGhost}>
                        {b.active ? t("Retirer du service") : t("Remettre en service")}
                      </button>
                      {b.shifts30d === 0 && !b.driver && (
                        <button
                          type="button"
                          onClick={() => window.confirm(t("Supprimer la moto {plate} ?", { plate: b.plate })) && run(() => adminFetch(`/fleet/${b.id}`, { method: "DELETE" }))}
                          className={`${buttonGhost} text-red-700!`}
                        >
                          {t("Supprimer")}
                        </button>
                      )}
                      <button className={`${button} sm:col-span-3`}>{t("Enregistrer")}</button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
            {manages && (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  const form = e.currentTarget;
                  const f = new FormData(form);
                  const photo = f.get("photo");
                  const ok = await run(async () => {
                    const bike = await adminFetch<{ id: string }>("/fleet", { method: "POST", body: { plate: f.get("plate"), label: f.get("label") || null, note: f.get("note") || null } });
                    if (photo instanceof File && photo.size > 0) await adminFetch(`/fleet/${bike.id}/photo`, { method: "PUT", body: { photo: await photoDataUrl(photo) } });
                  });
                  if (ok) form.reset();
                }}
                className="mt-3 grid gap-2 border-t border-stone-100 pt-3 sm:grid-cols-4"
              >
                <input name="plate" required placeholder={t("Plaque, ex. TG-1234-AB")} aria-label={t("Plaque")} className={`${input} font-mono uppercase`} />
                <input name="label" placeholder={t("Modèle, couleur")} aria-label={t("Modèle, couleur")} className={input} />
                <input name="note" placeholder={t("Note (facultatif)")} aria-label={t("Note")} className={input} />
                <label className={`${buttonGhost} cursor-pointer text-center`}>
                  {t("Photo (facultatif)")}
                  <input name="photo" type="file" accept="image/*" className="sr-only" />
                </label>
                <button className={`${button} sm:col-span-4`}>{t("Ajouter une moto")}</button>
              </form>
            )}
          </Card>

          {withoutBike.length > 0 && inService.length > 0 && (
            <Card title={t("Salariés à moto sans moto du parc ({n})", { n: withoutBike.length })}>
              <p className="text-sm text-stone-600">{t("Ils choisiront une moto libre en passant en ligne. Vous pouvez aussi leur en donner une avec « Donner à… ».")}</p>
              <p className="mt-2 text-sm font-medium">{withoutBike.map((d) => d.name).join(", ")}</p>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
