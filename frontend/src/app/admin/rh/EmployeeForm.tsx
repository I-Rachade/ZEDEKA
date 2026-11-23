"use client";

import { useState } from "react";
import { useT } from "@/lib/i18n/client";
import { button, buttonGhost, ErrorNote, input } from "../ui";
import { CONTRACT_LABEL, dayValue, PAYMENT_LABEL, STATUS_LABEL, type ContractType, type Employee, type EmployeeStatus, type PaymentMethod } from "./shared";

// Formulaire d'une fiche employé : création (page RH) et modification (fiche). Envoie les champs à l'API telle quelle.

export type EmployeeBody = Record<string, string | number | null>;

function Field({ label, children, wide = false }: { label: string; children: React.ReactNode; wide?: boolean }) {
  const t = useT();
  return (
    <label className={`block ${wide ? "sm:col-span-2" : ""}`}>
      <span className="mb-1 block text-sm font-medium">{t(label)}</span>
      {children}
    </label>
  );
}

export default function EmployeeForm({
  employee,
  drivers,
  onSubmit,
  onCancel,
  submitLabel,
}: {
  employee?: Partial<Employee>;
  drivers?: { id: string; name: string; phone: string; employeeId: string | null }[];
  onSubmit: (body: EmployeeBody) => Promise<boolean>;
  onCancel?: () => void;
  submitLabel: string;
}) {
  const t = useT();
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<EmployeeStatus>(employee?.status ?? "ACTIVE");
  const [busy, setBusy] = useState(false);
  const e = employee ?? {};

  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={async (ev) => {
        ev.preventDefault();
        const f = new FormData(ev.currentTarget);
        const str = (k: string) => String(f.get(k) ?? "").trim();
        const body: EmployeeBody = {
          name: str("name"),
          phone: str("phone") || null,
          email: str("email") || null,
          position: str("position"),
          department: str("department") || null,
          contractType: str("contractType"),
          startDate: str("startDate"),
          endDate: str("endDate") || null,
          trialEndDate: str("trialEndDate") || null,
          monthlySalary: Number(str("monthlySalary") || 0),
          paymentMethod: str("paymentMethod"),
          paymentAccount: str("paymentAccount") || null,
          birthDate: str("birthDate") || null,
          address: str("address") || null,
          idNumber: str("idNumber") || null,
          cnssNumber: str("cnssNumber") || null,
          emergencyContact: str("emergencyContact") || null,
          leaveDaysPerYear: Number(str("leaveDaysPerYear") || 30),
          status,
          leftAt: status === "LEFT" ? str("leftAt") || null : null,
          leftReason: status === "LEFT" ? str("leftReason") || null : null,
          notes: str("notes") || null,
          ...(drivers ? { driverId: str("driverId") || null } : {}),
        };
        setBusy(true);
        setError(null);
        try {
          await onSubmit(body);
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <h3 className="text-sm font-semibold text-stone-500 sm:col-span-2">{t("Identité et contact")}</h3>
      <Field label="Nom complet">
        <input name="name" required minLength={2} maxLength={80} defaultValue={e.name ?? ""} className={input} />
      </Field>
      <Field label="Téléphone">
        <input name="phone" type="tel" maxLength={30} defaultValue={e.phone ?? ""} className={input} />
      </Field>
      <Field label="Adresse e-mail">
        <input name="email" type="email" maxLength={120} defaultValue={e.email ?? ""} className={input} />
      </Field>
      <Field label="Date de naissance">
        <input name="birthDate" type="date" defaultValue={dayValue(e.birthDate)} className={input} />
      </Field>
      <Field label="Adresse">
        <input name="address" maxLength={200} defaultValue={e.address ?? ""} className={input} />
      </Field>
      <Field label="Personne à prévenir (nom, téléphone)">
        <input name="emergencyContact" maxLength={160} defaultValue={e.emergencyContact ?? ""} className={input} />
      </Field>
      <Field label="Numéro de pièce d'identité">
        <input name="idNumber" maxLength={60} defaultValue={e.idNumber ?? ""} className={input} />
      </Field>
      <Field label="Numéro CNSS">
        <input name="cnssNumber" maxLength={60} defaultValue={e.cnssNumber ?? ""} className={input} />
      </Field>

      <h3 className="mt-2 text-sm font-semibold text-stone-500 sm:col-span-2">{t("Poste et contrat")}</h3>
      <Field label="Poste">
        <input name="position" required minLength={2} maxLength={80} defaultValue={e.position ?? ""} placeholder={t("ex. Livreur salarié, Dispatcheur, Comptable")} className={input} />
      </Field>
      <Field label="Service">
        <input name="department" maxLength={80} defaultValue={e.department ?? ""} placeholder={t("ex. Livraison, Bureau, Direction")} className={input} />
      </Field>
      <Field label="Type de contrat">
        <select name="contractType" defaultValue={e.contractType ?? "CDI"} className={input}>
          {(Object.keys(CONTRACT_LABEL) as ContractType[]).map((k) => (
            <option key={k} value={k}>
              {t(CONTRACT_LABEL[k])}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Date d'embauche">
        <input name="startDate" type="date" required defaultValue={dayValue(e.startDate) || new Date().toISOString().slice(0, 10)} className={input} />
      </Field>
      <Field label="Fin de la période d'essai">
        <input name="trialEndDate" type="date" defaultValue={dayValue(e.trialEndDate)} className={input} />
      </Field>
      <Field label="Fin du contrat (CDD, stage)">
        <input name="endDate" type="date" defaultValue={dayValue(e.endDate)} className={input} />
      </Field>
      {drivers && (
        <Field label="Livreur salarié lié (facultatif)" wide>
          <select name="driverId" defaultValue={e.driverId ?? ""} className={input}>
            <option value="">{t("Aucun")}</option>
            {drivers
              .filter((d) => !d.employeeId || d.id === e.driverId)
              .map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} · {d.phone}
                </option>
              ))}
          </select>
        </Field>
      )}

      <h3 className="mt-2 text-sm font-semibold text-stone-500 sm:col-span-2">{t("Salaire et congés")}</h3>
      <Field label="Salaire mensuel (FCFA)">
        <input name="monthlySalary" type="number" min={0} step={1} required defaultValue={e.monthlySalary ?? 0} className={input} />
      </Field>
      <Field label="Jours de congés payés par an">
        <input name="leaveDaysPerYear" type="number" min={0} max={60} step={1} defaultValue={e.leaveDaysPerYear ?? 30} className={input} />
      </Field>
      <Field label="Paiement du salaire">
        <select name="paymentMethod" defaultValue={e.paymentMethod ?? "MOBILE_MONEY"} className={input}>
          {(Object.keys(PAYMENT_LABEL) as PaymentMethod[]).map((k) => (
            <option key={k} value={k}>
              {t(PAYMENT_LABEL[k])}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Numéro mobile money ou compte bancaire">
        <input name="paymentAccount" maxLength={80} defaultValue={e.paymentAccount ?? ""} className={input} />
      </Field>

      <h3 className="mt-2 text-sm font-semibold text-stone-500 sm:col-span-2">{t("Situation")}</h3>
      <Field label="Statut">
        <select value={status} onChange={(ev) => setStatus(ev.target.value as EmployeeStatus)} className={input}>
          {(Object.keys(STATUS_LABEL) as EmployeeStatus[]).map((k) => (
            <option key={k} value={k}>
              {t(STATUS_LABEL[k])}
            </option>
          ))}
        </select>
      </Field>
      {status === "LEFT" ? (
        <>
          <Field label="Date de départ">
            <input name="leftAt" type="date" defaultValue={dayValue(e.leftAt)} className={input} />
          </Field>
          <Field label="Motif du départ" wide>
            <input name="leftReason" maxLength={300} defaultValue={e.leftReason ?? ""} className={input} />
          </Field>
        </>
      ) : (
        <span />
      )}
      <Field label="Notes (visibles des RH et de la direction)" wide>
        <textarea name="notes" rows={3} maxLength={2000} defaultValue={e.notes ?? ""} className={input} />
      </Field>

      <div className="sm:col-span-2">
        <ErrorNote message={error} />
      </div>
      <div className="flex gap-2 sm:col-span-2">
        <button className={button} disabled={busy}>
          {t(submitLabel)}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className={buttonGhost}>
            {t("Annuler")}
          </button>
        )}
      </div>
    </form>
  );
}
