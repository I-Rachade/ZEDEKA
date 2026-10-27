"use client";

import { use, useEffect, useState } from "react";
import QRCode from "qrcode";
import { fcfa } from "@/lib/api";
import { adminFetch, type AdminMenuItem, type AdminOption, type AdminRestaurant, type AdminZone } from "@/lib/admin";
import { button, buttonGhost, Card, ErrorNote, input, Loading } from "../../ui";
import { useAction, useAdmin } from "../../useAdmin";

type Run = (fn: () => Promise<unknown>) => Promise<boolean>;
const text = (v: FormDataEntryValue | null) => (v === null ? "" : String(v).trim());
const optionalNumber = (v: FormDataEntryValue | null) => (text(v) === "" ? null : Number(v));

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

// Variantes (liste remplacée d'un bloc) et suppléments rattachés à un plat.
function ItemOptions({ item, addons, run, reload }: { item: AdminMenuItem; addons: AdminOption[]; run: Run; reload: () => Promise<void> }) {
  const [variants, setVariants] = useState(item.variants.map((v) => ({ name: v.name, price: String(v.price) })));
  const [addonIds, setAddonIds] = useState(item.addons.map((a) => a.id));

  return (
    <div className="mt-2 space-y-3 rounded-lg bg-stone-50 p-3 text-sm">
      <div className="space-y-2">
        <p className="font-medium">Variantes {variants.length === 0 && <span className="font-normal text-stone-500">(aucune : prix unique)</span>}</p>
        {variants.map((v, i) => (
          <div key={i} className="flex gap-2">
            <input
              value={v.name}
              onChange={(e) => setVariants((vs) => vs.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
              placeholder="Nom (ex. Grande portion)"
              className={`${input} flex-1`}
            />
            <input
              value={v.price}
              type="number"
              min={0}
              step={50}
              onChange={(e) => setVariants((vs) => vs.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)))}
              className={`${input} w-28`}
              aria-label="Prix"
            />
            <button type="button" onClick={() => setVariants((vs) => vs.filter((_, j) => j !== i))} className="px-2 text-red-700" aria-label="Supprimer la variante">
              ×
            </button>
          </div>
        ))}
        <div className="flex gap-2">
          <button type="button" onClick={() => setVariants((vs) => [...vs, { name: "", price: String(item.price) }])} className={buttonGhost}>
            + Variante
          </button>
          <button
            type="button"
            onClick={() =>
              run(async () => {
                await adminFetch(`/items/${item.id}/variants`, {
                  method: "PUT",
                  body: { variants: variants.filter((v) => v.name.trim()).map((v) => ({ name: v.name.trim(), price: Number(v.price) })) },
                });
                await reload();
              })
            }
            className={button}
          >
            Enregistrer les variantes
          </button>
        </div>
      </div>

      <div className="space-y-1 border-t border-stone-200 pt-3">
        <p className="font-medium">Suppléments proposés</p>
        {addons.length === 0 ? (
          <p className="text-stone-500">Créez d&apos;abord des suppléments plus bas.</p>
        ) : (
          addons.map((a) => (
            <label key={a.id} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={addonIds.includes(a.id)}
                onChange={(e) => {
                  const next = e.target.checked ? [...addonIds, a.id] : addonIds.filter((x) => x !== a.id);
                  setAddonIds(next);
                  run(async () => {
                    await adminFetch(`/items/${item.id}/addons`, { method: "PUT", body: { addonIds: next } });
                    await reload();
                  });
                }}
              />
              {a.name} (+ {fcfa(a.price)})
            </label>
          ))
        )}
      </div>
    </div>
  );
}

function ItemRow({ item, addons, run, reload }: { item: AdminMenuItem; addons: AdminOption[]; run: Run; reload: () => Promise<void> }) {
  const [mode, setMode] = useState<"view" | "edit" | "options">("view");
  const save = (body: Partial<AdminMenuItem>) =>
    run(async () => {
      await adminFetch(`/items/${item.id}`, { method: "PATCH", body });
      await reload();
    });

  if (mode === "edit") {
    return (
      <li className="py-2">
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const ok = await save({
              category: text(f.get("category")),
              name: text(f.get("name")),
              description: text(f.get("description")) || null,
              price: Number(f.get("price")),
              imageUrl: text(f.get("imageUrl")) || null,
            });
            if (ok) setMode("view");
          }}
          className="grid gap-2 sm:grid-cols-4"
        >
          <input name="category" defaultValue={item.category} required className={input} />
          <input name="name" defaultValue={item.name} required className={input} />
          <input name="description" defaultValue={item.description ?? ""} placeholder="Description" className={input} />
          <input name="price" type="number" min={0} step={50} defaultValue={item.price} required className={input} />
          <input name="imageUrl" type="url" defaultValue={item.imageUrl ?? ""} placeholder="Lien de la photo (https://…)" className={`${input} sm:col-span-4`} />
          <div className="flex gap-2 sm:col-span-4">
            <button className={button}>Enregistrer</button>
            <button type="button" onClick={() => setMode("view")} className={buttonGhost}>
              Annuler
            </button>
          </div>
        </form>
      </li>
    );
  }

  return (
    <li className="py-2">
      <div className="flex items-center justify-between gap-2">
        <div className={`flex items-center gap-3 ${item.available ? "" : "opacity-50"}`}>
          {item.imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- photo fournie par le restaurant
            <img src={item.imageUrl} alt="" className="h-12 w-12 rounded object-cover" />
          )}
          <div>
            <p className="font-medium">{item.name}</p>
            <p className="text-sm text-stone-500">
              {item.category} · {fcfa(item.price)}
              {item.variants.length > 0 && ` · ${item.variants.length} variante(s)`}
              {item.addons.length > 0 && ` · ${item.addons.length} supplément(s)`}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-1">
          <button onClick={() => save({ available: !item.available })} className={buttonGhost}>
            {item.available ? "Épuisé" : "Disponible"}
          </button>
          <button onClick={() => setMode(mode === "options" ? "view" : "options")} className={buttonGhost}>
            Options
          </button>
          <button onClick={() => setMode("edit")} className={buttonGhost}>
            Modifier
          </button>
        </div>
      </div>
      {mode === "options" && <ItemOptions item={item} addons={addons} run={run} reload={reload} />}
    </li>
  );
}

export default function RestaurantDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, error, reload } = useAdmin<AdminRestaurant>(`/restaurants/${id}`);
  const zones = useAdmin<AdminZone[]>("/zones");
  const action = useAction();
  const [saved, setSaved] = useState(false);

  if (error) return <ErrorNote message={error} />;
  if (!data) return <Loading />;

  const addons = data.addons ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        {data.logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- logo fourni par le restaurant
          <img src={data.logoUrl} alt="" className="h-12 w-12 rounded-full object-cover" />
        )}
        <h1 className="text-2xl font-bold">{data.name}</h1>
      </div>

      <Card title="Informations">
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const ok = await action.run(async () => {
              await adminFetch(`/restaurants/${id}`, {
                method: "PATCH",
                body: {
                  name: text(f.get("name")),
                  phone: text(f.get("phone")),
                  address: text(f.get("address")),
                  commissionRate: Number(f.get("commissionRate")),
                  active: f.get("active") === "on",
                  zoneId: text(f.get("zoneId")) || null,
                  deliveryTimeMin: Number(f.get("deliveryTimeMin")),
                  deliveryTimeMax: Number(f.get("deliveryTimeMax")),
                  logoUrl: text(f.get("logoUrl")) || null,
                  latitude: optionalNumber(f.get("latitude")),
                  longitude: optionalNumber(f.get("longitude")),
                },
              });
              await reload();
            });
            setSaved(ok);
          }}
          className="grid gap-2 text-sm sm:grid-cols-2"
        >
          <input name="name" defaultValue={data.name} required className={input} aria-label="Nom" />
          <input name="phone" defaultValue={data.phone} required className={input} aria-label="Téléphone" />
          <input name="address" defaultValue={data.address} required className={input} aria-label="Adresse" />
          <select name="zoneId" defaultValue={data.zoneId ?? ""} className={input} aria-label="Zone">
            <option value="">Zone non précisée</option>
            {zones.data?.map((z) => (
              <option key={z.id} value={z.id}>
                {z.name}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-2">
            Préparation et livraison
            <input name="deliveryTimeMin" type="number" min={5} max={180} defaultValue={data.deliveryTimeMin} className={`${input} w-20`} />
            à
            <input name="deliveryTimeMax" type="number" min={5} max={240} defaultValue={data.deliveryTimeMax} className={`${input} w-20`} />
            min
          </label>
          <label className="flex items-center gap-2">
            Commission (%)
            <input name="commissionRate" type="number" min={0} max={50} defaultValue={data.commissionRate} className={`${input} w-20`} />
          </label>
          <input name="logoUrl" type="url" defaultValue={data.logoUrl ?? ""} placeholder="Lien du logo (https://…)" className={`${input} sm:col-span-2`} />
          <label className="flex items-center gap-2">
            Latitude
            <input name="latitude" type="number" step="any" defaultValue={data.latitude ?? ""} className={input} />
          </label>
          <label className="flex items-center gap-2">
            Longitude
            <input name="longitude" type="number" step="any" defaultValue={data.longitude ?? ""} className={input} />
          </label>
          <p className="text-xs text-stone-500 sm:col-span-2">
            La position du restaurant sert au calcul du tarif dans les zones facturées à la distance.
          </p>
          <label className="flex items-center gap-2">
            <input name="active" type="checkbox" defaultChecked={data.active} /> Visible pour les clients
          </label>
          <div className="flex items-center gap-3 sm:col-span-2">
            <button className={button}>Enregistrer</button>
            {saved && <span className="text-emerald-700">Enregistré</span>}
          </div>
        </form>
      </Card>

      <QrBlock slug={data.slug} name={data.name} />

      <Card title="Carte">
        <ErrorNote message={action.error} />
        <ul className="divide-y divide-stone-100">
          {data.menuItems?.map((item) => <ItemRow key={item.id} item={item} addons={addons} run={action.run} reload={reload} />)}
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
                  category: text(f.get("category")),
                  name: text(f.get("name")),
                  description: text(f.get("description")) || null,
                  price: Number(f.get("price")),
                  imageUrl: text(f.get("imageUrl")) || null,
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
          <input name="imageUrl" type="url" placeholder="Lien de la photo (facultatif)" className={`${input} sm:col-span-4`} />
          <button className={`${button} sm:col-span-4`}>Ajouter le plat</button>
        </form>
      </Card>

      <Card title="Suppléments">
        <ul className="divide-y divide-stone-100">
          {addons.map((a) => (
            <li key={a.id} className="flex items-center justify-between py-2 text-sm">
              <span className={a.available ? "" : "opacity-50"}>
                {a.name} · {fcfa(a.price)}
              </span>
              <button
                onClick={() =>
                  action.run(async () => {
                    await adminFetch(`/addons/${a.id}`, { method: "PATCH", body: { available: !a.available } });
                    await reload();
                  })
                }
                className={buttonGhost}
              >
                {a.available ? "Épuisé" : "Disponible"}
              </button>
            </li>
          ))}
        </ul>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const f = new FormData(form);
            const ok = await action.run(async () => {
              await adminFetch(`/restaurants/${id}/addons`, { method: "POST", body: { name: text(f.get("name")), price: Number(f.get("price")) } });
              await reload();
            });
            if (ok) form.reset();
          }}
          className="mt-3 flex flex-wrap gap-2 border-t border-stone-100 pt-3"
        >
          <input name="name" required placeholder="Supplément (ex. Œuf)" className={`${input} flex-1`} />
          <input name="price" type="number" min={0} step={50} required placeholder="Prix FCFA" className={`${input} w-32`} />
          <button className={button}>Ajouter</button>
        </form>
      </Card>
    </div>
  );
}
