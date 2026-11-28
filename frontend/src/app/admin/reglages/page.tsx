"use client";

import { useState } from "react";
import { adminFetch } from "@/lib/admin";
import { DirectorEdits, button, Card, ErrorNote, input, Loading, PageHeader } from "../ui";
import { useAction, useAdmin } from "../useAdmin";
import { Icon } from "@/components/panel/icons";
import { ZED_COLORS, type ZedColor } from "@/lib/zed";
import { useT } from "@/lib/i18n/client";

type Settings = {
  parcelDriverCommission: number;
  foodDriverCommission: number;
  freeCancellationMinutes: number;
  cancellationFeePercent: number;
  vendorSubscriptionFee: number;
  proSubscriptionFee: number;
  essentialOrderLimit: number;
  merchantFlatFee: number;
  merchantFlatFrom: number;
  parcelMinFee: number;
  parcelPerKmFee: number;
  parcelMaxFee: number;
  foodMinFee: number;
  foodPerKmFee: number;
  foodMaxFee: number;
  // Facturation de la livraison : GRID (grille par tranches), KM (tarif au km ci-dessous) ou ZONE (prix fixe de chaque zone, écran Zones).
  foodPricingMode: "GRID" | "KM" | "ZONE";
  parcelPricingMode: "GRID" | "KM" | "ZONE";
  zedPricingMode: "GRID" | "KM";
  gridTier1Km: number;
  gridTier1Fee: number;
  gridTier2Km: number;
  gridTier2Fee: number;
  gridTier3Fee: number;
  mobileMoneyEnabled: boolean;
  depositAmount: number;
  depositLowThreshold: number;
  zedEnabled: boolean;
  zedRadiusM: number;
  zedOfferSeconds: number;
  zedMaxOffers: number;
  zedFarRadiusM: number;
  zedMinFee: number;
  zedPerKmFee: number;
  zedMonthPrice: number;
  zedDayPrice: number;
  zedTrialDays: number;
  zedPaymentNumber: string;
  zedekaWhatsapp: string;
  zedButtonColor: ZedColor;
  leaseHomeRate: number;
  leaseZedekaRate: number;
  leaseBlockDays: number;
  plusEnabled: boolean;
  plusMonthlyFee: number;
  plusDeliveryDiscount: number;
  plusMinSubtotal: number;
  loyaltySpendPerPoint: number;
  loyaltyRewardPoints: number;
  sponsorWeekFee: number;
  schoolMonthlyFee: number;
  schoolOneWayFee: number;
  studentMonthlyFee: number;
  studentOneWayFee: number;
  schoolGraceDays: number;
  schoolMaxPerDriver: number;
};

const LOYALTY_FIELDS: typeof FIELDS = [
  { key: "plusMonthlyFee", label: "Zedeka+ : prix par mois (FCFA)", help: "Prix encaissé par l'équipe pour 30 jours d'abonnement.", max: 1_000_000 },
  { key: "plusDeliveryDiscount", label: "Zedeka+ : remise sur la livraison des repas (%)", help: "100 : livraison offerte. 50 : livraison à moitié prix.", max: 100 },
  { key: "plusMinSubtotal", label: "Zedeka+ : panier minimum (FCFA)", help: "Montant des plats, hors livraison, à partir duquel la remise s'applique.", max: 1_000_000 },
  { key: "loyaltySpendPerPoint", label: "Points : FCFA dépensés pour 1 point", help: "Sur le total des commandes livrées (repas, colis, boutiques). 0 pour mettre les points en pause.", max: 100_000 },
  { key: "loyaltyRewardPoints", label: "Points pour une livraison offerte", help: "Le client échange ses points à la caisse d'un repas livré.", max: 1_000_000 },
  { key: "sponsorWeekFee", label: "Mise en avant d'un commerce : prix d'une semaine (FCFA)", help: "Prix proposé dans l'écran Mises en avant.", max: 10_000_000 },
];

const LEASE_FIELDS: typeof FIELDS = [
  { key: "leaseHomeRate", label: "Moto rechargeable à la maison : prix par jour (FCFA)", help: "Prix proposé pour les nouveaux contrats. Les contrats en cours gardent leur prix.", max: 100_000 },
  { key: "leaseZedekaRate", label: "Moto Zedeka : prix par jour (FCFA)", help: "Prix proposé pour les nouveaux contrats. Les contrats en cours gardent leur prix.", max: 100_000 },
  {
    key: "leaseBlockDays",
    label: "Jours de retard avant blocage",
    help: "Le livreur en retard de ce nombre de jours ne peut plus se mettre en ligne (ni recevoir les appels Zed) avant de payer. 0 : jamais bloqué.",
    max: 60,
  },
];

const SCHOOL_FIELDS: typeof FIELDS = [
  { key: "schoolMonthlyFee", label: "Écolier aller-retour : prix par mois (FCFA)", help: "Prix proposé aux parents. Modifiable abonnement par abonnement à la validation.", max: 1_000_000 },
  { key: "schoolOneWayFee", label: "Écolier aller ou retour seul : prix par mois (FCFA)", help: "Abonnement avec seulement l'aller, ou seulement le retour.", max: 1_000_000 },
  { key: "studentMonthlyFee", label: "Étudiant aller-retour : prix par mois (FCFA)", help: "Prix proposé aux étudiants.", max: 1_000_000 },
  { key: "studentOneWayFee", label: "Étudiant aller ou retour seul : prix par mois (FCFA)", help: "Abonnement étudiant avec un seul trajet par jour.", max: 1_000_000 },
  { key: "schoolGraceDays", label: "Jours de grâce en début de mois", help: "Les trajets continuent ces premiers jours du mois avant le paiement, puis s'arrêtent jusqu'au paiement.", max: 28 },
  { key: "schoolMaxPerDriver", label: "Abonnements au plus par conducteur", help: "Un conducteur attitré ne prend pas plus d'élèves ou d'étudiants. 0 : pas de limite.", max: 50 },
];

const ZED_FIELDS: typeof FIELDS = [
  { key: "zedMonthPrice", label: "Plan Zed : 30 jours (FCFA)", help: "Prix payé par le conducteur Zed pour 30 jours d'appels.", max: 1_000_000 },
  { key: "zedDayPrice", label: "Plan Zed : 1 jour (FCFA)", help: "Prix d'une journée, pour les conducteurs qui paient au jour.", max: 100_000 },
  { key: "zedTrialDays", label: "Jours offerts à la validation", help: "Premier mois offert : 30. 0 pour aucun essai.", max: 365 },
  { key: "zedRadiusM", label: "Rayon de recherche (m)", help: "Seuls les conducteurs à moins de cette distance du client reçoivent l'appel.", max: 10_000 },
  { key: "zedOfferSeconds", label: "Temps pour accepter (secondes)", help: "Sans réponse, l'appel passe au conducteur suivant le plus proche.", max: 120 },
  { key: "zedMaxOffers", label: "Conducteurs alertés au plus", help: "Après ce nombre, le client voit « Aucun Zed disponible ».", max: 20 },
  {
    key: "zedFarRadiusM",
    label: "Rayon d'une course demandée (m)",
    help: "Aucun Zed proche, ou course programmée : le client demande une course et les conducteurs jusqu'à cette distance reçoivent l'appel.",
    max: 30_000,
  },
  { key: "zedMinFee", label: "Course demandée : prix minimum (FCFA)", help: "Prix le plus bas d'une course demandée, même très courte.", max: 100_000 },
  {
    key: "zedPerKmFee",
    label: "Course demandée : prix par km (FCFA)",
    help: "Multiplié par la longueur de l'itinéraire, arrondi aux 50 FCFA supérieurs. Annoncé au client avant l'arrivée du Zed.",
    max: 10_000,
  },
];

const VENDOR_FIELDS: typeof FIELDS = [
  {
    key: "vendorSubscriptionFee",
    label: "Abonnement Standard (FCFA)",
    help: "Prix appliqué aux nouveaux restaurants créés sans prix. Les commerces déjà inscrits gardent leur prix.",
    max: 1_000_000,
  },
  {
    key: "proSubscriptionFee",
    label: "Abonnement Pro (FCFA)",
    help: "Palier Pro : sans commission, livreur salarié dédié au service du midi. Appliqué quand l'équipe passe un commerce en Pro dans sa fiche.",
    max: 1_000_000,
  },
  {
    key: "essentialOrderLimit",
    label: "Palier Pro conseillé au-delà de (commandes livrées par mois)",
    help: "Un commerce Standard qui dépasse ce nombre ce mois-ci est signalé « Pro conseillé » dans la liste. 0 pour ne rien signaler.",
    max: 100_000,
  },
  {
    key: "depositAmount",
    label: "Dépôt chez chaque restaurant (FCFA)",
    help: "Somme laissée par Zedeka : le restaurant s'y paie les plats des commandes livrées par un livreur salarié Zedeka (un livreur indépendant paie les plats sur place). Montant proposé au premier dépôt et pour revenir au plein lors d'une recharge.",
    max: 1_000_000,
  },
  {
    key: "depositLowThreshold",
    label: "Alerte « dépôt bas » sous (FCFA)",
    help: "L'équipe (finances) et le restaurant sont prévenus quand le solde passe sous ce montant.",
    max: 1_000_000,
  },
];

type ModeKey = "foodPricingMode" | "parcelPricingMode" | "zedPricingMode";

// Grille par tranches de distance, commune aux repas, aux colis et à la course demandée (mode « Grille »).
const GRID_FIELDS: typeof FIELDS = [
  { key: "gridTier1Km", label: "1re tranche : jusqu'à (km)", help: "Distance incluse dans le premier prix.", max: 100 },
  { key: "gridTier1Fee", label: "1re tranche : prix (FCFA)", help: "Aussi le prix « dès » affiché quand la distance n'est pas encore connue.", max: 1_000_000 },
  { key: "gridTier2Km", label: "2e tranche : jusqu'à (km)", help: "Au-delà de la 1re tranche et jusqu'à cette distance incluse.", max: 100 },
  { key: "gridTier2Fee", label: "2e tranche : prix (FCFA)", help: "Prix de la 2e tranche.", max: 1_000_000 },
  { key: "gridTier3Fee", label: "Au-delà : prix (FCFA)", help: "Prix au-delà de la 2e tranche. Le client ne paie jamais plus.", max: 1_000_000 },
];
type NumberKey = Exclude<keyof Settings, "plusEnabled" | "mobileMoneyEnabled" | "zedEnabled" | "zedPaymentNumber" | "zedekaWhatsapp" | "zedButtonColor" | ModeKey>;

const PARCEL_FIELDS: typeof FIELDS = [
  {
    key: "parcelPerKmFee",
    label: "Prix par km (FCFA)",
    help: "Distance à vol d'oiseau entre le retrait et le point de livraison, arrondie aux 50 FCFA supérieurs.",
    max: 100_000,
  },
  { key: "parcelMinFee", label: "Prix minimum (FCFA)", help: "Aussi appliqué quand le client n'a donné qu'une adresse écrite (prix à confirmer).", max: 1_000_000 },
  { key: "parcelMaxFee", label: "Prix maximum (FCFA)", help: "0 pour aucun plafond.", max: 1_000_000 },
  {
    key: "merchantFlatFrom",
    label: "Tarif boutique : après (colis du mois)",
    help: "Une boutique de l'appli marchand qui a déjà envoyé ce nombre de colis dans le mois passe au tarif boutique. 0 pour couper le tarif boutique.",
    max: 10_000,
  },
  {
    key: "merchantFlatFee",
    label: "Tarif boutique : prix par colis (FCFA)",
    help: "Prix de livraison fixe des colis suivants, jamais plus cher que le prix au km. Les suppléments de type et de poids restent dus.",
    max: 1_000_000,
  },
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

  const section = (title: string, fields: typeof FIELDS, modeKey?: ModeKey, zoneMode = true) => (
    <Card title={title}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const ok = await action.run(async () => {
            await adminFetch("/settings", {
              method: "PATCH",
              body: {
                ...Object.fromEntries(fields.map(({ key }) => [key, Number(f.get(key))])),
                ...(modeKey ? { [modeKey]: String(f.get(modeKey)) } : {}),
              },
            });
            await reload();
          });
          setSaved(ok ? title : null);
        }}
        className="space-y-4"
      >
        {modeKey && (
          <fieldset className="space-y-2 text-sm">
            <legend className="font-medium">{t("Facturer la livraison")}</legend>
            <label className="flex items-start gap-2">
              <input type="radio" name={modeKey} value="GRID" defaultChecked={data[modeKey] === "GRID"} className="mt-1 accent-emerald-600" />
              <span>
                <span className="font-medium">{t("Grille par tranches")}</span>
                <span className="block text-stone-500">{t("Prix fixe par tranche de distance, réglé dans « Grille de prix ».")}</span>
              </span>
            </label>
            <label className="flex items-start gap-2">
              <input type="radio" name={modeKey} value="KM" defaultChecked={data[modeKey] !== "ZONE" && data[modeKey] !== "GRID"} className="mt-1 accent-emerald-600" />
              <span>
                <span className="font-medium">{t("Au km")}</span>
                <span className="block text-stone-500">{t("Prix selon la distance, avec le tarif ci-dessous.")}</span>
              </span>
            </label>
            {zoneMode && <label className="flex items-start gap-2">
              <input type="radio" name={modeKey} value="ZONE" defaultChecked={data[modeKey] === "ZONE"} className="mt-1 accent-emerald-600" />
              <span>
                <span className="font-medium">{t("Par zone")}</span>
                <span className="block text-stone-500">
                  {t("Prix fixe de la zone de livraison, défini dans l'écran Zones. Hors zone ou sans position, le tarif au km s'applique.")}
                </span>
              </span>
            </label>}
          </fieldset>
        )}
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
    <DirectorEdits>
      <PageHeader
        icon="settings"
        title="Réglages"
        description="Prix des repas et des colis, paiement, part des livreurs, règles d'annulation et abonnement des commerces partenaires."
      />
      {section("Grille de prix", GRID_FIELDS)}
      {section("Prix des repas", FOOD_FIELDS, "foodPricingMode")}
      {section("Prix des colis", PARCEL_FIELDS, "parcelPricingMode")}
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
      <Card title="Mode Zed (moto-taxi)">
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            checked={data.zedEnabled}
            onChange={async (e) => {
              const on = e.target.checked;
              const ok = await action.run(async () => {
                await adminFetch("/settings", { method: "PATCH", body: { zedEnabled: on } });
                await reload();
              });
              setSaved(ok ? "Zed" : null);
            }}
            className="mt-1 h-4 w-4 accent-emerald-600"
          />
          <span>
            <span className="font-medium">{t("Mode Zed activé")}</span>
            <span className="block text-stone-500">
              {t("Activé : le bouton Zed apparaît au milieu de la barre de l'appli client et les clients peuvent appeler un Zed. Désactivé : rien n'est visible côté client ; les conducteurs peuvent toujours s'inscrire et payer leur plan.")}
            </span>
            {saved === "Zed" && <span className="text-emerald-700">{t("Enregistré")}</span>}
          </span>
        </label>
        <fieldset className="mt-4 text-sm">
          <legend className="font-medium">{t("Couleur du bouton Zed dans l'appli client")}</legend>
          <div className="mt-2 flex flex-wrap gap-3">
            {(Object.keys(ZED_COLORS) as ZedColor[]).map((c) => (
              <button
                key={c}
                type="button"
                aria-pressed={data.zedButtonColor === c}
                onClick={async () => {
                  const ok = await action.run(async () => {
                    await adminFetch("/settings", { method: "PATCH", body: { zedButtonColor: c } });
                    await reload();
                  });
                  setSaved(ok ? "ZedColor" : null);
                }}
                className={`flex items-center gap-2 rounded-xl border-2 px-3 py-2 ${data.zedButtonColor === c ? "border-emerald-600 bg-emerald-50" : "border-stone-200"}`}
              >
                <span className={`grid h-9 w-9 place-items-center rounded-full ${ZED_COLORS[c].button}`}>
                  <Icon name="rider" className="h-5 w-5" />
                </span>
                {t(ZED_COLORS[c].label)}
              </button>
            ))}
          </div>
          {saved === "ZedColor" && <span className="mt-1 block text-emerald-700">{t("Enregistré")}</span>}
        </fieldset>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const v = String(new FormData(e.currentTarget).get("zedPaymentNumber") ?? "");
            const ok = await action.run(async () => {
              await adminFetch("/settings", { method: "PATCH", body: { zedPaymentNumber: v } });
              await reload();
            });
            setSaved(ok ? "ZedNumber" : null);
          }}
          className="mt-4 flex flex-wrap items-end gap-2 text-sm"
        >
          <label className="flex-1">
            <span className="block font-medium">{t("Numéro mobile money pour le plan Zed")}</span>
            <input name="zedPaymentNumber" defaultValue={data.zedPaymentNumber} maxLength={30} placeholder="+228 90 00 00 00" className={input} />
          </label>
          <button className={button}>{t("Enregistrer")}</button>
          {saved === "ZedNumber" && <span className="text-emerald-700">{t("Enregistré")}</span>}
        </form>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const v = String(new FormData(e.currentTarget).get("zedekaWhatsapp") ?? "");
            const ok = await action.run(async () => {
              await adminFetch("/settings", { method: "PATCH", body: { zedekaWhatsapp: v } });
              await reload();
            });
            setSaved(ok ? "ZedekaWhatsapp" : null);
          }}
          className="mt-4 flex flex-wrap items-end gap-2 text-sm"
        >
          <label className="flex-1">
            <span className="block font-medium">{t("Numéro WhatsApp de Zedeka (commandes, aide, livreurs)")}</span>
            <input name="zedekaWhatsapp" defaultValue={data.zedekaWhatsapp} maxLength={30} placeholder="+228 90 00 00 00" className={input} />
          </label>
          <button className={button}>{t("Enregistrer")}</button>
          {saved === "ZedekaWhatsapp" && <span className="text-emerald-700">{t("Enregistré")}</span>}
        </form>
      </Card>
      {section("Plan et appels Zed", ZED_FIELDS, "zedPricingMode", false)}
      {section("Livreurs et annulations", FIELDS)}
      {section("Commerces partenaires", VENDOR_FIELDS)}
      <div id="leasing">{section("Leasing de motos", LEASE_FIELDS)}</div>
      <div id="fidelite" className="space-y-4">
        <Card title="Zedeka+">
          <label className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              checked={data.plusEnabled}
              onChange={async (e) => {
                const on = e.target.checked;
                const ok = await action.run(async () => {
                  await adminFetch("/settings", { method: "PATCH", body: { plusEnabled: on } });
                  await reload();
                });
                setSaved(ok ? "Plus" : null);
              }}
              className="mt-1 h-4 w-4 accent-emerald-600"
            />
            <span>
              <span className="font-medium">{t("Proposer Zedeka+ aux clients")}</span>
              <span className="block text-stone-500">{t("Désactivé : l'offre est masquée dans l'appli et aucune remise Zedeka+ n'est appliquée.")}</span>
              {saved === "Plus" && <span className="text-emerald-700">{t("Enregistré")}</span>}
            </span>
          </label>
        </Card>
        {section("Zedeka+, fidélité et mises en avant", LOYALTY_FIELDS)}
      </div>
      <div id="ecole">{section("Transport scolaire", SCHOOL_FIELDS)}</div>
    </DirectorEdits>
  );
}
