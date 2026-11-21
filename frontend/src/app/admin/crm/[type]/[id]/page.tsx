"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { adminFetch, telLink, whatsappLink } from "@/lib/admin";
import { useI18n } from "@/lib/i18n/client";
import { button, buttonGhost, Card, ErrorNote, input, Loading } from "../../../ui";
import { useAction, useAdmin } from "../../../useAdmin";
import { dueLabel, NOTE_KIND_LABEL, SCORE_STYLE, SEGMENT_LABEL, SEGMENT_STYLE, TYPE_LABEL, TYPE_SLUG, typeFromSlug, type CrmProfile, type CrmType, type NoteKind } from "../../crm";

// Fiche complète (360°) d'un livreur, client, commerce ou marchand : chiffres, historique, détail du score,
// notes de l'équipe, étiquettes et rappels de suivi.
const PAGE_OF: Partial<Record<CrmType, (id: string) => string>> = {
  DRIVER: () => "/admin/livreurs",
  RESTAURANT: (id) => `/admin/restaurants/${id}`,
  MERCHANT: (id) => `/admin/marchands/${id}`,
};

const tomorrow = () => {
  const d = new Date(Date.now() + 86_400_000);
  return d.toISOString().slice(0, 10);
};

export default function CrmProfilePage() {
  const { t, locale } = useI18n();
  const params = useParams<{ type: string; id: string }>();
  const type = typeFromSlug(params.type);
  const id = decodeURIComponent(params.id);
  const path = `/crm/${params.type}/${encodeURIComponent(id)}`;
  const { data, error, reload } = useAdmin<CrmProfile>(path);
  const team = useAdmin<string[]>("/crm/team");
  const { error: actionError, run } = useAction();
  const [kind, setKind] = useState<NoteKind>("NOTE");
  const [body, setBody] = useState("");
  const [remind, setRemind] = useState(false);
  const [due, setDue] = useState(tomorrow());
  const [assignee, setAssignee] = useState("");
  const [tag, setTag] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (data) document.title = `${data.name} · Zedeka`;
  }, [data]);

  if (!type) return <ErrorNote message="Type inconnu" />;
  if (!data) return error ? <ErrorNote message={error} /> : <Loading />;

  const save = async () => {
    setBusy(true);
    const ok = await run(async () => {
      if (body.trim()) await adminFetch(`${path}/notes`, { method: "POST", body: { kind, body } });
      if (remind) await adminFetch(`${path}/tasks`, { method: "POST", body: { title: body.trim() || t("Rappeler"), dueAt: `${due}T08:00:00.000Z`, assignedTo: assignee || null } });
    });
    setBusy(false);
    if (ok) {
      setBody("");
      setRemind(false);
      setKind("NOTE");
      reload();
    }
  };
  const addTag = async () => {
    if (!tag.trim()) return;
    if (await run(() => adminFetch(`${path}/tags`, { method: "POST", body: { label: tag } }))) {
      setTag("");
      reload();
    }
  };
  const removeTag = async (tagId: string) => (await run(() => adminFetch(`${path}/tags/${tagId}`, { method: "DELETE" }))) && reload();
  const doneTask = async (taskId: string) => (await run(() => adminFetch(`/crm/tasks/${taskId}`, { method: "PATCH", body: { done: true } }))) && reload();
  const suspend = async () => {
    if (!window.confirm(t("Suspendre {name} ? Il ne recevra plus de courses.", { name: data.name }))) return;
    const ok = await run(async () => {
      await adminFetch(`/drivers/${id}`, { method: "PATCH", body: { active: false } });
      await adminFetch(`${path}/notes`, { method: "POST", body: { kind: "WARNING", body: t("Compte suspendu depuis le suivi CRM.") } });
    });
    if (ok) reload();
  };
  const warn = () => {
    setKind("WARNING");
    document.getElementById("crm-note")?.focus();
  };

  return (
    <div className="space-y-4">
      <div className="text-sm text-stone-500 print:hidden">
        <Link href={`/admin/crm?type=${TYPE_SLUG[type]}`} className="hover:underline">
          {t("Suivi CRM")} › {t(TYPE_LABEL[type])}
        </Link>
      </div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            {data.name}
            <span className={`rounded-lg px-2 py-0.5 text-base ${SCORE_STYLE[data.color]}`} title={t("Score sur 100")}>
              {data.score.value ?? "–"}
            </span>
          </h1>
          <p className="text-sm text-stone-600">{[data.phone, data.subtitle].filter(Boolean).join(" · ")}</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {data.segments.map((s) => (
              <span key={s} className={`rounded-full px-2 py-0.5 text-xs ${SEGMENT_STYLE[s]}`}>
                {t(SEGMENT_LABEL[s])}
              </span>
            ))}
            {data.tags.map((tg) => (
              <span key={tg.id} className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-900">
                {tg.label}
                <button onClick={() => removeTag(tg.id)} aria-label={t("Retirer l'étiquette")} className="opacity-60 hover:opacity-100">
                  ×
                </button>
              </span>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {data.phone && (
            <>
              <a href={telLink(data.phone)} className={button}>
                {t("Appeler")}
              </a>
              <a href={whatsappLink(data.phone)} target="_blank" rel="noreferrer" className={buttonGhost}>
                WhatsApp
              </a>
            </>
          )}
          <button onClick={warn} className={`${buttonGhost} border-orange-200 bg-orange-50 text-orange-800`}>
            {t("Avertir")}
          </button>
          {type === "DRIVER" && data.active && (
            <button onClick={suspend} className={buttonGhost}>
              {t("Suspendre")}
            </button>
          )}
          {PAGE_OF[type] && (
            <Link href={PAGE_OF[type](id)} className={buttonGhost}>
              {t("Ouvrir la fiche habituelle")}
            </Link>
          )}
        </div>
      </div>
      <ErrorNote message={actionError} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {data.kpis.map((k) => (
          <div key={k.label} className="rounded-xl border border-stone-200 bg-surface p-3">
            <p className="text-xs text-stone-500">{k.label}</p>
            <p className="text-xl font-bold tabular-nums">{k.value}</p>
            {k.hint && <p className="text-xs text-stone-500">{k.hint}</p>}
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <Card title="Historique">
          {!data.timeline.length ? (
            <p className="text-sm text-stone-500">{t("Rien pour l'instant.")}</p>
          ) : (
            <ul className="divide-y divide-stone-100 text-sm">
              {data.timeline.map((e, i) => (
                <li key={i} className="flex gap-3 py-2">
                  <span className="w-24 shrink-0 text-xs text-stone-500">{new Date(e.at).toLocaleString(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                  <span className="w-5 shrink-0" aria-hidden>
                    {e.icon}
                  </span>
                  <span className="min-w-0">
                    {e.author && <b>{e.author} : </b>}
                    {e.text}
                    {e.orderId && e.code && (
                      <>
                        {" "}
                        <Link href={`/admin/commandes/${e.orderId}`} className="text-emerald-700 underline">
                          {e.code}
                        </Link>
                      </>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="space-y-4">
          <Card title="Détail du score">
            {data.score.value === null && <p className="mb-2 text-xs text-stone-500">{t("Pas encore de score : moins de 5 courses ou commandes en {n} jours.", { n: data.windowDays })}</p>}
            <ul className="space-y-3 text-sm">
              {data.score.parts.map((p) => (
                <li key={p.key}>
                  <div className="flex justify-between gap-2">
                    <span>{p.label}</span>
                    <span className="font-semibold tabular-nums">
                      {p.points} / {p.max}
                    </span>
                  </div>
                  <div className="mt-1 h-2 rounded bg-stone-100">
                    <div className={`h-2 rounded ${p.points / p.max >= 0.8 ? "bg-emerald-500" : p.points / p.max >= 0.6 ? "bg-amber-500" : "bg-red-500"}`} style={{ width: `${Math.max(3, (p.points / p.max) * 100)}%` }} />
                  </div>
                  <p className="mt-0.5 text-xs text-stone-500">{p.detail}</p>
                </li>
              ))}
            </ul>
          </Card>

          {data.tasks.length > 0 && (
            <Card title="Suivis à faire">
              <ul className="space-y-2 text-sm">
                {data.tasks.map((task) => (
                  <li key={task.id} className="flex items-start justify-between gap-2">
                    <span>
                      <b>{dueLabel(task.dueAt, t, locale)}</b> · {task.title}
                      <span className="block text-xs text-stone-500">{task.assignedTo ? t("pour {name}", { name: task.assignedTo }) : t("pour toute l'équipe")}</span>
                    </span>
                    <button onClick={() => doneTask(task.id)} className={buttonGhost}>
                      {t("Fait")}
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card title="Ajouter au suivi">
            <div className="mb-2 flex flex-wrap gap-1">
              {(Object.keys(NOTE_KIND_LABEL) as NoteKind[]).map((k) => (
                <button key={k} onClick={() => setKind(k)} className={`rounded-full border px-3 py-1 text-xs ${kind === k ? "border-stone-800 bg-stone-800 text-white" : "border-stone-300"}`}>
                  {t(NOTE_KIND_LABEL[k])}
                </button>
              ))}
            </div>
            <textarea id="crm-note" className={`${input} h-20`} placeholder={t("Ce qui a été dit ou fait (appel, remarque, accord…)")} value={body} onChange={(e) => setBody(e.target.value)} />
            <label className="mt-2 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={remind} onChange={(e) => setRemind(e.target.checked)} />
              {t("Me rappeler")}
            </label>
            {remind && (
              <div className="mt-2 grid grid-cols-2 gap-2">
                <input type="date" className={input} value={due} onChange={(e) => setDue(e.target.value)} aria-label={t("Date du rappel")} />
                <select className={input} value={assignee} onChange={(e) => setAssignee(e.target.value)} aria-label={t("Pour qui")}>
                  <option value="">{t("Toute l'équipe")}</option>
                  {(team.data ?? []).map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <button onClick={save} disabled={busy || (!body.trim() && !remind)} className={`${button} mt-3 w-full`}>
              {t("Enregistrer")}
            </button>
            <div className="mt-3 flex gap-2">
              <input className={input} placeholder={t("Nouvelle étiquette")} value={tag} onChange={(e) => setTag(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addTag()} />
              <button onClick={addTag} className={buttonGhost} disabled={!tag.trim()}>
                {t("Ajouter")}
              </button>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
