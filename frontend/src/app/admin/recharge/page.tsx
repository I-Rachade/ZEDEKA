"use client";

import { useState } from "react";
import { fcfa } from "@/lib/api";
import { adminFetch } from "@/lib/admin";
import { BOOKING_STATUS, hhmm, offersService, SERVICE_LABEL, type BookingStatus, type ChargingService, type ChargingStation } from "@/lib/charging";
import { useI18n } from "@/lib/i18n/client";
import { button, buttonGhost, Card, Empty, ErrorNote, input, Loading, PageHeader, StatTile, Tabs } from "../ui";
import { useAction, useAdmin } from "../useAdmin";

type Summary = {
  stations: number;
  today: { booked: number; atStation: number; done: number; collected: number };
  month: { sessions: number; outside: number; swaps: number; collected: number };
};
type Booking = {
  id: string;
  code: string;
  service: ChargingService;
  startsAt: string;
  endsAt: string;
  name: string;
  phone: string;
  plate: string;
  bikeModel: string | null;
  driverId: string | null;
  price: number;
  status: BookingStatus;
  source: "ONLINE" | "STATION";
  paymentMethod: string | null;
  paidAmount: number | null;
  note: string | null;
  handledBy: string | null;
  station: { id: string; name: string };
};
type Tab = "jour" | "stations";
const today = () => new Date().toISOString().slice(0, 10);

// Recharge et échange de batteries ouverts à toutes les motos : réservations du jour, passages sans réservation,
// arrivée, paiement à la station, et stations (bornes, baies d'échange, prix, horaires).
export default function ChargingAdminPage() {
  const [tab, setTab] = useState<Tab>("jour");
  const { data: s, reload } = useAdmin<Summary>("/charging/summary");
  const t = useI18n().t;
  return (
    <div>
      <PageHeader
        icon="fire"
        title="Recharge"
        count={s ? s.today.booked + s.today.atStation || undefined : undefined}
        description="Recharge sur borne et échange de batteries, ouverts à toutes les motos électriques (livreurs Zedeka, taxis-motos, particuliers). Réservation sur la page publique /recharge ou passage sans réservation noté ici."
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Réservés aujourd'hui" value={s?.today.booked ?? "–"} icon="clock" />
        <StatTile label="À la station" value={s?.today.atStation ?? "–"} icon="pin" />
        <StatTile label="Encaissé aujourd'hui" value={s ? fcfa(s.today.collected) : "–"} hint={s ? t("{n} séance(s)", { n: s.today.done }) : undefined} icon="wallet" />
        <StatTile
          label="Ce mois"
          value={s ? fcfa(s.month.collected) : "–"}
          hint={s ? t("{n} séance(s), dont {outside} hors Zedeka", { n: s.month.sessions, outside: s.month.outside }) : undefined}
          icon="chart"
        />
      </div>
      <Card>
        <Tabs
          tabs={[
            { value: "jour" as const, label: "Réservations" },
            { value: "stations" as const, label: "Stations", count: s?.stations },
          ]}
          value={tab}
          onChange={setTab}
        />
        {tab === "jour" && <Bookings onChange={reload} />}
        {tab === "stations" && <Stations onChange={reload} />}
      </Card>
    </div>
  );
}

function Bookings({ onChange }: { onChange: () => void }) {
  const t = useI18n().t;
  const [day, setDay] = useState(today());
  const [stationId, setStationId] = useState("");
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const { data: stations } = useAdmin<ChargingStation[]>("/charging/stations");
  const { data, error, reload } = useAdmin<Booking[]>(
    search ? `/charging/bookings?q=${encodeURIComponent(search)}` : `/charging/bookings?day=${day}${stationId ? `&stationId=${stationId}` : ""}`,
  );
  const [walkIn, setWalkIn] = useState(false);
  const refresh = () => {
    reload();
    onChange();
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <input type="date" value={day} onChange={(e) => setDay(e.target.value || today())} aria-label={t("Jour")} className={`${input} w-44`} />
        <select value={stationId} onChange={(e) => setStationId(e.target.value)} aria-label={t("Station")} className={`${input} w-56`}>
          <option value="">{t("Toutes les stations")}</option>
          {(stations ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setSearch(q.trim());
          }}
        >
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Code, plaque ou numéro")} aria-label={t("Chercher une réservation")} className={`${input} w-56`} />
          <button className={buttonGhost}>{t("Chercher")}</button>
          {search && (
            <button
              type="button"
              className={buttonGhost}
              onClick={() => {
                setQ("");
                setSearch("");
              }}
            >
              {t("Effacer")}
            </button>
          )}
        </form>
        <button type="button" onClick={() => setWalkIn((v) => !v)} className={button}>
          {t("Passage sans réservation")}
        </button>
      </div>
      {walkIn && stations && (
        <WalkIn
          stations={stations.filter((s) => s.active)}
          onDone={() => {
            setWalkIn(false);
            refresh();
          }}
        />
      )}
      {!data ? (
        error ? <ErrorNote message={error} /> : <Loading />
      ) : data.length === 0 ? (
        <Empty>{search ? "Aucune réservation ne correspond." : "Aucune réservation ce jour-là."}</Empty>
      ) : (
        <ul className="space-y-2">
          {data.map((b) => (
            <BookingRow key={b.id} b={b} onChange={refresh} />
          ))}
        </ul>
      )}
    </div>
  );
}

function BookingRow({ b, onChange }: { b: Booking; onChange: () => void }) {
  const t = useI18n().t;
  const action = useAction();
  const [paying, setPaying] = useState(false);
  const [label, tone] = BOOKING_STATUS[b.status];
  const act = async (body: Record<string, unknown>) => {
    if (await action.run(() => adminFetch(`/charging/bookings/${b.id}/action`, { method: "POST", body }))) {
      setPaying(false);
      onChange();
    }
  };
  const open = b.status === "BOOKED" || b.status === "CHECKED_IN";
  return (
    <li className="rounded-xl border border-stone-200 p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-mono font-semibold">{b.code}</span>
          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${tone}`}>{t(label)}</span>
          {b.source === "STATION" && <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs">{t("Sans réservation")}</span>}
          {!b.driverId && <span className="rounded-full bg-violet-50 px-2 py-0.5 text-xs text-violet-800">{t("Hors Zedeka")}</span>}
        </span>
        <span className="font-semibold">
          {b.startsAt.slice(0, 10)} · {hhmm(b.startsAt)}–{hhmm(b.endsAt)}
        </span>
      </div>
      <p className="mt-1">
        {t(SERVICE_LABEL[b.service])} · {b.station.name} · {fcfa(b.paidAmount ?? b.price)}
        {b.paymentMethod ? ` · ${b.paymentMethod}` : ""}
      </p>
      <p className="text-stone-600">
        {b.name} · {b.phone} · {b.plate}
        {b.bikeModel ? ` · ${b.bikeModel}` : ""}
      </p>
      {(b.note || b.handledBy) && (
        <p className="text-stone-500">
          {b.note}
          {b.note && b.handledBy ? " · " : ""}
          {b.handledBy}
        </p>
      )}
      <ErrorNote message={action.error} />
      {open && (
        <div className="mt-2 flex flex-wrap gap-2">
          {b.status === "BOOKED" && (
            <button type="button" className={buttonGhost} onClick={() => act({ action: "CHECK_IN" })}>
              {t("Arrivé")}
            </button>
          )}
          <button type="button" className={button} onClick={() => setPaying((v) => !v)}>
            {t("Terminé et payé")}
          </button>
          {b.status === "BOOKED" && (
            <button type="button" className={buttonGhost} onClick={() => act({ action: "NO_SHOW" })}>
              {t("Absent")}
            </button>
          )}
          <button type="button" className={`${buttonGhost} text-red-700`} onClick={() => act({ action: "CANCEL" })}>
            {t("Annuler")}
          </button>
        </div>
      )}
      {paying && (
        <form
          className="mt-2 flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            act({
              action: "DONE",
              paymentMethod: String(f.get("method")),
              paidAmount: Number(f.get("amount")) || 0,
              paymentRef: String(f.get("ref") ?? "") || undefined,
            });
          }}
        >
          <select name="method" aria-label={t("Moyen de paiement")} className={`${input} w-36`} defaultValue="CASH">
            <option value="CASH">{t("Espèces")}</option>
            <option value="FLOOZ">Flooz</option>
            <option value="TMONEY">T-Money</option>
          </select>
          <input name="amount" type="number" min={0} defaultValue={b.price} aria-label={t("Montant encaissé")} className={`${input} w-32`} />
          <input name="ref" maxLength={40} placeholder={t("Référence (mobile money)")} aria-label={t("Référence")} className={`${input} w-48`} />
          <button className={button}>{t("Valider")}</button>
        </form>
      )}
    </li>
  );
}

function WalkIn({ stations, onDone }: { stations: ChargingStation[]; onDone: () => void }) {
  const t = useI18n().t;
  const action = useAction();
  const [stationId, setStationId] = useState(stations[0]?.id ?? "");
  const station = stations.find((s) => s.id === stationId);
  if (!stations.length) return <Empty>Ajoutez d&apos;abord une station.</Empty>;
  return (
    <form
      className="grid gap-2 rounded-xl border border-emerald-200 bg-emerald-50/40 p-3 sm:grid-cols-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const ok = await action.run(() =>
          adminFetch("/charging/bookings", {
            method: "POST",
            body: {
              stationId,
              service: String(f.get("service")),
              name: String(f.get("name") ?? ""),
              phone: String(f.get("phone") ?? ""),
              plate: String(f.get("plate") ?? ""),
              bikeModel: String(f.get("bikeModel") ?? "") || undefined,
            },
          }),
        );
        if (ok) onDone();
      }}
    >
      <select value={stationId} onChange={(e) => setStationId(e.target.value)} aria-label={t("Station")} className={input}>
        {stations.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      <select name="service" aria-label={t("Service")} className={input}>
        {(["CHARGE", "SWAP"] as const)
          .filter((k) => station && offersService(station, k))
          .map((k) => (
            <option key={k} value={k}>
              {t(SERVICE_LABEL[k])}
            </option>
          ))}
      </select>
      <input name="name" required minLength={2} maxLength={80} placeholder={t("Nom")} aria-label={t("Nom")} className={input} />
      <input name="phone" required placeholder={t("Téléphone")} aria-label={t("Téléphone")} className={input} />
      <input name="plate" required minLength={3} maxLength={15} placeholder={t("Plaque")} aria-label={t("Plaque")} className={`${input} uppercase`} />
      <input name="bikeModel" maxLength={60} placeholder={t("Modèle (facultatif)")} aria-label={t("Modèle de la moto")} className={input} />
      <div className="sm:col-span-3">
        <ErrorNote message={action.error} />
        <button className={button}>{t("Enregistrer le passage")}</button>
      </div>
    </form>
  );
}

function Stations({ onChange }: { onChange: () => void }) {
  const { data, error, reload } = useAdmin<ChargingStation[]>("/charging/stations");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const t = useI18n().t;
  const done = () => {
    setAdding(false);
    setEditing(null);
    reload();
    onChange();
  };
  if (!data) return error ? <ErrorNote message={error} /> : <Loading />;
  return (
    <div className="space-y-3">
      <button type="button" onClick={() => setAdding((v) => !v)} className={button}>
        {t("Nouvelle station")}
      </button>
      {adding && <StationForm onDone={done} />}
      {data.length === 0 && !adding && <Empty>Aucune station pour l&apos;instant.</Empty>}
      <ul className="space-y-2">
        {data.map((s) => (
          <li key={s.id} className={`rounded-xl border p-3 text-sm ${s.active ? "border-stone-200" : "border-dashed border-stone-300 opacity-70"}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold">
                {s.name}
                {!s.active && <span className="ml-2 text-xs text-stone-500">{t("Fermée")}</span>}
              </span>
              <button type="button" onClick={() => setEditing(editing === s.id ? null : s.id)} className={buttonGhost}>
                {t("Modifier")}
              </button>
            </div>
            <p className="text-stone-600">{s.address}</p>
            <p className="text-stone-600">
              {offersService(s, "CHARGE") && t("{n} borne(s) à {price}", { n: s.chargePoints, price: fcfa(s.chargePrice) })}
              {s.kind === "BOTH" && " · "}
              {offersService(s, "SWAP") && t("{n} baie(s) d'échange à {price}", { n: s.swapBays, price: fcfa(s.swapPrice) })}
            </p>
            <p className="text-stone-500">
              {t("{from}–{to}, créneaux de {n} min", { from: s.opensAt, to: s.closesAt, n: s.slotMinutes })}
            </p>
            {editing === s.id && <StationForm station={s} onDone={done} />}
          </li>
        ))}
      </ul>
    </div>
  );
}

function StationForm({ station, onDone }: { station?: ChargingStation; onDone: () => void }) {
  const t = useI18n().t;
  const action = useAction();
  const num = (v: FormDataEntryValue | null) => (v === null || String(v).trim() === "" ? null : Number(v));
  return (
    <form
      className="mt-2 grid gap-2 rounded-xl border border-stone-200 p-3 sm:grid-cols-2"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const body = {
          name: String(f.get("name") ?? ""),
          kind: String(f.get("kind")),
          address: String(f.get("address") ?? ""),
          latitude: num(f.get("latitude")),
          longitude: num(f.get("longitude")),
          chargePoints: Number(f.get("chargePoints")) || 0,
          swapBays: Number(f.get("swapBays")) || 0,
          chargePrice: Number(f.get("chargePrice")) || 0,
          swapPrice: Number(f.get("swapPrice")) || 0,
          slotMinutes: Number(f.get("slotMinutes")) || 60,
          opensAt: String(f.get("opensAt") ?? ""),
          closesAt: String(f.get("closesAt") ?? ""),
          active: f.get("active") === "on",
          note: String(f.get("note") ?? "") || null,
        };
        const ok = await action.run(() =>
          adminFetch(station ? `/charging/stations/${station.id}` : "/charging/stations", { method: station ? "PATCH" : "POST", body }),
        );
        if (ok) onDone();
      }}
    >
      <label className="block text-sm">
        {t("Nom")}
        <input name="name" required minLength={2} maxLength={80} defaultValue={station?.name} className={input} />
      </label>
      <label className="block text-sm">
        {t("Services")}
        <select name="kind" defaultValue={station?.kind ?? "BOTH"} className={input}>
          <option value="BOTH">{t("Recharge et échange")}</option>
          <option value="CHARGE">{t("Recharge sur borne")}</option>
          <option value="SWAP">{t("Échange de batterie")}</option>
        </select>
      </label>
      <label className="block text-sm sm:col-span-2">
        {t("Adresse")}
        <input name="address" required minLength={3} maxLength={300} defaultValue={station?.address} className={input} />
      </label>
      <label className="block text-sm">
        {t("Latitude")}
        <input name="latitude" type="number" step="any" defaultValue={station?.latitude ?? ""} className={input} />
      </label>
      <label className="block text-sm">
        {t("Longitude")}
        <input name="longitude" type="number" step="any" defaultValue={station?.longitude ?? ""} className={input} />
      </label>
      <label className="block text-sm">
        {t("Bornes de recharge")}
        <input name="chargePoints" type="number" min={0} max={100} defaultValue={station?.chargePoints ?? 2} className={input} />
      </label>
      <label className="block text-sm">
        {t("Prix d'une recharge (FCFA)")}
        <input name="chargePrice" type="number" min={0} defaultValue={station?.chargePrice ?? 1000} className={input} />
      </label>
      <label className="block text-sm">
        {t("Baies d'échange de batterie")}
        <input name="swapBays" type="number" min={0} max={100} defaultValue={station?.swapBays ?? 1} className={input} />
      </label>
      <label className="block text-sm">
        {t("Prix d'un échange (FCFA)")}
        <input name="swapPrice" type="number" min={0} defaultValue={station?.swapPrice ?? 1500} className={input} />
      </label>
      <label className="block text-sm">
        {t("Ouverture (HH:MM)")}
        <input name="opensAt" required pattern="[0-2][0-9]:[0-5][0-9]" defaultValue={station?.opensAt ?? "07:00"} className={input} />
      </label>
      <label className="block text-sm">
        {t("Fermeture (HH:MM)")}
        <input name="closesAt" required pattern="[0-2][0-9]:[0-5][0-9]" defaultValue={station?.closesAt ?? "21:00"} className={input} />
      </label>
      <label className="block text-sm">
        {t("Durée d'un créneau (minutes)")}
        <input name="slotMinutes" type="number" min={15} max={240} defaultValue={station?.slotMinutes ?? 60} className={input} />
      </label>
      <label className="flex items-center gap-2 self-end text-sm">
        <input name="active" type="checkbox" defaultChecked={station?.active ?? true} />
        {t("Ouverte aux réservations")}
      </label>
      <label className="block text-sm sm:col-span-2">
        {t("Note affichée aux clients")}
        <input name="note" maxLength={300} defaultValue={station?.note ?? ""} className={input} />
      </label>
      <div className="sm:col-span-2">
        <ErrorNote message={action.error} />
        <button className={button}>{station ? t("Enregistrer") : t("Ajouter la station")}</button>
      </div>
    </form>
  );
}
