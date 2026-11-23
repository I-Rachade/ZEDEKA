"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { type Restaurant } from "@/lib/api";
import { addressLine, customerFetch, locateMe, useSession, type Address, type Position, type Profile } from "@/lib/customer";
import { useHydrated } from "@/lib/device";
import { useT } from "@/lib/i18n/client";

// Lancer une commande groupée (bureau, école) : lieu de livraison, heure limite facultative, facturation entreprise.
// Ensuite, le lien /groupe/<code> se partage (WhatsApp) et chacun ajoute sa part.
export default function GroupStart({ restaurant }: { restaurant: Restaurant }) {
  const t = useT();
  const router = useRouter();
  const hydrated = useHydrated();
  const session = useSession();
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [addressId, setAddressId] = useState<string | null>(null);
  const [here, setHere] = useState<Position | null>(null);
  const [companies, setCompanies] = useState<{ id: string; name: string }[]>([]);
  const [companyId, setCompanyId] = useState<string>("");
  const [deadline, setDeadline] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;
    customerFetch<Profile>("/me").then(
      (p) => {
        const usable = p.addresses.filter((a) => a.latitude !== null && a.longitude !== null);
        setAddresses(usable);
        setAddressId((id) => id ?? usable[0]?.id ?? null);
      },
      () => {},
    );
    customerFetch<{ id: string; name: string }[]>("/companies").then(
      (list) => {
        setCompanies(list);
        if (list.length === 1) setCompanyId(list[0].id);
      },
      () => {},
    );
  }, [session]);

  if (!hydrated) return null;
  const saved = addresses.find((a) => a.id === addressId);
  const point = addressId === "here" ? here : saved && saved.latitude !== null && saved.longitude !== null ? { latitude: saved.latitude, longitude: saved.longitude } : null;

  async function start() {
    if (!point) return setError(t("Choisissez où livrer"));
    setBusy(true);
    setError(null);
    try {
      const today = new Date().toISOString().slice(0, 10);
      const { code } = await customerFetch<{ code: string }>("/group-orders", {
        method: "POST",
        body: {
          restaurantSlug: restaurant.slug,
          address: saved ? addressLine(saved) : t("Ma position"),
          latitude: point.latitude,
          longitude: point.longitude,
          ...(deadline ? { deadline: `${today}T${deadline}:00Z` } : {}),
          ...(companyId ? { companyId } : {}),
        },
      });
      router.push(`/groupe/${code}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-xl space-y-4 px-4 pb-24 pt-4">
      <Link href={`/r/${restaurant.slug}`} className="text-sm text-emerald-700">
        ← {restaurant.name}
      </Link>
      <h1 className="text-[24px] font-bold leading-tight">👥 {t("Commande groupée")}</h1>
      <p className="text-[15px] text-stone-600">{t("Partagez un lien à vos collègues ou aux parents : chacun ajoute ses plats avec son prénom, vous envoyez une seule commande, livrée en une fois.")}</p>
      {!session ? (
        <Link href={`/app/connexion?suite=/r/${restaurant.slug}/groupe`} className="block rounded-2xl bg-emerald-600 px-4 py-3.5 text-center font-semibold text-white">
          {t("Se connecter")}
        </Link>
      ) : (
        <>
          <section className="space-y-2 rounded-2xl bg-surface p-4">
            <p className="text-sm font-medium">{t("Où livrer ?")}</p>
            {addresses.map((a) => (
              <button key={a.id} type="button" aria-pressed={addressId === a.id} onClick={() => setAddressId(a.id)} className={`block w-full rounded-xl border px-3 py-2.5 text-left text-[14px] ${addressId === a.id ? "border-emerald-700 bg-emerald-50" : "border-stone-200"}`}>
                {addressLine(a)}
              </button>
            ))}
            <button
              type="button"
              aria-pressed={addressId === "here"}
              onClick={async () => {
                const p = await locateMe();
                if (!p) return setError(t("Position introuvable : autorisez la localisation, ou enregistrez une adresse."));
                setHere(p);
                setAddressId("here");
              }}
              className={`block w-full rounded-xl border px-3 py-2.5 text-left text-[14px] ${addressId === "here" ? "border-emerald-700 bg-emerald-50" : "border-stone-200"}`}
            >
              📍 {t("Ma position actuelle")}
            </button>
            <Link href="/app/adresses" className="block text-sm text-emerald-700">
              {t("Ajouter une adresse (bureau, école…)")}
            </Link>
          </section>
          <section className="space-y-3 rounded-2xl bg-surface p-4">
            <label className="block text-sm font-medium">
              {t("Heure limite pour ajouter ses plats (facultatif)")}
              <input type="time" value={deadline} onChange={(e) => setDeadline(e.target.value)} className="mt-1 block w-full rounded-xl border border-stone-200 px-3 py-2.5" />
            </label>
            {companies.length > 0 && (
              <label className="block text-sm font-medium">
                {t("Paiement")}
                <select value={companyId} onChange={(e) => setCompanyId(e.target.value)} className="mt-1 block w-full rounded-xl border border-stone-200 px-3 py-2.5">
                  <option value="">{t("Espèces à la livraison")}</option>
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {t("Facturer à {name}", { name: c.name })}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </section>
          {error && <p className="rounded-xl bg-red-50 px-3 py-2.5 text-sm text-red-800">{error}</p>}
          <button type="button" disabled={busy} onClick={start} className="w-full rounded-2xl bg-emerald-600 px-4 py-4 text-[17px] font-semibold text-white disabled:opacity-50">
            {busy ? t("Envoi…") : t("Créer le lien à partager")}
          </button>
        </>
      )}
    </main>
  );
}
