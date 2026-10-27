"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon, type IconName } from "@/components/panel/icons";
import { customerFetch, getSession, logout, saveSession, useSession } from "@/lib/customer";
import { useHydrated } from "@/lib/device";
import { card, input, primary, TopBar } from "../ui";

const INFO: { href: string; label: string; icon: IconName }[] = [
  { href: "/app/aide", label: "Aide et contact", icon: "help" },
  { href: "/app/annulation", label: "Annulation et remboursement", icon: "clock" },
  { href: "/app/conditions", label: "Conditions d'utilisation", icon: "doc" },
  { href: "/app/confidentialite", label: "Confidentialité", icon: "shield" },
];

function Row({ href, label, icon }: { href: string; label: string; icon: IconName }) {
  return (
    <li>
      <Link href={href} className="flex items-center gap-3 px-4 py-3.5">
        <Icon name={icon} className="h-5 w-5 text-stone-500" />
        <span className="flex-1">{label}</span>
        <Icon name="chevron" className="h-4 w-4 text-stone-400" />
      </Link>
    </li>
  );
}

const pretty = (phone: string) => phone.replace(/^\+228(\d{2})(\d{2})(\d{2})(\d{2})$/, "+228 $1 $2 $3 $4");

export default function ProfilePage() {
  const router = useRouter();
  const hydrated = useHydrated();
  const session = useSession();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function rename(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    try {
      const p = await customerFetch<{ name: string }>("/me", { method: "PATCH", body: { name: String(new FormData(e.currentTarget).get("name") ?? "") } });
      const s = getSession();
      if (s) saveSession({ ...s, name: p.name });
      setEditing(false);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function remove() {
    if (!window.confirm("Supprimer votre compte ? Vos adresses seront effacées et vos commandes ne seront plus reliées à votre numéro. C'est définitif.")) return;
    try {
      await customerFetch("/me", { method: "DELETE" });
      logout();
      router.replace("/app");
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div>
      <TopBar title="Profil" />
      <div className="space-y-4 px-4 py-4">
        {!hydrated ? null : session ? (
          <section className={`${card} p-4`}>
            {editing ? (
              <form onSubmit={rename} className="space-y-3">
                <input name="name" defaultValue={session.name ?? ""} required minLength={2} aria-label="Votre nom" className={input} autoFocus />
                <div className="flex gap-2">
                  <button className={primary}>Enregistrer</button>
                  <button type="button" onClick={() => setEditing(false)} className="rounded-xl px-4 text-stone-600">
                    Annuler
                  </button>
                </div>
              </form>
            ) : (
              <div className="flex items-center gap-3">
                <span className="grid h-14 w-14 place-items-center rounded-full bg-emerald-100 text-xl font-bold text-emerald-700">
                  {(session.name ?? "?").slice(0, 1).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-lg font-semibold">{session.name ?? "Sans nom"}</p>
                  <p className="text-sm text-stone-600">{pretty(session.phone)}</p>
                </div>
                <button onClick={() => setEditing(true)} aria-label="Modifier mon nom" className="grid h-10 w-10 place-items-center rounded-full hover:bg-stone-100">
                  <Icon name="edit" />
                </button>
              </div>
            )}
            {error && <p className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
          </section>
        ) : (
          <section className={`${card} space-y-3 p-4`}>
            <p className="font-semibold">Retrouvez vos commandes et vos adresses</p>
            <p className="text-sm text-stone-600">Connectez-vous avec votre numéro : un code suffit, pas de mot de passe.</p>
            <Link href="/app/connexion?suite=/app/profil" className={primary}>
              Se connecter
            </Link>
          </section>
        )}

        {session && (
          <ul className={`${card} divide-y divide-stone-100`}>
            <Row href="/app/adresses" label="Mes adresses" icon="pin" />
            <Row href="/app/commandes" label="Mes commandes" icon="orders" />
          </ul>
        )}

        <ul className={`${card} divide-y divide-stone-100`}>
          {INFO.map((i) => (
            <Row key={i.href} {...i} />
          ))}
        </ul>

        <ul className={`${card} divide-y divide-stone-100`}>
          <Row href="/devenir-partenaire" label="Devenir partenaire" icon="store" />
          <Row href="/devenir-livreur" label="Devenir livreur" icon="rider" />
        </ul>

        {session && (
          <div className="space-y-2 pt-2">
            <button
              onClick={() => {
                logout();
                router.replace("/app");
              }}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-white py-3 font-medium ring-1 ring-stone-200"
            >
              <Icon name="logout" className="h-5 w-5" /> Se déconnecter
            </button>
            <button onClick={remove} className="flex w-full items-center justify-center gap-2 py-3 text-sm text-red-700">
              <Icon name="trash" className="h-4 w-4" /> Supprimer mon compte
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
