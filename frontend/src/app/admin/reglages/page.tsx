"use client";

import { useState } from "react";
import { adminFetch } from "@/lib/admin";
import { button, Card, ErrorNote, input, Loading, PageHeader } from "../ui";
import { useAction, useAdmin } from "../useAdmin";

type Settings = {
  parcelDriverCommission: number;
  foodDriverCommission: number;
  freeCancellationMinutes: number;
  cancellationFeePercent: number;
};

const FIELDS: { key: keyof Settings; label: string; help: string; max: number }[] = [
  {
    key: "foodDriverCommission",
    label: "Part du livreur sur les repas (%)",
    help: "Pourcentage des frais de livraison reversé au livreur. 0 si les livreurs sont salariés.",
    max: 100,
  },
  {
    key: "parcelDriverCommission",
    label: "Part du livreur sur les colis (%)",
    help: "Pourcentage des frais de colis (livraison + supplément) reversé au livreur.",
    max: 100,
  },
  {
    key: "freeCancellationMinutes",
    label: "Annulation gratuite pendant (minutes)",
    help: "Passé ce délai, ou dès que le livreur a récupéré la commande, des frais sont retenus.",
    max: 240,
  },
  {
    key: "cancellationFeePercent",
    label: "Frais d'annulation (% des frais de livraison)",
    help: "Montant retenu sur une annulation tardive.",
    max: 100,
  },
];

export default function SettingsPage() {
  const { data, error, reload } = useAdmin<Settings>("/settings");
  const action = useAction();
  const [saved, setSaved] = useState(false);

  if (error) return <ErrorNote message={error} />;
  if (!data) return <Loading />;

  return (
    <div className="space-y-4">
      <PageHeader icon="settings" title="Réglages" description="Part des livreurs et règles d'annulation, valables pour toutes les commandes." />
      <Card title="Livreurs et annulations">
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const ok = await action.run(async () => {
              await adminFetch("/settings", {
                method: "PATCH",
                body: Object.fromEntries(FIELDS.map(({ key }) => [key, Number(f.get(key))])),
              });
              await reload();
            });
            setSaved(ok);
          }}
          className="space-y-4"
        >
          {FIELDS.map((field) => (
            <label key={field.key} className="block text-sm">
              <span className="flex items-center justify-between gap-2 font-medium">
                {field.label}
                <input name={field.key} type="number" min={0} max={field.max} defaultValue={data[field.key]} className={`${input} w-24`} />
              </span>
              <span className="text-stone-500">{field.help}</span>
            </label>
          ))}
          <ErrorNote message={action.error} />
          <div className="flex items-center gap-3">
            <button className={button}>Enregistrer</button>
            {saved && <span className="text-sm text-emerald-700">Enregistré</span>}
          </div>
        </form>
      </Card>
    </div>
  );
}
