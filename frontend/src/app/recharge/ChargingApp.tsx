"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { card, input, primary, secondary, Skeleton, TopBar } from "@/app/app/ui";
import { apiGet, apiPost, fcfa } from "@/lib/api";
import {
  BOOKING_STATUS,
  hhmm,
  mapsUrl,
  offersService,
  saveTicket,
  savedTickets,
  SERVICE_LABEL,
  type ChargingService,
  type ChargingStation,
  type ChargingTicket,
  type Slot,
} from "@/lib/charging";
import { useI18n, useT } from "@/lib/i18n/client";

// Recharge et échange de batteries, ouverts à toutes les motos électriques : choisir une station, un service,
// un jour et un créneau, puis garder le ticket (code) à montrer à la station.

const DAYS = 7;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

export default function ChargingApp() {
  const t = useT();
  const [stations, setStations] = useState<ChargingStation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [station, setStation] = useState<ChargingStation | null>(null);
  const [ticket, setTicket] = useState<ChargingTicket | null>(null);
  const [mine, setMine] = useState<ChargingTicket[]>([]);

  useEffect(() => {
    apiGet<ChargingStation[]>("/api/recharge/stations")
      .then((l) => setStations(l ?? []))
      .catch((e) => setError((e as Error).message));
    // Tickets gardés sur cet appareil (seulement ceux encore à venir ou en cours).
    Promise.all(savedTickets().map((s) => apiGet<ChargingTicket>(`/api/recharge/bookings/${encodeURIComponent(s.code)}?phone=${encodeURIComponent(s.phone)}`).catch(() => null)))
      .then((list) => setMine(list.filter((x): x is ChargingTicket => !!x && (x.status === "BOOKED" || x.status === "CHECKED_IN"))))
      .catch(() => {});
  }, []);

  if (ticket) return <TicketView ticket={ticket} onBack={() => setTicket(null)} onChange={setTicket} />;
  if (station) return <BookingForm station={station} onBack={() => setStation(null)} onBooked={setTicket} />;

  return (
    <div className="mx-auto max-w-xl">
      <TopBar title="Recharge et batteries" back="/" />
      <div className="space-y-4 px-4 pb-10 pt-4">
        <div className={`${card} p-4`}>
          <h2 className="text-[20px] font-bold">{t("Rechargez ou échangez votre batterie")}</h2>
          <p className="mt-1 text-sm text-stone-600">
            {t("Ouvert à toutes les motos électriques : livreurs, taxis-motos et particuliers. Réservez un créneau ou passez sans réservation.")}
          </p>
        </div>

        {mine.length > 0 && (
          <section className="space-y-2">
            <h2 className="font-semibold">{t("Mes tickets")}</h2>
            {mine.map((m) => (
              <button key={m.code} type="button" onClick={() => setTicket(m)} className={`${card} flex w-full items-center justify-between gap-3 p-3 text-left`}>
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{m.station.name}</span>
                  <span className="block text-[13px] text-stone-500">
                    {t(m.serviceLabel)} · {m.startsAt.slice(0, 10)} {hhmm(m.startsAt)}
                  </span>
                </span>
                <span className="font-mono text-sm font-bold">{m.code}</span>
              </button>
            ))}
          </section>
        )}

        <section className="space-y-2">
          <h2 className="font-semibold">{t("Stations")}</h2>
          {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
          {!stations ? (
            <Skeleton rows={3} />
          ) : stations.length === 0 ? (
            <p className={`${card} p-4 text-sm text-stone-600`}>{t("Aucune station ouverte pour l'instant. Revenez bientôt.")}</p>
          ) : (
            <ul className="space-y-2">
              {stations.map((s) => (
                <li key={s.id} className={`${card} space-y-2 p-3`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold">{s.name}</p>
                      <p className="text-[13px] text-stone-500">{s.address}</p>
                      <p className="text-[13px] text-stone-500">
                        {t("Ouvert de {from} à {to}", { from: s.opensAt, to: s.closesAt })}
                      </p>
                    </div>
                    <a href={mapsUrl(s)} target="_blank" rel="noreferrer" className="shrink-0 text-sm font-semibold text-emerald-700">
                      {t("Itinéraire")}
                    </a>
                  </div>
                  <div className="flex flex-wrap gap-2 text-[13px]">
                    {offersService(s, "CHARGE") && (
                      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-800">
                        {t("Recharge sur borne")} · {fcfa(s.chargePrice)}
                      </span>
                    )}
                    {offersService(s, "SWAP") && (
                      <span className="rounded-full bg-sky-50 px-2 py-0.5 text-sky-800">
                        {t("Échange de batterie")} · {fcfa(s.swapPrice)}
                      </span>
                    )}
                  </div>
                  {s.note && <p className="text-[13px] text-stone-600">{s.note}</p>}
                  <button type="button" onClick={() => setStation(s)} className={primary}>
                    {t("Réserver un créneau")}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <FindTicket onFound={setTicket} />
      </div>
    </div>
  );
}

function BookingForm({ station, onBack, onBooked }: { station: ChargingStation; onBack: () => void; onBooked: (t: ChargingTicket) => void }) {
  const t = useT();
  const { locale } = useI18n();
  const [service, setService] = useState<ChargingService>(offersService(station, "CHARGE") ? "CHARGE" : "SWAP");
  const days = useMemo(() => {
    const now = new Date();
    const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    return Array.from({ length: DAYS }, (_, i) => isoDay(new Date(today + i * 86_400_000)));
  }, []);
  const [day, setDay] = useState(days[0]);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [slot, setSlot] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSlots = useCallback(async () => {
    setSlots(null);
    setSlot(null);
    try {
      const r = await apiGet<{ slots: Slot[] }>(`/api/recharge/stations/${station.id}/slots?service=${service}&day=${day}`);
      setSlots(r?.slots ?? []);
    } catch (e) {
      setError((e as Error).message);
      setSlots([]);
    }
  }, [station.id, service, day]);
  useEffect(() => {
    loadSlots();
  }, [loadSlots]);

  const free = (slots ?? []).filter((s) => s.left > 0);
  const price = service === "CHARGE" ? station.chargePrice : station.swapPrice;

  return (
    <div className="mx-auto max-w-xl">
      <TopBar title="Réserver" onBack={onBack} />
      <form
        className="space-y-4 px-4 pb-10 pt-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!slot) {
            setError(t("Choisissez un créneau"));
            return;
          }
          const f = new FormData(e.currentTarget);
          const phone = String(f.get("phone") ?? "");
          setBusy(true);
          setError(null);
          try {
            const created = await apiPost<ChargingTicket>("/api/recharge/bookings", {
              stationId: station.id,
              service,
              startsAt: slot,
              name: String(f.get("name") ?? ""),
              phone,
              plate: String(f.get("plate") ?? ""),
              bikeModel: String(f.get("bikeModel") ?? "") || undefined,
            });
            saveTicket(created.code, phone);
            onBooked(created);
          } catch (err) {
            setError((err as Error).message);
            await loadSlots();
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className={`${card} p-3`}>
          <p className="font-semibold">{station.name}</p>
          <p className="text-[13px] text-stone-500">{station.address}</p>
        </div>

        {station.kind === "BOTH" && (
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t("Service")}>
            {(["CHARGE", "SWAP"] as const).map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={service === s}
                onClick={() => setService(s)}
                className={`rounded-xl border p-3 text-left text-sm ${service === s ? "border-emerald-600 bg-emerald-50 font-semibold" : "border-stone-200"}`}
              >
                {t(SERVICE_LABEL[s])}
                <span className="block text-[13px] text-stone-500">{fcfa(s === "CHARGE" ? station.chargePrice : station.swapPrice)}</span>
              </button>
            ))}
          </div>
        )}

        <div className="-mx-4 flex gap-2 overflow-x-auto px-4" role="radiogroup" aria-label={t("Jour")}>
          {days.map((d) => (
            <button
              key={d}
              type="button"
              role="radio"
              aria-checked={day === d}
              onClick={() => setDay(d)}
              className={`shrink-0 rounded-xl border px-3 py-2 text-sm ${day === d ? "border-emerald-600 bg-emerald-50 font-semibold" : "border-stone-200"}`}
            >
              {new Date(`${d}T12:00:00Z`).toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })}
            </button>
          ))}
        </div>

        <div>
          <p className="mb-2 text-sm font-semibold">{t("Créneau")}</p>
          {!slots ? (
            <Skeleton rows={2} />
          ) : free.length === 0 ? (
            <p className="text-sm text-stone-600">{t("Plus de créneau libre ce jour-là. Essayez un autre jour, ou passez sans réservation.")}</p>
          ) : (
            <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-label={t("Créneau")}>
              {free.map((s) => (
                <button
                  key={s.startsAt}
                  type="button"
                  role="radio"
                  aria-checked={slot === s.startsAt}
                  onClick={() => setSlot(s.startsAt)}
                  className={`rounded-xl border py-2 text-sm ${slot === s.startsAt ? "border-emerald-600 bg-emerald-600 font-semibold text-white" : "border-stone-200"}`}
                >
                  {hhmm(s.startsAt)}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-2">
          <input name="name" required minLength={2} maxLength={80} autoComplete="name" placeholder={t("Votre nom")} aria-label={t("Votre nom")} className={input} />
          <input name="phone" required inputMode="tel" autoComplete="tel" placeholder={t("Téléphone (8 chiffres)")} aria-label={t("Téléphone")} className={input} />
          <input name="plate" required minLength={3} maxLength={15} placeholder={t("Plaque de la moto")} aria-label={t("Plaque de la moto")} className={`${input} uppercase`} />
          <input name="bikeModel" maxLength={60} placeholder={t("Modèle de la moto (facultatif)")} aria-label={t("Modèle de la moto")} className={input} />
        </div>

        {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        <button disabled={busy || !slot} className={primary}>
          {t("Réserver pour {price}", { price: fcfa(price) })}
        </button>
        <p className="text-xs text-stone-500">{t("Vous payez à la station, en espèces ou par mobile money. Heures de Lomé.")}</p>
      </form>
    </div>
  );
}

function TicketView({ ticket, onBack, onChange }: { ticket: ChargingTicket; onBack: () => void; onChange: (t: ChargingTicket) => void }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [label, tone] = BOOKING_STATUS[ticket.status];
  const phone = savedTickets().find((s) => s.code === ticket.code)?.phone;

  return (
    <div className="mx-auto max-w-xl">
      <TopBar title="Mon ticket" onBack={onBack} />
      <div className="space-y-4 px-4 pb-10 pt-4">
        <div className={`${card} space-y-3 p-4 text-center`}>
          <span className={`inline-block rounded-full px-2 py-0.5 text-[13px] font-semibold ${tone}`}>{t(label)}</span>
          <p className="font-mono text-[32px] font-bold tracking-widest">{ticket.code}</p>
          <p className="text-sm text-stone-600">{t("Montrez ce code à la station.")}</p>
        </div>
        <dl className={`${card} grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 p-4 text-sm`}>
          <dt className="text-stone-500">{t("Service")}</dt>
          <dd className="font-semibold">{t(ticket.serviceLabel)}</dd>
          <dt className="text-stone-500">{t("Quand")}</dt>
          <dd className="font-semibold">
            {ticket.startsAt.slice(0, 10)} · {hhmm(ticket.startsAt)}–{hhmm(ticket.endsAt)}
          </dd>
          <dt className="text-stone-500">{t("Station")}</dt>
          <dd>
            <span className="block font-semibold">{ticket.station.name}</span>
            <span className="block text-stone-500">{ticket.station.address}</span>
            <a href={mapsUrl(ticket.station)} target="_blank" rel="noreferrer" className="font-semibold text-emerald-700">
              {t("Itinéraire")}
            </a>
          </dd>
          <dt className="text-stone-500">{t("Moto")}</dt>
          <dd>{ticket.plate}</dd>
          <dt className="text-stone-500">{t("Nom")}</dt>
          <dd>
            {ticket.name} · {ticket.phone}
          </dd>
          <dt className="text-stone-500">{t("Prix")}</dt>
          <dd className="font-semibold">{fcfa(ticket.paidAmount ?? ticket.price)}</dd>
        </dl>
        {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        {ticket.status === "BOOKED" && phone && (
          <button
            type="button"
            disabled={busy}
            className={secondary}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                onChange(await apiPost<ChargingTicket>(`/api/recharge/bookings/${encodeURIComponent(ticket.code)}/cancel`, { phone }));
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {t("Annuler la réservation")}
          </button>
        )}
      </div>
    </div>
  );
}

function FindTicket({ onFound }: { onFound: (t: ChargingTicket) => void }) {
  const t = useT();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className={`${card} space-y-2 p-3`}
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const code = String(f.get("code") ?? "").trim();
        const phone = String(f.get("phone") ?? "").trim();
        setBusy(true);
        setError(null);
        try {
          const found = await apiGet<ChargingTicket>(`/api/recharge/bookings/${encodeURIComponent(code)}?phone=${encodeURIComponent(phone)}`);
          if (!found) setError(t("Réservation introuvable"));
          else {
            saveTicket(found.code, phone);
            onFound(found);
          }
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2 className="font-semibold">{t("Retrouver un ticket")}</h2>
      <div className="grid grid-cols-2 gap-2">
        <input name="code" required placeholder={t("Code")} aria-label={t("Code du ticket")} className={`${input} uppercase`} />
        <input name="phone" required inputMode="tel" placeholder={t("Téléphone")} aria-label={t("Téléphone")} className={input} />
      </div>
      {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <button disabled={busy} className={secondary}>
        {t("Retrouver")}
      </button>
    </form>
  );
}
