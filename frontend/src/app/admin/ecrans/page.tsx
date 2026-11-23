"use client";

import { useEffect, useState } from "react";
import { adminFetch } from "@/lib/admin";
import { useT } from "@/lib/i18n/client";
import { button, buttonGhost, Card, DirectorEdits, Empty, ErrorNote, input, Loading, PageHeader } from "../ui";
import { useAction, useAdmin } from "../useAdmin";

type Screen = { id: string; name: string; keyHint: string; createdBy: string | null; createdAt: string; lastSeenAt: string | null; revokedAt: string | null };
type Data = { screens: Screen[]; goal: number };

// Écran du bureau : brancher un moniteur (télé, PC, tablette ou Raspberry Pi, tout appareil avec un navigateur) et
// régler l'objectif de livraisons du jour. On ouvre /ecran sur l'appareil, il affiche un code : on le tape ici.
// Ancien moyen gardé : un lien qui contient la clé, montré une seule fois à la création.
export default function ScreensPage() {
  const t = useT();
  const { data, error, reload } = useAdmin<Data>("/screens");
  const action = useAction();
  const [name, setName] = useState("");
  const [created, setCreated] = useState<{ name: string; url: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [goal, setGoal] = useState("");
  const [pairCode, setPairCode] = useState("");
  const [pairName, setPairName] = useState("");
  const [pairedName, setPairedName] = useState<string | null>(null);

  useEffect(() => {
    if (data) setGoal(data.goal ? String(data.goal) : "");
  }, [data]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await action.run(async () => {
      const res = await adminFetch<{ url: string; screen: Screen }>("/screens", { method: "POST", body: { name } });
      setCreated({ name: res.screen.name, url: res.url });
      setCopied(false);
      setName("");
    });
    if (ok) reload();
  };

  const pair = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await action.run(async () => {
      const res = await adminFetch<{ screen: Screen }>("/screens/pair", { method: "POST", body: { code: pairCode, name: pairName } });
      setPairedName(res.screen.name);
      setPairCode("");
      setPairName("");
    });
    if (ok) reload();
  };

  const revoke = async (s: Screen) => {
    if (!window.confirm(t("Débrancher « {name} » ? L'écran s'arrêtera dans les 30 secondes et affichera un nouveau code.", { name: s.name }))) return;
    if (await action.run(() => adminFetch(`/screens/${s.id}`, { method: "DELETE" }))) reload();
  };

  const saveGoal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (await action.run(() => adminFetch("/screens/goal", { method: "PUT", body: { goal: Number(goal) || 0 } }))) reload();
  };

  const copy = async () => {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const ago = (iso: string | null) => {
    if (!iso) return t("jamais");
    const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
    if (min < 10) return t("en ligne");
    if (min < 60) return t("il y a {n} min", { n: min });
    if (min < 48 * 60) return t("il y a {n} h", { n: Math.round(min / 60) });
    return t("il y a {n} j", { n: Math.round(min / 1440) });
  };

  return (
    <div className="space-y-4">
      <PageHeader
        icon="chart"
        title="Écran du bureau"
        description="Un grand moniteur au bureau (télé, ordinateur, tablette ou Raspberry Pi, tout appareil avec un navigateur) : livraisons du jour en direct, objectif, record, classement des livreurs et carte du terrain. Accès en lecture seule, sans numéro ni adresse de client."
      />
      <ErrorNote message={action.error ?? (data ? null : error)} />
      {!data ? (
        !error && <Loading />
      ) : (
        <DirectorEdits>
          {created && (
            <Card title="Lien du nouvel écran" icon="lock">
              <p className="text-sm text-stone-700">
                {t("Ouvrez ce lien une fois sur l'appareil de « {name} ». Il n'est montré qu'une seule fois.", { name: created.name })}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <input readOnly value={created.url} className={`${input} min-w-0 flex-1 font-mono text-xs`} onFocus={(e) => e.currentTarget.select()} aria-label={t("Lien de l'écran")} />
                <button type="button" onClick={copy} className={button}>
                  {copied ? t("Copié") : t("Copier")}
                </button>
                <a href={created.url} target="_blank" rel="noopener" className={buttonGhost}>
                  {t("Aperçu")}
                </a>
              </div>
              <p className="mt-2 text-xs text-stone-500">{t("Réglages possibles à la fin du lien : &vue=compteur ou &vue=carte (sinon rotation), &duree=40 (secondes par écran), &son=0 (muet).")}</p>
            </Card>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Brancher un écran" icon="plus">
              <p className="text-sm text-stone-700">
                {t("Sur la télé, l'ordinateur ou la tablette, ouvrez {url} dans le navigateur : un code à 6 chiffres s'affiche. Tapez-le ici.", {
                  url: `${typeof window === "undefined" ? "" : window.location.host}/ecran`,
                })}
              </p>
              <form onSubmit={pair} className="mt-3 flex flex-wrap gap-2">
                <input
                  value={pairCode}
                  onChange={(e) => setPairCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="123456"
                  required
                  className={`${input} w-32 font-mono text-lg tracking-widest`}
                  aria-label={t("Code affiché sur l'écran")}
                />
                <input value={pairName} onChange={(e) => setPairName(e.target.value)} placeholder={t("Ex. : Télé de l'accueil")} maxLength={60} required className={`${input} min-w-0 flex-1`} aria-label={t("Nom de l'écran")} />
                <button className={button} disabled={pairCode.length !== 6}>
                  {t("Brancher")}
                </button>
              </form>
              <p className="mt-2 text-xs text-stone-500">{t("Réglages : ouvrez /ecran?vue=compteur ou /ecran?vue=carte (sinon rotation), ajoutez &duree=60 (secondes par écran) ou &son=0 (muet).")}</p>
              {pairedName && <p className="mt-2 text-sm font-semibold text-emerald-700">{t("« {name} » est branché : il démarre dans quelques secondes.", { name: pairedName })}</p>}
              <details className="mt-3 text-sm">
                <summary className="cursor-pointer text-stone-500">{t("Sans code : créer un lien à ouvrir sur l'appareil")}</summary>
                <form onSubmit={create} className="mt-2 flex flex-wrap gap-2">
                  <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("Ex. : Grand écran du bureau")} maxLength={60} required className={`${input} min-w-0 flex-1`} aria-label={t("Nom de l'écran (lien)")} />
                  <button className={buttonGhost}>{t("Créer le lien")}</button>
                </form>
              </details>
            </Card>
            <Card title="Objectif du jour" icon="fire">
              <form onSubmit={saveGoal} className="flex flex-wrap items-center gap-2">
                <input value={goal} onChange={(e) => setGoal(e.target.value.replace(/\D/g, ""))} inputMode="numeric" placeholder={t("Automatique")} className={`${input} w-40`} aria-label={t("Objectif de livraisons")} />
                <button className={button}>{t("Enregistrer")}</button>
              </form>
              <p className="mt-2 text-xs text-stone-500">{t("Vide : calculé chaque jour (moyenne des 7 derniers jours + 10 %). L'écran fait la fête toutes les 10 livraisons, à l'objectif et au record.")}</p>
            </Card>
          </div>

          <Card title="Écrans" icon="grid">
            {data.screens.length === 0 ? (
              <Empty>Aucun écran pour l&apos;instant.</Empty>
            ) : (
              <ul className="divide-y divide-stone-100 text-sm">
                {data.screens.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span className="min-w-0">
                      <span className="font-semibold">{s.name}</span>
                      <span className="ml-2 font-mono text-xs text-stone-500">…{s.keyHint}</span>
                      <span className="block text-xs text-stone-500">
                        {s.revokedAt ? t("Débranché") : t("Dernier signal : {when}", { when: ago(s.lastSeenAt) })}
                        {s.createdBy ? ` · ${t("créé par {name}", { name: s.createdBy })}` : ""}
                      </span>
                    </span>
                    {!s.revokedAt && (
                      <button type="button" onClick={() => revoke(s)} className="text-sm font-semibold text-red-700 hover:underline">
                        {t("Débrancher")}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </DirectorEdits>
      )}
    </div>
  );
}
