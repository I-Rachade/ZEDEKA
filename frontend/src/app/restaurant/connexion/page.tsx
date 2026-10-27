"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { button, Card, ErrorNote, input } from "@/components/panel/ui";
import { restaurantLogin } from "@/lib/restaurant";

export default function RestaurantLoginPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
      <Card title="Espace restaurant">
        <p className="mb-3 text-sm text-stone-600">Recevez vos commandes, gérez votre carte et vos horaires.</p>
        <form onSubmit={submit} className="space-y-3">
          <input name="email" type="email" required placeholder="E-mail" autoComplete="username" className={input} autoFocus />
          <input name="password" type="password" required placeholder="Mot de passe" autoComplete="current-password" className={input} />
          <ErrorNote message={error} />
          <button disabled={busy} className={`${button} w-full`}>
            {busy ? "Connexion…" : "Se connecter"}
          </button>
        </form>
        <p className="mt-3 text-xs text-stone-500">Pas encore d&apos;accès ? Demandez-le à l&apos;équipe Zedeka.</p>
      </Card>
    </div>
  );
}
