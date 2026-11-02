"use client";

import { useState } from "react";
import { button, buttonGhost, Card, Empty, ErrorNote, input, Loading, PageHeader } from "@/components/panel/ui";
import { Icon } from "@/components/panel/icons";
import { formatTime } from "@/lib/admin";
import { restaurantFetch, ROLE_LABEL, type TeamMember } from "@/lib/restaurant";
import { useT } from "@/lib/i18n/client";
import { useRestaurant, useRestaurantAction } from "../useRestaurant";
import { useRestaurantRole } from "../RestaurantRole";

const ROLE_HELP: Record<TeamMember["role"], string> = {
  CASHIER: "Voit les commandes qui arrivent et en cours, les accepte, encaisse au comptoir et prévient le livreur. Pas de carte, de réglages, de relevés ni d'équipe.",
  MANAGER: "Gère le restaurant comme le gérant (commandes, carte, tables, horaires, relevés) et les caissières. Ne change pas le numéro, l'adresse ni le logo du restaurant.",
};

// Équipe du restaurant : le gérant ajoute caissières et manageuses, la manageuse ajoute des caissières.
export default function RestaurantTeamPage() {
  const { data, error, reload } = useRestaurant<TeamMember[]>("/team");
  const action = useRestaurantAction();
  const role = useRestaurantRole();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const t = useT();

  if (error) return <ErrorNote message={error} />;
  if (!data) return <Loading />;

  const owner = role === "OWNER";
  const canManage = (m: TeamMember) => owner || m.role === "CASHIER";
  const roles: TeamMember["role"][] = owner ? ["CASHIER", "MANAGER"] : ["CASHIER"];

  const save = (id: string | null, body: Record<string, unknown>) =>
    action.run(async () => {
      await restaurantFetch(id ? `/team/${id}` : "/team", { method: id ? "PATCH" : "POST", body });
      setAdding(false);
      setEditing(null);
      await reload();
    });
  const remove = (m: TeamMember) => {
    if (!window.confirm(t("Supprimer le compte de {name} ?", { name: m.name }))) return;
    action.run(async () => {
      await restaurantFetch(`/team/${m.id}`, { method: "DELETE" });
      await reload();
    });
  };

  const form = (m: TeamMember | null) => (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const password = String(f.get("password") ?? "");
        save(m?.id ?? null, {
          name: String(f.get("name")).trim(),
          email: String(f.get("email")).trim(),
          role: String(f.get("role")),
          ...(password || !m ? { password } : {}),
        });
      }}
      className="grid gap-3 sm:grid-cols-2"
    >
      <label className="text-sm">
        {t("Nom")}
        <input name="name" required minLength={2} defaultValue={m?.name} className={`${input} mt-1`} />
      </label>
      <label className="text-sm">
        {t("E-mail de connexion")}
        <input name="email" type="email" required defaultValue={m?.email} className={`${input} mt-1`} />
      </label>
      <label className="text-sm">
        {m ? t("Nouveau mot de passe (facultatif)") : t("Mot de passe")}
        <input name="password" type="password" required={!m} minLength={8} autoComplete="new-password" className={`${input} mt-1`} />
        <span className="mt-1 block text-xs text-stone-500">{t("8 caractères minimum, avec au moins une lettre et un chiffre.")}</span>
      </label>
      <label className="text-sm">
        {t("Rôle")}
        <select name="role" defaultValue={m?.role ?? "CASHIER"} className={`${input} mt-1`}>
          {roles.map((r) => (
            <option key={r} value={r}>
              {t(ROLE_LABEL[r])}
            </option>
          ))}
        </select>
      </label>
      <div className="flex gap-2 sm:col-span-2">
        <button className={button}>{m ? t("Enregistrer") : t("Ajouter")}</button>
        <button type="button" onClick={() => (m ? setEditing(null) : setAdding(false))} className={buttonGhost}>
          {t("Annuler")}
        </button>
      </div>
    </form>
  );

  return (
    <div className="space-y-4">
      <PageHeader
        icon="team"
        title="Équipe"
        count={data.length}
        description="Chaque membre se connecte à l'espace restaurant avec son e-mail et son mot de passe. Vous gardez seul l'accès complet du gérant."
        actions={
          !adding && (
            <button onClick={() => setAdding(true)} className={button}>
              <Icon name="plus" className="h-4 w-4" /> {t("Ajouter un membre")}
            </button>
          )
        }
      />
      <ErrorNote message={action.error} />

      {adding && (
        <Card title="Nouveau membre" icon="plus">
          {form(null)}
        </Card>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {roles.map((r) => (
          <div key={r} className="rounded-xl border border-stone-200 bg-white p-3 text-sm">
            <p className="font-semibold">{t(ROLE_LABEL[r])}</p>
            <p className="mt-1 text-stone-600">{t(ROLE_HELP[r])}</p>
          </div>
        ))}
      </div>

      {data.length === 0 ? (
        <Empty>{t("Aucun membre pour l'instant. Ajoutez vos caissières et votre manageuse.")}</Empty>
      ) : (
        <div className="space-y-2">
          {data.map((m) => (
            <Card key={m.id}>
              {editing === m.id ? (
                form(m)
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {m.name}{" "}
                      <span className="ml-1 rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-700">{t(ROLE_LABEL[m.role])}</span>
                      {!m.active && <span className="ml-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900">{t("Désactivé")}</span>}
                    </p>
                    <p className="truncate text-sm text-stone-600">{m.email}</p>
                    <p className="text-xs text-stone-500">{m.lastLoginAt ? t("Dernière connexion : {date}", { date: formatTime(m.lastLoginAt) }) : t("Jamais connecté")}</p>
                  </div>
                  {canManage(m) && (
                    <div className="flex flex-wrap gap-2">
                      <button onClick={() => setEditing(m.id)} className={buttonGhost}>
                        <Icon name="edit" className="h-4 w-4" /> {t("Modifier")}
                      </button>
                      <button onClick={() => save(m.id, { active: !m.active })} className={buttonGhost}>
                        {m.active ? t("Désactiver") : t("Réactiver")}
                      </button>
                      <button onClick={() => remove(m)} className={buttonGhost} aria-label={t("Supprimer")}>
                        <Icon name="trash" className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
