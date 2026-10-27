import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { apiGet } from "@/lib/api";
import BookingForm, { type RentalOffer } from "./BookingForm";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const p = await apiGet<RentalOffer>(`/api/rentals/${encodeURIComponent(slug)}`);
  return { title: p ? `${p.name} – location – Zedeka` : "Loueur introuvable – Zedeka" };
}

export default async function RentalPage({ params }: Props) {
  const { slug } = await params;
  const provider = await apiGet<RentalOffer>(`/api/rentals/${encodeURIComponent(slug)}`);
  if (!provider) notFound();

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        {provider.logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- logo fourni par le loueur
          <img src={provider.logoUrl} alt="" className="h-14 w-14 rounded-full object-cover" />
        )}
        <div>
          <h1 className="text-2xl font-bold">{provider.name}</h1>
          <p className="text-sm text-stone-600">
            Location de véhicules · {provider.address} · prêt en {provider.pickupTimeMin}–{provider.pickupTimeMax} min
          </p>
        </div>
      </div>
      {!provider.availability.open && (
        <p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">
          <strong>Fermé pour le moment.</strong> {provider.availability.reason} Vous pouvez consulter les véhicules, mais pas réserver.
        </p>
      )}
      <BookingForm provider={provider} />
    </div>
  );
}
