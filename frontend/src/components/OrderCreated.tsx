import Link from "next/link";
import { fcfa, type CreatedOrder } from "@/lib/api";

export default function OrderCreated({ order, trackHref, label = "Commande" }: { order: CreatedOrder; trackHref?: string; label?: string }) {
  return (
    <div className="space-y-4 rounded-xl bg-white p-5 shadow-sm">
      <h2 className="text-xl font-semibold">
        {label} {order.code} enregistrée
      </h2>
      <p className="text-stone-700">
        Total à payer : <strong>{fcfa(order.total)}</strong>. Envoyez-nous {label === "Commande" ? "la commande" : "la réservation"} sur WhatsApp pour
        qu&apos;elle soit traitée tout de suite.
      </p>
      <a
        href={order.whatsappUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="block rounded-lg bg-emerald-600 px-4 py-3 text-center font-semibold text-white"
      >
        Envoyer sur WhatsApp
      </a>
      <Link href={trackHref ?? `/commande/${order.code}`} className="block text-center text-sm text-emerald-700 underline">
        Suivre ma {label === "Commande" ? "commande" : "réservation"}
      </Link>
    </div>
  );
}
