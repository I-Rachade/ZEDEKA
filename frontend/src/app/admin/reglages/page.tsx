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
  vendorSubscriptionFee: number;
};

const VENDOR_FIELDS: typeof FIELDS = [
  {
    key: "vendorSubscriptionFee",
    label: "Abonnement mensuel (FCFA)",
    help: "Prix affiché sur la page « Devenir partenaire ». Les commerces déjà inscrits gardent le prix de leur inscription.",
    max: 1_000_000,
  },
];

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
  const [saved, setSaved] = useState<string | null>(null);

  if (error) return <ErrorNote message={error} />;
  if (!data) return <Loading />;

  const section = (title: string, fields: typeof FIELDS) => (
    <Card title={title}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const ok = await action.run(async () => {
            await adminFetch("/settings", {
              method: "PATCH",
              body: Object.fromEntries(fields.map(({ key }) => [key, Number(f.get(key))])),
            });
            await reload();
          });
          setSaved(ok ? title : null);
        }}
        className="space-y-4"
      >
        {fields.map((field) => (
          <label key={field.key} className="block text-sm">
            <span className="flex items-center justify-between gap-2 font-medium">
              {field.label}
              <input name={field.key} type="number" min={0} max={field.max} defaultValue={data[field.key]} className={`${input} w-28`} />
            </span>
            <span className="text-stone-500">{field.help}</span>
          </label>
        ))}
        {saved !== title && <ErrorNote message={action.error} />}
        <div className="flex items-center gap-3">
          <button className={button}>Enregistrer</button>
          {saved === title && <span className="text-sm text-emerald-700">Enregistré</span>}
        </div>
      </form>
    </Card>
  );

  return (
    <div className="space-y-4">
      <PageHeader
        icon="settings"
        title="Réglages"
        description="Part des livreurs, règles d'annulation et abonnement des commerces partenaires."
      />
      {section("Livreurs et annulations", FIELDS)}
      {section("Commerces partenaires", VENDOR_FIELDS)}
    </div>
  );
}
