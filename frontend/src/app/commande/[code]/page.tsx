import { notFound } from "next/navigation";
import { TopBar } from "@/app/app/ui";
import OrderCode from "@/components/OrderCode";
import { Icon } from "@/components/panel/icons";
import { fcfa, lineLabel, type OrderStatus, type OrderSummary } from "@/lib/api";
import { dateLocale, type T } from "@/lib/i18n";
import { getLang, getT } from "@/lib/i18n/server";
import { serverGet } from "@/lib/serverApi";
import AutoRefresh from "./AutoRefresh";
import LocationRequestCard from "./LocationRequestCard";

const ORDER: OrderStatus[] = ["PENDING", "CONFIRMED", "PREPARING", "READY", "PICKED_UP", "DELIVERED"];
const VEHICLE = { MOTO: "Moto", VELO: "Vélo", VOITURE: "Voiture" } as const;

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
    { status: "PREPARING", label: t("En préparation"), at: o.preparingAt },
    { status: "READY", label: o.fulfillment === "PICKUP" ? t("Prête, à retirer") : t("Prête"), at: o.readyAt },
  ];
  if (o.fulfillment === "PICKUP") return [...steps, { status: "DELIVERED", label: t("Retirée"), at: o.deliveredAt }];
  return [...steps, { status: "PICKED_UP", label: `${t("En route")}${driver}`, at: o.pickedUpAt }, { status: "DELIVERED", label: t("Livrée"), at: o.deliveredAt }];
}

// Grande ligne en haut : ce que la personne veut savoir tout de suite.
function headline(o: OrderSummary, t: T, time: Clock): { title: string; sub: string } {
  const r = o.restaurant;
  if (o.status === "DELIVERED")
    return {
      title: t(o.fulfillment === "PICKUP" ? "Retirée à {time}" : "Livrée à {time}", { time: time(o.deliveredAt ?? o.createdAt) }),
      sub: t("Bon appétit, merci d'avoir commandé avec Zedeka."),
    };
  if (o.status === "CANCELLED") return { title: t("Commande annulée"), sub: o.cancelledAt ? t("Annulée à {time}.", { time: time(o.cancelledAt) }) : "" };
  if (o.awaitingPosition) return { title: t("En attente du destinataire"), sub: t("Le colis partira dès que sa position sera connue.") };
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
    <TopBar title={order.type === "PARCEL" ? "Suivi du colis" : "Suivi de la commande"} back="/app/commandes" />
    <div className="space-y-4 p-4">
      {ongoing && <AutoRefresh />}
      {/* Carte d'état façon « Activité en direct » : grand titre, barre d'avancement fine, code en dessous. */}
      <section className="overflow-hidden rounded-[20px] bg-white shadow-[0_1px_2px_rgb(0_0_0/0.04)]">
        <div className="p-5">
          <p className={`text-[13px] font-semibold uppercase tracking-wide ${cancelled ? "text-stone-500" : "text-emerald-600"}`}>
            {order.type === "PARCEL" ? t("Colis") : order.restaurant?.name}
            {order.fulfillment === "PICKUP" && ` · ${t("à emporter")}`}
          </p>
          <h1 className="mt-1 text-[28px] font-bold leading-tight">{head.title}</h1>
          {head.sub && <p className="mt-0.5 text-[15px] text-stone-500">{head.sub}</p>}
          {ongoing && (
            <div className="mt-4 flex gap-1" aria-hidden="true">
              {steps.map((s, i) => (
                <span key={s.status} className={`h-1 flex-1 rounded-full ${i < reached ? "bg-emerald-600" : i === reached ? "step-now" : "bg-stone-200"}`} />
              ))}
            </div>
          )}
        </div>
        <div className="hairline-t px-5 py-4">
          <OrderCode code={order.code} />
        </div>
      </section>

      <section className="rounded-[20px] bg-white p-5">
        <h2 className="sr-only">{t("Étapes")}</h2>
        <ol>
          {steps.slice(0, cancelled ? reached + 1 : steps.length).map((s, i, shown) => {
            const done = i < reached || (i === reached && (order.status === "DELIVERED" || cancelled));
            const now = !done && i === reached;
            const last = i === shown.length - 1 && !cancelled;
            return (
              <li key={s.status} className="relative flex gap-3 pb-4 last:pb-0">
                {!last && <span className={`absolute left-[11px] top-6 h-[calc(100%-1rem)] w-0.5 ${done ? "bg-emerald-600" : "bg-stone-200"}`} />}
                <span
                  className={`relative z-10 mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 ${
                    done ? "border-emerald-600 bg-emerald-600 text-white" : now ? "anim-ring border-emerald-600 bg-white" : "border-stone-300 bg-white"
                  }`}
                >
                  {done ? <Icon name="check" className="h-3.5 w-3.5" /> : now && <span className="h-2 w-2 rounded-full bg-emerald-600" />}
                </span>
                <span className={`flex-1 ${done || now ? "font-medium text-stone-900" : "text-stone-500"}`}>{s.label}</span>
                {s.at && <time className="text-sm tabular-nums text-stone-500">{time(s.at)}</time>}
              </li>
            );
          })}
          {cancelled && (
            <li className="relative flex gap-3">
              <span className="relative z-10 mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-red-600 text-white">
                <Icon name="close" className="h-3.5 w-3.5" />
              </span>
              <span className="flex-1 font-medium text-red-700">{t("Annulée")}</span>
              {order.cancelledAt && <time className="text-sm tabular-nums text-stone-500">{time(order.cancelledAt)}</time>}
            </li>
          )}
        </ol>
      </section>

      {order.driver && ongoing && (
        <section className="flex items-center gap-3 rounded-[20px] bg-white p-4">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-sun text-lg font-bold text-ink">{order.driver.firstName.charAt(0)}</span>
          <span className="flex-1">
            <span className="block font-semibold">{order.driver.firstName}</span>
            <span className="block text-sm text-stone-500">{t("Votre livreur")} · {t(VEHICLE[order.driver.vehicle])}</span>
          </span>
          <Icon name="rider" className="h-6 w-6 text-emerald-600" />
        </section>
      )}

      {order.type === "PARCEL" && order.locationStatus && ongoing && (
        <LocationRequestCard code={order.code} status={order.locationStatus} open={order.status === "PENDING"} />
      )}

      {help && ongoing && (
        <a href={help} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 rounded-[20px] bg-white p-4">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-emerald-600/10 text-emerald-600">
            <Icon name="phone" className="h-5 w-5" />
          </span>
          <span className="flex-1">
            <span className="block font-semibold">{t("Une question, un souci ?")}</span>
            <span className="block text-sm text-stone-500">{t("Écrivez-nous sur WhatsApp, nous joignons {name} pour vous.", { name: order.driver ? order.driver.firstName : t("le livreur") })}</span>
          </span>
          <Icon name="chevron" className="h-4 w-4 text-stone-300" />
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

      <section className="space-y-3 rounded-[20px] bg-white p-5">
        <h2 className="text-[17px] font-semibold">{t("Détail")}</h2>
        <ul className="space-y-1 text-sm">
          {order.items.map((i) => (
            <li key={`${i.name}-${i.variantName}-${i.addons.length}`} className="flex justify-between gap-2">
              <span>
                {i.quantity} × {lineLabel(i)}
              </span>
              <span className="shrink-0 tabular-nums">{fcfa(i.unitPrice * i.quantity)}</span>
            </li>
          ))}
        </ul>
        <dl className="hairline-t space-y-1 pt-3 text-sm">
          {order.discount > 0 && (
            <div className="flex justify-between">
              <dt>{t("Remise")}</dt>
              <dd>− {fcfa(order.discount)}</dd>
            </div>
          )}
          <div className="flex justify-between gap-2">
            <dt>{t("Livraison")} ({order.zone.name})</dt>
            <dd className="shrink-0 tabular-nums">{order.awaitingPosition ? t("à fixer") : fcfa(order.deliveryFee)}</dd>
          </div>
          {order.extraFee > 0 && (
            <div className="flex justify-between">
              <dt>{t("Supplément")}</dt>
              <dd className="tabular-nums">{fcfa(order.extraFee)}</dd>
            </div>
          )}
          <div className="flex justify-between text-base font-semibold">
            <dt>{t("Total")} · {order.paymentMethod === "CASH" ? t("espèces") : t("mobile money")}</dt>
            <dd className="tabular-nums">{order.awaitingPosition ? t("à venir") : fcfa(order.total)}</dd>
          </div>
        </dl>
      </section>
    </div>
    </>
  );
}
