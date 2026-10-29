"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { login } from "@/lib/admin";
import { LanguageSwitch, useT } from "@/lib/i18n/client";
import { button, Card, ErrorNote, input } from "../ui";

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const t = useT();

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    try {
      await login(String(new FormData(e.currentTarget).get("password") ?? ""));
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
          <input name="password" type="password" required placeholder={t("Mot de passe")} className={input} autoFocus />
          <ErrorNote message={error} />
          <button disabled={busy} className={`${button} w-full`}>
            {busy ? t("Connexion…") : t("Se connecter")}
          </button>
        </form>
      </Card>
    </div>
  );
}
