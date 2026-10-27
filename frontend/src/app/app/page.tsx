"use client";

import Link from "next/link";
import { InstallPrompt } from "@/components/AppRuntime";
import Logo from "@/components/Logo";
import { Icon, type IconName } from "@/components/panel/icons";
import { fcfa } from "@/lib/api";
import { usePlace, useSession } from "@/lib/customer";
import { trackHref, useHydrated } from "@/lib/device";
import { useHistory, useRestaurants } from "./data";
import PlacePicker from "./PlacePicker";
import { card, Empty, KIND, RestaurantCard, Skeleton, StatusBadge } from "./ui";

const SERVICES: { href: string; label: string; hint: string; icon: IconName; tone: string }[] = [
  { href: "/app/recherche", label: "Repas", hint: "Restaurants de Lomé", icon: "menu", tone: "bg-sun-soft text-amber-800" },
  { href: "/colis", label: "Colis", hint: "Envoi dans la ville", icon: "box", tone: "bg-emerald-100 text-emerald-700" },
  { href: "/app/location", label: "Location", hint: "Voiture avec chauffeur", icon: "car", tone: "bg-stone-100 text-ink" },
];

// Avancement d'une commande en 4 segments (reçue, en cuisine, prête, en route) pour la carte « En cours ».
const PROGRESS: Record<string, number> = { PENDING: 0, CONFIRMED: 1, PREPARING: 1, READY: 2, PICKED_UP: 3, DELIVERED: 4, ONGOING: 3, COMPLETED: 4 };

export default function AppHome() {
  const hydrated = useHydrated();
  const session = useSession();
  const place = usePlace();
  const restaurants = useRestaurants(place?.zoneId);
  const history = useHistory();
  const ongoing = (history.data ?? []).filter((h) => h.ongoing).slice(0, 2);
  const firstName = session?.name?.split(" ")[0];

  return (
    <div className="page-enter">
      <div className="bg-emerald-600 px-4 pt-[calc(0.75rem+env(safe-area-inset-top))]">
        <Logo size="sm" tone="light" />
      </div>
      <header className="sticky top-0 z-30 flex items-center justify-between gap-3 bg-emerald-600 px-4 pb-3 pt-3 text-white">
        <div className="min-w-0 flex-1 rounded-xl bg-white px-3 py-1.5 text-stone-900">
          <PlacePicker />
        </div>
        <Link href={session ? "/app/profil" : "/app/connexion"} className="shrink-0 text-sm font-medium">
          {hydrated && session ? (firstName ?? "Mon compte") : "Se connecter"}
        </Link>
      </header>

      <section className="bg-emerald-600 px-4 pb-12 pt-1 text-white">
        <h1 className="text-2xl font-extrabold">{firstName ? `Bonjour ${firstName}` : "Bonjour"}</h1>
        <p className="text-emerald-50">Qu&apos;est-ce qu&apos;on vous apporte aujourd&apos;hui ?</p>
      </section>

      <div className="space-y-6 px-4 pb-4">
        <section className="-mt-9 grid grid-cols-3 gap-3">
          {SERVICES.map((s) => (
            <Link key={s.href} href={s.href} className={`${card} flex flex-col items-center gap-2 px-2 py-4 text-center shadow-md transition active:scale-95`}>
              <span className={`grid h-12 w-12 place-items-center rounded-2xl ${s.tone}`}>
                <Icon name={s.icon} className="h-6 w-6" />
              </span>
              <span className="font-semibold">{s.label}</span>
              <span className="text-xs leading-tight text-stone-500">{s.hint}</span>
            </Link>
          ))}
        </section>

        {ongoing.length > 0 && (
          <section className="space-y-2">
            <h2 className="font-semibold">En cours</h2>
            {ongoing.map((o) => (
              <Link key={o.code} href={trackHref(o.kind, o.code)} className={`${card} block space-y-2.5 p-3`}>
                <span className="flex items-center gap-3">
                  <Icon name={KIND[o.kind].icon} className="h-6 w-6 text-emerald-600" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{o.title}</span>
                    <span className="block text-sm text-stone-500">
                      {o.code} · {fcfa(o.total)}
                    </span>
                  </span>
                  <StatusBadge kind={o.kind} status={o.status} />
                </span>
                <span className="grid grid-cols-4 gap-1" aria-hidden="true">
                  {[0, 1, 2, 3].map((i) => {
                    const p = PROGRESS[o.status] ?? 0;
                    return <span key={i} className={`h-1.5 rounded-full ${i < p ? "bg-emerald-600" : i === p ? "step-now" : "bg-stone-200"}`} />;
                  })}
                </span>
              </Link>
            ))}
          </section>
        )}

        <InstallPrompt />

        <section className="space-y-3">
          <div className="flex items-end justify-between">
            <h2 className="font-semibold">Restaurants</h2>
            {!place && hydrated && <span className="text-xs text-stone-500">Choisissez votre zone pour voir les frais</span>}
          </div>
          {restaurants.loading || !restaurants.data ? (
            restaurants.error ? (
              <Empty icon="store" title="Liste indisponible">
                {restaurants.error}{" "}
                <button onClick={restaurants.reload} className="text-emerald-700 underline">
                  Réessayer
                </button>
              </Empty>
            ) : (
              <Skeleton />
            )
          ) : restaurants.data.length === 0 ? (
            <Empty icon="store" title="Aucun restaurant pour le moment" />
          ) : (
            restaurants.data.map((r) => <RestaurantCard key={r.slug} r={r} />)
          )}
        </section>

        <p className="pb-2 text-center text-sm text-stone-500">
          Vous êtes commerçant ?{" "}
          <Link href="/devenir-partenaire" className="text-emerald-700 underline">
            Devenez partenaire
          </Link>{" "}
          ·{" "}
          <Link href="/devenir-livreur" className="text-emerald-700 underline">
            Devenez livreur
          </Link>
        </p>
      </div>
    </div>
  );
}
