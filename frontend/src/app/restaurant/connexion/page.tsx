"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { button, Card, ErrorNote, input, Tabs } from "@/components/panel/ui";
import { getRestaurantRole, restaurantLogin, restaurantPinLogin } from "@/lib/restaurant";
import { LanguageSwitch, useT } from "@/lib/i18n/client";

// Espace commerce (restaurant ou boutique) : e-mail et mot de passe pour tous ; le gérant peut aussi entrer
// avec le numéro du commerce et son code PIN.
export default function RestaurantLoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"email" | "pin">("email");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const t = useT();

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const field = (name: string) => String(f.get(name) ?? "");
    setBusy(true);
    try {
      if (mode === "pin") await restaurantPinLogin(field("phone"), field("pin"));
      else await restaurantLogin(field("email"), field("password"));
      router.replace(getRestaurantRole() === "CASHIER" ? "/restaurant/commandes" : "/restaurant");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-sm pt-6">
      <Card title="Espace commerce" action={<LanguageSwitch />}>
        <p className="mb-3 text-sm text-stone-600">{t("Recevez vos commandes, gérez votre carte et vos horaires.")}</p>
        <Tabs
          value={mode}
          onChange={(m) => {
            setMode(m);
            setError(null);
          }}
          tabs={[
            { value: "email", label: "E-mail" },
            { value: "pin", label: "Numéro et PIN" },
          ]}
        />
        <form key={mode} onSubmit={submit} className="space-y-3">
          {mode === "pin" ? (
            <>
              <input name="phone" type="tel" required placeholder={t("Numéro du commerce")} autoComplete="tel" className={input} autoFocus />
              <input name="pin" type="password" inputMode="numeric" pattern="[0-9]{4}" maxLength={4} required placeholder={t("Code PIN (4 chiffres)")} autoComplete="current-password" className={input} />
            </>
          ) : (
            <>
              <input name="email" type="email" required placeholder={t("E-mail")} autoComplete="username" className={input} autoFocus />
              <input name="password" type="password" required placeholder={t("Mot de passe")} autoComplete="current-password" className={input} />
            </>
          )}
          <ErrorNote message={error} />
          <button disabled={busy} className={`${button} w-full`}>
            {busy ? t("Connexion…") : t("Se connecter")}
          </button>
        </form>
        {mode === "pin" ? (
          <p className="mt-3 text-xs text-stone-500">{t("Réservé au gérant. PIN oublié : connectez-vous avec l'e-mail, ou demandez un nouveau PIN à l'équipe Zedeka.")}</p>
        ) : (
          <Link href="/restaurant/mot-de-passe" className="mt-3 flex min-h-11 items-center justify-center text-sm text-emerald-700 underline">
            {t("Mot de passe oublié ?")}
          </Link>
        )}
        <p className="mt-3 text-xs text-stone-500">{t("Pas encore d'accès ? Demandez-le à l'équipe Zedeka.")}</p>
      </Card>
    </div>
  );
}
