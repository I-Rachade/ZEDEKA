"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { login } from "@/lib/admin";
import { LanguageSwitch, useT } from "@/lib/i18n/client";
import { button, Card, ErrorNote, input } from "../ui";

// Chaque membre de l'équipe se connecte avec son adresse. Le mot de passe de secours (ADMIN_PASSWORD) n'est
// plus proposé à l'écran : il ne s'ouvre qu'en tapant soi-même l'adresse /admin/connexion#secours.
export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const t = useT();
  const [master, setMaster] = useState(false);
  useEffect(() => {
    const sync = () => setMaster(window.location.hash === "#secours");
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    try {
      await login(String(f.get("password") ?? ""), master ? undefined : String(f.get("email") ?? ""));
      router.replace("/admin");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-sm pt-6">
      <Card title="Espace admin" action={<LanguageSwitch />}>
        <form onSubmit={submit} className="space-y-3">
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
        </form>
      </Card>
    </div>
  );
}
