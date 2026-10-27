"use client";

import { useState } from "react";
import ContactFields, { field } from "@/components/ContactFields";
import { useSession } from "@/lib/customer";
import OrderCreated from "@/components/OrderCreated";
import { createParcel, fcfa, type CreatedOrder, type ParcelCategory, type Zone } from "@/lib/api";

// Même arrondi que l'API : supplément au poids arrondi aux 50 FCFA supérieurs.
function extraFee(c: ParcelCategory | undefined, kg: number) {
  if (!c) return 0;
  return c.surcharge + Math.ceil((Math.max(0, kg) * c.perKgFee) / 50) * 50;
}

export default function ParcelForm({ zones, categories }: { zones: Zone[]; categories: ParcelCategory[] }) {
  const session = useSession();
  const [zoneId, setZoneId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [weight, setWeight] = useState("1");
  const [paymentMethod, setPaymentMethod] = useState<"CASH" | "MOBILE_MONEY">("CASH");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedOrder | null>(null);

  const category = categories.find((c) => c.id === categoryId);
  const fee = zones.find((z) => z.id === zoneId)?.deliveryFee ?? 0;
  const extra = extraFee(category, Number(weight) || 0);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setSubmitting(true);
    setError(null);
    try {
      setCreated(
        await createParcel({
          zoneId,
          customerName: String(f.get("name")),
          customerPhone: String(f.get("phone")),
          pickupAddress: String(f.get("pickupAddress")),
          address: String(f.get("address")),
          recipientName: String(f.get("recipientName")),
          recipientPhone: String(f.get("recipientPhone")),
          parcelCategoryId: categoryId,
          weightKg: Number(weight) || 0,
          note: String(f.get("note") ?? "") || undefined,
          paymentMethod,
        }),
      );
      window.scrollTo({ top: 0 });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  if (created) return <OrderCreated order={created} kind="PARCEL" />;

  return (
    <form onSubmit={submit} className="space-y-4">
      <section className="space-y-3 rounded-xl bg-white p-4 shadow-sm">
        <h2 className="font-semibold">Le colis</h2>
        <select required value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={field}>
          <option value="">Type de colis</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
              {c.surcharge || c.perKgFee
                ? ` (+ ${fcfa(c.surcharge)}${c.perKgFee ? `, + ${fcfa(c.perKgFee)}/kg` : ""})`
                : ""}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm">
          Poids approximatif (kg)
          <input
            type="number"
            min={0}
            max={100}
            step={0.5}
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
            className="w-24 rounded-lg border border-stone-300 p-2"
          />
        </label>
        <textarea name="pickupAddress" required minLength={5} rows={2} placeholder="Adresse de retrait" className={field} />
      </section>

      <section className="space-y-3 rounded-xl bg-white p-4 shadow-sm">
        <h2 className="font-semibold">Expéditeur</h2>
        <ContactFields
          key={session?.phone ?? "invite"}
          defaultName={session?.name ?? undefined}
          defaultPhone={session?.phone ?? undefined}
          zones={zones}
          zoneId={zoneId}
          onZone={setZoneId}
          paymentMethod={paymentMethod}
          onPayment={setPaymentMethod}
        />
      </section>

      <section className="space-y-3 rounded-xl bg-white p-4 shadow-sm">
        <h2 className="font-semibold">Destinataire</h2>
        <input name="recipientName" required minLength={2} placeholder="Nom du destinataire" className={field} />
        <input
          name="recipientPhone"
          required
          type="tel"
          inputMode="tel"
          pattern="\+?[0-9 ]{8,15}"
          placeholder="Téléphone du destinataire"
          className={field}
        />
        <textarea name="address" required minLength={5} rows={2} placeholder="Adresse de livraison et repère" className={field} />
        <textarea name="note" rows={2} placeholder="Instructions (facultatif)" className={field} />
      </section>

      <section className="space-y-1 rounded-xl bg-white p-4 text-sm shadow-sm">
        <div className="flex justify-between">
          <span>Livraison</span>
          <span>{zoneId ? fcfa(fee) : "–"}</span>
        </div>
        <div className="flex justify-between">
          <span>Supplément colis</span>
          <span>{fcfa(extra)}</span>
        </div>
        <div className="flex justify-between text-base font-semibold">
          <span>Total</span>
          <span>{fcfa(fee + extra)}</span>
        </div>
        {error && <p className="mt-2 rounded-lg bg-red-50 p-3 text-red-700">{error}</p>}
        <button disabled={submitting} className="mt-3 w-full rounded-lg bg-emerald-600 px-4 py-3 font-semibold text-white disabled:opacity-60">
          {submitting ? "Envoi…" : "Demander la livraison"}
        </button>
      </section>
    </form>
  );
}
