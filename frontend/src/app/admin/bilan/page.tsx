"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/panel/icons";
import { adminFetch } from "@/lib/admin";
import { useI18n } from "@/lib/i18n/client";
import { button, buttonGhost, Card, Empty, ErrorNote, Loading, PageHeader } from "../ui";
import { useAdmin } from "../useAdmin";

type Severity = "critical" | "high" | "moderate" | "low";
type Counts = Record<Severity, number>;
type Check = { key: string; label: string; status: "ok" | "warn" | "fail" | "skip"; note: string; severity?: Severity; group: "api" | "code" | "app" };
type Ci = {
  generatedAt: string;
  commit?: string;
  npmAudit?: Counts & { packages?: { name: string; severity: string; dir: string }[] };
  semgrep?: { error: number; warning: number; top?: { rule: string; file: string }[] };
};
type AuditDetail = { day: string; ranAt: string; durationSec: number | null; counts: Counts; checks: Check[]; ci: Ci | null };
type AuditRow = Counts & { day: string; ranAt: string };

const SEVERITIES: { key: Severity; label: string; tone: string }[] = [
  { key: "critical", label: "Critiques", tone: "bg-red-100 text-red-800" },
  { key: "high", label: "Élevées", tone: "bg-amber-100 text-amber-900" },
  { key: "moderate", label: "Moyennes", tone: "bg-yellow-50 text-yellow-900" },
  { key: "low", label: "Faibles", tone: "bg-stone-100 text-stone-700" },
];
const STATUS = {
  ok: { label: "OK", tone: "text-emerald-700", dot: "bg-emerald-600" },
  warn: { label: "À surveiller", tone: "text-amber-700", dot: "bg-amber-500" },
  fail: { label: "Problème", tone: "text-red-700", dot: "bg-red-600" },
  skip: { label: "Non vérifié", tone: "text-stone-500", dot: "bg-stone-400" },
} as const;
const GROUPS: { key: Check["group"]; label: string }[] = [
  { key: "api", label: "API" },
  { key: "app", label: "Appli en ligne" },
  { key: "code", label: "Code et dépendances" },
];
const SEVERITY_LABEL: Record<Severity, string> = { critical: "critique", high: "élevée", moderate: "moyenne", low: "faible" };

const toneOf = (c: Counts) => (c.critical > 0 ? "bg-red-600" : c.high > 0 ? "bg-amber-500" : "bg-emerald-600");

// Fichier CSV pour Excel : séparateur « ; » et BOM, pour que les accents et colonnes s'ouvrent bien en français.
function exportCsv(a: AuditDetail) {
  const cell = (v: string | number | null | undefined) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [
    ["Bilan du", a.day, "Lancé à", a.ranAt].map(cell).join(";"),
    ["Critiques", a.counts.critical, "Élevées", a.counts.high, "Moyennes", a.counts.moderate, "Faibles", a.counts.low].map(cell).join(";"),
    "",
    ["Partie", "Contrôle", "Résultat", "Gravité", "Détail"].map(cell).join(";"),
    ...a.checks.map((c) => [GROUPS.find((g) => g.key === c.group)?.label, c.label, STATUS[c.status].label, c.severity && c.status !== "ok" ? SEVERITY_LABEL[c.severity] : "", c.note].map(cell).join(";")),
  ];
  for (const p of a.ci?.npmAudit?.packages ?? []) lines.push(["Dépendance", p.name, "Vulnérable", p.severity, p.dir].map(cell).join(";"));
  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `bilan-zedeka-${a.day}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Bilan du jour : chaque matin à 6 h, contrôle de sécurité et d'état de l'API, de l'appli en ligne et du code. Les 60
// derniers jours, le détail d'un jour, la relance à la demande et l'export (PDF par l'impression, CSV pour Excel).
export default function BilanPage() {
  const { t, locale } = useI18n();
  const list = useAdmin<{ audits: AuditRow[]; canRun: boolean }>("/tech/audits");
  const [day, setDay] = useState<string | null>(null);
  const [detail, setDetail] = useState<AuditDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const shown = day ?? list.data?.audits[0]?.day ?? null;
  useEffect(() => {
    if (!shown) return;
    let alive = true;
    adminFetch<AuditDetail>(`/tech/audits/${shown}`)
      .then((d) => alive && (setDetail(d), setError(null)))
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [shown]);

  async function run() {
    setRunning(true);
    try {
      const fresh = await adminFetch<AuditDetail>("/tech/audit/run", { method: "POST" });
      setDetail(fresh);
      setDay(fresh.day);
      await list.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  }

  const when = (iso: string) => new Date(iso).toLocaleString(locale, { dateStyle: "long", timeStyle: "short" });
  const dayLabel = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short" });

  return (
    <div className="space-y-4">
      <div className="print:hidden">
        <PageHeader
          icon="shield"
          title="Bilan du jour"
          description="Chaque matin à 6 h : sécurité et état de l'API, de l'appli en ligne et du code. Les failles critiques préviennent aussitôt le directeur et l'administrateur adjoint."
          actions={
            <>
              {detail && (
                <>
                  <button type="button" className={buttonGhost} onClick={() => window.print()}>
                    <Icon name="print" className="h-4 w-4" /> {t("Exporter en PDF")}
                  </button>
                  <button type="button" className={buttonGhost} onClick={() => exportCsv(detail)}>
                    <Icon name="download" className="h-4 w-4" /> {t("Exporter en CSV")}
                  </button>
                </>
              )}
              {list.data?.canRun && (
                <button type="button" className={button} onClick={run} disabled={running}>
                  <Icon name="refresh" className="h-4 w-4" /> {t(running ? "Bilan en cours…" : "Relancer le bilan")}
                </button>
              )}
            </>
          }
        />
      </div>
      <ErrorNote message={list.error ?? error} />
      {!list.data ? (
        !list.error && <Loading />
      ) : list.data.audits.length === 0 ? (
        <Empty>Pas encore de bilan. Le premier sera fait demain à 6 h, ou maintenant avec « Relancer le bilan ».</Empty>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
          <Card title="60 derniers jours" icon="clock" className="print:hidden">
            <ul className="max-h-[70vh] space-y-1 overflow-y-auto text-sm">
              {list.data.audits.map((a) => (
                <li key={a.day}>
                  <button
                    type="button"
                    onClick={() => setDay(a.day)}
                    className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left ${a.day === shown ? "bg-night-soft text-white" : "hover:bg-stone-100"}`}
                  >
                    <span className={`h-2 w-2 shrink-0 rounded-full ${toneOf(a)}`} />
                    <span className="flex-1">{dayLabel(a.day)}</span>
                    <span className="tabular-nums opacity-80">{a.critical + a.high > 0 ? `${a.critical} · ${a.high}` : "✓"}</span>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
          {!detail ? (
            <Loading />
          ) : (
            <div className="space-y-4">
              <div>
                <h2 className="text-lg font-semibold">{t("Bilan de sécurité du {day}", { day: new Date(`${detail.day}T12:00:00Z`).toLocaleDateString(locale, { dateStyle: "full" }) })}</h2>
                <p className="text-sm text-stone-600">
                  {t("Lancé le {when}", { when: when(detail.ranAt) })}
                  {detail.durationSec !== null && ` · ${t("{n} s", { n: detail.durationSec })}`}
                  {detail.ci?.commit && ` · ${t("code {sha}", { sha: detail.ci.commit.slice(0, 7) })}`}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {SEVERITIES.map((s) => (
                  <div key={s.key} className={`rounded-xl px-4 py-3 ${s.tone}`}>
                    <div className="text-2xl font-bold tabular-nums">{detail.counts[s.key]}</div>
                    <div className="text-sm">{t(s.label)}</div>
                  </div>
                ))}
              </div>
              {GROUPS.map((g) => {
                const checks = detail.checks.filter((c) => c.group === g.key);
                if (checks.length === 0) return null;
                return (
                  <Card key={g.key} title={g.label} className="break-inside-avoid">
                    <ul className="divide-y divide-stone-100 text-sm">
                      {checks.map((c) => (
                        <li key={c.key} className="flex items-start gap-3 py-2">
                          <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${STATUS[c.status].dot}`} />
                          <div className="flex-1">
                            <div className="font-medium">{t(c.label)}</div>
                            {c.note && <div className="text-stone-600">{c.note}</div>}
                          </div>
                          <span className={`shrink-0 font-medium ${STATUS[c.status].tone}`}>
                            {t(STATUS[c.status].label)}
                            {c.severity && c.status !== "ok" && c.status !== "skip" ? ` · ${t(SEVERITY_LABEL[c.severity])}` : ""}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </Card>
                );
              })}
              {(detail.ci?.npmAudit?.packages?.length ?? 0) > 0 && (
                <Card title="Dépendances vulnérables" className="break-inside-avoid">
                  <ul className="divide-y divide-stone-100 text-sm">
                    {detail.ci!.npmAudit!.packages!.map((p) => (
                      <li key={`${p.dir}-${p.name}`} className="flex justify-between gap-3 py-1.5">
                        <span className="font-mono">{p.name}</span>
                        <span className="text-stone-600">
                          {p.dir} · {t(SEVERITY_LABEL[p.severity as Severity] ?? p.severity)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
              {(detail.ci?.semgrep?.top?.length ?? 0) > 0 && (
                <Card title="Points relevés dans le code" className="break-inside-avoid">
                  <ul className="divide-y divide-stone-100 text-sm">
                    {detail.ci!.semgrep!.top!.map((p, i) => (
                      <li key={i} className="flex justify-between gap-3 py-1.5">
                        <span>{p.rule}</span>
                        <span className="font-mono text-stone-600">{p.file}</span>
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
