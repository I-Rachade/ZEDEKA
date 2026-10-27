"use client";

import { use, useEffect, useState } from "react";
import QRCode from "qrcode";
import { fcfa } from "@/lib/api";
import { adminFetch, type AdminMenuItem, type AdminRestaurant } from "@/lib/admin";
import { button, buttonGhost, Card, ErrorNote, input, Loading } from "../../ui";
import { useAction, useAdmin } from "../../useAdmin";

function QrBlock({ slug, name }: { slug: string; name: string }) {
  const [url, setUrl] = useState("");
  const [png, setPng] = useState("");
  useEffect(() => {
    const target = `${window.location.origin}/r/${slug}`;
    setUrl(target);
    QRCode.toDataURL(target, { width: 600, margin: 2 }).then(setPng);
  }, [slug]);

  return (
    <Card title="QR code à afficher">
      <div className="flex flex-col items-center gap-2 text-center sm:flex-row sm:text-left">
        {/* eslint-disable-next-line @next/next/no-img-element -- image générée localement (data URL) */}
        {png && <img src={png} alt={`QR code de ${name}`} className="h-40 w-40" />}
        <div className="space-y-2 text-sm">
          <p className="break-all text-stone-600">{url}</p>
          {png && (
            <a href={png} download={`qr-zedeka-${slug}.png`} className={`${button} inline-block`}>
              Télécharger le QR code
            </a>
          )}
        </div>
      </div>
    </Card>
  );
}

function ItemRow({ item, onSave }: { item: AdminMenuItem; onSave: (id: string, body: Partial<AdminMenuItem>) => Promise<boolean> }) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <li className="py-2">
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const ok = await onSave(item.id, {
              category: String(f.get("category")),
              name: String(f.get("name")),
              description: String(f.get("description")) || null,
              price: Number(f.get("price")),
            });
            if (ok) setEditing(false);
          }}
          className="grid gap-2 sm:grid-cols-4"
        >
          <input name="category" defaultValue={item.category} required className={input} />
          <input name="name" defaultValue={item.name} required className={input} />
          <input name="description" defaultValue={item.description ?? ""} placeholder="Description" className={input} />
          <input name="price" type="number" min={0} step={50} defaultValue={item.price} required className={input} />
          <div className="flex gap-2 sm:col-span-4">
            <button className={button}>Enregistrer</button>
            <button type="button" onClick={() => setEditing(false)} className={buttonGhost}>
              Annuler
            </button>
          </div>
        </form>
      </li>
    );
  }

  return (
    <li className="flex items-center justify-between gap-2 py-2">
      <div className={item.available ? "" : "opacity-50"}>
        <p className="font-medium">{item.name}</p>
        <p className="text-sm text-stone-500">
          {item.category} · {fcfa(item.price)}
        </p>
      </div>
      <div className="flex shrink-0 gap-1">
        <button onClick={() => onSave(item.id, { available: !item.available })} className={buttonGhost}>
          {item.available ? "Épuisé" : "Disponible"}
        </button>
        <button onClick={() => setEditing(true)} className={buttonGhost}>
          Modifier
        </button>
      </div>
    </li>
  );
}

export default function RestaurantDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, error, reload } = useAdmin<AdminRestaurant>(`/restaurants/${id}`);
  const action = useAction();
  const [saved, setSaved] = useState(false);

  if (error) return <ErrorNote message={error} />;
  if (!data) return <Loading />;

  const saveItem = (itemId: string, body: Partial<AdminMenuItem>) =>
    action.run(async () => {
      await adminFetch(`/items/${itemId}`, { method: "PATCH", body });
      await reload();
    });

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">{data.name}</h1>

      <Card title="Informations">
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const ok = await action.run(async () => {
              await adminFetch(`/restaurants/${id}`, {
                method: "PATCH",
                body: {
                  name: f.get("name"),
                  phone: f.get("phone"),
                  address: f.get("address"),
                  commissionRate: Number(f.get("commissionRate")),
                  active: f.get("active") === "on",
                },
              });
              await reload();
            });
            setSaved(ok);
          }}
          className="grid gap-2 sm:grid-cols-2"
        >
          <input name="name" defaultValue={data.name} required className={input} />
          <input name="phone" defaultValue={data.phone} required className={input} />
          <input name="address" defaultValue={data.address} required className={input} />
          <label className="flex items-center gap-2 text-sm">
            Commission (%)
            <input name="commissionRate" type="number" min={0} max={50} defaultValue={data.commissionRate} className={`${input} w-20`} />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input name="active" type="checkbox" defaultChecked={data.active} /> Visible pour les clients
          </label>
          <div className="flex items-center gap-3 sm:col-span-2">
            <button className={button}>Enregistrer</button>
            {saved && <span className="text-sm text-emerald-700">Enregistré</span>}
          </div>
        </form>
      </Card>

      <QrBlock slug={data.slug} name={data.name} />

      <Card title="Carte">
        <ErrorNote message={action.error} />
        <ul className="divide-y divide-stone-100">
          {data.menuItems?.map((item) => <ItemRow key={item.id} item={item} onSave={saveItem} />)}
        </ul>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const f = new FormData(form);
            const ok = await action.run(async () => {
              await adminFetch(`/restaurants/${id}/items`, {
                method: "POST",
                body: {
                  category: f.get("category"),
                  name: f.get("name"),
                  description: String(f.get("description")) || null,
                  price: Number(f.get("price")),
                  sortOrder: data.menuItems?.length ?? 0,
                },
              });
              await reload();
            });
            if (ok) form.reset();
          }}
          className="mt-3 grid gap-2 border-t border-stone-100 pt-3 sm:grid-cols-4"
        >
          <input name="category" required placeholder="Catégorie (ex. Plats)" className={input} />
          <input name="name" required placeholder="Nom du plat" className={input} />
          <input name="description" placeholder="Description (facultatif)" className={input} />
          <input name="price" type="number" min={0} step={50} required placeholder="Prix FCFA" className={input} />
          <button className={`${button} sm:col-span-4`}>Ajouter le plat</button>
        </form>
      </Card>
    </div>
  );
}
