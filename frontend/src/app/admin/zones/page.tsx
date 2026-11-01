"use client";

import { useState } from "react";
import Link from "next/link";
import { fcfa } from "@/lib/api";
import MapPicker, { type Point } from "@/components/MapPicker";
import { adminFetch, type AdminZone } from "@/lib/admin";
import { DirectorEdits, button, buttonGhost, Card, ErrorNote, input, Loading, PageHeader } from "../ui";
import { useAction, useAdmin } from "../useAdmin";
import { useT } from "@/lib/i18n/client";

const centreOf = (z?: AdminZone): Point | null => (z && z.latitude !== null && z.longitude !== null ? { latitude: z.latitude, longitude: z.longitude } : null);

function ZoneForm({ zone, onSubmit, onCancel }: { zone?: AdminZone; onSubmit: (body: Partial<AdminZone>) => Promise<boolean>; onCancel?: () => void }) {
  const [centre, setCentre] = useState<Point | null>(centreOf(zone));
  const [picking, setPicking] = useState(false);
  const t = useT();
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const f = new FormData(form);
        const ok = await onSubmit({
          name: String(f.get("name")),
          deliveryFee: Number(f.get("deliveryFee") || 0),
          latitude: centre?.latitude ?? null,
          longitude: centre?.longitude ?? null,
        });
        if (ok && !zone) {
          form.reset();
          setCentre(null);
        }
      }}
      className="grid gap-2 text-sm sm:grid-cols-3"
    >
      <input name="name" required defaultValue={zone?.name} placeholder={t("Nom de la zone")} className={`${input} sm:col-span-2`} />
      <label className="flex items-center justify-between gap-2">
        {t("Prix de la zone")}
        <input name="deliveryFee" type="number" min={0} step={50} required defaultValue={zone?.deliveryFee ?? ""} className={`${input} w-28`} />
      </label>
      <div className="flex items-center gap-2 sm:col-span-3">
        <button type="button" onClick={() => setPicking(true)} className={buttonGhost}>
          {centre ? t("Déplacer le centre") : t("Placer le centre sur la carte")}
        </button>
        <span className="text-stone-500">{centre ? t("Centre placé : les commandes livrées près de ce point prennent cette zone.") : t("Sans centre, la zone d'une commande vient des commerces proches.")}</span>
      </div>
      {picking && (
        <MapPicker
          title={zone ? t("Centre de {name}", { name: zone.name }) : t("Centre de la zone")}
          initial={centre}
          onClose={() => setPicking(false)}
          onPick={(p) => {
            setCentre(p);
            setPicking(false);
          }}
        />
      )}
      <div className="flex gap-2 sm:col-span-3">
        <button className={button}>{zone ? t("Enregistrer") : t("Ajouter la zone")}</button>
        {onCancel && (
          <button type="button" onClick={onCancel} className={buttonGhost}>
            {t("Annuler")}
          </button>
        )}
      </div>
    </form>
  );
}

type PricingModes = { foodPricingMode?: "KM" | "ZONE"; parcelPricingMode?: "KM" | "ZONE" };

export default function ZonesPage() {
  const { data, error, reload } = useAdmin<AdminZone[]>("/zones");
  // Mode de facturation (Réglages) : le prix de la zone ne sert que pour les services facturés par zone.
  const { data: modes } = useAdmin<PricingModes>("/settings");
  const action = useAction();
  const [editing, setEditing] = useState<string | null>(null);
  const t = useT();

  const save = (id: string, body: Partial<AdminZone>) =>
    action.run(async () => {
      await adminFetch(`/zones/${id}`, { method: "PATCH", body });
      await reload();
      setEditing(null);
    });

  return (
    <DirectorEdits>
      <PageHeader
        icon="map"
        title="Zones"
        description="Zones de Lomé : elles servent à placer les livreurs et à répartir les courses. Une commande prend la zone du centre le plus proche. Le prix de la zone s'applique aux services facturés par zone (Réglages)."
      />
      {modes && (
        <p className="rounded-lg bg-stone-100 px-3 py-2 text-sm text-stone-700">
          {t("Repas : {food}. Colis : {parcel}.", {
            food: modes.foodPricingMode === "ZONE" ? t("prix de la zone") : t("au km"),
            parcel: modes.parcelPricingMode === "ZONE" ? t("prix de la zone") : t("au km"),
          })}{" "}
          <Link href="/admin/reglages" className="text-emerald-700 underline">
            {t("Changer dans les Réglages")}
          </Link>
        </p>
      )}
      <ErrorNote message={action.error ?? error} />
      {!data ? (
        <Loading />
      ) : (
        <Card>
          <ul className="divide-y divide-stone-100">
            {data.map((z) =>
              editing === z.id ? (
                <li key={z.id} className="py-3">
                  <ZoneForm zone={z} onSubmit={(b) => save(z.id, b)} onCancel={() => setEditing(null)} />
                </li>
              ) : (
                <li key={z.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <div className={z.active ? "" : "opacity-50"}>
                    <p className="font-medium">{z.name}</p>
                    <p className="text-sm text-stone-500">
                      {z.deliveryFee > 0 ? fcfa(z.deliveryFee) : t("Prix à définir")} · {centreOf(z) ? t("Centre placé") : t("Centre à placer")}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    <button onClick={() => setEditing(z.id)} className={buttonGhost}>
                      {t("Modifier")}
                    </button>
                    <button onClick={() => save(z.id, { active: !z.active })} className={buttonGhost}>
                      {z.active ? t("Désactiver") : t("Activer")}
                    </button>
                  </div>
                </li>
              ),
            )}
          </ul>
          <div className="mt-3 border-t border-stone-100 pt-3">
            <ZoneForm
              onSubmit={(body) =>
                action.run(async () => {
                  await adminFetch("/zones", { method: "POST", body });
                  await reload();
                })
              }
            />
          </div>
        </Card>
      )}
    </DirectorEdits>
  );
}
