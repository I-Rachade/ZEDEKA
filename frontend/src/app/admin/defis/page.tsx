"use client";

import { useState } from "react";
import { adminFetch } from "@/lib/admin";
import { fcfa } from "@/lib/api";
import { useI18n } from "@/lib/i18n/client";
import { button, buttonGhost, Card, Empty, ErrorNote, input, Loading, PageHeader } from "../ui";
import { useAction, useAdmin } from "../useAdmin";

// Défis des livreurs : un nombre de livraisons à faire sur une période et une prime. Le livreur suit sa progression
// dans son appli (« Mes défis ») ; l'équipe verse la prime à ceux qui ont atteint l'objectif et la note ici.

type Challenge = { id: string; title: string; target: number; reward: number; startsAt: string; endsAt: string; active: boolean; live: boolean; ended: boolean; reached: number; paid: number };
type Board = Challenge & { board: { id: string; name: string; phone: string; done: number; reached: boolean; paidAt: string | null; paidBy: string | null }[] };

// Jours entiers à l'heure de Lomé (UTC) : fin incluse.
const startOf = (d: string) => new Date(`${d}T00:00:00Z`).toISOString();
const endOf = (d: string) => new Date(new Date(`${d}T00:00:00Z`).getTime() + 86_400_000).toISOString();
const today = () => new Date().toISOString().slice(0, 10);
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

function Leaderboard({ id }: { id: string }) {
  const { t, locale } = useI18n();
  const { data, error, reload } = useAdmin<Board>(`/challenges/${id}`);
  const action = useAction();
  if (error) return <ErrorNote message={error} />;
  if (!data) return <Loading />;
  if (data.board.length === 0) return <Empty>Aucune livraison pendant ce défi pour le moment.</Empty>;
  return (
    <>
      <ul className="divide-y divide-stone-100 text-sm">
        {data.board.map((d, i) => (
          <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span>
              {i + 1}. <span className="font-semibold">{d.name}</span> · {d.phone}
              <span className="block text-xs text-stone-500">
                {d.done} / {data.target}
              </span>
            </span>
            {d.paidAt ? (
              <span className="text-xs text-emerald-700">{t("Prime versée le {date}", { date: new Date(d.paidAt).toLocaleDateString(locale) })}</span>
            ) : d.reached ? (
              <button
                type="button"
                className={button}
                onClick={() =>
                  action.run(async () => {
                    await adminFetch(`/challenges/${id}/rewards`, { method: "POST", body: { driverId: d.id } });
                    await reload();
                  })
                }
              >
                {t("Prime de {amount} versée", { amount: fcfa(data.reward) })}
              </button>
            ) : (
              <span className="text-xs text-stone-500">{t("Encore {n}", { n: data.target - d.done })}</span>
            )}
          </li>
        ))}
      </ul>
      <ErrorNote message={action.error} />
    </>
  );
}

export default function ChallengesAdminPage() {
  const { t, locale } = useI18n();
  const { data, error, reload } = useAdmin<Challenge[]>("/challenges");
  const action = useAction();
  const [open, setOpen] = useState<string | null>(null);
  const [form, setForm] = useState({ title: "", target: 50, reward: 5000, from: today(), to: inDays(6) });
  if (error) return <ErrorNote message={error} />;
  if (!data) return <Loading />;
  const day = (iso: string) => new Date(iso).toLocaleDateString(locale, { day: "numeric", month: "short", timeZone: "UTC" });

  return (
    <div className="space-y-4">
      <PageHeader icon="chart" title="Défis livreurs" description="Objectifs de livraisons sur une période, avec une prime versée par l'équipe. Les livreurs suivent leur progression dans « Mes défis »." />
      <Card title="Nouveau défi">
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const ok = await action.run(async () => {
              await adminFetch("/challenges", { method: "POST", body: { title: form.title, target: form.target, reward: form.reward, startsAt: startOf(form.from), endsAt: endOf(form.to) } });
              await reload();
            });
            if (ok) setForm((f) => ({ ...f, title: "" }));
          }}
          className="grid gap-3 text-sm sm:grid-cols-2"
        >
          <label className="sm:col-span-2">
            <span className="block font-medium">{t("Titre")}</span>
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required minLength={3} maxLength={80} placeholder={t("ex. 50 livraisons cette semaine")} className={input} />
          </label>
          <label>
            <span className="block font-medium">{t("Livraisons à faire")}</span>
            <input type="number" min={1} max={10000} value={form.target} onChange={(e) => setForm({ ...form, target: Number(e.target.value) })} className={input} />
          </label>
          <label>
            <span className="block font-medium">{t("Prime (FCFA)")}</span>
            <input type="number" min={0} max={10000000} value={form.reward} onChange={(e) => setForm({ ...form, reward: Number(e.target.value) })} className={input} />
          </label>
          <label>
            <span className="block font-medium">{t("Du")}</span>
            <input type="date" value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} className={input} />
          </label>
          <label>
            <span className="block font-medium">{t("Au (inclus)")}</span>
            <input type="date" value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} className={input} />
          </label>
          <div className="sm:col-span-2">
            <button className={button}>{t("Lancer le défi")}</button>
          </div>
        </form>
        <ErrorNote message={action.error} />
      </Card>

      <Card title="Défis">
        {data.length === 0 ? (
          <Empty>Aucun défi pour le moment.</Empty>
        ) : (
          <ul className="divide-y divide-stone-100">
            {data.map((c) => (
              <li key={c.id} className="space-y-2 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    <span className="font-semibold">{c.title}</span>
                    <span className={`ml-2 rounded-full px-2 py-0.5 text-xs ${c.live ? "bg-emerald-100 text-emerald-800" : !c.active ? "bg-stone-200 text-stone-600" : c.ended ? "bg-stone-200 text-stone-700" : "bg-amber-100 text-amber-900"}`}>
                      {c.live ? t("En cours") : !c.active ? t("Masqué") : c.ended ? t("Terminé") : t("Programmé")}
                    </span>
                    <span className="block text-sm text-stone-600">
                      {t("{target} livraisons, prime {reward}", { target: c.target, reward: fcfa(c.reward) })} · {day(c.startsAt)} – {day(new Date(new Date(c.endsAt).getTime() - 1).toISOString())} ·{" "}
                      {t("{reached} objectif(s) atteint(s), {paid} prime(s) versée(s)", { reached: c.reached, paid: c.paid })}
                    </span>
                  </span>
                  <span className="flex gap-2">
                    <button type="button" className={buttonGhost} onClick={() => setOpen(open === c.id ? null : c.id)}>
                      {open === c.id ? t("Fermer") : t("Classement")}
                    </button>
                    <button
                      type="button"
                      className={buttonGhost}
                      onClick={() =>
                        action.run(async () => {
                          await adminFetch(`/challenges/${c.id}`, { method: "PATCH", body: { active: !c.active } });
                          await reload();
                        })
                      }
                    >
                      {c.active ? t("Masquer") : t("Afficher")}
                    </button>
                  </span>
                </div>
                {open === c.id && <Leaderboard id={c.id} />}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
