"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import DataTable from "@/components/panel/DataTable";
import { fcfa } from "@/lib/api";
import { adminDownload, adminFetch, editsHr, roleOf, useStaff } from "@/lib/admin";
import { useI18n } from "@/lib/i18n/client";
import { button, buttonGhost, Card, Empty, ErrorNote, input, Loading, PageHeader, StatTile, Tabs } from "../ui";
import { useAction, useAdmin } from "../useAdmin";
import EmployeeForm from "./EmployeeForm";
import {
  CONTRACT_LABEL,
  currentMonth,
  LEAVE_LABEL,
  LEAVE_STATUS_LABEL,
  monthName,
  PAYSLIP_LABEL,
  Pill,
  shiftMonth,
  shortDate,
  STATUS_LABEL,
  type EmployeeRow,
  type EmployeeStatus,
  type Leave,
  type LeaveStatus,
  type Payslip,
} from "./shared";

type Summary = {
  active: number;
  suspended: number;
  monthlyPayroll: number;
  onLeaveToday: { id: string; kind: Leave["kind"]; endDate: string; employee: { id: string; name: string; position: string } }[];
  pendingLeaves: number;
  deadlines: { employeeId: string; name: string; kind: "CONTRACT_END" | "TRIAL_END"; date: string }[];
  departments: { name: string; count: number }[];
  payroll: { month: string; DRAFT: number; VALIDATED: number; PAID: number; total: number };
};
type Payroll = {
  month: string;
  payslips: Payslip[];
  totals: { count: number; base: number; absences: number; bonus: number; deductions: number; net: number };
  byStatus: Record<Payslip["status"], number>;
};
type StaffDriver = { id: string; name: string; phone: string; employeeId: string | null; monthlySalary: number | null };

type Tab = "employes" | "conges" | "paie" | "nouveau";

export default function HrPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Hr />
    </Suspense>
  );
}

// Ressources humaines de Zedeka : employés (fiches, contrats, salaires), congés et absences, paie du mois.
function Hr() {
  const params = useSearchParams();
  const [tab, setTab] = useState<Tab>((params.get("onglet") as Tab | null) ?? "employes");
  const { data: s, reload } = useAdmin<Summary>("/hr/summary");
  const edits = editsHr(roleOf(useStaff()));
  const { t, locale } = useI18n();

  return (
    <div>
      <PageHeader
        icon="team"
        title="Ressources humaines"
        description="Les employés de Zedeka : fiches, contrats, postes et salaires, congés et absences, documents, et la paie du mois. Les RH préparent et valident la paie ; le comptable la paie."
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Employés en poste" value={s?.active ?? "–"} hint={s?.suspended ? t("{n} suspendu(s)", { n: s.suspended }) : undefined} icon="team" />
        <StatTile label="Masse salariale par mois" value={s ? fcfa(s.monthlyPayroll) : "–"} icon="wallet" />
        <StatTile label="En congé aujourd'hui" value={s?.onLeaveToday.length ?? "–"} hint={s?.pendingLeaves ? t("{n} demande(s) à décider", { n: s.pendingLeaves }) : undefined} icon="clock" />
        <StatTile
          label="Paie du mois"
          value={s ? fcfa(s.payroll.total) : "–"}
          hint={s ? t("{draft} brouillon(s) · {validated} à payer · {paid} payé(s)", { draft: s.payroll.DRAFT, validated: s.payroll.VALIDATED, paid: s.payroll.PAID }) : undefined}
          icon="receipt"
        />
      </div>

      {s && (s.deadlines.length > 0 || s.onLeaveToday.length > 0) && (
        <div className="mb-4 grid gap-3 lg:grid-cols-2">
          {s.deadlines.length > 0 && (
            <Card title="À prévoir dans les 30 jours" icon="bell">
              <ul className="space-y-1 text-sm">
                {s.deadlines.map((d) => (
                  <li key={`${d.employeeId}-${d.kind}`}>
                    <Link href={`/admin/rh/${d.employeeId}`} className="font-medium underline">
                      {d.name}
                    </Link>{" "}
                    · {t(d.kind === "CONTRACT_END" ? "fin du contrat le {date}" : "fin de la période d'essai le {date}", { date: shortDate(d.date, locale) })}
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {s.onLeaveToday.length > 0 && (
            <Card title="Absents aujourd'hui" icon="clock">
              <ul className="space-y-1 text-sm">
                {s.onLeaveToday.map((l) => (
                  <li key={l.id}>
                    <Link href={`/admin/rh/${l.employee.id}`} className="font-medium underline">
                      {l.employee.name}
                    </Link>{" "}
                    · {t(LEAVE_LABEL[l.kind])} · {t("jusqu'au {date}", { date: shortDate(l.endDate, locale) })}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      )}

      <Card>
        <Tabs
          tabs={[
            { value: "employes" as const, label: "Employés", count: s?.active },
            { value: "conges" as const, label: "Congés et absences", count: s?.pendingLeaves || undefined },
            { value: "paie" as const, label: "Paie" },
            ...(edits ? [{ value: "nouveau" as const, label: "Nouvel employé" }] : []),
          ]}
          value={tab}
          onChange={setTab}
        />
        {tab === "employes" && <Employees edits={edits} onChange={reload} />}
        {tab === "conges" && <Leaves edits={edits} onChange={reload} />}
        {tab === "paie" && <PayrollTab edits={edits} onChange={reload} />}
        {tab === "nouveau" && <NewEmployee />}
      </Card>
    </div>
  );
}

function Employees({ edits, onChange }: { edits: boolean; onChange: () => void }) {
  const { t, locale } = useI18n();
  const [status, setStatus] = useState<EmployeeStatus | "ALL">("ACTIVE");
  const [q, setQ] = useState("");
  const { data, error, reload } = useAdmin<EmployeeRow[]>(`/hr/employees?status=${status}&q=${encodeURIComponent(q)}`);
  const drivers = useAdmin<StaffDriver[]>("/hr/drivers");
  const action = useAction();
  const unlinked = drivers.data?.filter((d) => !d.employeeId).length ?? 0;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Nom, poste, service, téléphone")} aria-label={t("Rechercher un employé")} className={`${input} max-w-xs`} />
        <select value={status} onChange={(e) => setStatus(e.target.value as EmployeeStatus | "ALL")} aria-label={t("Statut")} className={`${input} w-auto`}>
          {(Object.keys(STATUS_LABEL) as EmployeeStatus[]).map((k) => (
            <option key={k} value={k}>
              {t(STATUS_LABEL[k])}
            </option>
          ))}
          <option value="ALL">{t("Tous")}</option>
        </select>
        {edits && unlinked > 0 && (
          <button
            className={buttonGhost}
            onClick={() =>
              action.run(async () => {
                await adminFetch("/hr/import-drivers", { method: "POST" });
                await Promise.all([reload(), drivers.reload()]);
                onChange();
              })
            }
          >
            {t("Créer les fiches des {n} livreur(s) salarié(s)", { n: unlinked })}
          </button>
        )}
      </div>
      <ErrorNote message={action.error ?? error} />
      {!data ? (
        <Loading />
      ) : (
        <DataTable
          rows={data}
          rowKey={(e) => e.id}
          rowHref={(e) => `/admin/rh/${e.id}`}
          empty="Aucun employé pour l'instant."
          columns={[
            {
              header: "Employé",
              mobile: "title",
              cell: (e) => (
                <span>
                  <span className="font-semibold">{e.name}</span>
                  <span className="block text-xs text-stone-500">{e.phone ?? e.email ?? ""}</span>
                </span>
              ),
            },
            { header: "Statut", mobile: "badge", cell: (e) => <Pill status={e.status} label={STATUS_LABEL[e.status]} /> },
            {
              header: "Poste",
              cell: (e) => (
                <span>
                  {e.position}
                  {e.department && <span className="block text-xs text-stone-500">{e.department}</span>}
                </span>
              ),
            },
            { header: "Contrat", cell: (e) => `${t(CONTRACT_LABEL[e.contractType])}${e.endDate ? ` · ${t("jusqu'au {date}", { date: shortDate(e.endDate, locale) })}` : ""}` },
            { header: "Depuis le", cell: (e) => shortDate(e.startDate, locale) },
            { header: "Salaire", align: "right", cell: (e) => fcfa(e.monthlySalary) },
          ]}
        />
      )}
    </div>
  );
}

function NewEmployee() {
  const router = useRouter();
  const drivers = useAdmin<StaffDriver[]>("/hr/drivers");
  if (!drivers.data && !drivers.error) return <Loading />;
  return (
    <EmployeeForm
      drivers={drivers.data ?? []}
      submitLabel="Créer la fiche"
      onSubmit={async (body) => {
        const created = await adminFetch<{ id: string }>("/hr/employees", { method: "POST", body });
        router.push(`/admin/rh/${created.id}`);
        return true;
      }}
    />
  );
}

function Leaves({ edits, onChange }: { edits: boolean; onChange: () => void }) {
  const { t, locale } = useI18n();
  const [status, setStatus] = useState<LeaveStatus | "ALL">("REQUESTED");
  const { data, error, reload } = useAdmin<Leave[]>(`/hr/leaves?status=${status}`);
  const action = useAction();

  const decide = (l: Leave, decision: "APPROVE" | "REJECT") =>
    action.run(async () => {
      await adminFetch(`/hr/leaves/${l.id}/decide`, { method: "POST", body: { decision } });
      await reload();
      onChange();
    });

  return (
    <div className="space-y-3">
      <p className="text-sm text-stone-600">{t("Pour ajouter un congé ou une absence, ouvrez la fiche de l'employé. Les jours se comptent du lundi au samedi.")}</p>
      <select value={status} onChange={(e) => setStatus(e.target.value as LeaveStatus | "ALL")} aria-label={t("Statut")} className={`${input} w-auto`}>
        {(Object.keys(LEAVE_STATUS_LABEL) as LeaveStatus[]).map((k) => (
          <option key={k} value={k}>
            {t(LEAVE_STATUS_LABEL[k])}
          </option>
        ))}
        <option value="ALL">{t("Tous")}</option>
      </select>
      <ErrorNote message={action.error ?? error} />
      {!data ? (
        <Loading />
      ) : (
        <DataTable
          rows={data}
          rowKey={(l) => l.id}
          empty={status === "REQUESTED" ? "Aucune demande de congé à décider." : "Aucun congé ni absence."}
          columns={[
            {
              header: "Employé",
              mobile: "title",
              cell: (l) => (
                <Link href={`/admin/rh/${l.employeeId}`} className="font-semibold underline">
                  {l.employee?.name}
                </Link>
              ),
            },
            { header: "État", mobile: "badge", cell: (l) => <Pill status={l.status} label={LEAVE_STATUS_LABEL[l.status]} /> },
            { header: "Type", cell: (l) => t(LEAVE_LABEL[l.kind]) },
            { header: "Période", cell: (l) => `${shortDate(l.startDate, locale)} → ${shortDate(l.endDate, locale)}` },
            { header: "Jours", cell: (l) => l.days },
            { header: "Motif", cell: (l) => l.reason ?? "–" },
            {
              header: "",
              cell: (l) =>
                edits && l.status === "REQUESTED" ? (
                  <span className="flex gap-1">
                    <button className={button} onClick={() => decide(l, "APPROVE")}>
                      {t("Accepter")}
                    </button>
                    <button className={buttonGhost} onClick={() => decide(l, "REJECT")}>
                      {t("Refuser")}
                    </button>
                  </span>
                ) : (
                  l.decidedBy && <span className="text-xs text-stone-500">{t("par {name}", { name: l.decidedBy })}</span>
                ),
            },
          ]}
        />
      )}
    </div>
  );
}

function PayrollTab({ edits, onChange }: { edits: boolean; onChange: () => void }) {
  const { t, locale } = useI18n();
  const [month, setMonth] = useState(currentMonth());
  const { data, error, reload } = useAdmin<Payroll>(`/hr/payroll?month=${month}`);
  const action = useAction();
  const [editing, setEditing] = useState<string | null>(null);

  const after = async () => {
    await reload();
    onChange();
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button className={buttonGhost} onClick={() => setMonth(shiftMonth(month, -1))} aria-label={t("Mois précédent")}>
          ←
        </button>
        <span className="min-w-36 text-center font-semibold capitalize">{monthName(month, locale)}</span>
        <button className={buttonGhost} onClick={() => setMonth(shiftMonth(month, 1))} aria-label={t("Mois suivant")}>
          →
        </button>
        <span className="flex-1" />
        {edits && (
          <button
            className={buttonGhost}
            onClick={() =>
              action.run(async () => {
                await adminFetch("/hr/payroll/prepare", { method: "POST", body: { month } });
                await after();
              })
            }
          >
            {t("Préparer ou recalculer la paie")}
          </button>
        )}
        {edits && !!data?.byStatus.DRAFT && (
          <button
            className={button}
            onClick={() => {
              if (!window.confirm(t("Valider les {n} bulletin(s) en brouillon ? Le comptable pourra alors les payer.", { n: data.byStatus.DRAFT }))) return;
              action.run(async () => {
                await adminFetch("/hr/payroll/validate", { method: "POST", body: { month } });
                await after();
              });
            }}
          >
            {t("Valider la paie du mois")}
          </button>
        )}
        <button className={buttonGhost} onClick={() => action.run(() => adminDownload(`/hr/payroll/export?month=${month}`, `paie-${month}.csv`))}>
          {t("Exporter (CSV)")}
        </button>
      </div>
      <p className="text-sm text-stone-600">
        {t(
          "La paie reprend le salaire de chaque fiche et retire les jours de congé sans solde et d'absence non justifiée acceptés (salaire ÷ 26 par jour). Ajoutez primes et retenues, puis validez : le comptable paie les bulletins validés.",
        )}
      </p>
      <ErrorNote message={action.error ?? error} />
      {!data ? (
        <Loading />
      ) : data.payslips.length === 0 ? (
        <Empty>{edits ? "Aucun bulletin pour ce mois : cliquez sur « Préparer ou recalculer la paie »." : "Aucun bulletin pour ce mois."}</Empty>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-stone-500">
                <tr>
                  <th className="py-2 pr-3">{t("Employé")}</th>
                  <th className="py-2 pr-3 text-right">{t("Salaire de base")}</th>
                  <th className="py-2 pr-3 text-right">{t("Absences")}</th>
                  <th className="py-2 pr-3 text-right">{t("Prime")}</th>
                  <th className="py-2 pr-3 text-right">{t("Retenues")}</th>
                  <th className="py-2 pr-3 text-right">{t("Net à payer")}</th>
                  <th className="py-2 pr-3">{t("État")}</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {data.payslips.map((p) =>
                  editing === p.id ? (
                    <PayslipEditor key={p.id} slip={p} onDone={async () => (setEditing(null), await after())} onCancel={() => setEditing(null)} />
                  ) : (
                    <tr key={p.id}>
                      <td className="py-2 pr-3">
                        <Link href={`/admin/rh/${p.employeeId}`} className="font-medium underline">
                          {p.employee?.name}
                        </Link>
                        <span className="block text-xs text-stone-500">
                          {p.employee?.position}
                          {p.note ? ` · ${p.note}` : ""}
                        </span>
                      </td>
                      <td className="py-2 pr-3 text-right">{fcfa(p.baseSalary)}</td>
                      <td className="py-2 pr-3 text-right">{p.absenceDeduction ? `− ${fcfa(p.absenceDeduction)} (${t("{n} j", { n: p.unpaidDays })})` : "–"}</td>
                      <td className="py-2 pr-3 text-right">{p.bonus ? `+ ${fcfa(p.bonus)}` : "–"}</td>
                      <td className="py-2 pr-3 text-right">{p.deductions ? `− ${fcfa(p.deductions)}` : "–"}</td>
                      <td className="py-2 pr-3 text-right font-semibold">{fcfa(p.net)}</td>
                      <td className="py-2 pr-3">
                        <Pill status={p.status} label={PAYSLIP_LABEL[p.status]} />
                        {p.status === "PAID" && p.paidAt && <span className="block text-xs text-stone-500">{shortDate(p.paidAt, locale)}</span>}
                      </td>
                      <td className="py-2 text-right whitespace-nowrap">
                        {edits && p.status === "DRAFT" && (
                          <>
                            <button className={buttonGhost} onClick={() => setEditing(p.id)}>
                              {t("Modifier")}
                            </button>{" "}
                            <button className={buttonGhost} onClick={() => action.run(async () => (await adminFetch(`/hr/payslips/${p.id}/validate`, { method: "POST" }), await after()))}>
                              {t("Valider")}
                            </button>
                          </>
                        )}
                        {edits && p.status === "VALIDATED" && (
                          <button className={buttonGhost} onClick={() => action.run(async () => (await adminFetch(`/hr/payslips/${p.id}/reopen`, { method: "POST" }), await after()))}>
                            {t("Rouvrir")}
                          </button>
                        )}
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
              <tfoot className="border-t-2 border-stone-200 font-semibold">
                <tr>
                  <td className="py-2 pr-3">{t("{n} bulletin(s)", { n: data.totals.count })}</td>
                  <td className="py-2 pr-3 text-right">{fcfa(data.totals.base)}</td>
                  <td className="py-2 pr-3 text-right">{data.totals.absences ? `− ${fcfa(data.totals.absences)}` : "–"}</td>
                  <td className="py-2 pr-3 text-right">{data.totals.bonus ? `+ ${fcfa(data.totals.bonus)}` : "–"}</td>
                  <td className="py-2 pr-3 text-right">{data.totals.deductions ? `− ${fcfa(data.totals.deductions)}` : "–"}</td>
                  <td className="py-2 pr-3 text-right">{fcfa(data.totals.net)}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function PayslipEditor({ slip, onDone, onCancel }: { slip: Payslip; onDone: () => Promise<void>; onCancel: () => void }) {
  const t = useI18n().t;
  const action = useAction();
  return (
    <tr className="bg-stone-50">
      <td colSpan={8} className="p-3">
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const n = (k: string) => Number(f.get(k) || 0);
            action.run(async () => {
              await adminFetch(`/hr/payslips/${slip.id}`, {
                method: "PATCH",
                body: { baseSalary: n("baseSalary"), bonus: n("bonus"), deductions: n("deductions"), note: String(f.get("note") ?? "").trim() || null },
              });
              await onDone();
            });
          }}
        >
          <strong className="w-full">{slip.employee?.name}</strong>
          <label className="block">
            <span className="mb-1 block text-xs font-medium">{t("Salaire de base")}</span>
            <input name="baseSalary" type="number" min={0} step={1} defaultValue={slip.baseSalary} className={`${input} w-32!`} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium">{t("Prime")}</span>
            <input name="bonus" type="number" min={0} step={1} defaultValue={slip.bonus} className={`${input} w-28!`} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium">{t("Retenues (avance, prêt…)")}</span>
            <input name="deductions" type="number" min={0} step={1} defaultValue={slip.deductions} className={`${input} w-28!`} />
          </label>
          <label className="block flex-1">
            <span className="mb-1 block text-xs font-medium">{t("Remarque")}</span>
            <input name="note" maxLength={300} defaultValue={slip.note ?? ""} className={input} />
          </label>
          <button className={button}>{t("Enregistrer")}</button>
          <button type="button" onClick={onCancel} className={buttonGhost}>
            {t("Annuler")}
          </button>
          <div className="w-full">
            <ErrorNote message={action.error} />
          </div>
        </form>
      </td>
    </tr>
  );
}
