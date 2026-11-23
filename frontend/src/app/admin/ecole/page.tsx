"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import DataTable from "@/components/panel/DataTable";
import { fcfa } from "@/lib/api";
import { adminFetch, roleOf, seesEverything, useStaff } from "@/lib/admin";
import { useI18n } from "@/lib/i18n/client";
import { dayLabel, hhmm, KIND_LABEL, LEG_LABEL, scheduleText, TRIP_STATUS, type Fees, type Leg, type MonthState, type PassKind, type PassStatus, type Schedule, type TripStatus } from "@/lib/school";
import { button, buttonGhost, ErrorNote, input, Loading, PageHeader, StatTile, Tabs, Card } from "../ui";
import { useAction, useAdmin } from "../useAdmin";
import { PassPill } from "./shared";

type Summary = {
  pending: number;
  active: number;
  activeSchool: number;
  activeStudent: number;
  paused: number;
  withoutDriver: number;
  unpaid: number;
  expectedThisMonth: number;
  collectedThisMonth: number;
  tripsToday: Partial<Record<TripStatus, number>>;
  fees: Fees;
  graceDays: number;
  maxPerDriver: number;
};
type PassRow = {
  id: string;
  kind: PassKind;
  riderName: string;
  riderGrade: string | null;
  schoolName: string;
  homeAddress: string;
  status: PassStatus;
  monthlyFee: number;
  schedule: Schedule;
  createdAt: string;
  startsOn: string | null;
  customer: { id: string; name: string | null; phone: string };
  driver: { id: string; name: string; phone: string; plate: string | null } | null;
  month: MonthState;
};
type TripRow = {
  id: string;
  leg: Leg;
  scheduledAt: string;
  status: TripStatus;
  codeSkipped: boolean;
  note: string | null;
  pickedUpAt: string | null;
  droppedAt: string | null;
  pass: { id: string; kind: PassKind; riderName: string; schoolName: string; homeAddress: string; customer: { name: string | null; phone: string } };
  driver: { id: string; name: string; phone: string } | null;
};
type SchoolDriver = { id: string; name: string; phone: string; plate: string | null; vehicle: string; active: boolean; schoolCleared: boolean; schoolClearedAt: string | null; schoolClearedBy: string | null; passes: number };
type Holiday = { id: string; date: string; label: string; kind: "ALL" | PassKind };

type Tab = "demandes" | "abonnements" | "trajets" | "conducteurs" | "feries" | "termines";

export default function SchoolAdminPage() {
  return (
    <Suspense fallback={<Loading />}>
      <SchoolAdmin />
    </Suspense>
  );
}

// Transport scolaire : demandes à valider, abonnements en cours, trajets du jour, conducteurs vérifiés, jours fériés.
function SchoolAdmin() {
  const params = useSearchParams();
  const { t } = useI18n();
  const { data: s, reload } = useAdmin<Summary>("/school/summary");
  const [tab, setTab] = useState<Tab>((params.get("onglet") as Tab | null) ?? (s && s.pending === 0 ? "abonnements" : "demandes"));
  const trips = s?.tripsToday ?? {};
  const tripsLeft = (trips.PLANNED ?? 0) + (trips.ON_THE_WAY ?? 0) + (trips.PICKED_UP ?? 0);

  return (
    <div>
      <PageHeader
        icon="user"
        title="Transport scolaire"
        count={s?.pending || undefined}
        description="Abonnements mensuels maison-école des écoliers (inscrits par leur parent) et des étudiants, assurés par des conducteurs Course Zed attitrés. Paiement encaissé au bureau, enregistré ici."
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Abonnements en cours" value={s?.active ?? "–"} hint={s ? t("{school} écolier(s) · {student} étudiant(s)", { school: s.activeSchool, student: s.activeStudent }) : undefined} icon="user" />
        <StatTile label="Demandes à valider" value={s?.pending ?? "–"} hint={s?.withoutDriver ? t("{n} sans conducteur", { n: s.withoutDriver }) : undefined} icon="bell" />
        <StatTile label="Trajets aujourd'hui" value={s ? tripsLeft + (trips.DROPPED ?? 0) : "–"} hint={s ? t("{done} faits · {left} à venir", { done: trips.DROPPED ?? 0, left: tripsLeft }) : undefined} icon="clock" />
        <StatTile
          label="Encaissé ce mois-ci"
          value={s ? fcfa(s.collectedThisMonth) : "–"}
          hint={s ? t("{amount} attendus · {n} non payé(s)", { amount: fcfa(s.expectedThisMonth), n: s.unpaid }) : undefined}
          icon="wallet"
        />
      </div>
      <Card>
        <Tabs
          tabs={[
            { value: "demandes" as const, label: "Demandes", count: s?.pending },
            { value: "abonnements" as const, label: "En cours", count: s ? s.active + s.paused : undefined },
            { value: "trajets" as const, label: "Trajets du jour" },
            { value: "conducteurs" as const, label: "Conducteurs" },
            { value: "feries" as const, label: "Jours fériés" },
            { value: "termines" as const, label: "Terminés" },
          ]}
          value={tab}
          onChange={setTab}
        />
        {tab === "demandes" && <Passes status="PENDING" />}
        {tab === "abonnements" && <Passes status="OPEN" />}
        {tab === "termines" && <Passes status="ENDED" />}
        {tab === "trajets" && <Trips />}
        {tab === "conducteurs" && <Drivers onChange={reload} />}
        {tab === "feries" && <Holidays />}
      </Card>
      {s && (
        <p className="mt-3 text-xs text-stone-500">
          <Link href="/admin/reglages#ecole" className="underline">
            {t("Écolier {school} · étudiant {student} par mois (aller-retour) · {n} jours de grâce · {max} abonnements au plus par conducteur", {
              school: fcfa(s.fees.SCHOOL.round),
              student: fcfa(s.fees.STUDENT.round),
              n: s.graceDays,
              max: s.maxPerDriver,
            })}
          </Link>
        </p>
      )}
    </div>
  );
}


function Passes({ status }: { status: "PENDING" | "OPEN" | "ENDED" }) {
  const { t, locale } = useI18n();
  const { data, error } = useAdmin<PassRow[]>(`/school/passes?status=${status}`);
  if (!data) return error ? <ErrorNote message={error} /> : <Loading />;
  return (
    <DataTable
      rows={data}
      rowKey={(p) => p.id}
      rowHref={(p) => `/admin/ecole/${p.id}`}
      empty={status === "PENDING" ? "Aucune demande à valider." : status === "OPEN" ? "Aucun abonnement en cours." : "Aucun abonnement terminé."}
      columns={[
        {
          header: "Élève ou étudiant",
          mobile: "title",
          cell: (p) => (
            <span>
              <span className="font-semibold">
                {p.kind === "SCHOOL" ? "🎒" : "🎓"} {p.riderName}
              </span>
              <span className="block text-xs text-stone-500">
                {t(KIND_LABEL[p.kind])}
                {p.riderGrade ? ` · ${p.riderGrade}` : ""} · {p.schoolName}
              </span>
            </span>
          ),
        },
        {
          header: "État",
          mobile: "badge",
          cell: (p) => (
            <span className="flex flex-col items-start gap-1">
              <PassPill status={p.status} />
              {p.status === "ACTIVE" && !p.month.paid && (
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${p.month.suspended ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-800"}`}>{p.month.suspended ? t("Non payé : arrêté") : t("Mois à payer")}</span>
              )}
            </span>
          ),
        },
        { header: "Horaires", cell: (p) => <span className="text-xs">{scheduleText(p.schedule, t)}</span> },
        {
          header: "Parent ou étudiant",
          cell: (p) => (
            <span>
              {p.customer.name ?? "–"}
              <span className="block text-xs text-stone-500">{p.customer.phone}</span>
            </span>
          ),
        },
        { header: "Conducteur", cell: (p) => (p.driver ? p.driver.name : <span className="font-semibold text-amber-700">{t("À choisir")}</span>) },
        { header: "Par mois", cell: (p) => fcfa(p.monthlyFee) },
        { header: "Demandé le", cell: (p) => dayLabel(p.createdAt.slice(0, 10), locale) },
      ]}
    />
  );
}

function Trips() {
  const { t } = useI18n();
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const { data, error } = useAdmin<TripRow[]>(`/school/trips?date=${date}`);
  return (
    <div className="space-y-3">
      <label className="inline-flex items-center gap-2 text-sm">
        {t("Jour")}
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={`${input} !w-auto`} />
      </label>
      {!data ? (
        error ? (
          <ErrorNote message={error} />
        ) : (
          <Loading />
        )
      ) : (
        <DataTable
          rows={data}
          rowKey={(r) => r.id}
          rowHref={(r) => `/admin/ecole/${r.pass.id}`}
          empty="Aucun trajet ce jour-là."
          columns={[
            { header: "Heure", mobile: "title", cell: (r) => <span className="font-mono font-semibold">{hhmm(r.scheduledAt)}</span> },
            {
              header: "Trajet",
              cell: (r) => (
                <span>
                  <span className="font-semibold">{r.pass.riderName}</span>
                  <span className="block text-xs text-stone-500">
                    {t(LEG_LABEL[r.leg])} · {r.leg === "GO" ? `${r.pass.homeAddress} → ${r.pass.schoolName}` : `${r.pass.schoolName} → ${r.pass.homeAddress}`}
                  </span>
                </span>
              ),
            },
            {
              header: "État",
              mobile: "badge",
              cell: (r) => (
                <span className="flex flex-col items-start gap-1">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${TRIP_STATUS[r.status].tone}`}>{t(TRIP_STATUS[r.status].label)}</span>
                  {r.codeSkipped && <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">{t("Remis sans code")}</span>}
                </span>
              ),
            },
            {
              header: "Conducteur",
              cell: (r) =>
                r.driver ? (
                  <span>
                    {r.driver.name}
                    <span className="block text-xs text-stone-500">{r.driver.phone}</span>
                  </span>
                ) : (
                  "–"
                ),
            },
            { header: "Remarque", cell: (r) => <span className="text-xs">{r.note ?? ""}</span> },
          ]}
        />
      )}
    </div>
  );
}

function Drivers({ onChange }: { onChange: () => void }) {
  const { t } = useI18n();
  const { data, error, reload } = useAdmin<SchoolDriver[]>("/school/drivers");
  const action = useAction();
  const manages = seesEverything(roleOf(useStaff()));
  const [busy, setBusy] = useState<string | null>(null);
  if (!data) return error ? <ErrorNote message={error} /> : <Loading />;

  async function clear(d: SchoolDriver, cleared: boolean) {
    if (!cleared && !window.confirm(t("Retirer la vérification ? Ses abonnements écoliers perdent leur conducteur et sont à réattribuer."))) return;
    setBusy(d.id);
    await action.run(() => adminFetch(`/school/drivers/${d.id}/clearance`, { method: "POST", body: { cleared } }));
    setBusy(null);
    reload();
    onChange();
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-stone-600">
        {t("Conducteurs Course Zed actifs. Les étudiants peuvent être confiés à tout conducteur Zed actif ; les écoliers seulement aux conducteurs vérifiés pour le transport d'enfants (casier judiciaire, entretien, références, casque enfant).")}
      </p>
      <ErrorNote message={action.error} />
      <DataTable
        rows={data}
        rowKey={(d) => d.id}
        empty="Aucun conducteur Course Zed actif."
        columns={[
          {
            header: "Conducteur",
            mobile: "title",
            cell: (d) => (
              <span>
                <span className="font-semibold">{d.name}</span>
                <span className="block text-xs text-stone-500">
                  {d.phone}
                  {d.plate ? ` · ${d.plate}` : ""}
                </span>
              </span>
            ),
          },
          {
            header: "Enfants",
            mobile: "badge",
            cell: (d) =>
              d.schoolCleared ? (
                <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-800" title={d.schoolClearedBy ?? undefined}>
                  {t("Vérifié")}
                </span>
              ) : (
                <span className="rounded-full bg-stone-200 px-2 py-1 text-xs font-semibold text-stone-700">{t("Non vérifié")}</span>
              ),
          },
          { header: "Abonnés", cell: (d) => d.passes },
          {
            header: "",
            cell: (d) =>
              manages ? (
                <button disabled={busy === d.id} onClick={() => clear(d, !d.schoolCleared)} className={d.schoolCleared ? buttonGhost : button}>
                  {d.schoolCleared ? t("Retirer la vérification") : t("Vérifié pour les enfants")}
                </button>
              ) : null,
          },
        ]}
      />
    </div>
  );
}

function Holidays() {
  const { t, locale } = useI18n();
  const { data, error, reload } = useAdmin<Holiday[]>("/school/holidays");
  const action = useAction();
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-4">
      <p className="text-sm text-stone-600">{t("Pas de trajet ces jours-là (les trajets déjà prévus sont annulés). Ajoutez un jour, ou une période de vacances avec une date de fin.")}</p>
      <ErrorNote message={action.error} />
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const f = new FormData(form);
          setBusy(true);
          const ok = await action.run(() =>
            adminFetch("/school/holidays", {
              method: "POST",
              body: { date: f.get("date"), until: f.get("until") || undefined, label: f.get("label"), kind: f.get("kind") },
            }),
          );
          setBusy(false);
          if (ok) {
            form.reset();
            reload();
          }
        }}
      >
        <label className="text-sm">
          {t("Du")}
          <input type="date" name="date" required className={input} />
        </label>
        <label className="text-sm">
          {t("Au (facultatif)")}
          <input type="date" name="until" className={input} />
        </label>
        <label className="min-w-48 flex-1 text-sm">
          {t("Nom")}
          <input name="label" required minLength={2} maxLength={80} placeholder={t("Fête de l'indépendance")} className={input} />
        </label>
        <label className="text-sm">
          {t("Pour")}
          <select name="kind" className={input} defaultValue="ALL">
            <option value="ALL">{t("Tous")}</option>
            <option value="SCHOOL">{t("Écoliers")}</option>
            <option value="STUDENT">{t("Étudiants")}</option>
          </select>
        </label>
        <button disabled={busy} className={button}>
          {t("Ajouter")}
        </button>
      </form>
      {!data ? (
        error ? (
          <ErrorNote message={error} />
        ) : (
          <Loading />
        )
      ) : (
        <DataTable
          rows={data}
          rowKey={(h) => h.id}
          empty="Aucun jour férié enregistré."
          columns={[
            { header: "Jour", mobile: "title", cell: (h) => <span className="capitalize">{dayLabel(h.date, locale)}</span> },
            { header: "Nom", cell: (h) => h.label },
            { header: "Pour", mobile: "badge", cell: (h) => t(h.kind === "ALL" ? "Tous" : h.kind === "SCHOOL" ? "Écoliers" : "Étudiants") },
            {
              header: "",
              cell: (h) => (
                <button
                  onClick={async () => {
                    if (await action.run(() => adminFetch(`/school/holidays/${h.id}`, { method: "DELETE" }))) reload();
                  }}
                  className={buttonGhost}
                >
                  {t("Retirer")}
                </button>
              ),
            },
          ]}
        />
      )}
    </div>
  );
}
