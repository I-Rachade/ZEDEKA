// Ressources humaines : employés de Zedeka, congés et absences, documents, paie du mois.
// Les écrans sont dans src/routes/adminHr.ts ; le rôle « HR » n'ouvre que ces routes (voir team.ts).
// Le comptable paie les bulletins validés (src/routes/adminAccounting.ts) : les RH préparent, le comptable paie.

import { z } from "zod";

export const CONTRACT_TYPES = ["CDI", "CDD", "STAGE", "PRESTATAIRE", "JOURNALIER"] as const;
export const EMPLOYEE_STATUSES = ["ACTIVE", "SUSPENDED", "LEFT"] as const;
export const PAYMENT_METHODS = ["MOBILE_MONEY", "BANK", "CASH"] as const;
export const LEAVE_KINDS = ["PAID", "SICK", "UNPAID", "MATERNITY", "ABSENCE", "OTHER"] as const;
export const LEAVE_STATUSES = ["REQUESTED", "APPROVED", "REJECTED"] as const;
export const DOCUMENT_KINDS = ["CONTRACT", "ID", "DIPLOMA", "CERTIFICATE", "PAYSLIP", "OTHER"] as const;
export const PAYSLIP_STATUSES = ["DRAFT", "VALIDATED", "PAID"] as const;
export type LeaveKind = (typeof LEAVE_KINDS)[number];

// Congés et absences retirés du salaire : congé sans solde et absence non justifiée.
export const UNPAID_LEAVE_KINDS: LeaveKind[] = ["UNPAID", "ABSENCE"];
// Congés qui consomment le droit annuel (congés payés).
export const ENTITLEMENT_KINDS: LeaveKind[] = ["PAID"];
// Mois de paie compté sur 26 jours ouvrables (lundi à samedi) : retenue d'une journée = salaire / 26.
export const WORKING_DAYS_PER_MONTH = 26;

const DAY = 86_400_000;

/** AAAA-MM-JJ vérifié caractère par caractère (pas d'expression régulière sur une saisie), à minuit UTC (Lomé). */
export function parseDay(raw: unknown): Date | null {
  if (typeof raw !== "string" || raw.length !== 10) return null;
  if (![...raw].every((ch, i) => (i === 4 || i === 7 ? ch === "-" : ch >= "0" && ch <= "9"))) return null;
  const d = new Date(`${raw}T00:00:00Z`);
  // 2026-02-31 devient le 3 mars en JavaScript : refusé.
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== raw ? null : d;
}

/** AAAA-MM vérifié de la même façon ; rend le premier jour du mois et le premier du mois suivant. */
export function parseMonth(raw: unknown): { start: Date; end: Date; month: string } | null {
  if (typeof raw !== "string" || raw.length !== 7) return null;
  const start = parseDay(`${raw}-01`);
  if (!start) return null;
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
  return { start, end, month: raw };
}

export const monthOf = (d: Date) => d.toISOString().slice(0, 7);

// Champ date facultatif d'un formulaire : "" ou null efface, AAAA-MM-JJ valide.
export const dayField = z
  .union([z.string(), z.null()])
  .transform((v, ctx) => {
    if (v === null || v.trim() === "") return null;
    const d = parseDay(v.trim());
    if (!d) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Date invalide (AAAA-MM-JJ)" });
      return z.NEVER;
    }
    return d;
  });
export const requiredDay = z.string().transform((v, ctx) => {
  const d = parseDay(v.trim());
  if (!d) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Date invalide (AAAA-MM-JJ)" });
    return z.NEVER;
  }
  return d;
});

/** Jours ouvrables (lundi à samedi) entre deux dates incluses ; les dimanches ne comptent pas. */
export function workingDays(start: Date, end: Date): number {
  if (end.getTime() < start.getTime()) return 0;
  let n = 0;
  for (let t = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()); t <= end.getTime(); t += DAY) {
    if (new Date(t).getUTCDay() !== 0) n++;
  }
  return n;
}

/** Jours ouvrables d'un congé qui tombent dans [from, to[ (pour la paie d'un mois ou le solde d'une année). */
export function workingDaysWithin(leave: { startDate: Date; endDate: Date }, from: Date, to: Date): number {
  const start = new Date(Math.max(leave.startDate.getTime(), from.getTime()));
  const end = new Date(Math.min(leave.endDate.getTime(), to.getTime() - DAY));
  return workingDays(start, end);
}

type LeaveRow = { kind: string; status: string; startDate: Date; endDate: Date };

/** Droit aux congés payés de l'année civile : acquis, pris (acceptés), demandés et restants. */
export function leaveBalance(employee: { leaveDaysPerYear: number; startDate: Date }, leaves: LeaveRow[], now = new Date()) {
  const year = now.getUTCFullYear();
  const from = new Date(Date.UTC(year, 0, 1));
  const to = new Date(Date.UTC(year + 1, 0, 1));
  // Arrivé en cours d'année : droit au prorata des mois restants.
  const startMonth = employee.startDate.getTime() > from.getTime() ? employee.startDate.getUTCMonth() + (employee.startDate.getUTCFullYear() > year ? 12 : 0) : 0;
  const entitled = Math.max(0, Math.round((employee.leaveDaysPerYear * Math.max(0, 12 - startMonth)) / 12));
  const paid = leaves.filter((l) => ENTITLEMENT_KINDS.includes(l.kind as LeaveKind));
  const taken = paid.filter((l) => l.status === "APPROVED").reduce((s, l) => s + workingDaysWithin(l, from, to), 0);
  const requested = paid.filter((l) => l.status === "REQUESTED").reduce((s, l) => s + workingDaysWithin(l, from, to), 0);
  return { year, entitled, taken, requested, remaining: entitled - taken };
}

/** Jours d'absence non payés (acceptés) d'un mois, et leur retenue sur le salaire de base. */
export function unpaidDaysInMonth(leaves: LeaveRow[], month: { start: Date; end: Date }) {
  return leaves
    .filter((l) => l.status === "APPROVED" && UNPAID_LEAVE_KINDS.includes(l.kind as LeaveKind))
    .reduce((s, l) => s + workingDaysWithin(l, month.start, month.end), 0);
}

export function absenceDeduction(baseSalary: number, unpaidDays: number): number {
  return Math.min(baseSalary, Math.round((baseSalary * Math.min(unpaidDays, WORKING_DAYS_PER_MONTH)) / WORKING_DAYS_PER_MONTH));
}

/** Net à payer d'un bulletin (jamais négatif). */
export function payslipNet(p: { baseSalary: number; absenceDeduction: number; bonus: number; deductions: number }): number {
  return Math.max(0, p.baseSalary - p.absenceDeduction + p.bonus - p.deductions);
}

/** L'employé fait-il partie de la paie de ce mois ? Arrivé avant la fin du mois, et pas parti avant son début. */
export function onPayroll(e: { status: string; startDate: Date; leftAt: Date | null; endDate: Date | null }, month: { start: Date; end: Date }): boolean {
  if (e.startDate.getTime() >= month.end.getTime()) return false;
  const gone = e.leftAt ?? (e.status === "LEFT" ? e.endDate : null);
  if (e.status === "LEFT" && (!gone || gone.getTime() < month.start.getTime())) return false;
  return e.status !== "SUSPENDED";
}

/** Fin de contrat ou de période d'essai dans les 30 prochains jours : à prévoir par les RH. */
export function upcomingDeadlines(employees: { id: string; name: string; status: string; endDate: Date | null; trialEndDate: Date | null; contractType: string }[], now = new Date()) {
  const soon = now.getTime() + 30 * DAY;
  const out: { employeeId: string; name: string; kind: "CONTRACT_END" | "TRIAL_END"; date: Date }[] = [];
  for (const e of employees) {
    if (e.status === "LEFT") continue;
    if (e.endDate && e.endDate.getTime() >= now.getTime() - DAY && e.endDate.getTime() <= soon) out.push({ employeeId: e.id, name: e.name, kind: "CONTRACT_END", date: e.endDate });
    if (e.trialEndDate && e.trialEndDate.getTime() >= now.getTime() - DAY && e.trialEndDate.getTime() <= soon) out.push({ employeeId: e.id, name: e.name, kind: "TRIAL_END", date: e.trialEndDate });
  }
  return out.sort((a, b) => a.date.getTime() - b.date.getTime());
}

// Fichiers acceptés pour les documents d'un employé (photo ou PDF), et leur poids maximal.
export const MAX_DOCUMENT_BYTES = 3_000_000;
export const DOCUMENT_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"] as const;

/** Data URL d'un document (PDF ou photo) → octets et type ; null si le type n'est pas accepté. */
export function decodeDocument(dataUrl: string): { bytes: Uint8Array; contentType: string } | null {
  const comma = dataUrl.indexOf(",");
  if (!dataUrl.startsWith("data:") || comma < 0) return null;
  const head = dataUrl.slice(5, comma);
  if (!head.endsWith(";base64")) return null;
  const contentType = head.slice(0, -";base64".length);
  if (!(DOCUMENT_TYPES as readonly string[]).includes(contentType)) return null;
  const b64 = dataUrl.slice(comma + 1);
  // Poids vérifié avant de décoder : 4 caractères base64 font 3 octets.
  if (Math.floor((b64.length * 3) / 4) > MAX_DOCUMENT_BYTES + 2) return null;
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
  return { bytes, contentType };
}

/** Une cellule CSV (séparateur « ; », lu tel quel par Excel en français). Neutralise les formules (=, +, -, @). */
export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+([.,]\d+)?$/.test(s)) s = `'${s}`;
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export const csvLine = (cells: unknown[]) => cells.map(csvCell).join(";");
/** Fichier CSV complet, avec l'en-tête UTF-8 (BOM) pour qu'Excel lise les accents. */
export const csvFile = (rows: unknown[][]) => `﻿${rows.map(csvLine).join("\r\n")}\r\n`;
