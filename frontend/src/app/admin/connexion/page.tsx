"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { login } from "@/lib/admin";
import { button, Card, ErrorNote, input } from "../ui";

// Chaque membre de l'équipe se connecte avec son adresse ; le mot de passe du directeur reste utilisable seul.
export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [master, setMaster] = useState(false);

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
      <Card title="Espace admin">
        <form onSubmit={submit} className="space-y-3">
          {!master && <input name="email" type="email" required autoComplete="username" placeholder="Adresse e-mail" aria-label="Adresse e-mail" className={input} autoFocus />}
          <input
            name="password"
            type="password"
            required
            autoComplete="current-password"
            placeholder={master ? "Mot de passe du directeur" : "Mot de passe"}
            aria-label="Mot de passe"
            className={input}
            autoFocus={master}
          />
          <ErrorNote message={error} />
          <button disabled={busy} className={`${button} w-full`}>
            {busy ? "Connexion…" : "Se connecter"}
          </button>
          <button
            type="button"
            onClick={() => {
              setMaster((m) => !m);
              setError(null);
            }}
            className="w-full text-center text-sm text-emerald-700 underline"
          >
            {master ? "Se connecter avec mon compte" : "Utiliser le mot de passe du directeur"}
          </button>
        </form>
      </Card>
    </div>
  );
}
