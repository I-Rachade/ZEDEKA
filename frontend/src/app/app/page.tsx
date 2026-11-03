"use client";

import Link from "next/link";
import { InstallPrompt } from "@/components/AppRuntime";
import Logo from "@/components/Logo";
import { Icon, type IconName } from "@/components/panel/icons";
import { fcfa } from "@/lib/api";
import { usePlace, useSession } from "@/lib/customer";
import { trackHref, useHydrated } from "@/lib/device";
import { LanguageSwitch, useT } from "@/lib/i18n/client";
import { useHistory, useRestaurants } from "./data";
import PlacePicker from "./PlacePicker";
import { card, Empty, KIND, RestaurantCard, Skeleton, StatusBadge } from "./ui";

const SERVICES: { href: string; label: string; hint: string; icon: IconName; tone: string }[] = [
  { href: "/app/recherche", label: "Repas", hint: "Restaurants de Lomé", icon: "menu", tone: "bg-sun text-ink" },
  { href: "/colis", label: "Colis", hint: "Envoi dans la ville", icon: "box", tone: "bg-emerald-600 text-white" },
];

// Initiales du nom, ou les deux derniers chiffres du numéro tant que le nom n'est pas renseigné.
const initialsOf = (name: string | null, phone: string) =>
  name
    ?.split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("") || phone.slice(-2);

// Avancement d'une commande en 4 segments (reçue, en cuisine, prête, en route) pour la carte « En cours ».
const PROGRESS: Record<string, number> = { PENDING: 0, CONFIRMED: 1, PREPARING: 1, READY: 2, PICKED_UP: 3, DELIVERED: 4 };

export default function AppHome() {
  const hydrated = useHydrated();
  const session = useSession();
  const place = usePlace();
  const restaurants = useRestaurants(place?.zoneId);
  const history = useHistory();
  const ongoing = (history.data ?? []).filter((h) => h.ongoing).slice(0, 2);
  const firstName = session?.name?.split(" ")[0];
  const t = useT();

  return (
    <div className="page-enter">
      {/* Barre du haut translucide ; grand titre et adresse en dessous, comme les applications d'Apple. */}
      <div className="glass hairline-b sticky top-0 z-30 flex items-center justify-between px-4 pb-2 pt-[calc(0.5rem+env(safe-area-inset-top))]">
        <Logo size="sm" />
        <span className="flex items-center gap-3">
          <LanguageSwitch />
          {/* Discret à la place de « Se connecter » : initiales une fois connecté, silhouette sinon. */}
          <Link
            href={session ? "/app/profil" : "/app/connexion"}
            aria-label={session ? t("Mon profil") : t("Se connecter")}
            className={`grid h-9 w-9 place-items-center rounded-full ${session ? "bg-emerald-600 text-sm font-semibold text-white" : "bg-stone-200/80 text-stone-600"}`}
          >
            {session ? initialsOf(session.name, session.phone) : <Icon name="user" className="h-5 w-5" />}
          </Link>
        </span>
      </div>

      <div className="space-y-7 px-4 pb-4">
        <section className="pt-4">
          <h1 className="text-[34px] font-bold leading-tight">{firstName ? t("Bonjour {name}", { name: firstName }) : t("Bonjour")}</h1>
          <p className="text-[17px] text-stone-500">{t("Qu'est-ce qu'on vous apporte aujourd'hui ?")}</p>
          <div className={`${card} mt-4 px-3.5 py-2.5`}>
            <PlacePicker />
          </div>
        </section>

        <section className="grid grid-cols-2 gap-3">
          {SERVICES.map((s) => (
            <Link key={s.href} href={s.href} className={`${card} flex flex-col gap-3 p-4 transition active:scale-[0.97]`}>
              <span className={`grid h-11 w-11 place-items-center rounded-[13px] ${s.tone}`}>
                <Icon name={s.icon} className="h-6 w-6" />
              </span>
              <span>
                <span className="block text-[17px] font-semibold">{t(s.label)}</span>
                <span className="block text-[13px] leading-tight text-stone-500">{t(s.hint)}</span>
              </span>
            </Link>
          ))}
        </section>

        {ongoing.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-[22px] font-bold">{t("En cours")}</h2>
            {ongoing.map((o) => (
              <Link key={o.code} href={trackHref(o.code)} className={`${card} block space-y-3 p-4`}>
                <span className="flex items-center gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-emerald-600/10 text-emerald-600">
                    <Icon name={KIND[o.kind].icon} className="h-5 w-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{t(o.title)}</span>
                    <span className="block text-[13px] text-stone-500">
                      {o.code} · {fcfa(o.total)}
                    </span>
                  </span>
                  <StatusBadge kind={o.kind} status={o.status} />
                </span>
                <span className="grid grid-cols-4 gap-1" aria-hidden="true">
                  {[0, 1, 2, 3].map((i) => {
                    const p = PROGRESS[o.status] ?? 0;
                    return <span key={i} className={`h-1 rounded-full ${i < p ? "bg-emerald-600" : i === p ? "step-now" : "bg-stone-200"}`} />;
                  })}
                </span>
              </Link>
            ))}
          </section>
        )}

        <InstallPrompt />

        <section className="space-y-3">
          <div className="flex items-end justify-between">
            <h2 className="text-[22px] font-bold">{t("Restaurants")}</h2>
            {!place && hydrated && (
              <button
                type="button"
                onClick={() => document.querySelector<HTMLButtonElement>("[data-place-picker]")?.click()}
                className="inline-flex items-center gap-1 text-[15px] text-emerald-600"
              >
                <Icon name="pin" className="h-3.5 w-3.5" /> {t("Voir les frais de ma zone")}
              </button>
            )}
          </div>
          {restaurants.loading || !restaurants.data ? (
            restaurants.error ? (
              <Empty icon="store" title="Liste indisponible">
                {restaurants.error}{" "}
                <button onClick={restaurants.reload} className="text-emerald-600">
                  {t("Réessayer")}
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
      </div>
    </div>
  );
}
