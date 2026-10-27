"use client";

import { useEffect, useState } from "react";
import { button, buttonGhost, Card, ErrorNote, input, Loading, PageHeader, StickyActions } from "@/components/panel/ui";
import { DAYS, restaurantFetch, type Me, type OpeningSlot } from "@/lib/restaurant";
import { useRestaurant, useRestaurantAction } from "../useRestaurant";

// Lundi en premier, dimanche en dernier.
const WEEK = [1, 2, 3, 4, 5, 6, 0];

export default function RestaurantSettingsPage() {
  const { data, error, reload } = useRestaurant<Me>("/me");
  const action = useRestaurantAction();
  const [hours, setHours] = useState<OpeningSlot[]>([]);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (data) setHours(data.openingHours);
  }, [data]);
  // Le bouton Ouvert/Fermé de l'en-tête change aussi l'ouverture.
  useEffect(() => {
    window.addEventListener("zedeka:status-changed", reload);
    return () => window.removeEventListener("zedeka:status-changed", reload);
  }, [reload]);

  if (error) return <ErrorNote message={error} />;
  if (!data) return <Loading />;

  const setSlot = (index: number, patch: Partial<OpeningSlot>) => setHours((h) => h.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  const toggleClosed = () =>
    action.run(async () => {
      await restaurantFetch("/settings", { method: "PATCH", body: { temporarilyClosed: !data.temporarilyClosed } });
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
          await restaurantFetch("/settings", {
            method: "PATCH",
            body: {
              openingHours: hours,
              minOrderAmount: Number(f.get("minOrderAmount")),
              deliveryTimeMin: Number(f.get("deliveryTimeMin")),
              deliveryTimeMax: Number(f.get("deliveryTimeMax")),
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
      <PageHeader icon="settings" title="Horaires et réglages" description="Ouverture, horaires de la semaine, montant minimum et informations affichées aux clients." />

      <Card title="Ouverture" icon="store">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm">
            {data.availability.open ? (
              <span className="font-medium text-emerald-700">Ouvert : les clients peuvent commander.</span>
            ) : (
              <span className="font-medium text-amber-800">Fermé : {data.availability.reason}</span>
            )}
          </p>
          <button type="button" onClick={toggleClosed} className={data.temporarilyClosed ? button : buttonGhost}>
            {data.temporarilyClosed ? "Rouvrir maintenant" : "Fermer temporairement"}
          </button>
        </div>
        <p className="mt-2 text-xs text-stone-500">La fermeture temporaire bloque les commandes jusqu&apos;à ce que vous rouvriez, quels que soient les horaires. Pour fermer 30 minutes, 1 heure ou jusqu&apos;à demain, utilisez le bouton Ouvert/Fermé en haut de l&apos;écran.</p>
      </Card>

      <Card title="Horaires" icon="clock">
        <p className="mb-3 text-sm text-stone-600">
          Sans horaire, le restaurant est considéré ouvert en permanence. Un créneau peut passer minuit (ex. 18:00 à 02:00).
        </p>
        <ul className="divide-y divide-stone-100">
          {WEEK.map((day) => {
            const slots = hours.map((s, i) => ({ ...s, i })).filter((s) => s.day === day);
            return (
              <li key={day} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                <span className="w-24 font-medium">{DAYS[day]}</span>
                {slots.length === 0 && <span className="text-stone-500">Fermé</span>}
                {slots.map((s) => (
                  <span key={s.i} className="flex items-center gap-1">
                    <input type="time" value={s.open} onChange={(e) => setSlot(s.i, { open: e.target.value })} className={`${input} w-28`} aria-label={`Ouverture ${DAYS[day]}`} />
                    à
                    <input type="time" value={s.close} onChange={(e) => setSlot(s.i, { close: e.target.value })} className={`${input} w-28`} aria-label={`Fermeture ${DAYS[day]}`} />
                    <button type="button" onClick={() => setHours((h) => h.filter((_, j) => j !== s.i))} className="px-1 text-red-700" aria-label="Retirer le créneau">
                      ×
                    </button>
                  </span>
                ))}
                <button type="button" onClick={() => setHours((h) => [...h, { day, open: "11:00", close: "22:00" }])} className="text-emerald-700">
                  + créneau
                </button>
              </li>
            );
          })}
        </ul>
        <button
          type="button"
          onClick={() => {
            const monday = hours.filter((s) => s.day === 1);
            if (monday.length) setHours([...monday, ...WEEK.filter((d) => d !== 1).flatMap((day) => monday.map((s) => ({ ...s, day })))]);
          }}
          className={`${buttonGhost} mt-2`}
        >
          Copier le lundi sur toute la semaine
        </button>
      </Card>

      <Card title="Commande et livraison" icon="bag">
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-sm">
            Montant minimum (FCFA)
            <input name="minOrderAmount" type="number" min={0} step={100} defaultValue={data.minOrderAmount} className={`${input} mt-1`} />
          </label>
          <label className="text-sm">
            Délai minimum (min)
            <input name="deliveryTimeMin" type="number" min={5} max={180} defaultValue={data.deliveryTimeMin} className={`${input} mt-1`} />
          </label>
          <label className="text-sm">
            Délai maximum (min)
            <input name="deliveryTimeMax" type="number" min={5} max={240} defaultValue={data.deliveryTimeMax} className={`${input} mt-1`} />
          </label>
        </div>
      </Card>

      <Card title="Informations" icon="user">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            Téléphone
            <input name="phone" required defaultValue={data.phone} className={`${input} mt-1`} />
          </label>
          <label className="text-sm">
            Adresse
            <input name="address" required defaultValue={data.address} className={`${input} mt-1`} />
          </label>
          <label className="text-sm sm:col-span-2">
            Lien du logo (https://…)
            <input name="logoUrl" type="url" defaultValue={data.logoUrl ?? ""} className={`${input} mt-1`} />
          </label>
        </div>
        <p className="mt-2 text-xs text-stone-500">
          Commission Zedeka : {data.commissionRate} % · Zone : {data.zone?.name ?? "non définie"} · Page client : /r/{data.slug}
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
