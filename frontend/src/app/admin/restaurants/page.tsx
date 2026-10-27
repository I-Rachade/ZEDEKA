"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { adminFetch, type AdminRestaurant } from "@/lib/admin";
import { button, buttonGhost, Card, ErrorNote, input, Loading, PageHeader } from "../ui";
import { useAction, useAdmin } from "../useAdmin";

function slugify(name: string) {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export default function RestaurantsPage() {
  const router = useRouter();
  const { data, error } = useAdmin<AdminRestaurant[]>("/restaurants");
  const action = useAction();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");

  async function create(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    let id = "";
    const ok = await action.run(async () => {
      const r = await adminFetch<AdminRestaurant>("/restaurants", {
        method: "POST",
        body: {
          name: f.get("name"),
          slug: f.get("slug"),
          phone: f.get("phone"),
          address: f.get("address"),
          commissionRate: Number(f.get("commissionRate")),
        },
      });
      id = r.id;
    });
    if (ok) router.push(`/admin/restaurants/${id}`);
  }

  return (
    <div className="space-y-4">
      <PageHeader
        icon="store"
        title="Restaurants"
        description="Les restaurants partenaires, leur carte, leur QR code et leur accès à l'espace restaurant."
        actions={
          !adding && (
            <button onClick={() => setAdding(true)} className={button}>
              Ajouter
            </button>
          )
        }
      />
      {adding && (
        <Card title="Nouveau restaurant">
          <form onSubmit={create} className="grid gap-2 sm:grid-cols-2">
            <input name="name" required placeholder="Nom" className={input} value={name} onChange={(e) => setName(e.target.value)} />
            <input name="slug" required placeholder="Adresse web (slug)" className={input} key={slugify(name)} defaultValue={slugify(name)} />
            <input name="phone" required placeholder="Téléphone" className={input} />
            <input name="address" required placeholder="Quartier, Lomé" className={input} />
            <label className="flex items-center gap-2 text-sm">
              Commission (%)
              <input name="commissionRate" type="number" min={0} max={50} defaultValue={10} className={`${input} w-20`} />
            </label>
            <div className="flex gap-2 sm:col-span-2">
              <button className={button}>Créer</button>
              <button type="button" onClick={() => setAdding(false)} className={buttonGhost}>
                Annuler
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
                    {r.name} {!r.active && <span className="text-sm font-normal text-stone-500">(inactif)</span>}
                  </p>
                  <p className="text-sm text-stone-500">
                    {r.address}
                    {r.zone ? ` · ${r.zone.name.split(" – ")[0]}` : ""} · {r._count?.menuItems ?? 0} plats · commission {r.commissionRate} %
                  </p>
                </div>
                <span className="text-sm text-stone-600">{r._count?.orders ?? 0} commandes</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
