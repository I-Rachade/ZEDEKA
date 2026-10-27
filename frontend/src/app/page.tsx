export default function Home() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Commandez, le livreur est déjà en route.</h1>
      <p className="text-stone-700">
        Zedeka livre vos repas et vos colis à Lomé, en un clic, sans tracasserie.
      </p>
      <div className="rounded-xl bg-white p-4 shadow-sm">
        <h2 className="font-semibold">Commander un repas</h2>
        <p className="mt-1 text-sm text-stone-600">
          Scannez le QR code affiché chez l&apos;un de nos restaurants partenaires pour ouvrir sa carte.
        </p>
      </div>
    </div>
  );
}
