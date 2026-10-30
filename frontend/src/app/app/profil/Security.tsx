"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Icon } from "@/components/panel/icons";
import { customerFetch, getSession, saveSession, setPin, type Profile } from "@/lib/customer";
import { useT } from "@/lib/i18n/client";
import { card, input, primary } from "../ui";

// Connexion du compte : e-mail (pour se connecter et retrouver son PIN) et code PIN.
export default function Security() {
  const t = useT();
  const [me, setMe] = useState<{ email: string | null; hasPin: boolean } | null>(null);
  const [open, setOpen] = useState<"email" | "pin" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    customerFetch<Profile>("/me")
      .then((p) => setMe({ email: p.email, hasPin: p.hasPin }))
      .catch(() => setMe(null));
  }, []);

  function toggle(which: "email" | "pin") {
    setError(null);
    setSaved(null);
    setOpen(open === which ? null : which);
  }

  async function saveEmail(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    try {
      const email = String(new FormData(e.currentTarget).get("email") ?? "").trim();
      const p = await customerFetch<{ email: string | null }>("/me", { method: "PATCH", body: { email } });
      const s = getSession();
      if (s) saveSession({ ...s, email: p.email });
      setMe((m) => (m ? { ...m, email: p.email } : m));
      setOpen(null);
      setSaved(t("E-mail enregistré"));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function changePin(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const f = new FormData(e.currentTarget);
    const pin = String(f.get("pin") ?? "");
    if (pin !== String(f.get("pin2") ?? "")) return setError(t("Les deux codes PIN ne sont pas identiques"));
    try {
      await setPin(pin, String(f.get("currentPin") ?? ""));
      setMe((m) => (m ? { ...m, hasPin: true } : m));
      setOpen(null);
      setSaved(t("Code PIN changé"));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (!me) return null;
  const pinProps = { inputMode: "numeric" as const, pattern: "\\d{4}", maxLength: 4, required: true, autoComplete: "off", className: `${input} text-center font-mono text-xl tracking-[0.5em]` };

  return (
    <section className={`${card} divide-y divide-stone-100`}>
      <div>
        <button onClick={() => toggle("email")} className="flex w-full items-center gap-3 px-4 py-3.5 text-left">
          <Icon name="mail" className="h-5 w-5 text-stone-500" />
          <span className="flex-1">{t("E-mail")}</span>
          <span className="max-w-[45%] truncate text-sm text-stone-500">{me.email ?? t("Ajouter")}</span>
          <Icon name="chevron" className="h-4 w-4 text-stone-400" />
        </button>
        {open === "email" && (
          <form onSubmit={saveEmail} className="space-y-3 px-4 pb-4">
            <p className="text-sm text-stone-600">{t("Pour vous connecter aussi par e-mail et y recevoir un code si vous oubliez votre PIN.")}</p>
            <input name="email" type="email" defaultValue={me.email ?? ""} autoComplete="email" placeholder="nom@exemple.com" aria-label={t("Adresse e-mail")} className={input} autoFocus />
            <button className={primary}>{t("Enregistrer")}</button>
          </form>
        )}
      </div>
      <div>
        {me.hasPin ? (
          <button onClick={() => toggle("pin")} className="flex w-full items-center gap-3 px-4 py-3.5 text-left">
            <Icon name="shield" className="h-5 w-5 text-stone-500" />
            <span className="flex-1">{t("Changer mon code PIN")}</span>
            <Icon name="chevron" className="h-4 w-4 text-stone-400" />
          </button>
        ) : (
          <Link href="/app/connexion?pin=creer&suite=/app/profil" className="flex items-center gap-3 px-4 py-3.5">
            <Icon name="shield" className="h-5 w-5 text-stone-500" />
            <span className="flex-1">{t("Créer mon code PIN")}</span>
            <Icon name="chevron" className="h-4 w-4 text-stone-400" />
          </Link>
        )}
        {open === "pin" && (
          <form onSubmit={changePin} className="space-y-3 px-4 pb-4">
            <input name="currentPin" type="password" placeholder="••••" aria-label={t("Code PIN actuel")} {...pinProps} />
            <input name="pin" type="password" placeholder="••••" aria-label={t("Nouveau code PIN")} {...pinProps} />
            <input name="pin2" type="password" placeholder="••••" aria-label={t("Confirmez le code PIN")} {...pinProps} />
            <p className="text-xs text-stone-500">{t("Dans l'ordre : PIN actuel, nouveau PIN, puis encore le nouveau PIN.")}</p>
            <button className={primary}>{t("Enregistrer")}</button>
          </form>
        )}
      </div>
      {(error || saved) && <p className={`px-4 py-3 text-sm ${error ? "text-red-700" : "text-emerald-700"}`}>{error ?? saved}</p>}
    </section>
  );
}
