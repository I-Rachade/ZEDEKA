"use client";

import { use, useEffect, useState } from "react";
import QRCode from "qrcode";
import MenuEditor from "@/components/panel/MenuEditor";
import { adminFetch, type AdminRestaurant, type AdminZone } from "@/lib/admin";
import { button, Card, ErrorNote, input, Loading, PageHeader } from "../../ui";
import { useAction, useAdmin } from "../../useAdmin";
import { useT } from "@/lib/i18n/client";

type Run = (fn: () => Promise<unknown>) => Promise<boolean>;
const text = (v: FormDataEntryValue | null) => (v === null ? "" : String(v).trim());
const optionalNumber = (v: FormDataEntryValue | null) => (text(v) === "" ? null : Number(v));

function QrBlock({ slug, name }: { slug: string; name: string }) {
  const [url, setUrl] = useState("");
  const [png, setPng] = useState("");
  const t = useT();
  useEffect(() => {
    const target = `${window.location.origin}/r/${slug}`;
    setUrl(target);
    QRCode.toDataURL(target, { width: 600, margin: 2 }).then(setPng);
  }, [slug]);

  return (
    <Card title="QR code à afficher">
      <div className="flex flex-col items-center gap-2 text-center sm:flex-row sm:text-left">
        {/* eslint-disable-next-line @next/next/no-img-element -- image générée localement (data URL) */}
        {png && <img src={png} alt={t("QR code de {name}", { name })} className="h-40 w-40" />}
        <div className="space-y-2 text-sm">
          <p className="break-all text-stone-600">{url}</p>
          {png && (
            <a href={png} download={`qr-zedeka-${slug}.png`} className={`${button} inline-block`}>
              {t("Télécharger le QR code")}
            </a>
          )}
        </div>
      </div>
    </Card>
  );
}

// Variantes (liste remplacée d'un bloc) et suppléments rattachés à un plat.
// Identifiants de l'espace restaurant (/restaurant) remis au gérant.
function AccessBlock({ id, email, run }: { id: string; email: string | null; run: Run }) {
  const [current, setCurrent] = useState(email);
  const [done, setDone] = useState(false);
  const t = useT();
  return (
    <Card title="Accès restaurant" icon="user">
      <p className="mb-3 text-sm text-stone-600">
        {current ? t("Le gérant se connecte avec {email}.", { email: current }) : t("Aucun accès pour le moment.")}{" "}
        {t("Le gérant gère ses commandes, sa carte et ses horaires sur /restaurant.")}
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const el = e.currentTarget;
          const form = new FormData(el);
          const body = { email: text(form.get("email")), password: text(form.get("password")) };
          setDone(false);
          const ok = await run(() => adminFetch(`/restaurants/${id}/access`, { method: "PUT", body }));
          if (ok) {
            setCurrent(body.email.toLowerCase());
            setDone(true);
            (el.elements.namedItem("password") as HTMLInputElement).value = "";
          }
        }}
        className="grid gap-2 sm:grid-cols-3"
      >
        <input name="email" type="email" required defaultValue={current ?? ""} placeholder={t("E-mail du gérant")} className={input} />
        <input name="password" type="text" required minLength={8} placeholder={t("Nouveau mot de passe (8 caractères min.)")} className={input} />
        <button className={button}>{current ? t("Changer l'accès") : t("Créer l'accès")}</button>
      </form>
      {done && <p className="mt-2 text-sm text-emerald-700">{t("Accès enregistré. Transmettez le mot de passe au gérant.")}</p>}
    </Card>
  );
}

export default function RestaurantDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, error, reload } = useAdmin<AdminRestaurant>(`/restaurants/${id}`);
  const zones = useAdmin<AdminZone[]>("/zones");
  const action = useAction();
  const [saved, setSaved] = useState(false);
  const t = useT();

  if (error) return <ErrorNote message={error} />;
  if (!data) return <Loading />;

  const addons = data.addons ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        {data.logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- logo fourni par le restaurant
          <img src={data.logoUrl} alt={t("Logo de {name}", { name: data.name })} className="h-12 w-12 rounded-full object-cover" />
        )}
        <PageHeader icon="store" title={data.name} description={`${data.address} · ${t("page client /r/{slug}", { slug: data.slug })}`} />
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
                  subscriptionFee: optionalNumber(f.get("subscriptionFee")),
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
          <input name="name" defaultValue={data.name} required className={input} aria-label={t("Nom")} />
          <input name="phone" defaultValue={data.phone} required className={input} aria-label={t("Téléphone")} />
          <input name="address" defaultValue={data.address} required className={input} aria-label={t("Adresse")} />
          <select name="zoneId" defaultValue={data.zoneId ?? ""} className={input} aria-label={t("Zone")}>
            <option value="">{t("Zone non précisée")}</option>
            {zones.data?.map((z) => (
              <option key={z.id} value={z.id}>
                {z.name}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-2">
            {t("Préparation et livraison")}
            <input name="deliveryTimeMin" type="number" min={5} max={180} defaultValue={data.deliveryTimeMin} className={`${input} w-20`} />
            {t("à")}
            <input name="deliveryTimeMax" type="number" min={5} max={240} defaultValue={data.deliveryTimeMax} className={`${input} w-20`} />
            min
          </label>
          <label className="flex items-center gap-2">
            {t("Commission (%)")}
            <input name="commissionRate" type="number" min={0} max={50} defaultValue={data.commissionRate} className={`${input} w-20`} />
          </label>
          <label className="flex items-center gap-2">
            {t("Abonnement (FCFA/mois)")}
            <input name="subscriptionFee" type="number" min={0} max={1000000} step={500} defaultValue={data.subscriptionFee ?? ""} placeholder={t("aucun")} className={`${input} w-28`} />
          </label>
          <input name="logoUrl" type="url" defaultValue={data.logoUrl ?? ""} placeholder={t("Lien du logo (https://…)")} className={`${input} sm:col-span-2`} />
          <label className="flex items-center gap-2">
            Latitude
            <input name="latitude" type="number" step="any" defaultValue={data.latitude ?? ""} className={input} />
          </label>
          <label className="flex items-center gap-2">
            Longitude
            <input name="longitude" type="number" step="any" defaultValue={data.longitude ?? ""} className={input} />
          </label>
          <p className="text-xs text-stone-500 sm:col-span-2">
            {t("La position du restaurant sert au calcul du tarif dans les zones facturées à la distance.")}
          </p>
          <label className="flex items-center gap-2">
            <input name="active" type="checkbox" defaultChecked={data.active} /> {t("Visible pour les clients")}
          </label>
          <div className="flex items-center gap-3 sm:col-span-2">
            <button className={button}>{t("Enregistrer")}</button>
            {saved && <span className="text-emerald-700">{t("Enregistré")}</span>}
          </div>
        </form>
      </Card>

      <QrBlock slug={data.slug} name={data.name} />

      <AccessBlock id={data.id} email={data.ownerEmail ?? null} run={action.run} />

      <MenuEditor
        items={data.menuItems ?? []}
        addons={addons}
        fetcher={adminFetch}
        base={`/restaurants/${id}`}
        run={action.run}
        error={action.error}
        reload={reload}
      />
    </div>
  );
}
