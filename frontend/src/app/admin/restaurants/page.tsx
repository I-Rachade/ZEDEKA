"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { fcfa } from "@/lib/api";
import { adminFetch, type AdminRestaurant, type RestaurantLocationLink } from "@/lib/admin";
import { button, buttonGhost, Card, ErrorNote, input, Loading, PageHeader } from "../ui";
import { useAction, useAdmin } from "../useAdmin";
import { useT } from "@/lib/i18n/client";
import type { T } from "@/lib/i18n";
import { type LocationChoice, LocationChoiceField, RestaurantLinkCard } from "./RestaurantLocation";

function slugify(name: string) {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// Ce que paie le restaurant : abonnement fixe, commission (anciens restaurants), ou les deux.
function pricing(r: AdminRestaurant, t: T) {
  const parts = [
    r.subscriptionFee !== null && t("abonnement {amount}/mois", { amount: fcfa(r.subscriptionFee) }),
    (r.commissionRate > 0 || r.subscriptionFee === null) && t("commission {rate} %", { rate: r.commissionRate }),
  ];
  return parts.filter(Boolean).join(" · ");
}

export default function RestaurantsPage() {
  const router = useRouter();
  const { data, error } = useAdmin<AdminRestaurant[]>("/restaurants");
  const action = useAction();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [location, setLocation] = useState<LocationChoice>(null);
  const [created, setCreated] = useState<{ id: string; name: string; link: RestaurantLocationLink } | null>(null);
  const [missing, setMissing] = useState(false);
  const t = useT();

  async function create(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // La position est obligatoire : placée sur la carte, ou demandée au gérant.
    if (!location) {
      setMissing(true);
      return;
    }
    const f = new FormData(e.currentTarget);
    let r: AdminRestaurant | null = null;
    const ok = await action.run(async () => {
      r = await adminFetch<AdminRestaurant>("/restaurants", {
        method: "POST",
        body: {
          name: f.get("name"),
          slug: f.get("slug"),
          phone: f.get("phone"),
          address: f.get("address"),
          commissionRate: Number(f.get("commissionRate")),
          // Vide : le prix d'abonnement en vigueur (Réglages).
          ...(f.get("subscriptionFee") ? { subscriptionFee: Number(f.get("subscriptionFee")) } : {}),
          ...(location.mode === "map" ? location.point : { requestLocation: true }),
        },
      });
    });
    if (!ok || !r) return;
    const made: AdminRestaurant = r;
    // Position demandée : on montre d'abord le lien à envoyer au gérant.
    if (made.locationLink) setCreated({ id: made.id, name: made.name, link: made.locationLink });
    else router.push(`/admin/restaurants/${made.id}`);
  }

  return (
    <div className="space-y-4">
      <PageHeader
        icon="store"
        title="Restaurants"
        description="Les restaurants partenaires, leur carte, leur QR code et leur accès à l'espace restaurant."
        actions={
          !adding && (
            <button
              onClick={() => {
                setAdding(true);
                setCreated(null);
                setLocation(null);
              }}
              className={button}
            >
              {t("Ajouter")}
            </button>
          )
        }
      />
      {created && (
        <Card title="Restaurant créé">
          <p className="mb-3 text-sm text-stone-600">
            {t("{name} est créé et reste masqué aux clients jusqu'à ce que le gérant envoie la position.", { name: created.name })}
          </p>
          <RestaurantLinkCard link={created.link} />
          <div className="mt-3">
            <Link href={`/admin/restaurants/${created.id}`} className={button}>
              {t("Ouvrir la fiche du restaurant")}
            </Link>
          </div>
        </Card>
      )}
      {adding && !created && (
        <Card title="Nouveau restaurant">
          <form onSubmit={create} className="grid gap-2 sm:grid-cols-2">
            <input name="name" required placeholder={t("Nom")} className={input} value={name} onChange={(e) => setName(e.target.value)} />
            <input name="slug" required placeholder={t("Adresse web (slug)")} className={input} key={slugify(name)} defaultValue={slugify(name)} />
            <input name="phone" required placeholder={t("Téléphone")} className={input} />
            <input name="address" required placeholder={t("Quartier, Lomé")} className={input} />
            <label className="flex items-center gap-2 text-sm">
              {t("Commission (%)")}
              <input name="commissionRate" type="number" min={0} max={50} defaultValue={0} className={`${input} w-20`} />
            </label>
            <label className="flex items-center gap-2 text-sm">
              {t("Abonnement (FCFA/mois)")}
              <input name="subscriptionFee" type="number" min={0} max={1000000} step={500} placeholder={t("prix actuel")} className={`${input} w-28`} />
            </label>
            <LocationChoiceField
              value={location}
              onChange={(v) => {
                setLocation(v);
                setMissing(false);
              }}
            />
            {missing && (
              <p role="alert" className="text-sm text-red-700 sm:col-span-2">
                {t("Placez le restaurant sur la carte, ou demandez sa position au gérant.")}
              </p>
            )}
            <div className="flex gap-2 sm:col-span-2">
              <button className={button}>{location?.mode === "request" ? t("Créer et obtenir le lien") : t("Créer")}</button>
              <button type="button" onClick={() => setAdding(false)} className={buttonGhost}>
                {t("Annuler")}
              </button>
            </div>
          </form>
          <div className="mt-2">
            <ErrorNote message={action.error} />
          </div>
        </Card>
      )}
      <ErrorNote message={error} />
      {!data ? (
        <Loading />
      ) : (
        <ul className="space-y-2">
          {data.map((r) => (
            <li key={r.id}>
              <Link href={`/admin/restaurants/${r.id}`} className="flex items-center justify-between rounded-xl bg-white p-4 shadow-sm">
                <div>
                  <p className="font-semibold">
                    {r.name} {!r.active && <span className="text-sm font-normal text-stone-500">{t("(inactif)")}</span>}{" "}
                    {r.locationState && r.locationState !== "SET" && (
                      <span className={`ml-1 rounded-full px-2 py-0.5 text-xs font-medium ${r.locationState === "REQUESTED" ? "bg-amber-100 text-amber-900" : "bg-red-100 text-red-800"}`}>
                        {r.locationState === "REQUESTED" ? t("Position demandée") : t("Position manquante")}
                      </span>
                    )}
                  </p>
                  <p className="text-sm text-stone-500">
                    {r.address}
                    {r.zone ? ` · ${r.zone.name.split(" – ")[0]}` : ""} · {t("{n} plats", { n: r._count?.menuItems ?? 0 })} · {pricing(r, t)}
                  </p>
                </div>
                <span className="text-sm text-stone-600">{t("{n} commandes", { n: r._count?.orders ?? 0 })}
                  {r.rating ? <span className="block text-right text-amber-600">★ {r.rating.toFixed(1)} ({r.ratingCount})</span> : null}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
