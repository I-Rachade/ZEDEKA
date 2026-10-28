import { notFound } from "next/navigation";
import { Icon } from "@/components/panel/icons";
import { fcfa, lineLabel, type OrderStatus, type OrderSummary } from "@/lib/api";
import { serverGet } from "@/lib/serverApi";
import AutoRefresh from "./AutoRefresh";

const ORDER: OrderStatus[] = ["PENDING", "CONFIRMED", "PREPARING", "READY", "PICKED_UP", "DELIVERED"];
const VEHICLE = { MOTO: "Moto", VELO: "Vélo", VOITURE: "Voiture" } as const;

type Step = { status: OrderStatus; label: string; at: string | null | undefined };

const time = (iso: string | Date) => new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lome" });
const addMin = (iso: string, min: number) => new Date(new Date(iso).getTime() + min * 60_000);

// Étapes selon le type de commande : repas livré, repas à emporter ou colis.
function stepsOf(o: OrderSummary): Step[] {
  const driver = o.driver ? ` avec ${o.driver.firstName}` : "";
  if (o.type === "PARCEL")
    return [
      { status: "PENDING", label: "Demande reçue", at: o.createdAt },
      { status: "CONFIRMED", label: "Livreur trouvé", at: o.confirmedAt },
      { status: "PICKED_UP", label: `Colis récupéré${driver}`, at: o.pickedUpAt },
      { status: "DELIVERED", label: "Colis livré", at: o.deliveredAt },
    ];
  const steps: Step[] = [
    { status: "PENDING", label: "Commande reçue", at: o.createdAt },
    { status: "CONFIRMED", label: "Acceptée par le restaurant", at: o.confirmedAt },
    { status: "PREPARING", label: "En préparation", at: o.preparingAt },
    { status: "READY", label: o.fulfillment === "PICKUP" ? "Prête, à retirer" : "Prête", at: o.readyAt },
  ];
  if (o.fulfillment === "PICKUP") return [...steps, { status: "DELIVERED", label: "Retirée", at: o.deliveredAt }];
  return [...steps, { status: "PICKED_UP", label: `En route${driver}`, at: o.pickedUpAt }, { status: "DELIVERED", label: "Livrée", at: o.deliveredAt }];
}

// Grande ligne en haut : ce que la personne veut savoir tout de suite.
function headline(o: OrderSummary): { title: string; sub: string } {
  const r = o.restaurant;
  if (o.status === "DELIVERED") return { title: `${o.fulfillment === "PICKUP" ? "Retirée" : "Livrée"} à ${time(o.deliveredAt ?? o.createdAt)}`, sub: "Bon appétit, merci d'avoir commandé avec Zedeka." };
  if (o.status === "CANCELLED") return { title: "Commande annulée", sub: o.cancelledAt ? `Annulée à ${time(o.cancelledAt)}.` : "" };
  if (o.status === "PENDING") return { title: "Commande reçue", sub: o.type === "PARCEL" ? "Nous cherchons un livreur." : "En attente de la confirmation du restaurant." };
  if (o.type === "FOOD" && r?.deliveryTimeMin && r.deliveryTimeMax) {
    const from = addMin(o.createdAt, r.deliveryTimeMin);
    const to = addMin(o.createdAt, r.deliveryTimeMax);
    const late = Date.now() > to.getTime();
    const what = o.fulfillment === "PICKUP" ? "Prête" : "Arrivée";
    if (late) return { title: o.status === "PICKED_UP" ? "Le livreur arrive" : "Encore quelques minutes", sub: "Un peu plus long que prévu, votre commande est en cours." };
    return { title: `${what} vers ${time(to)}`, sub: `Estimation entre ${time(from)} et ${time(to)}.` };
  }
  if (o.status === "PICKED_UP") return { title: "En route vers vous", sub: o.driver ? `${o.driver.firstName} a récupéré votre colis.` : "" };
  return { title: "Commande en cours", sub: "" };
}

export default async function OrderPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const order = await serverGet<OrderSummary>(`/api/orders/${encodeURIComponent(code)}`);
  if (!order) notFound();

  const steps = stepsOf(order);
  const cancelled = order.status === "CANCELLED";
  const reached = cancelled ? steps.reduce((last, s, i) => (s.at ? i : last), 0) : Math.max(0, steps.findLastIndex((s) => ORDER.indexOf(s.status) <= ORDER.indexOf(order.status)));
  const ongoing = !cancelled && order.status !== "DELIVERED";
  const head = headline(order);

  return (
    <div className="space-y-4">
      {ongoing && <AutoRefresh />}
      <section className={`overflow-hidden rounded-2xl text-white shadow-sm ${cancelled ? "bg-stone-700" : "bg-emerald-600"}`}>
        <div className="p-5">
          <p className="text-sm text-white/80">
            Commande <span className="font-semibold tracking-wide">{order.code}</span> · {order.type === "PARCEL" ? "Colis" : order.restaurant?.name}
            {order.fulfillment === "PICKUP" && " · à emporter"}
          </p>
          <h1 className="mt-1 text-3xl font-extrabold leading-tight">{head.title}</h1>
          {head.sub && <p className="mt-1 text-sm text-white/85">{head.sub}</p>}
        </div>
        {ongoing && (
          <div className="flex gap-1 px-5 pb-4" aria-hidden="true">
            {steps.map((s, i) => (
              <span key={s.status} className={`h-1.5 flex-1 rounded-full ${i < reached ? "bg-sun" : i === reached ? "bg-white" : "bg-white/25"}`} />
            ))}
          </div>
        )}
      </section>

      <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-stone-100">
        <h2 className="sr-only">Étapes</h2>
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
              <span className="flex-1 font-medium text-red-700">Annulée</span>
              {order.cancelledAt && <time className="text-sm tabular-nums text-stone-500">{time(order.cancelledAt)}</time>}
            </li>
          )}
        </ol>
      </section>

      {order.driver && ongoing && (
        <section className="flex items-center gap-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-stone-100">
          <span className="font-display grid h-11 w-11 shrink-0 place-items-center rounded-full bg-sun text-lg font-extrabold text-ink">{order.driver.firstName.charAt(0)}</span>
          <span className="flex-1">
            <span className="block font-semibold">{order.driver.firstName}</span>
            <span className="block text-sm text-stone-500">Votre livreur · {VEHICLE[order.driver.vehicle]}</span>
          </span>
          <Icon name="rider" className="h-6 w-6 text-emerald-600" />
        </section>
      )}

      {order.edits?.map((e, n) => (
        <div key={n} className="rounded-2xl bg-amber-50 p-4 text-sm text-amber-950">
          <p className="font-semibold">Commande modifiée par le restaurant : {e.reason}</p>
          <ul>
            {e.changes.map((c, k) => (
              <li key={k}>
                {c.name} : {c.to === 0 ? "retiré" : `${c.from} → ${c.to}`}
                {c.replacement && `, remplacé par ${c.replacement}`}
              </li>
            ))}
          </ul>
          <p>
            Nouveau total : {fcfa(e.newTotal)} (au lieu de {fcfa(e.oldTotal)})
            {e.refund > 0 && `. ${fcfa(e.refund)} vous seront remboursés sur votre mobile money.`}
          </p>
        </div>
      ))}

      <section className="space-y-3 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-stone-100">
        <h2 className="font-semibold">Détail</h2>
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
        <dl className="space-y-1 border-t border-stone-100 pt-3 text-sm">
          {order.discount > 0 && (
            <div className="flex justify-between">
              <dt>Remise</dt>
              <dd>− {fcfa(order.discount)}</dd>
            </div>
          )}
          <div className="flex justify-between gap-2">
            <dt>Livraison ({order.zone.name})</dt>
            <dd className="shrink-0 tabular-nums">{fcfa(order.deliveryFee)}</dd>
          </div>
          {order.extraFee > 0 && (
            <div className="flex justify-between">
              <dt>Supplément</dt>
              <dd className="tabular-nums">{fcfa(order.extraFee)}</dd>
            </div>
          )}
          <div className="flex justify-between text-base font-semibold">
            <dt>Total · {order.paymentMethod === "CASH" ? "espèces" : "mobile money"}</dt>
            <dd className="tabular-nums">{fcfa(order.total)}</dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
