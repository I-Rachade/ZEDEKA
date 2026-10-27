"use client";

import { useRouter } from "next/navigation";
import { use, useState } from "react";
import { button, buttonGhost, Card, ErrorNote, input, Loading, PageHeader, StickyActions } from "@/components/panel/ui";
import { rental, type Vehicle } from "@/lib/rental";

const CATEGORIES = ["Berline", "SUV", "4x4", "Minibus", "Pick-up", "Moto", "Utilitaire"];
const FUELS = ["Essence", "Diesel", "Hybride", "Électrique"];
const TRANSMISSIONS = ["Manuelle", "Automatique"];
const PRICES = [
  { key: "hourlyPrice", label: "Location à l'heure", unit: "FCFA / heure" },
  { key: "dailyPrice", label: "Location à la journée", unit: "FCFA / jour" },
  { key: "perKmPrice", label: "Location au kilomètre", unit: "FCFA / km" },
] as const;

type Unit = { plateNumber: string; vin: string };
const text = (v: FormDataEntryValue | null) => String(v ?? "").trim();
const optionalNumber = (v: FormDataEntryValue | null) => (text(v) === "" ? null : Number(v));

export default function VehiclePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return id === "nouveau" ? <VehicleForm vehicle={null} /> : <EditVehicle id={id} />;
}

function EditVehicle({ id }: { id: string }) {
  const { data, error } = rental.useResource<Vehicle>(`/vehicles/${id}`);
  if (error) return <ErrorNote message={error} />;
  if (!data) return <Loading />;
  return <VehicleForm vehicle={data} />;
}

function VehicleForm({ vehicle }: { vehicle: Vehicle | null }) {
  const router = useRouter();
  const action = rental.useAction();
  const [units, setUnits] = useState<Unit[]>(
    vehicle ? vehicle.units.filter((u) => u.active).map((u) => ({ plateNumber: u.plateNumber, vin: u.vin ?? "" })) : [{ plateNumber: "", vin: "" }],
  );
  const [enabled, setEnabled] = useState<Record<string, boolean>>({
    hourlyPrice: vehicle ? vehicle.hourlyPrice !== null : true,
    dailyPrice: vehicle ? vehicle.dailyPrice !== null : true,
    perKmPrice: vehicle ? vehicle.perKmPrice !== null : false,
  });
  const [saved, setSaved] = useState(false);

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const body = {
          name: text(f.get("name")),
          description: text(f.get("description")) || null,
          imageUrl: text(f.get("imageUrl")) || null,
          images: text(f.get("images"))
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean),
          brand: text(f.get("brand")),
          model: text(f.get("model")),
          category: text(f.get("category")),
          type: text(f.get("type")),
          seats: Number(f.get("seats")),
          airConditioning: f.get("airConditioning") === "on",
          fuel: text(f.get("fuel")),
          transmission: text(f.get("transmission")),
          engineCc: optionalNumber(f.get("engineCc")),
          powerHp: optionalNumber(f.get("powerHp")),
          hourlyPrice: enabled.hourlyPrice ? optionalNumber(f.get("hourlyPrice")) : null,
          dailyPrice: enabled.dailyPrice ? optionalNumber(f.get("dailyPrice")) : null,
          perKmPrice: enabled.perKmPrice ? optionalNumber(f.get("perKmPrice")) : null,
          discountPercent: Number(f.get("discountPercent") || 0),
        };
        const plates = units.filter((u) => u.plateNumber.trim()).map((u) => ({ plateNumber: u.plateNumber.trim().toUpperCase(), vin: u.vin.trim() || null }));
        setSaved(false);
        const ok = await action.run(async () => {
          if (!vehicle) {
            const created = await rental.apiFetch<Vehicle>("/vehicles", { method: "POST", body: { ...body, units: plates } });
            router.replace(`/location/vehicules/${created.id}`);
          } else {
            await rental.apiFetch(`/vehicles/${vehicle.id}`, { method: "PATCH", body });
            await rental.apiFetch(`/vehicles/${vehicle.id}/units`, { method: "PUT", body: { units: plates } });
          }
        });
        setSaved(ok && Boolean(vehicle));
      }}
      className="space-y-4"
    >
      <PageHeader
        icon="car"
        title={vehicle ? vehicle.name : "Nouveau véhicule"}
        description="Renseignez le modèle une fois ; ajoutez une immatriculation pour chaque exemplaire de votre flotte."
      />

      <Card title="Général">
        <div className="grid gap-3">
          <label className="text-sm">
            Nom affiché
            <input name="name" required minLength={2} defaultValue={vehicle?.name} placeholder="ex. Toyota Corolla climatisée" className={`${input} mt-1`} />
          </label>
          <label className="text-sm">
            Description
            <textarea name="description" rows={3} defaultValue={vehicle?.description ?? ""} className={`${input} mt-1`} />
          </label>
        </div>
      </Card>

      <Card title="Photos">
        <div className="grid gap-3">
          <label className="text-sm">
            Photo principale (lien https://…)
            <input name="imageUrl" type="url" defaultValue={vehicle?.imageUrl ?? ""} className={`${input} mt-1`} />
          </label>
          <label className="text-sm">
            Galerie (un lien par ligne)
            <textarea name="images" rows={3} defaultValue={vehicle?.images.join("\n") ?? ""} className={`${input} mt-1`} />
          </label>
        </div>
      </Card>

      <Card title="Caractéristiques">
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-sm">
            Marque
            <input name="brand" required defaultValue={vehicle?.brand} className={`${input} mt-1`} />
          </label>
          <label className="text-sm">
            Modèle
            <input name="model" required defaultValue={vehicle?.model} className={`${input} mt-1`} />
          </label>
          <label className="text-sm">
            Catégorie
            <select name="category" defaultValue={vehicle?.category ?? "Berline"} className={`${input} mt-1`}>
              {[...new Set([...CATEGORIES, ...(vehicle ? [vehicle.category] : [])])].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Gamme
            <input name="type" required defaultValue={vehicle?.type ?? "Standard"} placeholder="Standard, Confort, Luxe" className={`${input} mt-1`} />
          </label>
          <label className="text-sm">
            Places
            <input name="seats" type="number" min={1} max={60} required defaultValue={vehicle?.seats ?? 5} className={`${input} mt-1`} />
          </label>
          <label className="text-sm">
            Carburant
            <select name="fuel" defaultValue={vehicle?.fuel ?? "Essence"} className={`${input} mt-1`}>
              {FUELS.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Boîte de vitesses
            <select name="transmission" defaultValue={vehicle?.transmission ?? "Manuelle"} className={`${input} mt-1`}>
              {TRANSMISSIONS.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Cylindrée (cm³, facultatif)
            <input name="engineCc" type="number" min={0} defaultValue={vehicle?.engineCc ?? ""} className={`${input} mt-1`} />
          </label>
          <label className="text-sm">
            Puissance (ch, facultatif)
            <input name="powerHp" type="number" min={0} defaultValue={vehicle?.powerHp ?? ""} className={`${input} mt-1`} />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input name="airConditioning" type="checkbox" defaultChecked={vehicle?.airConditioning ?? true} /> Climatisation
          </label>
        </div>
      </Card>

      <Card title="Immatriculations">
        <p className="mb-2 text-sm text-stone-600">Une ligne par exemplaire de ce modèle. Vous choisirez l&apos;immatriculation au moment de confirmer une course.</p>
        <div className="space-y-2">
          {units.map((u, i) => (
            <div key={i} className="flex gap-2">
              <input
                value={u.plateNumber}
                onChange={(e) => setUnits((us) => us.map((x, j) => (j === i ? { ...x, plateNumber: e.target.value } : x)))}
                placeholder="Immatriculation (ex. TG-1234-AB)"
                aria-label="Immatriculation"
                className={`${input} flex-1`}
              />
              <input
                value={u.vin}
                onChange={(e) => setUnits((us) => us.map((x, j) => (j === i ? { ...x, vin: e.target.value } : x)))}
                placeholder="N° de châssis (facultatif)"
                aria-label="Numéro de châssis"
                className={`${input} flex-1`}
              />
              <button type="button" onClick={() => setUnits((us) => us.filter((_, j) => j !== i))} className="px-2 text-red-700" aria-label="Retirer">
                ×
              </button>
            </div>
          ))}
          <button type="button" onClick={() => setUnits((us) => [...us, { plateNumber: "", vin: "" }])} className={buttonGhost}>
            + Immatriculation
          </button>
        </div>
      </Card>

      <Card title="Tarifs">
        <div className="grid gap-3 sm:grid-cols-3">
          {PRICES.map((p) => (
            <div key={p.key} className={`rounded-lg border p-3 ${enabled[p.key] ? "border-emerald-300 bg-emerald-50/40" : "border-stone-200"}`}>
              <label className="flex items-center justify-between gap-2 text-sm font-medium">
                {p.label}
                <input type="checkbox" checked={enabled[p.key]} onChange={(e) => setEnabled((x) => ({ ...x, [p.key]: e.target.checked }))} />
              </label>
              <input
                name={p.key}
                type="number"
                min={0}
                step={50}
                disabled={!enabled[p.key]}
                required={enabled[p.key]}
                defaultValue={vehicle?.[p.key] ?? ""}
                aria-label={p.label}
                className={`${input} mt-2`}
              />
              <p className="mt-1 text-xs text-stone-500">{p.unit}</p>
            </div>
          ))}
        </div>
        <label className="mt-3 block max-w-xs text-sm">
          Remise sur ce véhicule (%)
          <input name="discountPercent" type="number" min={0} max={90} defaultValue={vehicle?.discountPercent ?? 0} className={`${input} mt-1`} />
        </label>
      </Card>

      <ErrorNote message={action.error} />
      <StickyActions>
        {saved && <span className="self-center text-sm text-emerald-700">Enregistré</span>}
        <button type="button" onClick={() => router.push("/location/vehicules")} className={buttonGhost}>
          Retour
        </button>
        <button className={button}>{vehicle ? "Enregistrer" : "Créer le véhicule"}</button>
      </StickyActions>
    </form>
  );
}
