"use client";

import Link from "next/link";
import { useState } from "react";
import { adminFetch, roleOf, seesEverything, useStaff } from "@/lib/admin";
import { useI18n } from "@/lib/i18n/client";
import { buttonGhost, Card, Empty, ErrorNote, Loading, PageHeader, Tabs } from "../../ui";
import { useAction, useAdmin } from "../../useAdmin";
import { downloadCsv, dueLabel, profileHref, SEGMENT_STYLE, TYPE_ICON, TYPE_SLUG, type CrmAlert, type CrmList, type CrmSegmentInfo, type CrmTask } from "../crm";

// Mes suivis : rappels de l'équipe (aujourd'hui, en retard, à venir), alertes calculées et groupes de clients.
export default function CrmFollowUpsPage() {
  const { t, locale } = useI18n();
  const staff = useStaff();
  const [who, setWho] = useState<"MINE" | "ALL">("MINE");
  const tasks = useAdmin<CrmTask[]>(`/crm/tasks${who === "MINE" ? "?mine=1" : ""}`);
  const alerts = useAdmin<CrmAlert[]>("/crm/alerts");
  const segments = useAdmin<CrmSegmentInfo[]>("/crm/segments");
  const { error, run } = useAction();

  const done = async (id: string) => (await run(() => adminFetch(`/crm/tasks/${id}`, { method: "PATCH", body: { done: true } }))) && tasks.reload();
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);
  const list = tasks.data ?? [];
  const now = list.filter((task) => new Date(task.dueAt) <= endOfToday);
  const later = list.filter((task) => new Date(task.dueAt) > endOfToday);

  const exportSegment = async (s: CrmSegmentInfo) => {
    await run(async () => {
      const data = await adminFetch<CrmList>(`/crm/customer?segment=${s.key}&limit=5000`);
      downloadCsv(
        `zedeka-clients-${s.label.toLowerCase()}.csv`,
        [t("Nom"), t("Téléphone"), t("Score"), ...data.columns.map((c) => t(c.label))],
        data.rows.map((r) => [r.name, r.phone, r.score, ...data.columns.map((c) => r.cols[c.key])]),
      );
    });
  };

  const taskItem = (task: CrmTask) => (
    <li key={task.id} className="flex items-start justify-between gap-3 py-2">
      <span className="min-w-0 text-sm">
        <span aria-hidden>{TYPE_ICON[task.entityType]} </span>
        <Link href={profileHref(task.entityType, task.entityId)} className="font-semibold hover:underline">
          {task.entityName}
        </Link>
        {" — "}
        {task.title}
        <span className="block text-xs text-stone-500">
          {dueLabel(task.dueAt, t, locale)} · {task.assignedTo ? t("pour {name}", { name: task.assignedTo }) : t("pour toute l'équipe")} · {t("créé par {name}", { name: task.createdBy })}
        </span>
      </span>
      <button onClick={() => done(task.id)} className={buttonGhost}>
        {t("Fait")}
      </button>
    </li>
  );

  return (
    <div className="space-y-4">
      <PageHeader
        icon="check"
        title="Mes suivis"
        description="Les rappels de l'équipe et les alertes calculées chaque jour à partir des notes, refus et plaintes."
        actions={
          <Link href="/admin/crm" className={buttonGhost}>
            {t("Suivi CRM")}
          </Link>
        }
      />
      <ErrorNote message={error ?? tasks.error} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Rappels">
          <Tabs
            tabs={[
              { value: "MINE", label: staff?.id ? "Les miens" : "Les miens et ceux de l'équipe" },
              { value: "ALL", label: "Toute l'équipe" },
            ]}
            value={who}
            onChange={setWho}
          />
          {!tasks.data ? (
            <Loading />
          ) : !list.length ? (
            <Empty>{t("Aucun rappel. Ajoutez-en un depuis la fiche d'une personne.")}</Empty>
          ) : (
            <>
              <h3 className="text-xs font-semibold uppercase text-stone-500">{t("Aujourd'hui et en retard")}</h3>
              {now.length ? <ul className="divide-y divide-stone-100">{now.map(taskItem)}</ul> : <p className="py-2 text-sm text-stone-500">{t("Rien pour aujourd'hui.")}</p>}
              {later.length > 0 && (
                <>
                  <h3 className="mt-3 text-xs font-semibold uppercase text-stone-500">{t("À venir")}</h3>
                  <ul className="divide-y divide-stone-100">{later.map(taskItem)}</ul>
                </>
              )}
            </>
          )}
        </Card>

        <Card title="Alertes automatiques">
          {!alerts.data ? (
            <Loading />
          ) : !alerts.data.length ? (
            <Empty>Aucune alerte en ce moment.</Empty>
          ) : (
            <ul className="divide-y divide-stone-100 text-sm">
              {alerts.data.map((a, i) => (
                <li key={i} className="flex gap-2 py-2">
                  <span aria-hidden>{a.kind === "PRAISE" ? "🎉" : a.kind === "DORMANT" ? "💤" : a.kind === "DOOR" ? "🚪" : a.kind === "BAD_RATINGS" ? "👎" : "⚠️"}</span>
                  <span>
                    {TYPE_ICON[a.type]}{" "}
                    {a.id ? (
                      <Link href={profileHref(a.type, a.id)} className="font-semibold hover:underline">
                        {a.name}
                      </Link>
                    ) : (
                      <Link href={`/admin/crm?type=${TYPE_SLUG[a.type]}&segment=DORMANT`} className="font-semibold hover:underline">
                        {a.name}
                      </Link>
                    )}{" "}
                    : {a.text}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title="Groupes de clients">
        {!segments.data ? (
          <Loading />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="text-left text-xs text-stone-500">
                <tr className="border-b border-stone-200">
                  <th className="py-2 font-medium">{t("Groupe")}</th>
                  <th className="py-2 font-medium">{t("Règle")}</th>
                  <th className="py-2 font-medium">{t("Clients")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {segments.data.map((s) => (
                  <tr key={s.key} className="border-b border-stone-100 last:border-0">
                    <td className="py-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs ${SEGMENT_STYLE[s.key]}`}>{t(s.label)}</span>
                    </td>
                    <td className="py-2 text-stone-600">{s.rule}</td>
                    <td className="py-2 font-semibold tabular-nums">{s.count}</td>
                    <td className="py-2 text-right">
                      <div className="flex justify-end gap-2">
                        <Link href={`/admin/crm?type=customer&segment=${s.key}`} className={buttonGhost}>
                          {t("Voir")}
                        </Link>
                        <button onClick={() => exportSegment(s)} className={buttonGhost} disabled={!s.count}>
                          {t("Exporter")}
                        </button>
                        {s.key !== "WATCH" && seesEverything(roleOf(staff)) && (
                          <Link href="/admin/promotions" className={buttonGhost}>
                            {t("Code promo")}
                          </Link>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
