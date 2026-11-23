"use client";

import Link from "next/link";
import { use, useState } from "react";
import { fcfa } from "@/lib/api";
import { adminFetch, formatTime, roleOf, seesEverything, telLink, useStaff } from "@/lib/admin";
import { useI18n } from "@/lib/i18n/client";
import { ABSENCE_LEG, dayLabel, hhmm, KIND_LABEL, LEG_LABEL, monthLabel, scheduleText, TRIP_STATUS, type Leg, type MonthState, type PassKind, type PassStatus, type Schedule, type TripStatus } from "@/lib/school";
import { button, buttonDanger, buttonGhost, Card, ErrorNote, input, Loading, PageHeader, StatTile } from "../../ui";
import { useAction, useAdmin } from "../../useAdmin";
import { PassPill } from "../shared";

type Detail = {
  id: string;
  kind: PassKind;
  riderName: string;
  riderGrade: string | null;
  schoolName: string;
  schoolAddress: string;
  schoolLatitude: number | null;
  schoolLongitude: number | null;
  homeAddress: string;
  homeLatitude: number | null;
  homeLongitude: number | null;
  schedule: Schedule;
  emergencyName: string;
  emergencyPhone: string;
  emergency2Name: string | null;
  emergency2Phone: string | null;
  healthNote: string | null;
  note: string | null;
  homeCode: string | null;
  schoolCode: string | null;
  monthlyFee: number;
  status: PassStatus;
  statusNote: string | null;
  startsOn: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
  customer: { id: string; name: string | null; phone: string };
  driver: { id: string; name: string; phone: string; plate: string | null; zedStatus: string | null; schoolCleared: boolean } | null;
  payments: { id: string; month: string; amount: number; method: "CASH" | "BANK" | "OTHER"; note: string | null; recordedBy: string | null; createdAt: string }[];
  absences: { id: string; date: string; leg: "BOTH" | Leg; reason: string | null; createdBy: string | null }[];
  trips: { id: string; date: string; leg: Leg; scheduledAt: string; status: TripStatus; pickedUpAt: string | null; droppedAt: string | null; codeSkipped: boolean; note: string | null; driver: { id: string; name: string } | null }[];
  month: MonthState;
  conflicts: string[];
  today: string;
};
type Candidate = { id: string; name: string; phone: string; plate: string | null; active: boolean; schoolCleared: boolean; passes: number };

const METHOD: Record<Detail["payments"][number]["method"], string> = { CASH: "Espèces au bureau", BANK: "Virement", OTHER: "Autre" };
const mapLink = (lat: number | null, lng: number | null) => (lat !== null && lng !== null ? `https://www.google.com/maps/search/?api=1&query=${lat},${lng}` : null);

// Fiche d'un abonnement : validation et conducteur attitré, paiements du mois, absences, trajets, codes.
export default function SchoolPassAdminPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { t, locale } = useI18n();
  const { data: p, error, reload } = useAdmin<Detail>(`/school/passes/${id}`);
  const { data: drivers } = useAdmin<Candidate[]>("/school/drivers");
  const action = useAction();
  const manages = seesEverything(roleOf(useStaff()));
  const [busy, setBusy] = useState(false);

  if (!p) return error ? <ErrorNote message={error} /> : <Loading />;
  const child = p.kind === "SCHOOL";
  const eligible = (drivers ?? []).filter((d) => d.active && (!child || d.schoolCleared));
  const open = p.status === "ACTIVE" || p.status === "PAUSED";

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    const ok = await action.run(fn);
    setBusy(false);
    if (ok) await reload();
    return ok;
  }

  async function post(path: string, body: unknown) {
    return adminFetch(path, { method: "POST", body });
  }

  const currentMonth = p.month.month;
  const nextMonth = (() => {
    const d = new Date(`${currentMonth}-01T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + 1);
    return d.toISOString().slice(0, 7);
  })();

  return (
    <div className="space-y-4">
      <Link href="/admin/ecole" className="text-sm text-emerald-700 underline">
        ← {t("Transport scolaire")}
      </Link>
      <PageHeader
        icon="user"
        title={`${child ? "🎒" : "🎓"} ${p.riderName}`}
        description={`${t(KIND_LABEL[p.kind])}${p.riderGrade ? ` · ${p.riderGrade}` : ""} · ${p.schoolName}`}
        actions={<PassPill status={p.status} />}
      />
      <ErrorNote message={action.error} />
      {p.status === "ACTIVE" && p.conflicts.length > 0 && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{t("Créneaux proches d'un autre abonné du conducteur : {list}", { list: p.conflicts.join(" ; ") })}</p>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Par mois" value={fcfa(p.monthlyFee)} icon="wallet" />
        <StatTile
          label="Mois en cours"
          value={p.month.paid ? t("Payé") : p.month.suspended ? t("Non payé") : t("À payer")}
          hint={p.month.lastPaidMonth ? t("Dernier mois payé : {month}", { month: monthLabel(p.month.lastPaidMonth, locale) }) : t("Aucun mois payé")}
          icon="chart"
        />
        <StatTile label="Conducteur" value={p.driver?.name ?? t("À choisir")} hint={p.driver?.plate ?? undefined} icon="rider" />
        <StatTile label="Début" value={p.startsOn ? dayLabel(p.startsOn, locale) : t("Dès la validation")} icon="clock" />
      </div>

      {manages && (p.status === "PENDING" || open) && (
        <Card title={p.status === "PENDING" ? "Valider la demande" : "Conducteur attitré"}>
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const driverId = String(f.get("driverId") ?? "");
              const force = f.get("force") === "on";
              if (p.status === "PENDING")
                await run(() => post(`/school/passes/${p.id}/approve`, { driverId, force, monthlyFee: Number(f.get("monthlyFee")), startsOn: String(f.get("startsOn") ?? "") || null }));
              else await run(() => post(`/school/passes/${p.id}/assign`, { driverId, force }));
            }}
          >
            <label className="min-w-64 flex-1 text-sm">
              {child ? t("Conducteur vérifié pour les enfants") : t("Conducteur Course Zed")}
              <select name="driverId" required defaultValue={p.driver?.id ?? ""} className={input}>
                <option value="" disabled>
                  {t("Choisir…")}
                </option>
                {eligible.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} · {d.plate ?? d.phone} · {t("{n} abonné(s)", { n: d.passes })}
                  </option>
                ))}
              </select>
            </label>
            {p.status === "PENDING" && (
              <>
                <label className="text-sm">
                  {t("Prix par mois (FCFA)")}
                  <input type="number" name="monthlyFee" min={0} max={1_000_000} defaultValue={p.monthlyFee} className={input} />
                </label>
                <label className="text-sm">
                  {t("Premier jour")}
                  <input type="date" name="startsOn" defaultValue={p.startsOn ?? ""} className={input} />
                </label>
              </>
            )}
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="force" /> {t("Malgré les créneaux proches")}
            </label>
            <button disabled={busy} className={button}>
              {p.status === "PENDING" ? t("Valider l'abonnement") : t("Changer de conducteur")}
            </button>
          </form>
          {child && drivers && eligible.length === 0 && (
            <p className="mt-2 text-sm text-amber-800">
              {t("Aucun conducteur vérifié pour les enfants.")}{" "}
              <Link href="/admin/ecole?onglet=conducteurs" className="underline">
                {t("Vérifier un conducteur")}
              </Link>
            </p>
          )}
          {p.status === "PENDING" && (
            <button
              disabled={busy}
              onClick={() => {
                const note = window.prompt(t("Raison du refus (envoyée au parent ou à l'étudiant)"));
                if (note !== null) run(() => post(`/school/passes/${p.id}/status`, { status: "REJECTED", note }));
              }}
              className={`${buttonGhost} mt-3`}
            >
              {t("Refuser la demande")}
            </button>
          )}
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Élève et famille">
          <dl className="space-y-2 text-sm">
            <Row label="Horaires">{scheduleText(p.schedule, t)}</Row>
            <Row label="Maison">
              {p.homeAddress}{" "}
              {mapLink(p.homeLatitude, p.homeLongitude) && (
                <a href={mapLink(p.homeLatitude, p.homeLongitude)!} target="_blank" rel="noreferrer" className="text-emerald-700 underline">
                  {t("carte")}
                </a>
              )}
            </Row>
            <Row label="École">
              {p.schoolName}, {p.schoolAddress}{" "}
              {mapLink(p.schoolLatitude, p.schoolLongitude) && (
                <a href={mapLink(p.schoolLatitude, p.schoolLongitude)!} target="_blank" rel="noreferrer" className="text-emerald-700 underline">
                  {t("carte")}
                </a>
              )}
            </Row>
            <Row label={child ? "Parent" : "Étudiant"}>
              {p.customer.name ?? "–"} ·{" "}
              <a href={telLink(p.customer.phone)} className="underline">
                {p.customer.phone}
              </a>
            </Row>
            <Row label="Urgence">
              {p.emergencyName} · <a href={telLink(p.emergencyPhone)} className="underline">{p.emergencyPhone}</a>
              {p.emergency2Name && ` · ${p.emergency2Name}`}
              {p.emergency2Phone && (
                <>
                  {" "}
                  · <a href={telLink(p.emergency2Phone)} className="underline">{p.emergency2Phone}</a>
                </>
              )}
            </Row>
            {p.healthNote && <Row label="Santé">{p.healthNote}</Row>}
            {p.note && <Row label="Remarque">{p.note}</Row>}
            {child && (
              <Row label="Codes de remise">
                <span className="font-mono">
                  {t("école")} {p.schoolCode} · {t("maison")} {p.homeCode}
                </span>
              </Row>
            )}
            {p.statusNote && <Row label="Note">{p.statusNote}</Row>}
            {p.reviewedBy && <Row label="Traité par">{`${p.reviewedBy}${p.reviewedAt ? ` · ${formatTime(p.reviewedAt)}` : ""}`}</Row>}
          </dl>
        </Card>

        <Card title="Paiements">
          {manages && open && (
            <form
              className="mb-3 flex flex-wrap items-end gap-2"
              onSubmit={async (e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                await run(() => post(`/school/passes/${p.id}/payments`, { month: f.get("month"), amount: Number(f.get("amount")), method: f.get("method"), note: String(f.get("note") ?? "") || null }));
              }}
            >
              <label className="text-sm">
                {t("Mois")}
                <select name="month" className={input} defaultValue={p.month.paid ? nextMonth : currentMonth}>
                  {[currentMonth, nextMonth].map((m) => (
                    <option key={m} value={m}>
                      {monthLabel(m, locale)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                {t("Montant")}
                <input type="number" name="amount" min={0} defaultValue={p.monthlyFee} className={`${input} !w-28`} />
              </label>
              <label className="text-sm">
                {t("Moyen")}
                <select name="method" className={input} defaultValue="CASH">
                  {(Object.keys(METHOD) as (keyof typeof METHOD)[]).map((m) => (
                    <option key={m} value={m}>
                      {t(METHOD[m])}
                    </option>
                  ))}
                </select>
              </label>
              <input name="note" maxLength={200} placeholder={t("Reçu n°, remarque")} className={`${input} !w-40`} />
              <button disabled={busy} className={button}>
                {t("Enregistrer le paiement")}
              </button>
            </form>
          )}
          {p.payments.length === 0 ? (
            <p className="text-sm text-stone-600">{t("Aucun mois payé.")}</p>
          ) : (
            <ul className="divide-y divide-stone-100 text-sm">
              {p.payments.map((pay) => (
                <li key={pay.id} className="flex items-center justify-between gap-2 py-2">
                  <span>
                    <span className="font-semibold capitalize">{monthLabel(pay.month, locale)}</span>
                    <span className="block text-xs text-stone-500">
                      {t(METHOD[pay.method])} · {formatTime(pay.createdAt)}
                      {pay.recordedBy ? ` · ${pay.recordedBy}` : ""}
                      {pay.note ? ` · ${pay.note}` : ""}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="font-semibold">{fcfa(pay.amount)}</span>
                    {manages && (
                      <button
                        disabled={busy}
                        onClick={() => window.confirm(t("Supprimer ce paiement (erreur de saisie) ?")) && run(() => adminFetch(`/school/payments/${pay.id}`, { method: "DELETE" }))}
                        className="text-xs text-red-700 underline"
                      >
                        {t("Supprimer")}
                      </button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Trajets">
          {p.trips.length === 0 ? (
            <p className="text-sm text-stone-600">{t("Aucun trajet pour l'instant.")}</p>
          ) : (
            <ul className="divide-y divide-stone-100 text-sm">
              {p.trips.map((tr) => (
                <li key={tr.id} className="flex items-center justify-between gap-2 py-2">
                  <span>
                    <span className="capitalize">{dayLabel(tr.date, locale)}</span> · <span className="font-mono">{hhmm(tr.scheduledAt)}</span> · {t(LEG_LABEL[tr.leg])}
                    <span className="block text-xs text-stone-500">
                      {tr.driver?.name ?? "–"}
                      {tr.pickedUpAt ? ` · ${t("pris à {time}", { time: hhmm(tr.pickedUpAt) })}` : ""}
                      {tr.droppedAt ? ` · ${t("remis à {time}", { time: hhmm(tr.droppedAt) })}` : ""}
                      {tr.note ? ` · ${tr.note}` : ""}
                    </span>
                  </span>
                  <span className="flex flex-col items-end gap-1">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${TRIP_STATUS[tr.status].tone}`}>{t(TRIP_STATUS[tr.status].label)}</span>
                    {tr.codeSkipped && <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">{t("Sans code")}</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Absences">
          {manages && open && (
            <form
              className="mb-3 flex flex-wrap items-end gap-2"
              onSubmit={async (e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                await run(() => post(`/school/passes/${p.id}/absences`, { date: f.get("date"), leg: f.get("leg"), reason: String(f.get("reason") ?? "") || null }));
              }}
            >
              <input type="date" name="date" required defaultValue={p.today} className={`${input} !w-auto`} aria-label={t("Jour")} />
              <select name="leg" className={`${input} !w-auto`} defaultValue="BOTH" aria-label={t("Trajets")}>
                {(["BOTH", "GO", "BACK"] as const).map((l) => (
                  <option key={l} value={l}>
                    {t(ABSENCE_LEG[l])}
                  </option>
                ))}
              </select>
              <input name="reason" maxLength={200} placeholder={t("Raison")} className={`${input} !w-40`} />
              <button disabled={busy} className={buttonGhost}>
                {t("Ajouter")}
              </button>
            </form>
          )}
          {p.absences.length === 0 ? (
            <p className="text-sm text-stone-600">{t("Aucune absence.")}</p>
          ) : (
            <ul className="divide-y divide-stone-100 text-sm">
              {p.absences.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-2 py-2">
                  <span>
                    <span className="capitalize">{dayLabel(a.date, locale)}</span> · {t(ABSENCE_LEG[a.leg])}
                    <span className="block text-xs text-stone-500">
                      {a.reason ?? ""}
                      {a.createdBy ? ` · ${a.createdBy === "parent" ? t("par le client") : a.createdBy}` : ""}
                    </span>
                  </span>
                  {manages && (
                    <button disabled={busy} onClick={() => run(() => adminFetch(`/school/absences/${a.id}`, { method: "DELETE" }))} className="text-xs text-red-700 underline">
                      {t("Retirer")}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {manages && open && (
        <Card title="Arrêter ou reprendre">
          <div className="flex flex-wrap gap-2">
            {p.status === "ACTIVE" && (
              <button disabled={busy} onClick={() => run(() => post(`/school/passes/${p.id}/status`, { status: "PAUSED", note: window.prompt(t("Raison de la pause (envoyée au client)")) || null }))} className={buttonGhost}>
                {t("Mettre en pause")}
              </button>
            )}
            {p.status === "PAUSED" && (
              <button disabled={busy} onClick={() => run(() => post(`/school/passes/${p.id}/status`, { status: "ACTIVE" }))} className={button}>
                {t("Reprendre")}
              </button>
            )}
            <button
              disabled={busy}
              onClick={() => {
                if (window.confirm(t("Terminer l'abonnement ? Les trajets à venir sont annulés.")))
                  run(() => post(`/school/passes/${p.id}/status`, { status: "ENDED", note: window.prompt(t("Raison (facultatif)")) || null }));
              }}
              className={buttonDanger}
            >
              {t("Terminer l'abonnement")}
            </button>
          </div>
        </Card>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  const t = useI18n().t;
  return (
    <div className="grid grid-cols-[8rem_1fr] gap-2">
      <dt className="text-stone-500">{t(label)}</dt>
      <dd>{children}</dd>
    </div>
  );
}
