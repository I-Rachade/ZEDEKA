"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { fcfa } from "@/lib/api";
import { adminDownload, adminFetch, editsHr, roleOf, telLink, useStaff } from "@/lib/admin";
import { useI18n } from "@/lib/i18n/client";
import { button, buttonDanger, buttonGhost, Card, Empty, ErrorNote, input, Loading, PageHeader, StatTile } from "../../ui";
import { useAction, useAdmin } from "../../useAdmin";
import EmployeeForm from "../EmployeeForm";
import {
  CONTRACT_LABEL,
  DOCUMENT_LABEL,
  LEAVE_LABEL,
  LEAVE_STATUS_LABEL,
  monthName,
  PAYMENT_LABEL,
  PAYSLIP_LABEL,
  Pill,
  readAsDataUrl,
  shortDate,
  STATUS_LABEL,
  type DocumentKind,
  type Employee,
  type LeaveKind,
} from "../shared";

type StaffDriver = { id: string; name: string; phone: string; employeeId: string | null; monthlySalary: number | null };

// Fiche d'un employé : identité, contrat et salaire, congés (solde de l'année), documents et bulletins de paie.
export default function EmployeePage() {
  const id = String(useParams<{ id: string }>().id);
  const router = useRouter();
  const { t, locale } = useI18n();
  const { data: e, error, reload } = useAdmin<Employee>(`/hr/employees/${id}`);
  const drivers = useAdmin<StaffDriver[]>("/hr/drivers");
  const edits = editsHr(roleOf(useStaff()));
  const [editing, setEditing] = useState(false);
  const action = useAction();

  if (!e) return error ? <ErrorNote message={error} /> : <Loading />;

  const Row = ({ label, value }: { label: string; value: React.ReactNode }) => (
    <div className="flex justify-between gap-3 border-b border-stone-100 py-1.5 text-sm last:border-0">
      <span className="text-stone-500">{t(label)}</span>
      <span className="text-right font-medium">{value || "–"}</span>
    </div>
  );

  return (
    <div className="space-y-4">
      <PageHeader
        icon="user"
        title={e.name}
        description={`${e.position}${e.department ? ` · ${e.department}` : ""}`}
        actions={
          <>
            <Link href="/admin/rh" className={buttonGhost}>
              {t("Toutes les fiches")}
            </Link>
            {edits && !editing && (
              <button className={button} onClick={() => setEditing(true)}>
                {t("Modifier la fiche")}
              </button>
            )}
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Statut" value={t(STATUS_LABEL[e.status])} hint={e.status === "LEFT" && e.leftAt ? t("parti le {date}", { date: shortDate(e.leftAt, locale) }) : undefined} icon="user" />
        <StatTile label="Salaire mensuel" value={fcfa(e.monthlySalary)} hint={t(PAYMENT_LABEL[e.paymentMethod])} icon="wallet" />
        <StatTile
          label="Congés payés restants"
          value={e.balance.remaining}
          hint={t("{taken} pris sur {entitled} en {year}", { taken: e.balance.taken, entitled: e.balance.entitled, year: e.balance.year })}
          icon="clock"
        />
        <StatTile label="Contrat" value={t(CONTRACT_LABEL[e.contractType])} hint={t("depuis le {date}", { date: shortDate(e.startDate, locale) })} icon="doc" />
      </div>

      {editing ? (
        <Card title="Modifier la fiche">
          <EmployeeForm
            employee={e}
            drivers={drivers.data ?? undefined}
            submitLabel="Enregistrer"
            onCancel={() => setEditing(false)}
            onSubmit={async (body) => {
              await adminFetch(`/hr/employees/${id}`, { method: "PATCH", body });
              await reload();
              setEditing(false);
              return true;
            }}
          />
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Identité et contact" icon="user">
            <Row label="Téléphone" value={e.phone ? <a href={telLink(e.phone)} className="underline">{e.phone}</a> : null} />
            <Row label="Adresse e-mail" value={e.email} />
            <Row label="Date de naissance" value={e.birthDate ? shortDate(e.birthDate, locale) : null} />
            <Row label="Adresse" value={e.address} />
            <Row label="Personne à prévenir" value={e.emergencyContact} />
            <Row label="Numéro de pièce d'identité" value={e.idNumber} />
            <Row label="Numéro CNSS" value={e.cnssNumber} />
          </Card>
          <Card title="Poste et contrat" icon="doc">
            <Row label="Poste" value={e.position} />
            <Row label="Service" value={e.department} />
            <Row label="Type de contrat" value={t(CONTRACT_LABEL[e.contractType])} />
            <Row label="Date d'embauche" value={shortDate(e.startDate, locale)} />
            <Row label="Fin de la période d'essai" value={e.trialEndDate ? shortDate(e.trialEndDate, locale) : null} />
            <Row label="Fin du contrat" value={e.endDate ? shortDate(e.endDate, locale) : null} />
            <Row label="Paiement du salaire" value={`${t(PAYMENT_LABEL[e.paymentMethod])}${e.paymentAccount ? ` · ${e.paymentAccount}` : ""}`} />
            <Row label="Livreur salarié lié" value={e.driver ? `${e.driver.name} · ${e.driver.phone}` : null} />
            {e.status === "LEFT" && <Row label="Motif du départ" value={e.leftReason} />}
            {e.notes && <p className="mt-2 whitespace-pre-line rounded-lg bg-stone-50 p-2 text-sm">{e.notes}</p>}
          </Card>
        </div>
      )}

      <LeavesCard employee={e} edits={edits} onChange={reload} />
      <DocumentsCard employee={e} edits={edits} onChange={reload} />

      <Card title="Bulletins de paie" icon="receipt">
        {e.payslips.length === 0 ? (
          <Empty>{"Aucun bulletin pour l'instant (onglet Paie des ressources humaines)."}</Empty>
        ) : (
          <ul className="divide-y divide-stone-100 text-sm">
            {e.payslips.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="capitalize">{monthName(p.month, locale)}</span>
                <span className="flex items-center gap-2">
                  <strong>{fcfa(p.net)}</strong>
                  <Pill status={p.status} label={PAYSLIP_LABEL[p.status]} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {edits && (
        <Card title="Supprimer la fiche">
          <p className="mb-2 text-sm text-stone-600">{t("Seulement pour une fiche créée par erreur. Pour un employé qui quitte Zedeka, indiquez plutôt son départ (statut « Parti ») : la fiche reste pour la paie et la comptabilité.")}</p>
          <ErrorNote message={action.error} />
          <button
            className={buttonDanger}
            onClick={() => {
              if (!window.confirm(t("Supprimer la fiche de {name}, ses congés et ses documents ?", { name: e.name }))) return;
              action.run(async () => {
                await adminFetch(`/hr/employees/${id}`, { method: "DELETE" });
                router.replace("/admin/rh");
              });
            }}
          >
            {t("Supprimer la fiche")}
          </button>
        </Card>
      )}
    </div>
  );
}

function LeavesCard({ employee, edits, onChange }: { employee: Employee; edits: boolean; onChange: () => Promise<void> }) {
  const { t, locale } = useI18n();
  const action = useAction();
  const [adding, setAdding] = useState(false);
  return (
    <Card
      title="Congés et absences"
      icon="clock"
      action={
        edits && !adding ? (
          <button className={buttonGhost} onClick={() => setAdding(true)}>
            {t("Ajouter")}
          </button>
        ) : undefined
      }
    >
      {adding && (
        <form
          className="mb-3 grid gap-2 rounded-lg bg-stone-50 p-3 sm:grid-cols-2"
          onSubmit={(ev) => {
            ev.preventDefault();
            const f = new FormData(ev.currentTarget);
            action.run(async () => {
              await adminFetch(`/hr/employees/${employee.id}/leaves`, {
                method: "POST",
                body: { kind: f.get("kind"), startDate: f.get("startDate"), endDate: f.get("endDate"), reason: String(f.get("reason") ?? "").trim() || null, status: f.get("status") },
              });
              setAdding(false);
              await onChange();
            });
          }}
        >
          <label className="block">
            <span className="mb-1 block text-sm font-medium">{t("Type")}</span>
            <select name="kind" className={input} defaultValue="PAID">
              {(Object.keys(LEAVE_LABEL) as LeaveKind[]).map((k) => (
                <option key={k} value={k}>
                  {t(LEAVE_LABEL[k])}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium">{t("Décision")}</span>
            <select name="status" className={input} defaultValue="APPROVED">
              <option value="APPROVED">{t("Accepté")}</option>
              <option value="REQUESTED">{t("Demande à décider")}</option>
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium">{t("Du")}</span>
            <input name="startDate" type="date" required className={input} />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium">{t("Au (inclus)")}</span>
            <input name="endDate" type="date" required className={input} />
          </label>
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-sm font-medium">{t("Motif (facultatif)")}</span>
            <input name="reason" maxLength={300} className={input} />
          </label>
          <div className="flex gap-2 sm:col-span-2">
            <button className={button}>{t("Enregistrer")}</button>
            <button type="button" className={buttonGhost} onClick={() => setAdding(false)}>
              {t("Annuler")}
            </button>
          </div>
        </form>
      )}
      <ErrorNote message={action.error} />
      {employee.leaves.length === 0 ? (
        <Empty>Aucun congé ni absence.</Empty>
      ) : (
        <ul className="divide-y divide-stone-100 text-sm">
          {employee.leaves.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>
                <strong>{t(LEAVE_LABEL[l.kind])}</strong> · {shortDate(l.startDate, locale)} → {shortDate(l.endDate, locale)} · {t("{n} j", { n: l.days })}
                {l.reason && <span className="block text-xs text-stone-500">{l.reason}</span>}
              </span>
              <span className="flex items-center gap-2">
                <Pill status={l.status} label={LEAVE_STATUS_LABEL[l.status]} />
                {edits && l.status === "REQUESTED" && (
                  <>
                    <button className={buttonGhost} onClick={() => action.run(async () => (await adminFetch(`/hr/leaves/${l.id}/decide`, { method: "POST", body: { decision: "APPROVE" } }), await onChange()))}>
                      {t("Accepter")}
                    </button>
                    <button className={buttonGhost} onClick={() => action.run(async () => (await adminFetch(`/hr/leaves/${l.id}/decide`, { method: "POST", body: { decision: "REJECT" } }), await onChange()))}>
                      {t("Refuser")}
                    </button>
                  </>
                )}
                {edits && (
                  <button
                    className="text-xs text-red-700 underline"
                    onClick={() => {
                      if (window.confirm(t("Effacer ce congé ?"))) action.run(async () => (await adminFetch(`/hr/leaves/${l.id}`, { method: "DELETE" }), await onChange()));
                    }}
                  >
                    {t("Effacer")}
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function DocumentsCard({ employee, edits, onChange }: { employee: Employee; edits: boolean; onChange: () => Promise<void> }) {
  const { t, locale } = useI18n();
  const action = useAction();
  const [busy, setBusy] = useState(false);
  return (
    <Card title="Documents" icon="doc">
      {edits && (
        <form
          className="mb-3 grid gap-2 rounded-lg bg-stone-50 p-3 sm:grid-cols-3"
          onSubmit={async (ev) => {
            ev.preventDefault();
            const form = ev.currentTarget;
            const f = new FormData(form);
            const file = f.get("file");
            if (!(file instanceof File) || file.size === 0) return;
            setBusy(true);
            const ok = await action.run(async () => {
              if (file.size > 3_000_000) throw new Error(t("Fichier trop lourd (3 Mo au plus)"));
              await adminFetch(`/hr/employees/${employee.id}/documents`, { method: "POST", body: { kind: f.get("kind"), title: String(f.get("title") ?? "").trim(), file: await readAsDataUrl(file) } });
              await onChange();
            });
            setBusy(false);
            if (ok) form.reset();
          }}
        >
          <label className="block">
            <span className="mb-1 block text-sm font-medium">{t("Type")}</span>
            <select name="kind" className={input} defaultValue="CONTRACT">
              {(Object.keys(DOCUMENT_LABEL) as DocumentKind[]).map((k) => (
                <option key={k} value={k}>
                  {t(DOCUMENT_LABEL[k])}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium">{t("Titre")}</span>
            <input name="title" required minLength={2} maxLength={120} placeholder={t("ex. Contrat CDI signé")} className={input} />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium">{t("Fichier (PDF ou photo, 3 Mo au plus)")}</span>
            <input name="file" type="file" required accept="application/pdf,image/jpeg,image/png,image/webp" className={input} />
          </label>
          <div className="sm:col-span-3">
            <button className={button} disabled={busy}>
              {busy ? t("Envoi…") : t("Ajouter le document")}
            </button>
          </div>
        </form>
      )}
      <ErrorNote message={action.error} />
      {employee.documents.length === 0 ? (
        <Empty>Aucun document.</Empty>
      ) : (
        <ul className="divide-y divide-stone-100 text-sm">
          {employee.documents.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>
                <strong>{d.title}</strong>
                <span className="block text-xs text-stone-500">
                  {t(DOCUMENT_LABEL[d.kind])} · {shortDate(d.createdAt, locale)}
                  {d.uploadedBy ? ` · ${d.uploadedBy}` : ""} · {Math.max(1, Math.round(d.size / 1024))} Ko
                </span>
              </span>
              <span className="flex gap-2">
                <button
                  className={buttonGhost}
                  onClick={() => action.run(() => adminDownload(`/hr/documents/${d.id}/file`, `${d.title}.${d.contentType === "application/pdf" ? "pdf" : d.contentType.split("/")[1]}`))}
                >
                  {t("Télécharger")}
                </button>
                {edits && (
                  <button
                    className="text-xs text-red-700 underline"
                    onClick={() => {
                      if (window.confirm(t("Supprimer ce document ?"))) action.run(async () => (await adminFetch(`/hr/documents/${d.id}`, { method: "DELETE" }), await onChange()));
                    }}
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
  );
}
