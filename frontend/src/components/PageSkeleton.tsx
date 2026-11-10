import { getT } from "@/lib/i18n/server";

// Squelette affiché tout de suite pendant que la page est préparée côté serveur (carte d'un restaurant, caisse,
// suivi) : sur un réseau lent, l'écran n'est plus blanc pendant l'attente de l'API.
export default async function PageSkeleton({ kind }: { kind: "menu" | "checkout" | "tracking" }) {
  const t = await getT();
  return (
    <div role="status" aria-busy="true" aria-label={t("Chargement…")} className="mx-auto w-full max-w-3xl px-4 pb-24">
      {kind === "menu" && (
        <>
          <div className="skeleton -mx-4 mb-4 h-44 sm:mx-0 sm:mt-4 sm:rounded-2xl" />
          <div className="mb-5 flex items-center gap-3">
            <span className="skeleton h-14 w-14 shrink-0 rounded-2xl" />
            <span className="flex-1 space-y-2">
              <span className="skeleton block h-5 w-1/2 rounded-full" />
              <span className="skeleton block h-3.5 w-1/3 rounded-full" />
            </span>
          </div>
          <div className="mb-5 flex gap-2">
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className="skeleton h-9 w-24 rounded-full" />
            ))}
          </div>
          <ul className="space-y-4">
            {[0, 1, 2, 3, 4].map((i) => (
              <li key={i} className="flex gap-3">
                <span className="flex-1 space-y-2">
                  <span className="skeleton block h-4 w-2/3 rounded-full" />
                  <span className="skeleton block h-3 w-full rounded-full" />
                  <span className="skeleton block h-4 w-20 rounded-full" />
                </span>
                <span className="skeleton h-[104px] w-[104px] shrink-0 rounded-2xl" />
              </li>
            ))}
          </ul>
        </>
      )}
      {kind === "checkout" && (
        <div className="space-y-4 pt-6">
          <span className="skeleton block h-7 w-1/2 rounded-full" />
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton h-28 rounded-2xl" />
          ))}
          <div className="skeleton h-12 rounded-2xl" />
        </div>
      )}
      {kind === "tracking" && (
        <div className="space-y-4 pt-6">
          <span className="skeleton block h-7 w-2/3 rounded-full" />
          <div className="skeleton h-40 rounded-2xl" />
          <ul className="space-y-3">
            {[0, 1, 2, 3, 4].map((i) => (
              <li key={i} className="flex items-center gap-3">
                <span className="skeleton h-6 w-6 shrink-0 rounded-full" />
                <span className="skeleton block h-4 w-1/2 rounded-full" />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
