"use client";

import { useState } from "react";
import { adminFetch } from "@/lib/admin";
import { button, Card, ErrorNote, input, Loading, PageHeader } from "../ui";
import { useAction, useAdmin } from "../useAdmin";
import { useT } from "@/lib/i18n/client";

type Settings = {
  parcelDriverCommission: number;
  foodDriverCommission: number;
  freeCancellationMinutes: number;
  cancellationFeePercent: number;
  vendorSubscriptionFee: number;
  parcelMinFee: number;
  parcelPerKmFee: number;
  parcelMaxFee: number;
  foodMinFee: number;
  foodPerKmFee: number;
  foodMaxFee: number;
  mobileMoneyEnabled: boolean;
};

const VENDOR_FIELDS: typeof FIELDS = [
  {
    key: "vendorSubscriptionFee",
    label: "Abonnement mensuel (FCFA)",
    help: "Prix affiché sur la page « Devenir partenaire ». Les commerces déjà inscrits gardent le prix de leur inscription.",
    max: 1_000_000,
  },
];

type NumberKey = Exclude<keyof Settings, "mobileMoneyEnabled">;

const PARCEL_FIELDS: typeof FIELDS = [
  {
    key: "parcelPerKmFee",
    label: "Prix par km (FCFA)",
    help: "Distance à vol d'oiseau entre le retrait et le point de livraison, arrondie aux 50 FCFA supérieurs.",
    max: 100_000,
  },
  { key: "parcelMinFee", label: "Prix minimum (FCFA)", help: "Aussi appliqué quand le client n'a donné qu'une adresse écrite (prix à confirmer).", max: 1_000_000 },
  { key: "parcelMaxFee", label: "Prix maximum (FCFA)", help: "0 pour aucun plafond.", max: 1_000_000 },
];

const FOOD_FIELDS: typeof FIELDS = [
  {
    key: "foodPerKmFee",
    label: "Prix par km (FCFA)",
    help: "Distance à vol d'oiseau entre le restaurant et le point de livraison, arrondie aux 50 FCFA supérieurs. Gardez-le un peu moins cher que les colis.",
    max: 100_000,
  },
  { key: "foodMinFee", label: "Prix minimum (FCFA)", help: "Pour les livraisons les plus proches.", max: 1_000_000 },
  { key: "foodMaxFee", label: "Prix maximum (FCFA)", help: "0 pour aucun plafond.", max: 1_000_000 },
];

const FIELDS: { key: NumberKey; label: string; help: string; max: number }[] = [
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
  const t = useT();

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
              {t(field.label)}
              <input name={field.key} type="number" min={0} max={field.max} defaultValue={data[field.key]} className={`${input} w-28`} />
            </span>
            <span className="text-stone-500">{t(field.help)}</span>
          </label>
        ))}
        {saved !== title && <ErrorNote message={action.error} />}
        <div className="flex items-center gap-3">
          <button className={button}>{t("Enregistrer")}</button>
          {saved === title && <span className="text-sm text-emerald-700">{t("Enregistré")}</span>}
        </div>
      </form>
    </Card>
  );

  return (
    <div className="space-y-4">
      <PageHeader
        icon="settings"
        title="Réglages"
        description="Prix des repas et des colis, paiement, part des livreurs, règles d'annulation et abonnement des commerces partenaires."
      />
      {section("Prix des repas", FOOD_FIELDS)}
      {section("Prix des colis", PARCEL_FIELDS)}
      <Card title="Paiement">
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            checked={data.mobileMoneyEnabled}
            onChange={async (e) => {
              const on = e.target.checked;
              const ok = await action.run(async () => {
                await adminFetch("/settings", { method: "PATCH", body: { mobileMoneyEnabled: on } });
                await reload();
              });
              setSaved(ok ? "Paiement" : null);
            }}
            className="mt-1 h-4 w-4 accent-emerald-600"
          />
          <span>
            <span className="font-medium">{t("Proposer le paiement mobile money")}</span>
            <span className="block text-stone-500">{t("Désactivé : les clients paient en espèces au livreur (expéditeur ou destinataire pour les colis).")}</span>
            {saved === "Paiement" && <span className="text-emerald-700">{t("Enregistré")}</span>}
          </span>
        </label>
      </Card>
      {section("Livreurs et annulations", FIELDS)}
      {section("Commerces partenaires", VENDOR_FIELDS)}
    </div>
  );
}
