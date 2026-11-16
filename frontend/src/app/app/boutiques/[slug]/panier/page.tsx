"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import MapPicker, { type Point } from "@/components/MapPicker";
import TermsConsent from "@/components/legal/TermsConsent";
import { fcfa } from "@/lib/api";
import { addressLine, customerFetch, locateMe, useSession, type Profile } from "@/lib/customer";
import { rememberOrder } from "@/lib/device";
import { useT } from "@/lib/i18n/client";
import { thumbOf } from "@/lib/media";
import { choiceLabel, clearShopCart, fetchShop, orderFromShop, quoteShop, repriceShopCart, setShopLine, shopCartTotal, useShopCart, type ShopPage } from "@/lib/shop";
import { card, Empty, input, primary, TopBar } from "../../../ui";

type Drop = { point: Point; label: string; from: "gps" | "saved" | "map" };
const PHONE = /^\+?[0-9 ]{8,15}$/;

// Panier et caisse d'une boutique, sur une seule page : articles, point de livraison, coordonnées, paiement.
// Compte client obligatoire : la commande se suit et se retrouve dans « Mes commandes ».
export default function ShopCartPage() {
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();
  const t = useT();
  const session = useSession();
  const cart = useShopCart();
  const lines = cart && cart.slug === slug ? cart.lines : [];
  const [shop, setShop] = useState<ShopPage | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [drop, setDrop] = useState<Drop | null>(null);
  const [landmark, setLandmark] = useState("");
  const [map, setMap] = useState(false);
  const [locating, setLocating] = useState(false);
  const [quote, setQuote] = useState<{ deliveryFee: number; km: number | null } | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [payment, setPayment] = useState<"CASH" | "MOBILE_MONEY">("CASH");
  const [note, setNote] = useState("");
  const [terms, setTerms] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchShop(slug).then(setShop).catch(() => setShop(null));
  }, [slug]);

  useEffect(() => {
    if (!session) return;
    setName((n) => n || session.name || "");
    setPhone((p) => p || session.phone || "");
    customerFetch<Profile>("/me")
      .then(setProfile)
      .catch(() => setProfile(null));
  }, [session]);

  useEffect(() => {
    if (!drop) return setQuote(null);
    let live = true;
    setQuote(null);
    quoteShop(slug, drop.point)
      .then((q) => live && setQuote(q))
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [slug, drop]);

  // Stock du moment : la quantité d'un article ne peut pas dépasser ce qui reste.
  const stockOf = (productId: string) => shop?.products.find((p) => p.id === productId)?.stock ?? Infinity;
  const subtotal = shopCartTotal(cart && cart.slug === slug ? cart : null);
  const total = subtotal + (quote?.deliveryFee ?? 0);
  const saved = (profile?.addresses ?? []).filter((a) => a.latitude !== null && a.longitude !== null);

  async function pickGps() {
    setLocating(true);
    setError(null);
    const p = await locateMe();
    setLocating(false);
    if (p) setDrop({ point: p, label: t("Ma position actuelle"), from: "gps" });
    else setError(t("Position introuvable : autorisez la localisation ou choisissez le point sur la carte."));
  }

  async function submit() {
    if (!drop) return setError(t("Choisissez où livrer votre commande."));
    if (name.trim().length < 2) return setError(t("Indiquez votre nom"));
    if (!PHONE.test(phone.trim())) return setError(t("Numéro de téléphone invalide"));
    if (!terms) return setError(t("Acceptez les conditions générales et la politique de confidentialité pour continuer"));
    setBusy(true);
    setError(null);
    try {
      const created = await orderFromShop(slug, {
        items: lines.map((l) => ({ productId: l.productId, quantity: l.quantity, choice: l.choice })),
        latitude: drop.point.latitude,
        longitude: drop.point.longitude,
        address: [drop.label, landmark.trim() && `${t("Repère")} : ${landmark.trim()}`].filter(Boolean).join(" · "),
        customerName: name.trim(),
        customerPhone: phone.trim(),
        paymentMethod: payment,
        note: note.trim() || undefined,
        acceptTerms: true,
        expectedSubtotal: subtotal,
      });
      clearShopCart();
      rememberOrder("PARCEL", created.code);
      router.replace(`/commande/${created.code}`);
    } catch (e) {
      // Prix changés pendant l'achat : le panier affiche les nouveaux prix avant une nouvelle confirmation.
      const body = (e as Error & { body?: { code?: string; prices?: Record<string, number> } }).body;
      if (body?.code === "PRICES_CHANGED" && body.prices) {
        repriceShopCart(body.prices);
        fetchShop(slug).then(setShop).catch(() => {});
      }
      setError((e as Error).message);
      setBusy(false);
    }
  }

  if (!lines.length) {
    return (
      <div>
        <TopBar title="Panier" back={`/app/boutiques/${slug}`} />
        <div className="p-4">
          <Empty icon="bag" title="Votre panier est vide">
            <Link href={`/app/boutiques/${slug}`} className="text-emerald-700">
              {t("Retour à la boutique")}
            </Link>
          </Empty>
        </div>
      </div>
    );
  }

  return (
    <div className="pb-10">
      <TopBar title="Panier" back={`/app/boutiques/${slug}`} />
      <div className="space-y-5 px-4 pt-3">
        <section className="space-y-2">
          <h2 className="text-[17px] font-bold">{cart?.name}</h2>
          <ul className={`${card} divide-y divide-stone-200/70`}>
            {lines.map((l) => (
              <li key={l.key} className="flex items-center gap-3 p-3">
                {l.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- photo envoyée par le marchand
                  <img src={thumbOf(l.imageUrl)} alt="" className="h-14 w-14 shrink-0 rounded-[10px] object-cover" />
                ) : (
                  <span className="grid h-14 w-14 shrink-0 place-items-center rounded-[10px] bg-stone-100 text-[24px]">🛍️</span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{l.name}</span>
                  {Object.keys(l.choice).length > 0 && <span className="block truncate text-[13px] text-stone-500">{choiceLabel(l.choice)}</span>}
                  <span className="block text-[14px] font-bold text-emerald-700">{fcfa(l.price * l.quantity)}</span>
                </span>
                <span className="flex items-center gap-2">
                  <button type="button" aria-label={t("Retirer un")} onClick={() => setShopLine(l.key, l.quantity - 1)} className="keep-round grid h-9 w-9 place-items-center rounded-full bg-stone-100 text-[18px]">
                    −
                  </button>
                  <span className="w-5 text-center font-semibold">{l.quantity}</span>
                  <button
                    type="button"
                    aria-label={t("Ajouter un")}
                    disabled={cart!.lines.filter((x) => x.productId === l.productId).reduce((s, x) => s + x.quantity, 0) >= stockOf(l.productId)}
                    onClick={() => setShopLine(l.key, l.quantity + 1)}
                    className="keep-round grid h-9 w-9 place-items-center rounded-full bg-stone-100 text-[18px] disabled:opacity-30"
                  >
                    +
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </section>

        {!session ? (
          <section className={`${card} space-y-3 p-4 text-center`}>
            <p className="text-[15px] text-stone-700">{t("Connectez-vous pour commander : vous suivrez la livraison et retrouverez vos achats.")}</p>
            <Link href={`/app/connexion?suite=${encodeURIComponent(`/app/boutiques/${slug}/panier`)}`} className={primary}>
              {t("Se connecter")}
            </Link>
          </section>
        ) : (
          <>
            <section className="space-y-2">
              <h2 className="text-[13px] uppercase tracking-wide text-stone-500">{t("Où livrer ?")}</h2>
              <div className={`${card} space-y-2 p-3`}>
                <Choice on={drop?.from === "gps"} onClick={pickGps} title={locating ? t("Recherche de votre position…") : t("Ma position actuelle")} hint={t("je suis sur place")} />
                {saved.map((a) => (
                  <Choice
                    key={a.id}
                    on={drop?.from === "saved" && drop.label === addressLine(a)}
                    onClick={() => setDrop({ point: { latitude: a.latitude!, longitude: a.longitude! }, label: addressLine(a), from: "saved" })}
                    title={a.label}
                    hint={`${a.quarter}, ${a.landmark}`}
                  />
                ))}
                <Choice on={drop?.from === "map"} onClick={() => setMap(true)} title={t("Choisir sur la carte")} hint={t("chercher un lieu ou coller un lien")} />
                <input value={landmark} onChange={(e) => setLandmark(e.target.value)} maxLength={120} placeholder={t("Repère pour le livreur (facultatif)")} className={input} />
              </div>
            </section>

            <section className="space-y-2">
              <h2 className="text-[13px] uppercase tracking-wide text-stone-500">{t("Vos coordonnées")}</h2>
              <div className={`${card} space-y-2 p-3`}>
                <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoComplete="name" placeholder={t("Votre nom")} className={input} />
                <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" autoComplete="tel" placeholder={t("Téléphone")} className={input} />
                <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} rows={2} placeholder={t("Note pour la boutique (facultatif)")} className={input} />
              </div>
            </section>

            <section className="space-y-2">
              <h2 className="text-[13px] uppercase tracking-wide text-stone-500">{t("Paiement")}</h2>
              <div className={`${card} space-y-2 p-3`}>
                <Choice on={payment === "CASH"} onClick={() => setPayment("CASH")} title={t("Espèces à la livraison")} hint={t("vous payez le livreur à la porte")} />
                {shop?.mobileMoney && <Choice on={payment === "MOBILE_MONEY"} onClick={() => setPayment("MOBILE_MONEY")} title={t("Mobile Money")} hint={t("Flooz ou T-Money")} />}
              </div>
            </section>

            <section className={`${card} space-y-1.5 p-4 text-[15px]`}>
              <Row label={t("Articles")} value={fcfa(subtotal)} />
              <Row label={t("Livraison Zedeka")} value={!drop ? t("à choisir") : quote ? fcfa(quote.deliveryFee) : "…"} />
              <div className="border-t border-stone-200 pt-1.5">
                <Row label={t("Total")} value={fcfa(total)} strong />
              </div>
              <p className="pt-1 text-[13px] text-stone-500">{t("La boutique accepte votre commande, prépare le paquet, puis un livreur Zedeka vous l'apporte.")}</p>
            </section>

            <TermsConsent checked={terms} onChange={setTerms} />
            {error && <p className="rounded-xl bg-red-50 p-3 text-[14px] text-red-700">{error}</p>}
            <button type="button" disabled={busy || !drop || !quote} onClick={submit} className={primary}>
              {busy ? t("Envoi…") : `${t("Commander")} · ${fcfa(total)}`}
            </button>
          </>
        )}
      </div>
      {map && (
        <MapPicker
          title={t("Point de livraison")}
          initial={drop?.point ?? null}
          onPick={(p) => {
            setDrop({ point: p, label: t("Point sur la carte"), from: "map" });
            setMap(false);
          }}
          onClose={() => setMap(false)}
        />
      )}
    </div>
  );
}

function Choice({ on, onClick, title, hint }: { on: boolean; onClick: () => void; title: string; hint: string }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick} className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left ${on ? "border-emerald-600 bg-emerald-50" : "border-stone-200"}`}>
      <span className={`keep-round h-5 w-5 shrink-0 rounded-full border-2 ${on ? "border-emerald-600 bg-emerald-600 shadow-[inset_0_0_0_3px_white]" : "border-stone-300"}`} />
      <span className="min-w-0">
        <span className="block font-semibold">{title}</span>
        <span className="block truncate text-[13px] text-stone-500">{hint}</span>
      </span>
    </button>
  );
}

function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <p className={`flex justify-between ${strong ? "text-[17px] font-bold" : ""}`}>
      <span>{label}</span>
      <span>{value}</span>
    </p>
  );
}
