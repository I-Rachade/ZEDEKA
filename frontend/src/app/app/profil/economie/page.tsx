"use client";

import { useCallback, useEffect, useState } from "react";
import { fcfa } from "@/lib/api";
import { batterySaving, saveEco, useEco } from "@/lib/eco";
import { useT } from "@/lib/i18n/client";
import { drop, useOutbox } from "@/lib/outbox";
import { card, TopBar } from "../../ui";

// Profil > Économie (planche 7) : les deux réglages qui comptent à Lomé (batterie, données), ce qui est gardé sur le
// téléphone pour le hors-ligne, et ce qui attend d'être envoyé.

type Kept = {
  menus: { n: number; bytes: number };
  pages: { n: number; bytes: number };
  app: { n: number; bytes: number };
};

const size = (b: number) =>
  b >= 1_000_000
    ? `${(b / 1_000_000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} Mo`
    : `${Math.max(1, Math.round(b / 1000))} Ko`;

async function measure(
  name: string,
  filter: (url: string) => boolean = () => true,
) {
  const out = { n: 0, bytes: 0 };
  if (!("caches" in window)) return out;
  const cache = await caches.open(name);
  for (const req of await cache.keys()) {
    if (!filter(req.url)) continue;
    const res = await cache.match(req);
    out.n++;
    out.bytes +=
      Number(res?.headers.get("content-length")) ||
      (await res?.clone().blob())?.size ||
      0;
  }
  return out;
}

function Switch({
  on,
  onChange,
  label,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${on ? "bg-[#0e7c4a]" : "bg-stone-300"}`}
    >
      <span
        className={`absolute top-0.5 h-6 w-6 rounded-full bg-surface shadow transition-[left] ${on ? "left-[22px]" : "left-0.5"}`}
      />
    </button>
  );
}

export default function EconomyPage() {
  const t = useT();
  const eco = useEco();
  const outbox = useOutbox();
  const [kept, setKept] = useState<Kept | null>(null);
  const saving = batterySaving(eco);

  const load = useCallback(async () => {
    try {
      const [menus, pages, app] = await Promise.all([
        measure("zedeka-data", (u) => /\/api\/restaurants\//.test(u)),
        measure("zedeka-pages"),
        measure("zedeka-static"),
      ]);
      setKept({ menus, pages, app });
    } catch {
      setKept({
        menus: { n: 0, bytes: 0 },
        pages: { n: 0, bytes: 0 },
        app: { n: 0, bytes: 0 },
      });
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const clear = async () => {
    if ("caches" in window)
      await Promise.all(
        ["zedeka-data", "zedeka-pages"].map((c) => caches.delete(c)),
      );
    await load();
  };

  return (
    <>
      <TopBar title="Économie" back="/app/profil" />
      <div className="space-y-3 p-4">
        <section className={`${card} p-4`}>
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-bold">🔋 {t("Mode économie de batterie")}</h2>
            <span
              className={`shrink-0 whitespace-nowrap rounded-md px-2 py-1 text-xs font-bold ${saving ? "bg-emerald-100 text-emerald-800" : "bg-stone-100 text-stone-600"}`}
            >
              {saving ? t("Activé") : t("Désactivé")}
              {eco.level != null && ` · ${Math.round(eco.level * 100)}\u00a0%`}
            </span>
          </div>
          <p className="mt-1 text-sm text-stone-600">
            {t(
              "S'active tout seul sous 20 % de batterie : pas d'animation, moins de mises à jour.",
            )}
          </p>
          <div
            role="radiogroup"
            aria-label={t("Mode économie de batterie")}
            className="mt-3 grid grid-cols-3 gap-1 rounded-lg bg-stone-100 p-1 text-sm"
          >
            {(["AUTO", "ON", "OFF"] as const).map((m) => (
              <button
                key={m}
                role="radio"
                aria-checked={eco.battery === m}
                onClick={() => saveEco({ battery: m })}
                className={`rounded-md py-2 font-semibold ${eco.battery === m ? "bg-surface shadow-sm" : "text-stone-600"}`}
              >
                {t(
                  m === "AUTO"
                    ? "Automatique"
                    : m === "ON"
                      ? "Toujours"
                      : "Jamais",
                )}
              </button>
            ))}
          </div>
        </section>

        <section
          className={`${card} flex items-start justify-between gap-3 p-4`}
        >
          <div>
            <h2 className="font-bold">📶 {t("Données réduites")}</h2>
            <p className="mt-1 text-sm text-stone-600">
              {t(
                "Sans photos des plats ni des restaurants : les pages se chargent plus vite et coûtent moins de forfait.",
              )}
            </p>
          </div>
          <Switch
            on={eco.lite}
            onChange={(lite) => saveEco({ lite })}
            label={t("Données réduites")}
          />
        </section>

        <section className={`${card} p-4`}>
          <h2 className="font-bold">{t("Gardé sur ce téléphone")}</h2>
          {!kept ? (
            <p className="mt-2 text-sm text-stone-500">…</p>
          ) : (
            <dl className="mt-2 space-y-2 text-sm">
              <div className="flex justify-between gap-2">
                <dt>{t("Menus de {n} restaurant(s)", { n: kept.menus.n })}</dt>
                <dd className="tabular-nums">{size(kept.menus.bytes)}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt>{t("Pages et suivis ({n})", { n: kept.pages.n })}</dt>
                <dd className="tabular-nums">{size(kept.pages.bytes)}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt>{t("Fichiers de l'application")}</dt>
                <dd className="tabular-nums">{size(kept.app.bytes)}</dd>
              </div>
            </dl>
          )}
          <button
            onClick={clear}
            className="mt-3 text-sm font-bold text-amber-700"
          >
            {t("Vider les menus et les pages gardés")}
          </button>
        </section>

        <section className={`${card} p-4`}>
          <h2 className="font-bold">{t("En attente d'envoi")}</h2>
          {outbox.length === 0 ? (
            <p className="mt-1 text-sm text-stone-500">
              {t("Rien en attente : tout est parti.")}
            </p>
          ) : (
            <ul className="mt-2 space-y-2 text-sm">
              {outbox.map((i) => (
                <li
                  key={i.id}
                  className="flex items-center justify-between gap-2"
                >
                  <span>
                    ⏳ {i.label}
                    {i.estimate != null && (
                      <span className="text-stone-500">
                        {" "}
                        · ~{fcfa(i.estimate)}
                      </span>
                    )}
                  </span>
                  <button
                    onClick={() => drop(i.id)}
                    className="text-xs font-semibold text-red-700"
                  >
                    {t("Supprimer")}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-xs text-stone-500">
            {t(
              "Au retour du réseau, vous confirmez l'envoi ; un colis n'est jamais envoyé deux fois.",
            )}
          </p>
        </section>
      </div>
    </>
  );
}
