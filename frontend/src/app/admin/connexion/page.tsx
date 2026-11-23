"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { login, requestPasswordCode, resetPassword } from "@/lib/admin";
import { LanguageSwitch, useT } from "@/lib/i18n/client";
import { button, Card, ErrorNote, input } from "../ui";

// Chaque membre de l'équipe se connecte avec son adresse. Le mot de passe de secours (ADMIN_PASSWORD) n'est
// plus proposé à l'écran : il ne s'ouvre qu'en tapant soi-même l'adresse /admin/connexion#secours.
// « Mot de passe oublié ? » : un code part par e-mail à l'adresse du compte, puis le membre choisit un nouveau mot de passe.
type Mode = "login" | "forgot" | "reset";

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const t = useT();
  const [master, setMaster] = useState(false);
  // Arrivée depuis l'écran « Vous avez été déconnecté » : on rappelle pourquoi.
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    setTimedOut(new URLSearchParams(window.location.search).get("raison") === "inactivite");
  }, []);
  useEffect(() => {
    const sync = () => setMaster(window.location.hash === "#secours");
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function go(next: Mode) {
    setMode(next);
    setError(null);
    setInfo(null);
  }

  function submitLogin(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    void run(async () => {
      await login(String(f.get("password") ?? ""), master ? undefined : String(f.get("email") ?? ""));
      router.replace("/admin");
    });
  }

  function submitForgot(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const address = String(new FormData(e.currentTarget).get("email") ?? "").trim();
    void run(async () => {
      const sent = await requestPasswordCode(address);
      setEmail(address);
      setMode("reset");
      setInfo(
        sent.devCode
          ? t("Mode test : votre code est {code}", { code: sent.devCode })
          : t("Si un compte existe à cette adresse, un code à 6 chiffres vient d'y être envoyé. Il est valable {minutes} minutes.", { minutes: String(sent.expiresInMinutes ?? 15) }),
      );
    });
  }

  function submitReset(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const password = String(f.get("password") ?? "");
    if (password !== String(f.get("confirm") ?? "")) {
      setError(t("Les deux mots de passe ne sont pas identiques"));
      return;
    }
    void run(async () => {
      await resetPassword(email, String(f.get("code") ?? ""), password);
      await login(password, email);
      router.replace("/admin");
    });
  }

  const link = "text-sm text-gray-600 underline hover:text-gray-900";

  return (
    <div className="mx-auto max-w-sm pt-6">
      <Card title={mode === "login" ? "Espace admin" : t("Mot de passe oublié")} action={<LanguageSwitch />}>
        {mode === "login" && (
          <form onSubmit={submitLogin} className="space-y-3">
            {timedOut && (
              <p role="status" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
                {t("Vous avez été déconnecté pour inactivité. Reconnectez-vous pour continuer.")}
              </p>
            )}
            {!master && <input name="email" type="email" required autoComplete="username" placeholder={t("Adresse e-mail")} aria-label={t("Adresse e-mail")} className={input} autoFocus />}
            <input
              name="password"
              type="password"
              required
              autoComplete="current-password"
              placeholder={t("Mot de passe")}
              aria-label={t("Mot de passe")}
              className={input}
              autoFocus={master}
            />
            <ErrorNote message={error} />
            <button disabled={busy} className={`${button} w-full`}>
              {busy ? t("Connexion…") : t("Se connecter")}
            </button>
            {!master && (
              <button type="button" onClick={() => go("forgot")} className={link}>
                {t("Mot de passe oublié ?")}
              </button>
            )}
          </form>
        )}

        {mode === "forgot" && (
          <form onSubmit={submitForgot} className="space-y-3">
            <p className="text-sm text-gray-600">{t("Entrez l'adresse e-mail de votre compte. Nous y enverrons un code pour choisir un nouveau mot de passe.")}</p>
            <input name="email" type="email" required autoComplete="username" defaultValue={email} placeholder={t("Adresse e-mail")} aria-label={t("Adresse e-mail")} className={input} autoFocus />
            <ErrorNote message={error} />
            <button disabled={busy} className={`${button} w-full`}>
              {busy ? t("Envoi…") : t("Recevoir un code")}
            </button>
            <button type="button" onClick={() => go("login")} className={link}>
              {t("Retour à la connexion")}
            </button>
          </form>
        )}

        {mode === "reset" && (
          <form onSubmit={submitReset} className="space-y-3">
            {info && <p className="text-sm text-gray-600">{info}</p>}
            <input name="code" inputMode="numeric" pattern="\d{6}" maxLength={6} required autoComplete="one-time-code" placeholder={t("Code à 6 chiffres")} aria-label={t("Code à 6 chiffres")} className={input} autoFocus />
            <input name="password" type="password" required minLength={10} autoComplete="new-password" placeholder={t("Nouveau mot de passe (10 caractères minimum)")} aria-label={t("Nouveau mot de passe")} className={input} />
            <input name="confirm" type="password" required minLength={10} autoComplete="new-password" placeholder={t("Confirmer le mot de passe")} aria-label={t("Confirmer le mot de passe")} className={input} />
            <ErrorNote message={error} />
            <button disabled={busy} className={`${button} w-full`}>
              {busy ? t("Enregistrement…") : t("Changer le mot de passe")}
            </button>
            <div className="flex justify-between">
              <button type="button" onClick={() => go("forgot")} className={link}>
                {t("Renvoyer un code")}
              </button>
              <button type="button" onClick={() => go("login")} className={link}>
                {t("Retour à la connexion")}
              </button>
            </div>
          </form>
        )}
      </Card>
    </div>
  );
}
