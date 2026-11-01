"use client";

import { use, useState } from "react";
import { fcfa, lineLabel } from "@/lib/api";
import { adminFetch, formatTime, nextStatus, orderSteps, orderTitle, STATUS_LABEL, ZONE_TO_ASSIGN, type AdminOrder, type AdminZone, type Driver } from "@/lib/admin";
import { Icon } from "@/components/panel/icons";
import StatusStepper from "@/components/panel/StatusStepper";
import type { T } from "@/lib/i18n";
import { useT } from "@/lib/i18n/client";
import { button, buttonDanger, buttonGhost, Card, ErrorNote, input, Loading, PageHeader, StatusBadge } from "../../ui";
import { useAction, useAdmin } from "../../useAdmin";

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  const t = useT();
  return (
    <div className={`flex justify-between gap-2 ${strong ? "text-base font-semibold" : ""}`}>
      <dt>{t(label)}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  );
}

const mapLink = (lat: number, lng: number) => `https://www.google.com/maps?q=${lat},${lng}`;

// État de la demande de position envoyée au destinataire d'un colis.
function locationLine(r: NonNullable<AdminOrder["locationRequest"]>, t: T): string {
  if (r.status === "SHARED") return `${t("Position reçue par lien")}${r.accuracyM ? `, ${t("à {n} m près", { n: Math.round(r.accuracyM) })}` : ""}`;
  if (r.status === "REVOKED") return t("Point de livraison placé par l'expéditeur");
  if (r.status === "EXPIRED" || new Date(r.expiresAt).getTime() < Date.now()) return t("Lien de position expiré sans réponse");
  const wait = ` : ${t("en attente, pas de livreur ni de prix avant")}`;
  if (r.status === "DECLINED") return `${t("Le destinataire a refusé de partager sa position")}${wait}`;
  return `${r.status === "OPENED" ? t("Lien de position ouvert, pas encore de réponse") : t("Lien de position envoyé, pas encore ouvert")}${wait}`;
}

// Qui a clôturé la livraison.
const CLOSED_BY = {
  CUSTOMER: "Réception confirmée par le client",
  CODE: "Clôturée avec le code du client",
  AUTO: "Clôturée automatiquement, sans réponse du client",
  ADMIN: "Clôturée par l'équipe Zedeka",
  DRIVER: "Clôturée par le livreur",
} as const;

export default function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: o, error, reload } = useAdmin<AdminOrder>(`/orders/${id}`);
  const drivers = useAdmin<Driver[]>("/drivers");
  const zones = useAdmin<AdminZone[]>("/zones");
  const action = useAction();
  const [cancelling, setCancelling] = useState(false);
  const t = useT();

  if (error) return <ErrorNote message={error} />;
  if (!o) return <Loading />;

  const open = o.status !== "DELIVERED" && o.status !== "CANCELLED";
  const next = nextStatus(o);
  const patch = (body: Record<string, unknown>) =>
    action.run(async () => {
      await adminFetch(`/orders/${id}`, { method: "PATCH", body });
      await reload();
    });

  return (
    <div>
      <PageHeader
        icon={o.type === "PARCEL" ? "box" : "orders"}
        title={t("Commande {code}", { code: o.code })}
        description={`${orderTitle(o, t)} · ${formatTime(o.createdAt)}${o.fulfillment === "PICKUP" ? ` · ${t("à emporter")}` : ""}`}
        actions={
          <>
            <StatusBadge status={o.status} />
            <button onClick={() => window.print()} className={buttonGhost}>
              <Icon name="print" className="h-4 w-4" /> {t("Facture")}
            </button>
            {open && next && (
              <button onClick={() => patch({ status: next })} className={button}>
                <Icon name="check" className="h-4 w-4" /> {t(STATUS_LABEL[next])}
              </button>
            )}
          </>
        }
      />
      <div className="mb-3 print:hidden">
        <ErrorNote message={action.error} />
      </div>

      <Card className="mb-4 print:hidden">
        <StatusStepper steps={orderSteps(o)} stopped={o.status === "CANCELLED" ? { label: "Annulée", at: o.cancelledAt } : undefined} />
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <div id="facture" className="space-y-4 lg:col-span-2">
          <Card title={t("Facture {code}", { code: o.code })} icon="receipt">
            <p className="mb-3 hidden text-sm print:block">Zedeka · {t("livraison et repas à Lomé")} · {formatTime(o.createdAt)}</p>
            {o.items.length > 0 && (
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-stone-500">
                  <tr>
                    <th className="py-1 font-medium">{t("Article")}</th>
                    <th className="py-1 text-right font-medium">{t("Qté")}</th>
                    <th className="py-1 text-right font-medium">{t("Prix")}</th>
                    <th className="py-1 text-right font-medium">{t("Total")}</th>
                  </tr>
                </thead>
                <tbody>
                  {o.items.map((i, n) => (
                    <tr key={n} className="border-t border-stone-100">
                      <td className="py-1.5">{lineLabel(i)}</td>
                      <td className="py-1.5 text-right">{i.quantity}</td>
                      <td className="py-1.5 text-right">{fcfa(i.unitPrice)}</td>
                      <td className="py-1.5 text-right">{fcfa(i.unitPrice * i.quantity)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {o.type === "PARCEL" && (
              <p className="text-sm">
                {t("Colis")} {o.parcelCategory?.name}
                {o.weightKg !== null && ` · ${o.weightKg} kg`}
              </p>
            )}
            <dl className="mt-4 space-y-1 border-t border-stone-100 pt-3 text-sm">
              {o.type === "FOOD" && <Row label="Sous-total" value={fcfa(o.subtotal)} />}
              {o.discount > 0 && <Row label="Remise" value={`− ${fcfa(o.discount)}`} />}
              <Row label={`${t("Livraison")}${o.distanceKm !== null ? ` (${o.distanceKm} km)` : ""}`} value={fcfa(o.deliveryFee)} />
              {o.extraFee > 0 && <Row label="Supplément" value={fcfa(o.extraFee)} />}
              <Row label="Total" value={fcfa(o.total)} strong />
              <Row
                label="Paiement"
                value={`${o.paymentMethod === "CASH" ? t("Espèces") : t("Mobile money")}${o.payer === "RECIPIENT" ? ` ${t("par le destinataire")}` : ""} · ${o.paymentStatus === "PAID" ? t("payé") : t("non payé")}`}
              />
            </dl>
          </Card>

          <div className="grid gap-4 sm:grid-cols-2">
            <Card title={o.type === "PARCEL" ? "Expéditeur" : "Client"} icon="user">
              <div className="space-y-0.5 text-sm">
                <p>{o.customerName}</p>
                <a href={`tel:${o.customerPhone.replace(/ /g, "")}`} className="text-emerald-700">
                  {o.customerPhone}
                </a>
                {o.pickupAddress && <p>{t("Retrait :")} {o.pickupAddress}</p>}
                {o.type === "PARCEL" && o.pickupLatitude != null && o.pickupLongitude != null && (
                  <a href={mapLink(o.pickupLatitude, o.pickupLongitude)} target="_blank" rel="noopener noreferrer" className="block text-emerald-700 underline print:hidden">
                    {t("Voir la position du retrait")}
                  </a>
                )}
                {o.type === "FOOD" && <p>{o.address}</p>}
                {o.type === "FOOD" && o.latitude !== null && o.longitude !== null && (
                  <a href={`https://www.google.com/maps?q=${o.latitude},${o.longitude}`} target="_blank" rel="noopener noreferrer" className="block text-emerald-700 underline print:hidden">
                    {t("Voir la position")}
                  </a>
                )}
                {o.note && <p className="italic text-stone-600">{t("Note :")} {o.note}</p>}
              </div>
            </Card>
            {o.type === "PARCEL" ? (
              <Card title="Destinataire" icon="map">
                <div className="space-y-0.5 text-sm">
                  <p>{o.recipientName}</p>
                  <p>{o.recipientPhone}</p>
                  <p>{o.address}</p>
                  {open ? (
                    <label className="block pt-1 print:hidden">
                      <span className={o.zoneId === ZONE_TO_ASSIGN ? "font-medium text-amber-700" : "text-stone-500"}>
                        {o.zoneId === ZONE_TO_ASSIGN ? t("Zone à attribuer avant de confier le colis") : t("Zone (déduite de la position)")}
                      </span>
                      <select aria-label={t("Zone")} value={o.zoneId === ZONE_TO_ASSIGN ? "" : o.zoneId} onChange={(e) => e.target.value && patch({ zoneId: e.target.value })} className={input}>
                        <option value="">{t("Choisir la zone")}</option>
                        {zones.data
                          ?.filter((z) => z.active)
                          .map((z) => (
                            <option key={z.id} value={z.id}>
                              {z.name}
                            </option>
                          ))}
                      </select>
                    </label>
                  ) : (
                    <p className="text-stone-500">{o.zone.name}</p>
                  )}
                  {o.latitude !== null && o.longitude !== null && (
                    <a href={mapLink(o.latitude, o.longitude)} target="_blank" rel="noopener noreferrer" className="block text-emerald-700 underline print:hidden">
                      {o.locationSource === "RECIPIENT" ? t("Voir la position donnée par le destinataire") : t("Voir la position")}
                    </a>
                  )}
                  {o.locationRequest && <p className="text-stone-500">{locationLine(o.locationRequest, t)}</p>}
                </div>
              </Card>
            ) : (
              <Card title="Restaurant" icon="store">
                <div className="space-y-0.5 text-sm">
                  <p>{o.restaurant?.name}</p>
                  <p>{o.restaurant?.phone}</p>
                  <p className="text-stone-500">{o.fulfillment === "PICKUP" ? t("À emporter") : `${t("Livraison")} · ${o.zone.name}`}</p>
                  {o.prepMinutes && <p className="text-stone-500">{t("Préparation annoncée : {n} min", { n: o.prepMinutes })}</p>}
                </div>
              </Card>
            )}
          </div>
        </div>

        <div className="space-y-4 print:hidden">
          {open && (
            <Card title="Traitement" icon="dispatch">
              {o.fulfillment === "DELIVERY" && (
                <select
                  aria-label={t("Livreur")}
                  value={o.driver?.id ?? ""}
                  onChange={(e) => patch({ driverId: e.target.value || null })}
                  className={input}
                >
                  <option value="">{t("Choisir un livreur")}</option>
                  {drivers.data
                    ?.filter((d) => (d.active && d.status === "APPROVED") || d.id === o.driver?.id)
                    .map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name} {d.online ? `· ${t("en ligne")}` : ""} ({t("{n} aujourd'hui", { n: d.ordersToday ?? 0 })})
                      </option>
                    ))}
                </select>
              )}
              <button onClick={() => setCancelling((c) => !c)} className="mt-2 text-sm text-red-700">
                {t("Annuler la commande")}
              </button>
              {cancelling && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    patch({ status: "CANCELLED", cancellationReason: new FormData(e.currentTarget).get("reason") });
                  }}
                  className="mt-2 space-y-2"
                >
                  <input name="reason" required minLength={3} placeholder={t("Motif (ex. client injoignable)")} className={input} />
                  <button className={buttonDanger}>{t("Confirmer l'annulation")}</button>
                </form>
              )}
            </Card>
          )}

          {(o.driver || o.cancellationReason) && (
            <Card title="Suivi" icon="clock">
              {o.receiptDisputedAt && o.status === "PICKED_UP" && (
                <p className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-800">
                  {t("Le client dit ne pas avoir reçu la commande :")} {o.receiptDisputeNote}. {t("Vérifiez avec le livreur, puis passez la commande à « Livrée » ou annulez-la.")}
                </p>
              )}
              {o.handedOverAt && !o.receiptDisputedAt && o.status === "PICKED_UP" && (
                <p className="mt-3 rounded-xl bg-sky-50 p-3 text-sm text-sky-900">{t("Remise déclarée par le livreur, en attente de la confirmation du client (clôture automatique après 30 min).")}</p>
              )}
              {o.status === "DELIVERED" && o.closedBy && (
                <p className="mt-3 text-sm text-stone-600">
                  {t(CLOSED_BY[o.closedBy])}
                  {o.driverRating ? ` · ${t("livreur")} ★ ${o.driverRating}/5` : ""}
                  {o.restaurantRating ? ` · ${t("restaurant")} ★ ${o.restaurantRating}/5` : ""}
                </p>
              )}
              {o.ratingComment && <p className="mt-1 text-sm italic text-stone-600">« {o.ratingComment} »</p>}
              {o.driver && (
                <p className="mt-3 text-sm">
                  {t("Livreur :")} {o.driver.name},{" "}
                  <a href={`tel:${o.driver.phone.replace(/ /g, "")}`} className="text-emerald-700">
                    {o.driver.phone}
                  </a>
                </p>
              )}
              {o.cancellationReason && (
                <p className="mt-2 text-sm text-red-700">
                  {t("Annulée :")} {o.cancellationReason}
                  {o.cancellationFee > 0 && ` · ${t("frais retenus {amount}", { amount: fcfa(o.cancellationFee) })}`}
                </p>
              )}
            </Card>
          )}

          <Card title="Montants" icon="wallet">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                patch({
                  discount: Number(f.get("discount")),
                  extraFee: Number(f.get("extraFee")),
                  ...(o.type === "PARCEL" ? { deliveryFee: Number(f.get("deliveryFee")) } : {}),
                });
              }}
              className="space-y-2 text-sm"
            >
              {o.type === "PARCEL" && (
                <label className="flex items-center justify-between gap-2">
                  {o.distanceKm === null ? t("Livraison (adresse écrite : à confirmer)") : t("Livraison")}
                  <input name="deliveryFee" type="number" min={0} step={50} defaultValue={o.deliveryFee} disabled={!open} className={`${input} w-28`} />
                </label>
              )}
              <label className="flex items-center justify-between gap-2">
                {t("Remise")}
                <input name="discount" type="number" min={0} step={50} defaultValue={o.discount} disabled={!open} className={`${input} w-28`} />
              </label>
              <label className="flex items-center justify-between gap-2">
                {t("Supplément")}
                <input name="extraFee" type="number" min={0} step={50} defaultValue={o.extraFee} disabled={!open} className={`${input} w-28`} />
              </label>
              {open && <button className={buttonGhost}>{t("Recalculer le total")}</button>}
            </form>
            <label className="mt-3 flex items-center gap-2 border-t border-stone-100 pt-3 text-sm">
              <input
                type="checkbox"
                checked={o.paymentStatus === "PAID"}
                onChange={(e) => patch({ paymentStatus: e.target.checked ? "PAID" : "UNPAID" })}
              />
              {t("Paiement reçu")}
            </label>
            <dl className="mt-3 space-y-1 border-t border-stone-100 pt-3 text-xs text-stone-600">
              <Row label="Commission Zedeka" value={fcfa(o.commission)} />
              <Row label="Part du livreur" value={fcfa(o.driverEarning)} />
            </dl>
          </Card>
        </div>
      </div>
    </div>
  );
}
