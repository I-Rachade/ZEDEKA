"use client";

import { useState } from "react";
import { field } from "@/components/ContactFields";
import TermsConsent from "@/components/legal/TermsConsent";
import OrderCreated from "@/components/OrderCreated";
import { useSession } from "@/lib/customer";
import { apiPost, fcfa, type CreatedOrder } from "@/lib/api";

type Pricing = "HOURLY" | "DAILY" | "DISTANCE";

export type RentalOffer = {
  slug: string;
  name: string;
  address: string;
  logoUrl: string | null;
  scheduledTrips: boolean;
  pickupTimeMin: number;
  pickupTimeMax: number;
  taxPercent: number;
  availability: { open: boolean; reason: string | null };
  vehicles: {
    id: string;
    name: string;
    description: string | null;
    imageUrl: string | null;
    brand: string;
    model: string;
    category: string;
    seats: number;
    airConditioning: boolean;
    fuel: string;
    transmission: string;
    hourlyPrice: number | null;
    dailyPrice: number | null;
    perKmPrice: number | null;
    discountPercent: number;
    _count: { units: number };
  }[];
};

const PRICING: { value: Pricing; label: string; unit: string; key: "hourlyPrice" | "dailyPrice" | "perKmPrice" }[] = [
  { value: "HOURLY", label: "À l'heure", unit: "heure(s)", key: "hourlyPrice" },
  { value: "DAILY", label: "À la journée", unit: "jour(s)", key: "dailyPrice" },
  { value: "DISTANCE", label: "Au km", unit: "km", key: "perKmPrice" },
];

export default function BookingForm({ provider }: { provider: RentalOffer }) {
  const session = useSession();
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [pricing, setPricing] = useState<Pricing>("HOURLY");
  const [duration, setDuration] = useState(1);
  const [quantity, setQuantity] = useState(1);
  const [when, setWhen] = useState<"now" | "later">("now");
  const [payment, setPayment] = useState<"CASH" | "MOBILE_MONEY">("CASH");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState<CreatedOrder | null>(null);

  const vehicle = provider.vehicles.find((v) => v.id === vehicleId);
  const options = vehicle ? PRICING.filter((p) => vehicle[p.key] !== null) : [];
  const unit = vehicle && (vehicle[PRICING.find((p) => p.value === pricing)!.key] ?? null);
  const price = unit !== null && unit !== undefined ? unit * quantity * duration : 0;
  const discount = vehicle ? Math.round((price * vehicle.discountPercent) / 100) : 0;
  const tax = Math.round(((price - discount) * provider.taxPercent) / 100);

  if (created) return <OrderCreated order={created} trackHref={`/reservation/${created.code}`} label="Réservation" kind="RENTAL" />;

  function choose(id: string) {
    const v = provider.vehicles.find((x) => x.id === id)!;
    setVehicleId(id);
    setPricing(PRICING.find((p) => v[p.key] !== null)!.value);
    setQuantity(1);
  }

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (!vehicle) return;
        const f = new FormData(e.currentTarget);
        const scheduled = String(f.get("scheduledAt") ?? "");
        setSubmitting(true);
        setError(null);
        try {
          setCreated(
            await apiPost<CreatedOrder>("/api/trips", {
              providerSlug: provider.slug,
              vehicleId: vehicle.id,
              quantity,
              pricing,
              duration,
              ...(when === "later" && scheduled && { scheduledAt: `${scheduled}:00Z` }),
              customerName: String(f.get("name")).trim(),
              customerPhone: String(f.get("phone")).trim(),
              pickupAddress: String(f.get("pickupAddress")).trim(),
              destinationAddress: String(f.get("destinationAddress")).trim(),
              note: String(f.get("note") ?? "").trim() || undefined,
              paymentMethod: payment,
              acceptTerms: f.get("acceptTerms") === "on",
            }),
          );
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setSubmitting(false);
        }
      }}
      className="space-y-6 pb-24"
    >
      <section className="space-y-2">
        <h2 className="font-semibold">Choisissez un véhicule</h2>
        <ul className="space-y-2">
          {provider.vehicles.map((v) => (
            <li key={v.id}>
              <button
                type="button"
                disabled={!provider.availability.open || v._count.units === 0}
                onClick={() => choose(v.id)}
                className={`flex w-full gap-3 rounded-xl border bg-white p-3 text-left disabled:opacity-60 ${vehicleId === v.id ? "border-emerald-600 ring-2 ring-emerald-100" : "border-stone-200"}`}
              >
                {v.imageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element -- photo fournie par le loueur
                  <img src={v.imageUrl} alt="" className="h-16 w-20 rounded object-cover" />
                )}
                <span className="flex-1">
                  <span className="block font-medium">{v.name}</span>
                  <span className="block text-sm text-stone-600">
                    {v.category} · {v.seats} places · {v.transmission}
                    {v.airConditioning ? " · clim" : ""}
                  </span>
                  <span className="block text-sm">
                    {PRICING.filter((p) => v[p.key] !== null)
                      .map((p) => `${fcfa(v[p.key]!)} / ${p.unit.replace("(s)", "")}`)
                      .join(" · ")}
                    {v.discountPercent > 0 && <span className="ml-1 text-emerald-700">−{v.discountPercent} %</span>}
                  </span>
                  {v._count.units === 0 && <span className="block text-xs text-stone-500">Indisponible</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      {vehicle && (
        <section className="space-y-3 rounded-xl bg-white p-4 shadow-sm">
          <h2 className="font-semibold">Votre location</h2>
          <div className="flex flex-wrap gap-2">
            {options.map((p) => (
              <button
                key={p.value}
                type="button"
                onClick={() => setPricing(p.value)}
                className={`rounded-full border px-3 py-1 text-sm ${pricing === p.value ? "border-emerald-600 bg-emerald-50" : "border-stone-300"}`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm">
              Durée ({PRICING.find((p) => p.value === pricing)!.unit})
              <input type="number" min={1} max={1000} value={duration} onChange={(e) => setDuration(Math.max(1, Number(e.target.value)))} className={`${field} mt-1`} />
            </label>
            <label className="text-sm">
              Nombre de véhicules
              <input
                type="number"
                min={1}
                max={vehicle._count.units}
                value={quantity}
                onChange={(e) => setQuantity(Math.min(vehicle._count.units, Math.max(1, Number(e.target.value))))}
                className={`${field} mt-1`}
              />
            </label>
          </div>
          {provider.scheduledTrips && (
            <div className="flex gap-2">
              {(["now", "later"] as const).map((w) => (
                <button key={w} type="button" onClick={() => setWhen(w)} className={`flex-1 rounded-lg border p-2 text-sm ${when === w ? "border-emerald-600 bg-emerald-50" : "border-stone-300"}`}>
                  {w === "now" ? "Dès que possible" : "Plus tard"}
                </button>
              ))}
            </div>
          )}
          {when === "later" && <input name="scheduledAt" type="datetime-local" required aria-label="Date et heure de départ" className={field} />}
          <input name="pickupAddress" required minLength={5} placeholder="Lieu de prise en charge (ex. Aéroport de Lomé)" className={field} />
          <input name="destinationAddress" required minLength={3} placeholder="Destination" className={field} />
          <input key={`n-${session?.phone}`} name="name" required minLength={2} placeholder="Votre nom" defaultValue={session?.name ?? undefined} className={field} />
          <input key={`p-${session?.phone}`} name="phone" required inputMode="tel" placeholder="Téléphone (ex. 90 12 34 56)" defaultValue={session?.phone} className={field} />
          <textarea name="note" rows={2} placeholder="Note pour le loueur (facultatif)" className={field} />
          <div className="flex gap-2">
            {(["CASH", "MOBILE_MONEY"] as const).map((m) => (
              <button key={m} type="button" onClick={() => setPayment(m)} className={`flex-1 rounded-lg border p-2 text-sm ${payment === m ? "border-emerald-600 bg-emerald-50" : "border-stone-300"}`}>
                {m === "CASH" ? "Espèces" : "Mobile money"}
              </button>
            ))}
          </div>
          <dl className="space-y-1 border-t border-stone-100 pt-3 text-sm">
            <div className="flex justify-between">
              <dt>
                {fcfa(unit ?? 0)} × {quantity} × {duration}
              </dt>
              <dd>{fcfa(price)}</dd>
            </div>
            {discount > 0 && (
              <div className="flex justify-between text-emerald-700">
                <dt>Remise</dt>
                <dd>− {fcfa(discount)}</dd>
              </div>
            )}
            {tax > 0 && (
              <div className="flex justify-between">
                <dt>Taxe</dt>
                <dd>{fcfa(tax)}</dd>
              </div>
            )}
            <div className="flex justify-between text-base font-semibold">
              <dt>Total estimé</dt>
              <dd>{fcfa(price - discount + tax)}</dd>
            </div>
          </dl>
          <p className="text-xs text-stone-500">Le loueur confirme la réservation et peut ajouter des frais (carburant, péage) avec votre accord.</p>
          <TermsConsent />
          {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        </section>
      )}

      {vehicle && provider.availability.open && (
        <div className="fixed inset-x-0 bottom-0 border-t border-stone-200 bg-white p-3">
          <button type="submit" disabled={submitting} className="mx-auto block w-full max-w-2xl rounded-lg bg-emerald-600 px-4 py-3 font-semibold text-white disabled:opacity-60">
            {submitting ? "Envoi…" : `Réserver · ${fcfa(price - discount + tax)}`}
          </button>
        </div>
      )}
    </form>
  );
}
