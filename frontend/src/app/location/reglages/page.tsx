"use client";

import { useEffect, useState } from "react";
import { button, buttonGhost, Card, ErrorNote, input, Loading, PageHeader, StickyActions } from "@/components/panel/ui";
import { rental, type Provider } from "@/lib/rental";

type Me = Provider & { zones: { id: string; name: string }[] };

export default function RentalSettingsPage() {
  const { data, error, reload } = rental.useResource<Me>("/me");
  const action = rental.useAction();
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    window.addEventListener("zedeka:status-changed", reload);
    return () => window.removeEventListener("zedeka:status-changed", reload);
  }, [reload]);

  if (error) return <ErrorNote message={error} />;
  if (!data) return <Loading />;

  const toggle = (key: "temporarilyClosed" | "scheduledTrips") =>
    action.run(async () => {
      await rental.apiFetch("/settings", { method: "PATCH", body: { [key]: !data[key] } });
      await reload();
      window.dispatchEvent(new Event("zedeka:settings-changed"));
    });

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        setSaved(false);
        const ok = await action.run(async () => {
          await rental.apiFetch("/settings", {
            method: "PATCH",
            body: {
              pickupZoneId: String(f.get("pickupZoneId")) || null,
              pickupTimeMin: Number(f.get("pickupTimeMin")),
              pickupTimeMax: Number(f.get("pickupTimeMax")),
              taxPercent: Number(f.get("taxPercent")),
              phone: String(f.get("phone")).trim(),
              address: String(f.get("address")).trim(),
              logoUrl: String(f.get("logoUrl")).trim() || null,
            },
          });
          await reload();
        });
        setSaved(ok);
      }}
      className="space-y-4"
    >
      <PageHeader icon="settings" title="Réglages" description="Ouverture, réservations à l'avance, zone et délai de prise en charge." />

      <Card title="Ouverture" icon="store">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm">
            {data.availability.open ? (
              <span className="font-medium text-emerald-700">Ouvert : les clients peuvent réserver.</span>
            ) : (
              <span className="font-medium text-amber-800">Fermé : {data.availability.reason}</span>
            )}
          </p>
          <button type="button" onClick={() => toggle("temporarilyClosed")} className={data.temporarilyClosed ? button : buttonGhost}>
            {data.temporarilyClosed ? "Rouvrir maintenant" : "Fermer temporairement"}
          </button>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-stone-100 pt-3">
          <p className="text-sm">
            Réservations à l&apos;avance : <strong>{data.scheduledTrips ? "acceptées" : "refusées"}</strong>
            <span className="block text-xs text-stone-500">Sinon, seuls les départs immédiats sont proposés aux clients.</span>
          </p>
          <button type="button" onClick={() => toggle("scheduledTrips")} className={buttonGhost}>
            {data.scheduledTrips ? "Désactiver" : "Activer"}
          </button>
        </div>
      </Card>

      <Card title="Prise en charge" icon="pin">
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-sm">
            Zone de prise en charge
            <select name="pickupZoneId" defaultValue={data.pickupZoneId ?? ""} className={`${input} mt-1`}>
              <option value="">Tout Lomé</option>
              {data.zones.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Délai minimum (min)
            <input name="pickupTimeMin" type="number" min={0} max={240} defaultValue={data.pickupTimeMin} className={`${input} mt-1`} />
          </label>
          <label className="text-sm">
            Délai maximum (min)
            <input name="pickupTimeMax" type="number" min={0} max={480} defaultValue={data.pickupTimeMax} className={`${input} mt-1`} />
          </label>
        </div>
        <p className="mt-2 text-xs text-stone-500">Le délai indique au client en combien de temps un véhicule peut être prêt pour un départ immédiat.</p>
      </Card>

      <Card title="Facturation et informations" icon="receipt">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            Taxe appliquée aux courses (%)
            <input name="taxPercent" type="number" min={0} max={30} defaultValue={data.taxPercent} className={`${input} mt-1`} />
          </label>
          <label className="text-sm">
            Téléphone
            <input name="phone" required defaultValue={data.phone} className={`${input} mt-1`} />
          </label>
          <label className="text-sm">
            Adresse
            <input name="address" required defaultValue={data.address} className={`${input} mt-1`} />
          </label>
          <label className="text-sm">
            Lien du logo (https://…)
            <input name="logoUrl" type="url" defaultValue={data.logoUrl ?? ""} className={`${input} mt-1`} />
          </label>
        </div>
        <p className="mt-2 text-xs text-stone-500">
          Commission Zedeka : {data.commissionRate} % · Page de réservation : /louer/{data.slug}
        </p>
      </Card>

      <ErrorNote message={action.error} />
      <StickyActions>
        {saved && <span className="self-center text-sm text-emerald-700">Enregistré</span>}
        <button className={button}>Enregistrer</button>
      </StickyActions>
    </form>
  );
}
