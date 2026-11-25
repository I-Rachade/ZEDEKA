"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Icon, type IconName } from "@/components/panel/icons";
import type { Point } from "@/components/MapPicker";
import { fcfa } from "@/lib/api";
import { adminFetch, CHANNEL_LABEL, formatTime, type ManualChannel } from "@/lib/admin";
import { useT } from "@/lib/i18n/client";
import { useLiveRefresh } from "@/lib/live";
import { button, buttonGhost, Card, ErrorNote, input, Loading, PageHeader } from "../../ui";
import { useAction, useAdmin } from "../../useAdmin";

// Leaflet n'est chargé qu'à l'ouverture de la carte.
const MapPicker = dynamic(() => import("@/components/MapPicker"), { ssr: false });

// Saisie au back-office d'une demande reçue par téléphone, WhatsApp ou au bureau (routes/adminManual.ts) :
// course Zed, envoi de colis ou livraison de repas. Ouverte au directeur, à l'adjoint, à la managerin et au dispatcheur.

type Kind = "RIDE" | "PARCEL" | "FOOD";
const KINDS: { value: Kind; label: string; hint: string; icon: IconName }[] = [
  { value: "RIDE", label: "Course Zed", hint: "Moto avec chauffeur", icon: "rider" },
  { value: "PARCEL", label: "Envoi de colis", hint: "Retrait et livraison", icon: "box" },
  { value: "FOOD", label: "Livraison de repas", hint: "Plats d'un restaurant", icon: "orders" },
];

type Options = {
  channels: ManualChannel[];
  categories: { id: string; name: string }[];
  restaurants: { id: string; name: string; kind: string; address: string }[];
  zedEnabled: boolean;
  parcelEnabled: boolean;
  mobileMoneyEnabled: boolean;
};
type MenuItem = {
  id: string;
  name: string;
  category: string;
  price: number;
  options: { name: string; values: string[] }[];
  variants: { id: string; name: string; price: number }[];
  addons: { id: string; name: string; price: number }[];
};
type Menu = { restaurant: { id: string; name: string; minOrderAmount: number; open: boolean; reason: string | null }; items: MenuItem[] };
type Line = { key: number; menuItemId: string; quantity: number; variantId?: string; choices: string[]; addonIds: string[] };
type Created = { id: string; code: string; kind: Kind; message: { text: string; whatsappUrl: string } };
type ManualRide = {
  id: string;
  code: string;
  status: string;
  source: ManualChannel;
  createdBy: string | null;
  landmark: string | null;
  destination: string | null;
  quotedPrice: number | null;
  scheduledFor: string | null;
  createdAt: string;
  customer: { name: string | null; phone: string };
  driver: { name: string; phone: string; plate: string | null } | null;
};

const RIDE_STATUS: Record<string, string> = {
  SEARCHING: "Recherche d'un Zed",
  ACCEPTED: "Zed en route",
  ONBOARD: "Client à bord",
  COMPLETED: "Terminée",
  CANCELLED: "Annulée",
  NO_DRIVER: "Aucun Zed disponible",
  SCHEDULED: "Réservée",
};

const emptyForm = {
  channel: "PHONE" as ManualChannel,
  customerName: "",
  customerPhone: "",
  note: "",
  // Course
  landmark: "",
  destination: "",
  scheduledFor: "",
  // Colis
  pickupAddress: "",
  pickupAt: "",
  address: "",
  recipientName: "",
  recipientPhone: "",
  payer: "SENDER" as "SENDER" | "RECIPIENT",
  paymentMethod: "CASH" as "CASH" | "MOBILE_MONEY",
  parcelCategoryId: "",
  weightKg: "1",
  parcelSize: "" as "" | "SMALL" | "MEDIUM" | "LARGE",
  // Repas
  restaurantId: "",
};

const label = "mb-1 block text-sm font-medium text-stone-700";

export default function NewOrderPage() {
  const t = useT();
  const options = useAdmin<Options>("/orders/manual/options");
  const [kind, setKind] = useState<Kind>("RIDE");
  const [form, setForm] = useState(emptyForm);
  const [points, setPoints] = useState<{ pickup: Point | null; drop: Point | null }>({ pickup: null, drop: null });
  const [picking, setPicking] = useState<"pickup" | "drop" | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [price, setPrice] = useState<string | null>(null);
  const [created, setCreated] = useState<Created | null>(null);
  const [busy, setBusy] = useState(false);
  const { error, run } = useAction();

  const set = (key: keyof typeof emptyForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    setForm((f) => ({ ...f, [key]: e.target.value }));
    setPrice(null);
  };
  const choose = (k: Kind) => {
    setKind(k);
    setPrice(null);
    setPoints({ pickup: null, drop: null });
  };

  // Corps envoyé à l'API : seulement les champs du type choisi.
  const body = (): { path: string; data: Record<string, unknown> } => {
    const iso = (v: string) => (v ? new Date(v).toISOString() : undefined);
    const base = { channel: form.channel, customerName: form.customerName, customerPhone: form.customerPhone, note: form.note || undefined };
    if (kind === "RIDE") {
      return {
        path: "/orders/manual/ride",
        data: {
          ...base,
          latitude: points.pickup?.latitude,
          longitude: points.pickup?.longitude,
          landmark: form.landmark || undefined,
          destination: form.destination || undefined,
          destinationLatitude: points.drop?.latitude,
          destinationLongitude: points.drop?.longitude,
          scheduledFor: iso(form.scheduledFor),
        },
      };
    }
    if (kind === "PARCEL") {
      return {
        path: "/orders/manual/parcel",
        data: {
          ...base,
          pickupAddress: form.pickupAddress,
          pickupLatitude: points.pickup?.latitude,
          pickupLongitude: points.pickup?.longitude,
          pickupAt: iso(form.pickupAt),
          address: form.address,
          latitude: points.drop?.latitude,
          longitude: points.drop?.longitude,
          recipientName: form.recipientName,
          recipientPhone: form.recipientPhone,
          payer: form.payer,
          paymentMethod: form.paymentMethod,
          parcelCategoryId: form.parcelCategoryId,
          weightKg: Number(form.weightKg.replace(",", ".")) || 0,
          parcelSize: form.parcelSize || undefined,
        },
      };
    }
    return {
      path: "/orders/manual/food",
      data: {
        ...base,
        restaurantId: form.restaurantId,
        address: form.address,
        latitude: points.drop?.latitude,
        longitude: points.drop?.longitude,
        paymentMethod: form.paymentMethod,
        items: lines.map(({ menuItemId, quantity, variantId, choices, addonIds }) => ({ menuItemId, quantity, variantId, choices, addonIds })),
      },
    };
  };

  const preview = () =>
    run(async () => {
      const { path, data } = body();
      const r = await adminFetch<{ total?: number; price?: number | null; deliveryFee?: number; subtotal?: number; km?: number | null; zone?: string; priceToConfirm?: boolean; distanceM?: number | null }>(path, {
        method: "POST",
        body: { ...data, preview: true },
      });
      if (kind === "RIDE") {
        setPrice(r.price != null ? `${fcfa(r.price)} · ${((r.distanceM ?? 0) / 1000).toFixed(1)} km` : t("Prix fait avec le conducteur (pas de destination sur la carte)"));
      } else {
        const parts = [kind === "FOOD" && r.subtotal != null ? `${t("Plats")} ${fcfa(r.subtotal)}` : "", r.deliveryFee != null ? `${t("Livraison")} ${fcfa(r.deliveryFee)}` : "", r.zone ?? "", r.km != null ? `${r.km} km` : ""];
        setPrice(`${t("Total")} ${fcfa(r.total ?? 0)} · ${parts.filter(Boolean).join(" · ")}${r.priceToConfirm ? ` · ${t("prix à confirmer")}` : ""}`);
      }
    });

  const save = async () => {
    setBusy(true);
    await run(async () => {
      const { path, data } = body();
      const r = await adminFetch<Omit<Created, "kind">>(path, { method: "POST", body: data });
      setCreated({ ...r, kind });
      setForm(emptyForm);
      setPoints({ pickup: null, drop: null });
      setLines([]);
      setPrice(null);
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
    setBusy(false);
  };

  if (options.error) return <ErrorNote message={options.error} />;
  if (!options.data) return <Loading />;
  const o = options.data;
  const unavailable = kind === "RIDE" ? !o.zedEnabled && t("Le service Zed n'est pas encore ouvert.") : kind === "PARCEL" ? !o.parcelEnabled && t("L'envoi de colis est fermé pour le moment.") : false;

  return (
    <div>
      <PageHeader
        icon="plus"
        title="Nouvelle commande"
        description="Enregistrez une course, un envoi ou une livraison demandés par téléphone, WhatsApp ou au bureau."
        actions={
          <Link href="/admin/commandes" className={buttonGhost}>
            {t("Retour aux commandes")}
          </Link>
        }
      />

      {created && (
        <Card className="mb-4 border-emerald-300 bg-emerald-50">
          <p className="font-semibold text-emerald-900">
            {t(created.kind === "RIDE" ? "Course {code} enregistrée" : "Commande {code} enregistrée", { code: created.code })}
          </p>
          <p className="mt-1 text-sm text-emerald-900">{t("Envoyez la confirmation au client :")}</p>
          <p className="mt-2 whitespace-pre-line rounded-lg bg-surface p-3 text-sm">{created.message.text}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <a href={created.message.whatsappUrl} target="_blank" rel="noreferrer" className={button}>
              <Icon name="chat" className="h-4 w-4" /> {t("Envoyer sur WhatsApp")}
            </a>
            {created.kind !== "RIDE" && (
              <Link href={`/admin/commandes/${created.id}`} className={buttonGhost}>
                {t("Voir la commande")}
              </Link>
            )}
            <button type="button" onClick={() => setCreated(null)} className={buttonGhost}>
              {t("Fermer")}
            </button>
          </div>
        </Card>
      )}

      <div className="mb-4 grid gap-2 sm:grid-cols-3">
        {KINDS.map((k) => (
          <button
            key={k.value}
            type="button"
            onClick={() => choose(k.value)}
            aria-pressed={kind === k.value}
            className={`flex items-center gap-3 rounded-xl border p-3 text-left ${kind === k.value ? "border-emerald-600 bg-emerald-50 ring-1 ring-emerald-600" : "border-stone-200 bg-surface hover:bg-stone-50"}`}
          >
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-emerald-100 text-emerald-700">
              <Icon name={k.icon} />
            </span>
            <span>
              <span className="block font-semibold">{t(k.label)}</span>
              <span className="block text-xs text-stone-500">{t(k.hint)}</span>
            </span>
          </button>
        ))}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
        className="space-y-4"
      >
        {unavailable && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{unavailable}</p>}

        <Card title="Demande reçue par" icon="phone">
          <div className="flex flex-wrap gap-2">
            {o.channels.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setForm((f) => ({ ...f, channel: c }))}
                aria-pressed={form.channel === c}
                className={`rounded-full border px-4 py-2 text-sm ${form.channel === c ? "border-emerald-600 bg-emerald-600 font-semibold text-white" : "border-stone-300 bg-surface"}`}
              >
                {t(CHANNEL_LABEL[c])}
              </button>
            ))}
          </div>
        </Card>

        <Card title={kind === "PARCEL" ? "Expéditeur" : "Client"} icon="user">
          <div className="grid gap-3 sm:grid-cols-2">
            <label>
              <span className={label}>{t("Nom")}</span>
              <input value={form.customerName} onChange={set("customerName")} required minLength={2} className={input} autoComplete="off" />
            </label>
            <label>
              <span className={label}>{t("Téléphone")}</span>
              <input value={form.customerPhone} onChange={set("customerPhone")} required inputMode="tel" placeholder="90 00 00 00" className={input} autoComplete="off" />
            </label>
          </div>
        </Card>

        {kind === "RIDE" && (
          <Card title="Course" icon="rider">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <span className={label}>{t("Départ (obligatoire sur la carte)")}</span>
                <PointButton point={points.pickup} onOpen={() => setPicking("pickup")} onClear={() => setPoints((p) => ({ ...p, pickup: null }))} />
                <input value={form.landmark} onChange={set("landmark")} maxLength={80} placeholder={t("Repère : devant la pharmacie, portail bleu…")} className={`${input} mt-2`} />
              </div>
              <div>
                <span className={label}>{t("Destination")}</span>
                <input value={form.destination} onChange={set("destination")} maxLength={120} placeholder={t("Où va le client ?")} className={input} />
                <div className="mt-2">
                  <PointButton point={points.drop} onOpen={() => setPicking("drop")} onClear={() => setPoints((p) => ({ ...p, drop: null }))} optional />
                </div>
                <p className="mt-1 text-xs text-stone-500">{t("Avec la destination sur la carte, le prix est fixé d'avance ; sinon il se fait avec le conducteur.")}</p>
              </div>
              <label>
                <span className={label}>{t("Réserver pour plus tard (facultatif)")}</span>
                <input type="datetime-local" value={form.scheduledFor} onChange={set("scheduledFor")} className={input} />
              </label>
            </div>
          </Card>
        )}

        {kind === "PARCEL" && (
          <>
            <Card title="Retrait" icon="pin">
              <div className="grid gap-3 sm:grid-cols-2">
                <label>
                  <span className={label}>{t("Adresse du retrait")}</span>
                  <input value={form.pickupAddress} onChange={set("pickupAddress")} maxLength={300} className={input} />
                </label>
                <div>
                  <span className={label}>{t("Position du retrait")}</span>
                  <PointButton point={points.pickup} onOpen={() => setPicking("pickup")} onClear={() => setPoints((p) => ({ ...p, pickup: null }))} optional />
                </div>
                <label>
                  <span className={label}>{t("Retrait programmé (facultatif)")}</span>
                  <input type="datetime-local" value={form.pickupAt} onChange={set("pickupAt")} className={input} />
                </label>
              </div>
            </Card>
            <Card title="Destinataire" icon="user">
              <div className="grid gap-3 sm:grid-cols-2">
                <label>
                  <span className={label}>{t("Nom du destinataire")}</span>
                  <input value={form.recipientName} onChange={set("recipientName")} required minLength={2} className={input} autoComplete="off" />
                </label>
                <label>
                  <span className={label}>{t("Téléphone du destinataire")}</span>
                  <input value={form.recipientPhone} onChange={set("recipientPhone")} required inputMode="tel" placeholder="90 00 00 00" className={input} autoComplete="off" />
                </label>
                <label>
                  <span className={label}>{t("Adresse de livraison")}</span>
                  <input value={form.address} onChange={set("address")} maxLength={300} className={input} />
                </label>
                <div>
                  <span className={label}>{t("Position de livraison")}</span>
                  <PointButton point={points.drop} onOpen={() => setPicking("drop")} onClear={() => setPoints((p) => ({ ...p, drop: null }))} optional />
                </div>
              </div>
              <p className="mt-2 text-xs text-stone-500">{t("Avec les deux positions sur la carte, le prix se calcule à la distance ; avec l'adresse seule, il reste à confirmer.")}</p>
            </Card>
            <Card title="Colis et paiement" icon="box">
              <div className="grid gap-3 sm:grid-cols-2">
                <label>
                  <span className={label}>{t("Type de colis")}</span>
                  <select value={form.parcelCategoryId} onChange={set("parcelCategoryId")} required className={input}>
                    <option value="">{t("Choisir…")}</option>
                    {o.categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <label>
                    <span className={label}>{t("Poids (kg)")}</span>
                    <input value={form.weightKg} onChange={set("weightKg")} inputMode="decimal" className={input} />
                  </label>
                  <label>
                    <span className={label}>{t("Taille")}</span>
                    <select value={form.parcelSize} onChange={set("parcelSize")} className={input}>
                      <option value="">–</option>
                      <option value="SMALL">{t("Petit")}</option>
                      <option value="MEDIUM">{t("Moyen")}</option>
                      <option value="LARGE">{t("Grand")}</option>
                    </select>
                  </label>
                </div>
                <label>
                  <span className={label}>{t("Qui paie la livraison ?")}</span>
                  <select value={form.payer} onChange={set("payer")} className={input}>
                    <option value="SENDER">{t("L'expéditeur")}</option>
                    <option value="RECIPIENT">{t("Le destinataire, à la livraison")}</option>
                  </select>
                </label>
                {form.payer === "SENDER" && <PaymentSelect value={form.paymentMethod} onChange={set("paymentMethod")} mobileMoney={o.mobileMoneyEnabled} />}
              </div>
            </Card>
          </>
        )}

        {kind === "FOOD" && (
          <>
            <Card title="Restaurant et plats" icon="orders">
              <label className="block">
                <span className={label}>{t("Restaurant ou boutique")}</span>
                <select
                  value={form.restaurantId}
                  onChange={(e) => {
                    set("restaurantId")(e);
                    setLines([]);
                  }}
                  required
                  className={input}
                >
                  <option value="">{t("Choisir…")}</option>
                  {o.restaurants.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </label>
              {form.restaurantId && <MenuLines key={form.restaurantId} restaurantId={form.restaurantId} lines={lines} setLines={(l) => (setLines(l), setPrice(null))} />}
            </Card>
            <Card title="Livraison" icon="pin">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <span className={label}>{t("Point de livraison (obligatoire sur la carte)")}</span>
                  <PointButton point={points.drop} onOpen={() => setPicking("drop")} onClear={() => setPoints((p) => ({ ...p, drop: null }))} />
                </div>
                <label>
                  <span className={label}>{t("Adresse ou repère")}</span>
                  <input value={form.address} onChange={set("address")} maxLength={300} className={input} />
                </label>
                <PaymentSelect value={form.paymentMethod} onChange={set("paymentMethod")} mobileMoney={o.mobileMoneyEnabled} />
              </div>
            </Card>
          </>
        )}

        <Card title="Remarque pour l'équipe et le livreur" icon="doc">
          <textarea value={form.note} onChange={set("note")} maxLength={300} rows={2} className={input} placeholder={t("Facultatif")} />
        </Card>

        <ErrorNote message={error} />
        {price && <p className="rounded-xl bg-stone-100 p-3 text-sm font-medium">{price}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" onClick={() => void preview()} disabled={!!unavailable} className={buttonGhost}>
            {t("Calculer le prix")}
          </button>
          <button type="submit" disabled={busy || !!unavailable} className={button}>
            <Icon name="check" className="h-4 w-4" /> {busy ? t("Enregistrement…") : t("Enregistrer")}
          </button>
        </div>
      </form>

      {kind === "RIDE" && <RecentRides />}

      {picking && (
        <MapPicker
          title={picking === "pickup" ? (kind === "RIDE" ? "Point de départ" : "Point de retrait") : kind === "RIDE" ? "Destination" : "Point de livraison"}
          initial={points[picking] ?? (picking === "drop" ? points.pickup : points.drop)}
          onPick={(p) => {
            setPoints((s) => ({ ...s, [picking]: p }));
            setPrice(null);
            setPicking(null);
          }}
          onClose={() => setPicking(null)}
        />
      )}
    </div>
  );
}

function PointButton({ point, onOpen, onClear, optional }: { point: Point | null; onOpen: () => void; onClear: () => void; optional?: boolean }) {
  const t = useT();
  return (
    <div className="flex items-center gap-2">
      <button type="button" onClick={onOpen} className={`${buttonGhost} flex-1`}>
        <Icon name="pin" className="h-4 w-4" />
        {point ? `${point.latitude.toFixed(5)}, ${point.longitude.toFixed(5)}` : t(optional ? "Placer sur la carte (facultatif)" : "Placer sur la carte")}
      </button>
      {point && (
        <button type="button" onClick={onClear} aria-label={t("Retirer le point")} className={buttonGhost}>
          <Icon name="close" className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

function PaymentSelect({ value, onChange, mobileMoney }: { value: string; onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void; mobileMoney: boolean }) {
  const t = useT();
  return (
    <label>
      <span className={label}>{t("Paiement")}</span>
      <select value={value} onChange={onChange} className={input}>
        <option value="CASH">{t("Espèces à la livraison")}</option>
        {mobileMoney && <option value="MOBILE_MONEY">{t("Mobile money")}</option>}
      </select>
    </label>
  );
}

// Plats choisis sur la carte du restaurant : variante, choix (sauce, cuisson…) et suppléments, comme dans l'appli.
function MenuLines({ restaurantId, lines, setLines }: { restaurantId: string; lines: Line[]; setLines: (l: Line[]) => void }) {
  const t = useT();
  const { data: menu, error } = useAdmin<Menu>(`/orders/manual/menu/${restaurantId}`);
  const [pick, setPick] = useState("");
  const byId = useMemo(() => new Map((menu?.items ?? []).map((i) => [i.id, i])), [menu]);
  if (error) return <ErrorNote message={error} />;
  if (!menu) return <Loading />;
  const add = () => {
    const item = byId.get(pick);
    if (!item) return;
    setLines([...lines, { key: Date.now(), menuItemId: item.id, quantity: 1, variantId: item.variants[0]?.id, choices: item.options.map((g) => g.values[0] ?? ""), addonIds: [] }]);
    setPick("");
  };
  const update = (key: number, patch: Partial<Line>) => setLines(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const unit = (l: Line, item: MenuItem) => (item.variants.find((v) => v.id === l.variantId)?.price ?? item.price) + item.addons.filter((a) => l.addonIds.includes(a.id)).reduce((s, a) => s + a.price, 0);
  const subtotal = lines.reduce((s, l) => s + (byId.get(l.menuItemId) ? unit(l, byId.get(l.menuItemId)!) * l.quantity : 0), 0);
  return (
    <div className="mt-3 space-y-3">
      {!menu.restaurant.open && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{menu.restaurant.reason}</p>}
      <div className="flex gap-2">
        <select value={pick} onChange={(e) => setPick(e.target.value)} className={`${input} min-w-0 flex-1`} aria-label={t("Plat à ajouter")}>
          <option value="">{t("Choisir un plat…")}</option>
          {menu.items.map((i) => (
            <option key={i.id} value={i.id}>
              {i.category} · {i.name} · {fcfa(i.variants[0]?.price ?? i.price)}
            </option>
          ))}
        </select>
        <button type="button" onClick={add} disabled={!pick} className={buttonGhost}>
          <Icon name="plus" className="h-4 w-4" /> {t("Ajouter")}
        </button>
      </div>
      {lines.length === 0 ? (
        <p className="text-sm text-stone-500">{t("Aucun plat pour l'instant.")}</p>
      ) : (
        <ul className="divide-y divide-stone-100 rounded-xl border border-stone-200">
          {lines.map((l) => {
            const item = byId.get(l.menuItemId);
            if (!item) return null;
            return (
              <li key={l.key} className="space-y-2 p-3">
                <div className="flex items-center gap-2">
                  <span className="flex-1 font-medium">{item.name}</span>
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={l.quantity}
                    onChange={(e) => update(l.key, { quantity: Math.max(1, Math.min(50, Number(e.target.value) || 1)) })}
                    aria-label={t("Quantité")}
                    className={`${input} w-20!`}
                  />
                  <span className="w-24 text-right text-sm">{fcfa(unit(l, item) * l.quantity)}</span>
                  <button type="button" onClick={() => setLines(lines.filter((x) => x.key !== l.key))} aria-label={t("Retirer")} className="text-stone-500">
                    <Icon name="trash" className="h-4 w-4" />
                  </button>
                </div>
                {(item.variants.length > 0 || item.options.length > 0) && (
                  <div className="flex flex-wrap gap-2">
                    {item.variants.length > 0 && (
                      <select value={l.variantId} onChange={(e) => update(l.key, { variantId: e.target.value })} className={`${input} w-auto!`} aria-label={t("Variante")}>
                        {item.variants.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.name} · {fcfa(v.price)}
                          </option>
                        ))}
                      </select>
                    )}
                    {item.options.map((g, gi) => (
                      <select
                        key={g.name}
                        value={l.choices[gi] ?? ""}
                        onChange={(e) => update(l.key, { choices: l.choices.map((c, ci) => (ci === gi ? e.target.value : c)) })}
                        className={`${input} w-auto!`}
                        aria-label={g.name}
                      >
                        {g.values.map((v) => (
                          <option key={v} value={v}>
                            {g.name} : {v}
                          </option>
                        ))}
                      </select>
                    ))}
                  </div>
                )}
                {item.addons.length > 0 && (
                  <div className="flex flex-wrap gap-3 text-sm">
                    {item.addons.map((a) => (
                      <label key={a.id} className="flex items-center gap-1">
                        <input
                          type="checkbox"
                          checked={l.addonIds.includes(a.id)}
                          onChange={(e) => update(l.key, { addonIds: e.target.checked ? [...l.addonIds, a.id] : l.addonIds.filter((x) => x !== a.id) })}
                        />
                        {a.name} (+{fcfa(a.price)})
                      </label>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {lines.length > 0 && (
        <p className="text-right text-sm">
          {t("Plats")} : <span className="font-semibold">{fcfa(subtotal)}</span>
          {subtotal < menu.restaurant.minOrderAmount && <span className="block text-amber-700">{t("Minimum de commande : {amount}", { amount: fcfa(menu.restaurant.minOrderAmount) })}</span>}
        </p>
      )}
    </div>
  );
}

// Courses saisies au bureau ces dernières 24 h : l'équipe voit si un Zed a accepté, et peut rappeler le client.
function RecentRides() {
  const t = useT();
  const rides = useAdmin<ManualRide[]>("/orders/manual/rides");
  useLiveRefresh(() => void rides.reload(), { every: 10_000 });
  if (!rides.data?.length) return null;
  return (
    <Card title="Courses saisies au bureau (24 h)" icon="rider" className="mt-6">
      <ul className="divide-y divide-stone-100 text-sm">
        {rides.data.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span>
              <span className="font-semibold">{r.code}</span> · {r.customer.name ?? ""} {r.customer.phone}
              <span className="block text-xs text-stone-500">
                {r.scheduledFor ? t("Réservée pour {time}", { time: formatTime(r.scheduledFor) }) : formatTime(r.createdAt)} · {t(CHANNEL_LABEL[r.source] ?? "Autre")}
                {r.createdBy ? ` · ${r.createdBy}` : ""}
              </span>
            </span>
            <span className="text-right">
              <span className={`rounded-full px-2 py-1 text-xs font-semibold ${r.status === "NO_DRIVER" || r.status === "CANCELLED" ? "bg-red-50 text-red-700" : r.status === "COMPLETED" ? "bg-stone-100 text-stone-700" : "bg-emerald-50 text-emerald-700"}`}>
                {t(RIDE_STATUS[r.status] ?? r.status)}
              </span>
              {r.driver && (
                <a href={`tel:${r.driver.phone.replace(/ /g, "")}`} className="mt-1 block text-xs text-emerald-700">
                  {r.driver.name} {r.driver.plate ? `(${r.driver.plate})` : ""} · {r.driver.phone}
                </a>
              )}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
