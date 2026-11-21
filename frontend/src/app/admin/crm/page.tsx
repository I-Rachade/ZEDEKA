"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useI18n } from "@/lib/i18n/client";
import { useDebounced } from "@/lib/useDebounced";
import { buttonGhost, Card, Empty, ErrorNote, input, Loading, PageHeader, Tabs } from "../ui";
import { useAdmin } from "../useAdmin";
import { downloadCsv, dueLabel, profileHref, SCORE_STYLE, SEGMENT_LABEL, SEGMENT_STYLE, TYPE_LABEL, TYPE_SLUG, typeFromSlug, type CrmList, type CrmType, type Segment } from "./crm";

// Suivi CRM : une liste par type avec le score sur 100, les chiffres clés, les groupes et le prochain suivi.
export default function CrmPage() {
  return (
    <Suspense fallback={<Loading />}>
      <CrmList />
    </Suspense>
  );
}

const FILTERS: Record<CrmType, (Segment | "ALL" | "TODO")[]> = {
  DRIVER: ["ALL", "WATCH", "TOP", "NEW", "INACTIVE", "TODO"],
  CUSTOMER: ["ALL", "WATCH", "VIP", "LOYAL", "NEW", "DORMANT", "TODO"],
  RESTAURANT: ["ALL", "WATCH", "TOP", "NEW", "INACTIVE", "TODO"],
  MERCHANT: ["ALL", "WATCH", "TOP", "NEW", "INACTIVE", "TODO"],
};

function CrmList() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const params = useSearchParams();
  const type = typeFromSlug(params.get("type") ?? "") ?? "DRIVER";
  const segment = params.get("segment") ?? "ALL";
  const [q, setQ] = useState("");
  const query = useDebounced(q.trim());
  const { data, error } = useAdmin<CrmList>(`/crm/${TYPE_SLUG[type]}?segment=${segment}${query ? `&q=${encodeURIComponent(query)}` : ""}`);

  const go = (next: { type?: CrmType; segment?: string }) => {
    const p = new URLSearchParams({ type: TYPE_SLUG[next.type ?? type], segment: next.segment ?? (next.type ? "ALL" : segment) });
    router.replace(`/admin/crm?${p}`);
  };
  const filterLabel = (f: string) => (f === "ALL" ? t("Tous") : f === "TODO" ? t("Suivi à faire") : t(SEGMENT_LABEL[f as Segment]));

  const exportCsv = () => {
    if (!data) return;
    downloadCsv(
      `zedeka-${TYPE_SLUG[type]}-${segment.toLowerCase()}.csv`,
      [t("Nom"), t("Téléphone"), t("Score"), ...data.columns.map((c) => t(c.label)), t("Groupes"), t("Étiquettes")],
      data.rows.map((r) => [r.name, r.phone, r.score, ...data.columns.map((c) => r.cols[c.key]), r.segments.map((s) => t(SEGMENT_LABEL[s])).join(", "), r.tags.join(", ")]),
    );
  };

  return (
    <div>
      <PageHeader
        icon="team"
        title="Suivi CRM"
        description="Score, notes, plaintes et suivis de chaque livreur, client et partenaire, sur les 90 derniers jours."
        actions={
          <>
            <Link href="/admin/crm/suivis" className={buttonGhost}>
              {t("Mes suivis")}
            </Link>
            <button className={buttonGhost} onClick={exportCsv} disabled={!data?.rows.length}>
              {t("Exporter")}
            </button>
          </>
        }
      />
      <Tabs tabs={(Object.keys(TYPE_LABEL) as CrmType[]).map((v) => ({ value: v, label: TYPE_LABEL[v] }))} value={type} onChange={(v) => go({ type: v })} />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input className={`${input} max-w-xs`} placeholder={t("Nom, téléphone ou étiquette")} value={q} onChange={(e) => setQ(e.target.value)} />
        {FILTERS[type].map((f) => (
          <button
            key={f}
            onClick={() => go({ segment: f })}
            className={`rounded-full border px-3 py-1 text-xs font-medium ${segment === f ? "border-stone-800 bg-stone-800 text-white" : f === "WATCH" ? "border-red-200 bg-red-50 text-red-800" : "border-stone-300 bg-surface"}`}
          >
            {filterLabel(f)}
            {data && <span className="ml-1 opacity-70">{data.counts[f] ?? 0}</span>}
          </button>
        ))}
      </div>
      <ErrorNote message={error} />
      {!data ? (
        <Loading />
      ) : !data.rows.length ? (
        <Card>
          <Empty>Personne dans ce groupe.</Empty>
        </Card>
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="text-left text-xs text-stone-500">
              <tr className="border-b border-stone-200">
                <th className="px-3 py-2 font-medium">{t(TYPE_LABEL[type])}</th>
                <th className="px-3 py-2 font-medium">{t("Score")}</th>
                {data.columns.map((c) => (
                  <th key={c.key} className="px-3 py-2 font-medium">
                    {t(c.label)}
                  </th>
                ))}
                <th className="px-3 py-2 font-medium">{t("Groupes")}</th>
                <th className="px-3 py-2 font-medium">{t("Prochain suivi")}</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.id} className="border-b border-stone-100 last:border-0 hover:bg-stone-50">
                  <td className="px-3 py-2">
                    <Link href={profileHref(type, r.id)} className="font-semibold hover:underline">
                      {r.name}
                    </Link>
                    <span className="block text-xs text-stone-500">{[r.phone, r.subtitle].filter(Boolean).join(" · ")}</span>
                  </td>
                  <td className="px-3 py-2">
                    <span className={`inline-block w-11 rounded-md py-0.5 text-center font-bold ${SCORE_STYLE[r.color]}`} title={r.score === null ? t("Pas encore assez d'activité") : undefined}>
                      {r.score ?? "–"}
                    </span>
                  </td>
                  {data.columns.map((c) => (
                    <td key={c.key} className="px-3 py-2 tabular-nums">
                      {r.cols[c.key]}
                    </td>
                  ))}
                  <td className="px-3 py-2">
                    {r.segments.map((s) => (
                      <span key={s} className={`mr-1 inline-block rounded-full px-2 py-0.5 text-xs ${SEGMENT_STYLE[s]}`}>
                        {t(SEGMENT_LABEL[s])}
                      </span>
                    ))}
                    {r.tags.map((l) => (
                      <span key={l} className="mr-1 inline-block rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-900">
                        {l}
                      </span>
                    ))}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {r.nextTask ? (
                      <>
                        <span className="font-medium">{dueLabel(r.nextTask.dueAt, t, locale)}</span>
                        <span className="block text-stone-500">{r.nextTask.title}</span>
                      </>
                    ) : (
                      "–"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.total > data.rows.length && <p className="p-3 text-xs text-stone-500">{t("{n} premiers sur {total} : affinez la recherche.", { n: data.rows.length, total: data.total })}</p>}
        </Card>
      )}
    </div>
  );
}
