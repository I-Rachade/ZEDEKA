"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import MapPicker from "@/components/MapPicker";
import { useFavorites } from "@/components/FavoriteDrivers";
import { Icon } from "@/components/panel/icons";
import { button, buttonGhost, Card, ErrorNote, input, PageHeader } from "@/components/panel/ui";
import { fcfa } from "@/lib/api";
import { useT } from "@/lib/i18n/client";
import { restaurantFetch } from "@/lib/restaurant";

type Point = { latitude: number; longitude: number };
type Quote = { fee: number; km: number | null; zone: string; toCollect: number };
type Created = { order: { id: string; code: string }; message: { text: string; whatsappUrl: string; trackUrl: string } };

// « Nouvelle livraison » : un client a appelé ou écrit au restaurant (téléphone, WhatsApp…). Le restaurant
// enregistre la livraison ; la commande est prête et part à son livreur favori ou aux livreurs Zedeka.
export default function NewDeliveryPage() {
  const t = useT();
  const { data: favs } = useFavorites(restaurantFetch);
  const hasFavorite = !!favs?.favorites.some((f) => f.status === "ACTIVE");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [point, setPoint] = useState<Point | null>(null);
  const [picking, setPicking] = useState(false);
  const [paid, setPaid] = useState(false);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [route, setRoute] = useState<"FAVORITE" | "OPEN">("OPEN");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<Created | null>(null);

  useEffect(() => {
    if (hasFavorite) setRoute("FAVORITE");
  }, [hasFavorite]);

  const body = () => ({
    customerName: name.trim(),
    customerPhone: phone.trim(),
    address: address.trim(),
    ...(point ?? {}),
    amount: paid ? 0 : Math.max(0, Math.round(Number(amount) || 0)),
    note: note.trim() || undefined,
    route,
  });

  // Prix de la livraison recalculé dès que l'adresse, la position ou le montant changent.
  const ready = name.trim().length >= 2 && phone.trim().length >= 8 && address.trim().length >= 3;
  useEffect(() => {
    if (!ready) {
      setQuote(null);
      return;
    }
    const timer = setTimeout(() => {
      restaurantFetch<Quote>("/deliveries/quote", { method: "POST", body: body() }).then(
        (q) => {
          setQuote(q);
          setError(null);
        },
        (e) => setError((e as Error).message),
      );
    }, 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- body() lit ces mêmes valeurs
  }, [ready, name, phone, address, point, paid, amount]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setCreated(await restaurantFetch<Created>("/deliveries", { method: "POST", body: body() }));
      window.dispatchEvent(new Event("zedeka:orders-changed"));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (created)
    return (
      <div className="mx-auto max-w-xl space-y-4">
        <PageHeader icon="check" title="Livraison enregistrée" description={`${created.order.code}`} />
        <Card>
          <p className="text-sm">
            {route === "FAVORITE" ? t("Votre livreur favori est prévenu. S'il ne répond pas, la course part aux autres livreurs Zedeka.") : t("La course part aux livreurs Zedeka, le plus proche d'abord.")}
          </p>
          <p className="mt-3 text-sm font-semibold">{t("Message pour votre client")}</p>
          <p className="mt-1 rounded-lg bg-stone-50 p-3 text-sm text-stone-700">{created.message.text}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <a href={created.message.whatsappUrl} target="_blank" rel="noreferrer" className={button}>
              <Icon name="phone" className="h-4 w-4" /> {t("Envoyer sur WhatsApp")}
            </a>
            <Link href={`/restaurant/commandes/${created.order.id}`} className={buttonGhost}>
              {t("Voir la commande")}
            </Link>
            <button
              type="button"
              className={buttonGhost}
              onClick={() => {
                setCreated(null);
                setName("");
                setPhone("");
                setAddress("");
                setPoint(null);
                setAmount("");
                setNote("");
                setPaid(false);
              }}
            >
              {t("Nouvelle livraison")}
            </button>
          </div>
        </Card>
      </div>
    );

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <PageHeader icon="dispatch" title="Nouvelle livraison" description="Pour un client qui vous a appelé ou écrit, hors de l'appli Zedeka." />
      <ErrorNote message={error} />
      <form onSubmit={submit} className="space-y-4">
        <Card title="Client" icon="user">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              {t("Nom du client")}
              <input value={name} onChange={(e) => setName(e.target.value)} required minLength={2} className={`${input} mt-1`} />
            </label>
            <label className="text-sm">
              {t("Téléphone")}
              <input value={phone} onChange={(e) => setPhone(e.target.value)} required inputMode="tel" className={`${input} mt-1`} />
            </label>
            <label className="text-sm sm:col-span-2">
              {t("Adresse de livraison")}
              <input value={address} onChange={(e) => setAddress(e.target.value)} required minLength={3} placeholder={t("Quartier, rue, repère")} className={`${input} mt-1`} />
            </label>
            <div className="flex flex-wrap items-center gap-2 text-sm sm:col-span-2">
              <button type="button" onClick={() => setPicking(true)} className={buttonGhost}>
                <Icon name="pin" className="h-4 w-4" /> {point ? t("Changer la position") : t("Placer sur la carte")}
              </button>
              <span className="text-stone-600">{point ? t("Position placée : prix au km exact.") : t("Sans position, le prix de la zone du restaurant s'applique.")}</span>
            </div>
          </div>
        </Card>

        <Card title="Paiement" icon="wallet">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={paid} onChange={(e) => setPaid(e.target.checked)} className="h-4 w-4" />
            {t("Les plats sont déjà payés au restaurant")}
          </label>
          {!paid && (
            <label className="mt-3 block text-sm">
              {t("Prix des plats à encaisser chez le client (FCFA)")}
              <input value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))} required inputMode="numeric" className={`${input} mt-1`} />
            </label>
          )}
          <label className="mt-3 block text-sm">
            {t("Note pour le livreur (facultatif)")}
            <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} className={`${input} mt-1`} />
          </label>
          {quote && (
            <dl className="mt-3 grid grid-cols-2 gap-1 rounded-lg bg-stone-50 p-3 text-sm">
              <dt className="text-stone-600">{t("Livraison")}</dt>
              <dd className="text-right">
                {fcfa(quote.fee)}
                {quote.km !== null && <span className="text-stone-500"> · {quote.km} km</span>}
              </dd>
              <dt className="font-semibold">{t("Le client paie à la porte")}</dt>
              <dd className="text-right font-semibold">{fcfa(quote.toCollect)}</dd>
            </dl>
          )}
        </Card>

        <Card title="Qui livre ?" icon="rider">
          <div className="grid gap-2 sm:grid-cols-2">
            <label className={`rounded-xl border p-3 text-sm ${route === "FAVORITE" ? "border-emerald-600 bg-emerald-50" : "border-stone-200"} ${hasFavorite ? "" : "opacity-60"}`}>
              <input type="radio" name="route" className="mr-2" checked={route === "FAVORITE"} disabled={!hasFavorite} onChange={() => setRoute("FAVORITE")} />
              <span className="font-semibold">{t("À mon livreur favori")}</span>
              <span className="mt-1 block text-stone-600">
                {hasFavorite ? t("Il reçoit la course en premier. S'il ne répond pas, elle part aux autres.") : t("Aucun favori pour l'instant : invitez-en un dans « Mes livreurs ».")}
              </span>
            </label>
            <label className={`rounded-xl border p-3 text-sm ${route === "OPEN" ? "border-emerald-600 bg-emerald-50" : "border-stone-200"}`}>
              <input type="radio" name="route" className="mr-2" checked={route === "OPEN"} onChange={() => setRoute("OPEN")} />
              <span className="font-semibold">{t("Demande ouverte")}</span>
              <span className="mt-1 block text-stone-600">{t("Le livreur Zedeka libre le plus proche vient la chercher.")}</span>
            </label>
          </div>
        </Card>

        <button disabled={busy || !ready} className={`${button} w-full`}>
          {busy ? t("Envoi…") : t("Enregistrer la livraison")}
        </button>
      </form>
      {picking && <MapPicker title={t("Position du client")} initial={point} onClose={() => setPicking(false)} onPick={(p) => { setPoint(p); setPicking(false); }} />}
    </div>
  );
}
