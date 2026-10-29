"use client";

import { useState } from "react";
import { adminFetch, ROLE_LABEL, useStaff, type TeamMember, type TeamRole } from "@/lib/admin";
import { button, buttonGhost, Card, ErrorNote, input, Loading, PageHeader } from "../ui";
import { useAction, useAdmin } from "../useAdmin";
import { currentLang, dateLocale, type T } from "@/lib/i18n";
import { useT } from "@/lib/i18n/client";

const ROLE_HINT: Record<TeamRole, string> = {
  DIRECTOR: "Tout l'admin : finances, rapport, réglages, restaurants et équipe.",
  DISPATCHER: "Commandes, répartition et disponibilité des livreurs. Ni montants, ni salaires, ni réglages.",
};

const lastLogin = (d: string | null, t: T) =>
  d
    ? t("Dernière connexion le {date}", {
        date: new Date(d).toLocaleString(dateLocale(currentLang()), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lome" }),
      })
    : t("Jamais connecté");

// Comptes de l'équipe Zedeka : chacun se connecte avec son adresse, et chaque course attribuée porte son nom.
export default function TeamPage() {
  const { data, error, reload } = useAdmin<TeamMember[]>("/team");
  const me = useStaff();
  const action = useAction();
  const [resetFor, setResetFor] = useState<string | null>(null);
  const t = useT();

  const patch = (id: string, body: Partial<TeamMember> & { password?: string }) =>
    action.run(async () => {
      await adminFetch(`/team/${id}`, { method: "PATCH", body });
      await reload();
    });

  return (
    <div className="space-y-4">
      <PageHeader icon="user" title="Équipe" description="Un compte par personne de l'équipe Zedeka, avec son rôle. Le nom du membre apparaît sur chaque course qu'il attribue." />
      <ErrorNote message={action.error ?? error} />
      {!data ? (
        <Loading />
      ) : (
        <>
          <Card title="Membres">
            {data.length === 0 && <p className="text-sm text-stone-500">{t("Aucun compte pour l'instant : l'admin s'ouvre seulement avec le mot de passe du directeur.")}</p>}
            <ul className="divide-y divide-stone-100">
              {data.map((m) => (
                <li key={m.id} className={`space-y-2 py-3 ${m.active ? "" : "opacity-60"}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-medium">
                        {m.name}
                        <span className={`ml-2 rounded-full px-2 py-0.5 text-xs font-medium ${m.role === "DIRECTOR" ? "bg-emerald-50 text-emerald-800" : "bg-stone-100 text-stone-600"}`}>
                          {t(ROLE_LABEL[m.role])}
                        </span>
                        {!m.active && <span className="ml-1 text-xs text-stone-500">{t("désactivé")}</span>}
                      </p>
                      <p className="text-sm text-stone-500">
                        {m.email} · {lastLogin(m.lastLoginAt, t)}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      <select
                        aria-label={t("Rôle de {name}", { name: m.name })}
                        value={m.role}
                        disabled={m.id === me?.id}
                        onChange={(e) => patch(m.id, { role: e.target.value as TeamRole })}
                        className={`${input} w-auto`}
                      >
                        {Object.entries(ROLE_LABEL).map(([v, label]) => (
                          <option key={v} value={v}>
                            {t(label)}
                          </option>
                        ))}
                      </select>
                      <button onClick={() => setResetFor(resetFor === m.id ? null : m.id)} className={buttonGhost}>
                        {t("Mot de passe")}
                      </button>
                      <button onClick={() => patch(m.id, { active: !m.active })} disabled={m.id === me?.id} className={buttonGhost}>
                        {m.active ? t("Désactiver") : t("Réactiver")}
                      </button>
                    </div>
                  </div>
                  {resetFor === m.id && (
                    <form
                      onSubmit={async (e) => {
                        e.preventDefault();
                        const password = String(new FormData(e.currentTarget).get("password") ?? "");
                        if (await patch(m.id, { password })) setResetFor(null);
                      }}
                      className="flex gap-2"
                    >
                      <input name="password" type="password" required minLength={10} placeholder={t("Nouveau mot de passe (10 caractères minimum)")} aria-label={t("Nouveau mot de passe de {name}", { name: m.name })} className={input} />
                      <button className={button}>{t("Enregistrer")}</button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          </Card>

          <Card title="Ajouter un membre">
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const form = e.currentTarget;
                const f = new FormData(form);
                const ok = await action.run(async () => {
                  await adminFetch("/team", { method: "POST", body: { name: f.get("name"), email: f.get("email"), password: f.get("password"), role: f.get("role") } });
                  await reload();
                });
                if (ok) form.reset();
              }}
              className="grid gap-2 sm:grid-cols-2"
            >
              <input name="name" required minLength={2} placeholder={t("Nom")} aria-label={t("Nom")} className={input} />
              <input name="email" type="email" required placeholder={t("Adresse e-mail")} aria-label={t("Adresse e-mail")} className={input} />
              <input name="password" type="password" required minLength={10} placeholder={t("Mot de passe (10 caractères minimum)")} aria-label={t("Mot de passe")} className={input} />
              <select name="role" defaultValue="DISPATCHER" aria-label={t("Rôle")} className={input}>
                {Object.entries(ROLE_LABEL).map(([v, label]) => (
                  <option key={v} value={v}>
                    {t(label)}
                  </option>
                ))}
              </select>
              <ul className="space-y-1 text-xs text-stone-500 sm:col-span-2">
                {Object.entries(ROLE_HINT).map(([r, hint]) => (
                  <li key={r}>
                    <strong>{t(ROLE_LABEL[r as TeamRole])}</strong> : {t(hint)}
                  </li>
                ))}
                <li>{t("En ligne, l'adresse doit aussi être autorisée dans Cloudflare Access (voir le guide de déploiement).")}</li>
              </ul>
              <button className={`${button} sm:col-span-2`}>{t("Créer le compte")}</button>
            </form>
          </Card>
        </>
      )}
    </div>
  );
}
