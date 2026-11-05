import { notFound } from "next/navigation";
import OrderCode from "@/components/OrderCode";
import { Icon } from "@/components/panel/icons";
import { fcfa, lineLabel, type OrderStatus, type OrderSummary } from "@/lib/api";
import { dateLocale, type T } from "@/lib/i18n";
import { getLang, getT } from "@/lib/i18n/server";
import { serverGet } from "@/lib/serverApi";
import { CustomerPushPrompt } from "@/components/CustomerPush";
import { orderStamp } from "@/lib/orderStamp";
import AutoRefresh from "./AutoRefresh";
import DeliveryDetails from "./DeliveryDetails";
import OngoingPager from "./OngoingPager";
import LiveTrack from "./LiveTrack";
import LocationRequestCard from "./LocationRequestCard";
import ReceiptCard from "./ReceiptCard";

const ORDER: OrderStatus[] = ["PENDING", "CONFIRMED", "PREPARING", "READY", "PICKED_UP", "DELIVERED"];

type Step = { status: OrderStatus; label: string; at: string | null | undefined };

type Clock = (iso: string | Date) => string;
const clock = (locale: string): Clock => (iso) => new Date(iso).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lome" });
const addMin = (iso: string, min: number) => new Date(new Date(iso).getTime() + min * 60_000);

// Étapes selon le type de commande : repas livré, repas à emporter ou colis.
function stepsOf(o: OrderSummary, t: T): Step[] {
  const driver = o.driver ? ` ${t("avec {name}", { name: o.driver.firstName })}` : "";
  if (o.type === "PARCEL")
    return [
      { status: "PENDING", label: t("Demande reçue"), at: o.createdAt },
      { status: "CONFIRMED", label: t("Livreur trouvé"), at: o.confirmedAt },
      { status: "PICKED_UP", label: `${t("Colis récupéré")}${driver}`, at: o.pickedUpAt },
      { status: "DELIVERED", label: t("Colis livré"), at: o.deliveredAt },
    ];
  const steps: Step[] = [
    { status: "PENDING", label: t("Commande reçue"), at: o.createdAt },
    { status: "CONFIRMED", label: t("Acceptée par le restaurant"), at: o.confirmedAt },
    { status: "PREPARING", label: o.prepMinutes ? t("En cuisine · prête en {n} min", { n: o.prepMinutes }) : t("En préparation"), at: o.preparingAt },
    { status: "READY", label: o.tableNumber != null ? t("Prête, en route vers votre table") : o.fulfillment === "PICKUP" ? t("Prête, à retirer") : t("Prête"), at: o.readyAt },
  ];
  // Sur place : servie à la table.
  if (o.tableNumber != null) return [...steps, { status: "DELIVERED", label: t("Servie à la table {number}", { number: o.tableNumber }), at: o.deliveredAt }];
  if (o.fulfillment === "PICKUP") return [...steps, { status: "DELIVERED", label: t("Retirée"), at: o.deliveredAt }];
  return [...steps, { status: "PICKED_UP", label: `${t("En route")}${driver}`, at: o.pickedUpAt }, { status: "DELIVERED", label: t("Livrée"), at: o.deliveredAt }];
}

// Grande ligne en haut : ce que la personne veut savoir tout de suite.
function headline(o: OrderSummary, t: T, time: Clock): { title: string; sub: string } {
  const r = o.restaurant;
  if (o.status === "DELIVERED" && o.tableNumber != null) return { title: t("Servie à table"), sub: t("Bon appétit, merci d'avoir commandé avec Zedeka.") };
  if (o.status === "READY" && o.tableNumber != null) return { title: t("Prête, en route vers votre table"), sub: t("Le restaurant vous l'apporte à la table {number}.", { number: o.tableNumber }) };
  if (o.status === "DELIVERED")
    return {
      title: t(o.fulfillment === "PICKUP" ? "Retirée à {time}" : "Livrée à {time}", { time: time(o.deliveredAt ?? o.createdAt) }),
      sub: t("Bon appétit, merci d'avoir commandé avec Zedeka."),
    };
  if (o.status === "CANCELLED") return { title: t("Commande annulée"), sub: o.cancelledAt ? t("Annulée à {time}.", { time: time(o.cancelledAt) }) : "" };
  if (o.awaitingPosition) return { title: t("En attente du destinataire"), sub: t("Le colis partira dès que sa position sera connue.") };
  if (o.status === "PICKED_UP" && o.handedOverAt) return { title: t("Commande remise"), sub: t("Confirmez la réception ci-dessous pour clôturer la livraison.") };
  if (o.status === "PENDING") return { title: t("Commande reçue"), sub: o.type === "PARCEL" ? t("Nous cherchons un livreur.") : t("En attente de la confirmation du restaurant.") };
  if (o.type === "FOOD" && r?.deliveryTimeMin && r.deliveryTimeMax) {
    const from = addMin(o.createdAt, r.deliveryTimeMin);
    const to = addMin(o.createdAt, r.deliveryTimeMax);
    const late = Date.now() > to.getTime();
    if (late) return { title: o.status === "PICKED_UP" ? t("Le livreur arrive") : t("Encore quelques minutes"), sub: t("Un peu plus long que prévu, votre commande est en cours.") };
    return {
      title: t(o.fulfillment === "PICKUP" ? "Prête vers {time}" : "Arrivée vers {time}", { time: time(to) }),
      sub: t("Estimation entre {from} et {to}.", { from: time(from), to: time(to) }),
    };
  }
  if (o.status === "PICKED_UP") return { title: t("En route vers vous"), sub: o.driver ? t("{name} a récupéré votre colis.", { name: o.driver.firstName }) : "" };
  return { title: t("Commande en cours"), sub: "" };
}

// Dernière ligne du récapitulatif : qui paie, comment, et si c'est déjà réglé.
function payLine(o: OrderSummary, t: T): string {
  const done = o.status === "DELIVERED";
  if (o.type === "PARCEL" && o.payer === "RECIPIENT") return done ? t("Payé par le destinataire") : t("À payer par le destinataire");
  if (o.type === "PARCEL") return t("Payé par l'expéditeur");
  if (o.paymentMethod === "MOBILE_MONEY") return t("Total · mobile money");
  return done ? t("Payé en espèces") : t("À payer en espèces");
}

// Barre nommée du haut (comme sur la planche) : quelques étapes courtes, l'étape en cours en gras.
function barOf(o: OrderSummary, t: T): { labels: string[]; reached: number } {
  const at = (statuses: OrderStatus[]) => Math.max(0, statuses.findLastIndex((s) => ORDER.indexOf(s) <= ORDER.indexOf(o.status)));
  if (o.type === "PARCEL") return { labels: [t("Reçu"), t("Livreur"), t("En route"), t("Livré")], reached: at(["PENDING", "CONFIRMED", "PICKED_UP", "DELIVERED"]) };
  if (o.tableNumber != null || o.fulfillment === "PICKUP")
    return { labels: [t("Confirmée"), t("En cuisine"), t("Prête"), o.tableNumber != null ? t("Servie") : t("Retirée")], reached: at(["CONFIRMED", "PREPARING", "READY", "DELIVERED"]) };
  return { labels: [t("Confirmée"), t("En cuisine"), t("Prête"), t("En route"), t("Livrée")], reached: at(["CONFIRMED", "PREPARING", "READY", "PICKED_UP", "DELIVERED"]) };
}

export default async function OrderPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const [order, policies] = await Promise.all([
    serverGet<OrderSummary>(`/api/orders/${encodeURIComponent(code)}`),
    serverGet<{ whatsapp: string }>("/api/policies"),
  ]);
  if (!order) notFound();
  const t = await getT();
  const time = clock(dateLocale(await getLang()));
  // Le numéro du livreur n'est pas montré (la page s'ouvre avec le seul code) : on passe par Zedeka, qui le joint.
  const help = policies?.whatsapp
    ? `https://wa.me/${policies.whatsapp}?text=${encodeURIComponent(t("Bonjour Zedeka, à propos de ma commande {code}.", { code: order.code }))}`
    : null;

  const steps = stepsOf(order, t);
  const cancelled = order.status === "CANCELLED";
  const reached = cancelled ? steps.reduce((last, s, i) => (s.at ? i : last), 0) : Math.max(0, steps.findLastIndex((s) => ORDER.indexOf(s.status) <= ORDER.indexOf(order.status)));
  const ongoing = !cancelled && order.status !== "DELIVERED";
  const head = headline(order, t, time);

  return (
    <>
    {ongoing && <AutoRefresh code={order.code} stamp={orderStamp(order)} />}
    <LiveTrack
      code={order.code}
      parcel={order.type === "PARCEL"}
      live={order.status === "PICKED_UP" && order.fulfillment !== "PICKUP" && order.tableNumber == null && !order.handedOverAt}
      ongoing={ongoing}
      cancelled={cancelled}
      eyebrow={`${order.type === "PARCEL" ? t("Colis") : (order.restaurant?.name ?? "")}${order.tableNumber != null ? ` · ${t("Table {number}", { number: order.tableNumber })}` : order.fulfillment === "PICKUP" ? ` · ${t("à emporter")}` : ""}`}
      title={head.title}
      sub={head.sub}
      topTitle={order.type === "PARCEL" ? "Suivi du colis" : "Suivi de la commande"}
      bar={barOf(order, t)}
      etaTo={order.type === "FOOD" && order.restaurant?.deliveryTimeMax && Date.now() < addMin(order.createdAt, order.restaurant.deliveryTimeMax).getTime() ? addMin(order.createdAt, order.restaurant.deliveryTimeMax).toISOString() : null}
      help={help}
      stamp={orderStamp(order)}
    />
    <div className="space-y-4 p-4">
      <OngoingPager code={order.code} />
      <section className="rounded-[12px] bg-white px-5 py-4">
        <OrderCode code={order.code} />
      </section>

      <section className="card-gloss rounded-[12px] bg-white p-5">
        <h2 className="mb-3 text-[17px] font-semibold">{order.type === "PARCEL" ? t("Suivi du colis") : t("Suivi de la commande")}</h2>
        <ol>
          {steps.slice(0, cancelled ? reached + 1 : steps.length).map((s, i, shown) => {
            const done = i < reached || (i === reached && (order.status === "DELIVERED" || cancelled));
            const now = !done && i === reached;
            const last = i === shown.length - 1 && !cancelled;
            return (
              <li key={s.status} className="relative flex gap-3 pb-4 last:pb-0">
                {!last && <span className={`absolute left-[11px] top-6 h-[calc(100%-1rem)] w-0.5 ${done ? "bg-emerald-600" : "bg-stone-200"}`} />}
                <span
                  className={`relative z-10 mt-1 grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 ${
                    done ? "border-emerald-600 bg-emerald-600 text-white" : now ? "anim-ring border-emerald-600 bg-white" : "border-stone-300 bg-white"
                  }`}
                >
                  {done ? <Icon name="check" className="h-3.5 w-3.5" /> : now && <span className="h-2 w-2 rounded-full bg-emerald-600" />}
                </span>
                <span className={`flex-1 ${done || now ? "font-medium text-stone-900" : "text-stone-500"}`}>{s.label}</span>
                {s.at && <time className={`text-sm tabular-nums ${now ? "rounded-md bg-emerald-50 px-2 font-semibold text-emerald-700" : "text-stone-500"}`}>{time(s.at)}</time>}
              </li>
            );
          })}
          {cancelled && (
            <li className="relative flex gap-3">
              <span className="relative z-10 mt-1 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-red-600 text-white">
                <Icon name="close" className="h-3.5 w-3.5" />
              </span>
              <span className="flex-1 font-medium text-red-700">{t("Annulée")}</span>
              {order.cancelledAt && <time className="text-sm tabular-nums text-stone-500">{time(order.cancelledAt)}</time>}
            </li>
          )}
        </ol>
      </section>

      {ongoing && <CustomerPushPrompt />}

      {order.fulfillment !== "PICKUP" && !cancelled && (order.status === "PICKED_UP" || order.status === "DELIVERED") && (
        <ReceiptCard code={order.code} parcel={order.type === "PARCEL"} stamp={`${order.status}-${order.handedOverAt ?? ""}`} />
      )}

      {order.tableNumber == null && order.fulfillment !== "PICKUP" && (
        <DeliveryDetails code={order.code} parcel={order.type === "PARCEL"} stamp={`${order.status}-${order.locationStatus ?? ""}`} />
      )}

      {order.type === "PARCEL" && order.locationStatus && ongoing && (
        <LocationRequestCard code={order.code} status={order.locationStatus} open={order.status === "PENDING"} />
      )}

      {help && ongoing && (
        <a href={help} target="_blank" rel="noopener noreferrer" className="card-gloss flex items-center justify-between gap-3 rounded-[12px] bg-white px-5 py-4">
          <span className="font-semibold">{t("Besoin d'aide ?")}</span>
          <span className="inline-flex items-center gap-1 font-semibold text-emerald-700">
            {t("WhatsApp Zedeka")} <Icon name="chevron" className="h-4 w-4" />
          </span>
        </a>
      )}

      {order.edits?.map((e, n) => (
        <div key={n} className="rounded-2xl bg-amber-50 p-4 text-sm text-amber-950">
          <p className="font-semibold">{t("Commande modifiée par le restaurant :")} {t(e.reason)}</p>
          <ul>
            {e.changes.map((c, k) => (
              <li key={k}>
                {c.name} : {c.to === 0 ? t("retiré") : `${c.from} → ${c.to}`}
                {c.replacement && `, ${t("remplacé par {name}", { name: c.replacement })}`}
              </li>
            ))}
          </ul>
          <p>
            {t("Nouveau total : {total} (au lieu de {old})", { total: fcfa(e.newTotal), old: fcfa(e.oldTotal) })}
            {e.refund > 0 && `. ${t("{amount} vous seront remboursés sur votre mobile money.", { amount: fcfa(e.refund) })}`}
          </p>
        </div>
      ))}

      <section className="card-gloss space-y-3 rounded-[12px] bg-white p-5">
        <h2 className="text-[17px] font-semibold">{order.type === "PARCEL" ? t("Paiement") : t("Votre commande")}</h2>
        <ul className="space-y-1 text-sm empty:hidden">
          {order.items.map((i) => (
            <li key={`${i.name}-${i.variantName}-${i.addons.length}`} className="flex justify-between gap-2">
              <span>
                {i.quantity} × {lineLabel(i)}
              </span>
              <span className="shrink-0 tabular-nums">{fcfa(i.unitPrice * i.quantity)}</span>
            </li>
          ))}
        </ul>
        <dl className="hairline-t space-y-2 pt-3 text-sm">
          <div className="flex justify-between gap-2">
            <dt>
              {t("Livraison")}
              {order.distanceKm != null ? ` · ${t("{km} km", { km: order.distanceKm.toFixed(1).replace(".", ",") })}` : ` (${order.zone.name})`}
            </dt>
            <dd className="shrink-0 tabular-nums">{order.awaitingPosition ? t("à fixer") : fcfa(order.deliveryFee)}</dd>
          </div>
          {order.extraFee > 0 && (
            <div className="flex justify-between gap-2">
              <dt>{order.category ? t("Supplément {category}", { category: order.category }) : t("Supplément")}</dt>
              <dd className="tabular-nums">{fcfa(order.extraFee)}</dd>
            </div>
          )}
          {order.discount > 0 && (
            <div className="flex justify-between gap-2 font-semibold text-emerald-700">
              <dt>{order.promoCode ? t("Promo {code}", { code: order.promoCode }) : t("Remise")}</dt>
              <dd className="tabular-nums">-{fcfa(order.discount)}</dd>
            </div>
          )}
          <div className="!mt-3 flex justify-between gap-2 border-t border-dashed border-stone-300 pt-3 text-[17px] font-bold">
            <dt>{payLine(order, t)}</dt>
            <dd className="tabular-nums">{order.awaitingPosition ? t("à venir") : fcfa(order.total)}</dd>
          </div>
        </dl>
      </section>
    </div>
    </>
  );
}
