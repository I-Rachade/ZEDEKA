"use client";

import Link from "next/link";
import { use, useState } from "react";
import { Icon } from "@/components/panel/icons";
import StatusStepper from "@/components/panel/StatusStepper";
import { button, buttonDanger, buttonGhost, Card, ErrorNote, input, Loading, PageHeader } from "@/components/panel/ui";
import { fcfa } from "@/lib/api";
import { formatTime } from "@/lib/admin";
import { driverName, PRICING_LABEL, PRICING_UNIT, rental, tripSteps, TripPill, type RentalDriver, type Trip, type TripStatus, type Vehicle } from "@/lib/rental";

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-2 ${strong ? "text-base font-semibold" : ""}`}>
      <dt>{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  );
}

// Valeur d'un <input type="datetime-local"> en heure de Lomé (UTC).
const toLocalInput = (iso: string | null) => (iso ? iso.slice(0, 16) : "");

export default function TripPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: t, error, reload } = rental.useResource<Trip>(`/trips/${id}`);
  const drivers = rental.useResource<RentalDriver[]>("/drivers");
  const vehicles = rental.useResource<Vehicle[]>("/vehicles");
  const action = rental.useAction();
  const [editing, setEditing] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  if (error) return <ErrorNote message={error} />;
  if (!t) return <Loading />;

  const changed = () => window.dispatchEvent(new Event("zedeka:trips-changed"));
  const move = (status: TripStatus, reason?: string) =>
    action.run(async () => {
      await rental.apiFetch(`/trips/${id}/status`, { method: "POST", body: { status, ...(reason && { reason }) } });
      await reload();
      changed();
    });
  const patch = (body: Record<string, unknown>) =>
    action.run(async () => {
      await rental.apiFetch(`/trips/${id}`, { method: "PATCH", body });
      await reload();
    });

  const editable = t.status === "PENDING" || t.status === "CONFIRMED";
  const open = editable || t.status === "ONGOING";
  const main =
    t.status === "PENDING" ? (
      <button onClick={() => move("CONFIRMED")} className={button}>
        <Icon name="check" className="h-4 w-4" /> Confirmer
      </button>
    ) : t.status === "CONFIRMED" ? (
      <button onClick={() => move("ONGOING")} className={button}>
        <Icon name="car" className="h-4 w-4" /> Démarrer la course
      </button>
    ) : t.status === "ONGOING" ? (
      <button onClick={() => move("COMPLETED")} className={button}>
        <Icon name="check" className="h-4 w-4" /> Terminer la course
      </button>
    ) : t.status === "PAYMENT_FAILED" ? (
      <button onClick={() => move("PENDING")} className={button}>
        Remettre en attente
      </button>
    ) : null;

  const unitsFor = (vehicleId: string) => vehicles.data?.find((v) => v.id === vehicleId)?.units.filter((u) => u.active) ?? [];
  const mapUrl = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(
    t.pickupLatitude !== null && t.pickupLongitude !== null ? `${t.pickupLatitude},${t.pickupLongitude}` : `${t.pickupAddress}, Lomé`,
  )}&destination=${encodeURIComponent(`${t.destinationAddress}, Lomé`)}`;
  const stopped =
    t.status === "CANCELLED" ? { label: "Annulée", at: t.cancelledAt } : t.status === "PAYMENT_FAILED" ? { label: "Paiement échoué", at: null } : undefined;

  return (
    <div>
      <PageHeader
        icon="car"
        title={`Course ${t.code}`}
        description={`Réservée le ${formatTime(t.createdAt)} · ${t.scheduledAt ? `départ prévu le ${formatTime(t.scheduledAt)}` : "départ immédiat"}`}
        actions={
          <>
            <TripPill status={t.status} />
            {editable && (
              <button onClick={() => setEditing((e) => !e)} className={buttonGhost}>
                <Icon name="edit" className="h-4 w-4" /> Modifier
              </button>
            )}
            <button onClick={() => window.print()} className={buttonGhost}>
              <Icon name="print" className="h-4 w-4" /> Facture
            </button>
            {main}
          </>
        }
      />
      <div className="mb-3 print:hidden">
        <ErrorNote message={action.error} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card className="print:hidden">
            <StatusStepper steps={tripSteps(t)} stopped={stopped} />
          </Card>

          {editing && (
            <Card title="Modifier la course" icon="edit">
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  const scheduled = String(f.get("scheduledAt") ?? "");
                  const ok = await patch({
                    duration: Number(f.get("duration")),
                    extraFee: Number(f.get("extraFee")),
                    extraDiscount: Number(f.get("extraDiscount")),
                    scheduledAt: scheduled ? `${scheduled}:00Z` : null,
                  });
                  if (ok) setEditing(false);
                }}
                className="grid gap-3 sm:grid-cols-2"
              >
                <label className="text-sm">
                  Durée ({PRICING_UNIT[t.pricing]})
                  <input name="duration" type="number" min={1} defaultValue={t.duration} className={`${input} mt-1`} />
                </label>
                <label className="text-sm">
                  Départ prévu (vide = immédiat)
                  <input name="scheduledAt" type="datetime-local" defaultValue={toLocalInput(t.scheduledAt)} className={`${input} mt-1`} />
                </label>
                <label className="text-sm">
                  Frais supplémentaires (FCFA)
                  <input name="extraFee" type="number" min={0} step={100} defaultValue={t.extraFee} className={`${input} mt-1`} />
                </label>
                <label className="text-sm">
                  Remise accordée (FCFA)
                  <input name="extraDiscount" type="number" min={0} step={100} defaultValue={t.extraDiscount} className={`${input} mt-1`} />
                </label>
                <div className="flex gap-2 sm:col-span-2">
                  <button className={button}>Enregistrer et recalculer</button>
                  <button type="button" onClick={() => setEditing(false)} className={buttonGhost}>
                    Annuler
                  </button>
                </div>
              </form>
            </Card>
          )}

          <Card title={`Facture ${t.code}`} icon="receipt">
            <p className="mb-3 hidden text-sm print:block">
              {t.provider.name} · {formatTime(t.createdAt)} · {t.customerName}, {t.customerPhone}
            </p>
            <dl className="mb-4 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
              <div>
                <dt className="text-stone-500">Type</dt>
                <dd>
                  {PRICING_LABEL[t.pricing]} ({t.scheduledAt ? "planifiée" : "immédiate"})
                </dd>
              </div>
              <div>
                <dt className="text-stone-500">Durée</dt>
                <dd>
                  {t.duration} {PRICING_UNIT[t.pricing]}
                </dd>
              </div>
              <div>
                <dt className="text-stone-500">Véhicules</dt>
                <dd>{t.vehicles.reduce((n, v) => n + v.quantity, 0)}</dd>
              </div>
              <div>
                <dt className="text-stone-500">Paiement</dt>
                <dd>
                  {t.paymentMethod === "CASH" ? "Espèces" : "Mobile money"} · {t.paymentStatus === "PAID" ? "payé" : "non payé"}
                </dd>
              </div>
            </dl>
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-stone-500">
                <tr>
                  <th className="py-1 font-medium">Véhicule</th>
                  <th className="py-1 pl-2 text-right font-medium">Tarif</th>
                  <th className="py-1 pl-2 text-right font-medium">Qté</th>
                  <th className="py-1 pl-2 text-right font-medium">Durée</th>
                  <th className="py-1 pl-2 text-right font-medium">Prix</th>
                </tr>
              </thead>
              <tbody>
                {t.vehicles.map((v) => (
                  <tr key={v.id} className="border-t border-stone-100 align-top">
                    <td className="py-1.5">
                      <span className="font-medium">{v.name}</span>
                      {open ? (
                        <select
                          aria-label={`Immatriculation pour ${v.name}`}
                          value={v.unit?.id ?? ""}
                          onChange={(e) => patch({ units: [{ tripVehicleId: v.id, unitId: e.target.value || null }] })}
                          className={`${input} mt-1 max-w-[14rem] py-1 print:hidden`}
                        >
                          <option value="">Choisir l&apos;immatriculation</option>
                          {unitsFor(v.vehicleId).map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.plateNumber}
                            </option>
                          ))}
                        </select>
                      ) : (
                        v.unit && <span className="block text-stone-600">{v.unit.plateNumber}</span>
                      )}
                    </td>
                    <td className="py-1.5 pl-2 text-right">
                      {fcfa(v.unitPrice)} / {PRICING_UNIT[t.pricing]}
                    </td>
                    <td className="py-1.5 pl-2 text-right">{v.quantity}</td>
                    <td className="py-1.5 pl-2 text-right">
                      {v.duration} {PRICING_UNIT[t.pricing]}
                    </td>
                    <td className="py-1.5 pl-2 text-right">{fcfa(v.price)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <dl className="mt-4 space-y-1 border-t border-stone-100 pt-3 text-sm">
              <Row label="Prix de la course" value={fcfa(t.fare)} />
              {t.discount > 0 && <Row label="Remises" value={`− ${fcfa(t.discount)}`} />}
              {t.extraFee > 0 && <Row label="Frais supplémentaires" value={`+ ${fcfa(t.extraFee)}`} />}
              {t.tax > 0 && <Row label="Taxe" value={`+ ${fcfa(t.tax)}`} />}
              <Row label="Total TTC" value={fcfa(t.total)} strong />
              <Row label="Commission Zedeka" value={`− ${fcfa(t.commission)}`} />
              <Row label="Pour vous" value={fcfa(t.total - t.commission)} />
            </dl>
            {t.note && <p className="mt-3 rounded-lg bg-amber-50 p-2 text-sm text-amber-900">Note du client : {t.note}</p>}
          </Card>
        </div>

        <div className="space-y-4">
          {open && (
            <Card title="Traitement" icon="settings" className="print:hidden">
              <label className="block text-sm">
                Chauffeur
                <select value={t.driver?.id ?? ""} onChange={(e) => patch({ driverId: e.target.value || null })} className={`${input} mt-1`}>
                  <option value="">Sans chauffeur</option>
                  {drivers.data
                    ?.filter((d) => d.active || d.id === t.driver?.id)
                    .map((d) => (
                      <option key={d.id} value={d.id}>
                        {driverName(d)}
                      </option>
                    ))}
                </select>
              </label>
              <label className="mt-3 block text-sm">
                Paiement
                <select value={t.paymentStatus} onChange={(e) => patch({ paymentStatus: e.target.value })} className={`${input} mt-1`}>
                  <option value="UNPAID">Non payé</option>
                  <option value="PAID">Payé</option>
                </select>
              </label>
              <div className="mt-3 flex flex-wrap gap-2 border-t border-stone-100 pt-3">{main}</div>
              {editable && t.paymentMethod === "MOBILE_MONEY" && (
                <button onClick={() => move("PAYMENT_FAILED")} className="mt-2 block text-sm text-stone-600 underline">
                  Signaler un paiement échoué
                </button>
              )}
              <button onClick={() => setCancelling((c) => !c)} className="mt-2 block text-sm text-red-700">
                Annuler la course
              </button>
              {cancelling && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    move("CANCELLED", String(new FormData(e.currentTarget).get("reason") ?? ""));
                  }}
                  className="mt-2 space-y-2"
                >
                  <input name="reason" required minLength={3} placeholder="Motif (ex. client absent)" className={input} />
                  <button className={buttonDanger}>Confirmer l&apos;annulation</button>
                </form>
              )}
            </Card>
          )}

          <Card title="Itinéraire" icon="pin">
            <ol className="space-y-2 text-sm">
              <li className="flex gap-2">
                <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-500" />
                <span>
                  <span className="block text-xs text-stone-500">Départ</span>
                  {t.pickupAddress}
                </span>
              </li>
              <li className="flex gap-2">
                <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-red-500" />
                <span>
                  <span className="block text-xs text-stone-500">Arrivée</span>
                  {t.destinationAddress}
                </span>
              </li>
            </ol>
            <a href={mapUrl} target="_blank" rel="noopener noreferrer" className={`${buttonGhost} mt-3 print:hidden`}>
              <Icon name="map" className="h-4 w-4" /> Ouvrir la carte
            </a>
          </Card>

          <Card title="Client" icon="user">
            <div className="space-y-0.5 text-sm">
              <p>{t.customerName}</p>
              <a href={`tel:${t.customerPhone.replace(/ /g, "")}`} className="block text-emerald-700">
                {t.customerPhone}
              </a>
              {t.customerEmail && <p>{t.customerEmail}</p>}
            </div>
          </Card>

          {(t.driver || t.cancellationReason) && (
            <Card title="Suivi" icon="clock">
              {t.driver && (
                <p className="text-sm">
                  Chauffeur : {driverName(t.driver)},{" "}
                  <a href={`tel:${t.driver.phone.replace(/ /g, "")}`} className="text-emerald-700">
                    {t.driver.phone}
                  </a>
                </p>
              )}
              {t.cancellationReason && <p className="mt-2 text-sm text-red-700">Annulée : {t.cancellationReason}</p>}
            </Card>
          )}

          <Link href="/location/courses" className="block text-sm text-emerald-700 print:hidden">
            ← Toutes les courses
          </Link>
        </div>
      </div>
    </div>
  );
}
