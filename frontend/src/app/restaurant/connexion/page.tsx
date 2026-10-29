"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { button, Card, ErrorNote, input } from "@/components/panel/ui";
import { restaurantLogin } from "@/lib/restaurant";
import { LanguageSwitch, useT } from "@/lib/i18n/client";

export default function RestaurantLoginPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const t = useT();

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    try {
      await restaurantLogin(String(f.get("email") ?? ""), String(f.get("password") ?? ""));
      router.replace("/restaurant");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-sm pt-6">
      <Card title="Espace restaurant" action={<LanguageSwitch />}>
        <p className="mb-3 text-sm text-stone-600">{t("Recevez vos commandes, gérez votre carte et vos horaires.")}</p>
        <form onSubmit={submit} className="space-y-3">
          <input name="email" type="email" required placeholder={t("E-mail")} autoComplete="username" className={input} autoFocus />
          <input name="password" type="password" required placeholder={t("Mot de passe")} autoComplete="current-password" className={input} />
          <ErrorNote message={error} />
          <button disabled={busy} className={`${button} w-full`}>
            {busy ? t("Connexion…") : t("Se connecter")}
          </button>
        </form>
        <Link href="/restaurant/mot-de-passe" className="mt-3 block text-center text-sm text-emerald-700 underline">
          {t("Mot de passe oublié ?")}
        </Link>
        <p className="mt-3 text-xs text-stone-500">{t("Pas encore d'accès ? Demandez-le à l'équipe Zedeka.")}</p>
      </Card>
    </div>
  );
}
