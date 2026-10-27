import Link from "next/link";
import { fcfa, type CreatedOrder } from "@/lib/api";

export default function OrderCreated({ order }: { order: CreatedOrder }) {
  return (
    <div className="space-y-4 rounded-xl bg-white p-5 shadow-sm">
      <h2 className="text-xl font-semibold">Commande {order.code} enregistrée</h2>
      <p className="text-stone-700">
        Total à payer : <strong>{fcfa(order.total)}</strong>. Envoyez-nous la commande sur WhatsApp pour que le livreur
        parte tout de suite.
      </p>
      <a
        href={order.whatsappUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="block rounded-lg bg-emerald-600 px-4 py-3 text-center font-semibold text-white"
      >
        Envoyer sur WhatsApp
      </a>
      <Link href={`/commande/${order.code}`} className="block text-center text-sm text-emerald-700 underline">
        Suivre ma commande
      </Link>
    </div>
  );
}
