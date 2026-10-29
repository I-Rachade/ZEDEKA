"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { InstallPrompt } from "@/components/AppRuntime";
import { API_URL } from "@/lib/api";
import { useT } from "@/lib/i18n/client";
import { Icon } from "./icons";
import { usePush, type PartnerClient } from "./partner";
import { button, buttonGhost, Card, ErrorNote, input, PageHeader } from "./ui";

// « Mon compte » d'un partenaire : identité, mot de passe, alertes, application, sessions.
export function AccountPage({ api, name, email, phone, what }: { api: PartnerClient; name: string; email: string | null; phone: string; what: string }) {
  const router = useRouter();
  const push = usePush(api);
  const t = useT();
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwDone, setPwDone] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  async function changePassword(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    setPwError(null);
    setPwDone(false);
    if (f.get("password") !== f.get("confirm")) {
      setPwError("Les deux mots de passe ne correspondent pas");
      return;
    }
    try {
      const r = await api.apiFetch<{ token: string }>("/password", { method: "POST", body: { current: f.get("current"), password: f.get("password") } });
      api.saveSession(r.token);
      form.reset();
      setPwDone(true);
    } catch (err) {
      setPwError((err as Error).message);
    }
  }

  async function logoutEverywhere() {
    if (!window.confirm(t("Se déconnecter sur tous les appareils, y compris celui-ci ? Les alertes seront aussi désactivées."))) return;
    await api.apiFetch("/sessions/logout-all", { method: "POST" }).catch(() => {});
    api.logout();
    router.replace(`${api.base}/connexion`);
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Mon compte" icon="user" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Compte" icon="user">
          <dl className="space-y-2 text-sm">
            <div>
              <dt className="text-stone-500">{t("Nom")}</dt>
              <dd className="font-medium">{name}</dd>
            </div>
            <div>
              <dt className="text-stone-500">{t("E-mail de connexion")}</dt>
              <dd className="font-medium">{email ?? "–"}</dd>
            </div>
            <div>
              <dt className="text-stone-500">{t("Téléphone (reçoit les codes et les relances)")}</dt>
              <dd className="font-medium">{phone}</dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-stone-500">{t("Pour changer l'e-mail, écrivez à l'équipe Zedeka. Le téléphone se change dans les réglages.")}</p>
        </Card>

        <Card title="Alertes" icon="bell">
          <p className="text-sm text-stone-600">{t("Une notification avec sonnerie pour chaque {what}, même écran verrouillé ou page fermée.", { what: t(what) })}</p>
          <p className="mt-2 text-sm">
            {t("Sur cet appareil :")}{" "}
            <strong>
              {t(push.state === "on" ? "activées" : push.state === "denied" ? "bloquées par le navigateur" : push.state === "unsupported" ? "non prises en charge" : push.state === "loading" ? "…" : "désactivées")}
            </strong>
            {push.devices !== null && <span className="text-stone-500"> · {t("{n} appareil(s) abonné(s)", { n: push.devices })}</span>}
          </p>
          {push.state === "denied" && <p className="mt-2 text-xs text-stone-500">{t("Autorisez les notifications pour ce site dans les réglages du navigateur, puis revenez ici.")}</p>}
          {push.state === "unsupported" && <p className="mt-2 text-xs text-stone-500">{t("Sur iPhone, ajoutez d'abord l'espace à l'écran d'accueil, puis ouvrez-le depuis l'icône.")}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            {push.state === "off" && (
              <button onClick={push.enable} className={button}>
                {t("Activer sur cet appareil")}
              </button>
            )}
            {push.state === "on" && (
              <>
                <button
                  onClick={() =>
                    push.test().then(
                      (r) => setTestResult(r.sent ? t("Notification envoyée.") : t("Aucun appareil n'a reçu la notification.")),
                      (e: Error) => setTestResult(e.message),
                    )
                  }
                  className={button}
                >
                  {t("Envoyer un test")}
                </button>
                <button onClick={push.disable} className={buttonGhost}>
                  {t("Désactiver ici")}
                </button>
              </>
            )}
          </div>
          {testResult && <p className="mt-2 text-sm text-stone-600">{testResult}</p>}
        </Card>

        <Card title="Mot de passe" icon="settings">
          <form onSubmit={changePassword} className="space-y-2">
            <input name="current" type="password" required placeholder={t("Mot de passe actuel")} autoComplete="current-password" className={input} />
            <input name="password" type="password" required minLength={8} placeholder={t("Nouveau mot de passe (8 caractères, lettres et chiffres)")} autoComplete="new-password" className={input} />
            <input name="confirm" type="password" required placeholder={t("Confirmer le nouveau mot de passe")} autoComplete="new-password" className={input} />
            <ErrorNote message={pwError} />
            {pwDone && <p className="text-sm text-emerald-700">{t("Mot de passe changé. Les autres appareils devront se reconnecter.")}</p>}
            <button className={button}>{t("Changer le mot de passe")}</button>
          </form>
        </Card>

        <Card title="Application" icon="download">
          <p className="mb-3 text-sm text-stone-600">{t("Installez l'espace sur la tablette ou le téléphone de la caisse : il s'ouvre en plein écran et l'écran reste allumé.")}</p>
          <InstallPrompt always />
          <button onClick={logoutEverywhere} className={`${buttonGhost} mt-4 w-full text-red-700`}>
            <Icon name="logout" className="h-4 w-4" /> {t("Se déconnecter partout")}
          </button>
        </Card>
      </div>
    </div>
  );
}

// Mot de passe oublié : code par SMS au numéro du compte, valable 15 minutes.
export function ForgotPassword({ area, base, saveSession }: { area: string; base: string; saveSession: (token: string, name?: string) => void }) {
  const router = useRouter();
  const t = useT();
  const [email, setEmail] = useState<string | null>(null);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${API_URL}/api/${area}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? "La demande n'a pas abouti");
    return data as T;
  }

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-sm pt-6">
      <Card title="Mot de passe oublié">
        {!email ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const value = String(new FormData(e.currentTarget).get("email") ?? "");
              run(async () => {
                const r = await post<{ devCode?: string }>("/password/forgot", { email: value });
                setDevCode(r.devCode ?? null);
                setEmail(value);
              });
            }}
            className="space-y-3"
          >
            <p className="text-sm text-stone-600">{t("Indiquez l'e-mail de connexion. Un code à 6 chiffres est envoyé par SMS au numéro du compte.")}</p>
            <input name="email" type="email" required placeholder={t("E-mail")} autoComplete="username" className={input} autoFocus />
            <ErrorNote message={error} />
            <button disabled={busy} className={`${button} w-full`}>
              {busy ? t("Envoi…") : t("Recevoir un code")}
            </button>
          </form>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              run(async () => {
                if (f.get("password") !== f.get("confirm")) throw new Error("Les deux mots de passe ne correspondent pas");
                const r = await post<{ token: string; name: string }>("/password/reset", { email, code: f.get("code"), password: f.get("password") });
                saveSession(r.token, r.name);
                router.replace(base);
              });
            }}
            className="space-y-3"
          >
            <p className="text-sm text-stone-600">{t("Si un compte correspond à {email}, un code vient d'être envoyé. Il est valable 15 minutes.", { email })}</p>
            {devCode && (
              <p className="rounded-lg bg-amber-50 p-2 text-sm text-amber-900">
                {t("Mode test, aucun SMS n'est envoyé. Code :")} <strong className="font-mono">{devCode}</strong>
              </p>
            )}
            <input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" required placeholder={t("Code à 6 chiffres")} className={input} autoFocus />
            <input name="password" type="password" required minLength={8} placeholder={t("Nouveau mot de passe")} autoComplete="new-password" className={input} />
            <input name="confirm" type="password" required placeholder={t("Confirmer")} autoComplete="new-password" className={input} />
            <ErrorNote message={error} />
            <button disabled={busy} className={`${button} w-full`}>
              {busy ? t("Vérification…") : t("Changer et se connecter")}
            </button>
          </form>
        )}
        <Link href={`${base}/connexion`} className="mt-3 block text-center text-sm text-emerald-700 underline">
          {t("Retour à la connexion")}
        </Link>
      </Card>
    </div>
  );
}
