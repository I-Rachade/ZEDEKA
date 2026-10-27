import Link from "next/link";

export default function Home() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Commandez, le livreur est déjà en route.</h1>
      <p className="text-stone-700">Zedeka livre vos repas et vos colis à Lomé, en un clic, sans tracasserie.</p>
      <Link href="/app" className="block rounded-xl bg-emerald-600 p-4 text-center font-semibold text-white shadow-sm">
        Ouvrir l&apos;application Zedeka
      </Link>
      <Link href="/app/recherche" className="block rounded-xl bg-white p-4 shadow-sm">
        <h2 className="font-semibold">Commander un repas</h2>
        <p className="mt-1 text-sm text-stone-600">
          Choisissez parmi nos restaurants partenaires, ou scannez le QR code affiché chez eux pour ouvrir leur carte.
        </p>
      </Link>
      <Link href="/app/location" className="block rounded-xl bg-white p-4 shadow-sm">
        <h2 className="font-semibold">Louer un véhicule</h2>
        <p className="mt-1 text-sm text-stone-600">Voiture ou minibus avec chauffeur, à l&apos;heure ou à la journée.</p>
      </Link>
      <Link href="/colis" className="block rounded-xl bg-white p-4 shadow-sm">
        <h2 className="font-semibold">Envoyer un colis</h2>
        <p className="mt-1 text-sm text-stone-600">Documents et marchandises livrés dans Lomé, au prix de la zone.</p>
      </Link>
      <p className="text-sm text-stone-600">
        Vous avez une moto ?{" "}
        <Link href="/devenir-livreur" className="text-emerald-700 underline">
          Devenez livreur
        </Link>
      </p>
    </div>
  );
}
