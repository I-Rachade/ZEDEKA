// Écran technique (/ecran-technique) : données lues avec la clé de l'écran (GET /api/screen/tech).

export type Level = "good" | "warn" | "bad" | "none";

export type TechError = { fingerprint: string; source: string; route: string; status: number; message: string; count: number; lastAt: string };

export type TechVital = { key: string; label: string; value: number | null; total?: number | null; unit: string; level: Level; page?: string | null };

export type AuditCheck = { key: string; label: string; status: "ok" | "warn" | "fail" | "skip"; note: string };
export type Audit = {
  ranAt: string;
  durationSec: number | null;
  counts: { critical: number; high: number; moderate: number; low: number };
  checks: AuditCheck[];
};

export type Improvement = { title: string; why: string; level: Level };
export type Anomaly = { at: string; title: string; detail: string; level: Level };

export type TechData = {
  checkedAt: string;
  vitality: { score: number; level: Level; parts: { key: string; label: string; max: number; points: number }[] };
  live: {
    online: { total: number; byApp: Record<string, number> } | null;
    onlineLastWeek: number | null;
    activeToday: { total: number; byApp: Record<string, number> };
    today: { at: string; value: number }[];
    lastWeek: { at: string; value: number }[];
    errors: TechError[];
  };
  vitals: TechVital[];
  api: {
    // Dernier test de santé (toutes les 5 min) : routes essentielles qui répondent, sur le total.
    probe?: { at: string; ok: number | null; total: number | null; avgMs: number | null } | null;
    requests1h: number;
    slowest: { route: string; p95: number | null; requests: number }[];
    failing: { route: string; errors: number; errorRate: number | null }[];
  };
  // Bilan quotidien (6 h), anomalies et « quoi améliorer » : absents tant qu'ils ne sont pas calculés.
  audit?: Audit | null;
  anomalies?: Anomaly[];
  improvements?: Improvement[];
};

export const LEVEL_COLOR: Record<Level, string> = { good: "#5fcf94", warn: "#ffb020", bad: "#f26b55", none: "#a8a29e" };

export function formatVital(v: TechVital): string {
  if (v.value === null) return "–";
  if (v.unit === "%") return `${v.value.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} %`;
  if (v.unit === "ms") return v.value >= 1000 ? `${(v.value / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} s` : `${Math.round(v.value)} ms`;
  if (v.unit === "routes") return v.total ? `${v.value}/${v.total}` : String(v.value);
  if (v.unit === "s") return v.value < 60 ? `il y a ${Math.round(v.value)} s` : `il y a ${Math.round(v.value / 60)} min`;
  return v.value.toLocaleString("fr-FR");
}
