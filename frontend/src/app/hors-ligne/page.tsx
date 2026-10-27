import type { Metadata } from "next";

export const metadata: Metadata = { title: "Hors ligne – Zedeka" };

export default function Offline() {
  return (
    <div className="space-y-3 py-10 text-center">
      <p className="text-4xl" aria-hidden="true">
        📶
      </p>
      <h1 className="text-xl font-bold">Pas de connexion</h1>
      <p className="text-stone-600">Vérifiez vos données mobiles ou le Wi-Fi, puis réessayez. Votre panier est gardé sur votre téléphone.</p>
      <a href="/app" className="inline-block rounded-lg bg-emerald-600 px-4 py-3 font-semibold text-white">
        Réessayer
      </a>
    </div>
  );
}
