import { notFound } from "next/navigation";
import { apiGet, fcfa } from "@/lib/api";

type TripSummary = {
  code: string;
  status: "PENDING" | "CONFIRMED" | "ONGOING" | "COMPLETED" | "CANCELLED" | "PAYMENT_FAILED";
  pricing: "HOURLY" | "DAILY" | "DISTANCE";
  duration: number;
  scheduledAt: string | null;
  pickupAddress: string;
  destinationAddress: string;
  total: number;
  provider: { name: string; phone: string };
  vehicles: { name: string; quantity: number }[];
};

const LABEL: Record<TripSummary["status"], string> = {
  PENDING: "Reçue, en attente de confirmation du loueur",
  CONFIRMED: "Confirmée, véhicule réservé",
  ONGOING: "En cours",
  COMPLETED: "Terminée",
  CANCELLED: "Annulée",
  PAYMENT_FAILED: "Paiement non reçu",
};
const UNIT = { HOURLY: "h", DAILY: "jour(s)", DISTANCE: "km" };

export default async function ReservationPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const trip = await apiGet<TripSummary>(`/api/trips/${encodeURIComponent(code)}`);
  if (!trip) notFound();

  return (
    <div className="space-y-4 rounded-xl bg-white p-5 shadow-sm">
      <div>
        <h1 className="text-xl font-semibold">Réservation {trip.code}</h1>
        <p className="text-emerald-700">{LABEL[trip.status]}</p>
      </div>
      <dl className="space-y-1 text-sm">
        <div className="flex justify-between gap-2">
          <dt className="text-stone-500">Loueur</dt>
          <dd>
            {trip.provider.name}, {trip.provider.phone}
          </dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-stone-500">Véhicule</dt>
          <dd>
            {trip.vehicles.map((v) => `${v.quantity} × ${v.name}`).join(", ")} · {trip.duration} {UNIT[trip.pricing]}
          </dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-stone-500">Départ</dt>
          <dd>{trip.scheduledAt ? new Date(trip.scheduledAt).toLocaleString("fr-FR", { timeZone: "UTC", dateStyle: "short", timeStyle: "short" }) : "Dès que possible"}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-stone-500">Trajet</dt>
          <dd className="text-right">
            {trip.pickupAddress} → {trip.destinationAddress}
          </dd>
        </div>
        <div className="flex justify-between gap-2 text-base font-semibold">
          <dt>Total</dt>
          <dd>{fcfa(trip.total)}</dd>
        </div>
      </dl>
    </div>
  );
}
