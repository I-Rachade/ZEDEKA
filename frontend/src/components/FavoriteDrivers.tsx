"use client";

import { useCallback, useEffect, useState } from "react";
import { askConfirm } from "@/components/AlertDialog";
import { Icon } from "@/components/panel/icons";
import { useT } from "@/lib/i18n/client";

// « Mes livreurs » : livreurs favoris d'un restaurant (espace restaurant) ou d'une boutique (appli marchand).
// Jusqu'à 3 livreurs Zedeka, dans l'ordre ; chacun accepte ou refuse l'invitation. Les courses leur sont
// proposées d'abord (réglage « Mon favori d'abord »), puis partent aux autres livreurs.

export type FavoriteDriver = {
  id: string;
  rank: number;
  status: "INVITED" | "ACTIVE" | "DECLINED";
  createdAt: string;
  respondedAt: string | null;
  driver: { id: string; name: string; phone: string; vehicle: string; staff: boolean; online: boolean };
};
export type FavoritesState = { favorites: FavoriteDriver[]; favoriteFirst: boolean; canManage: boolean };
type Fetcher = <T>(path: string, init?: { method?: string; body?: unknown }) => Promise<T>;

export const MAX_FAVORITES = 3;

const STATUS: Record<FavoriteDriver["status"], { label: string; cls: string }> = {
  ACTIVE: { label: "Accepté", cls: "bg-emerald-100 text-emerald-800" },
  INVITED: { label: "Invitation envoyée", cls: "bg-amber-100 text-amber-900" },
  DECLINED: { label: "A refusé", cls: "bg-stone-200 text-stone-700" },
};

export function useFavorites(api: Fetcher) {
  const [data, setData] = useState<FavoritesState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try {
      setData(await api<FavoritesState>("/favorites"));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [api]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { data, error, reload, setData };
}

export default function FavoriteDrivers({ api, who }: { api: Fetcher; who: "restaurant" | "boutique" }) {
  const t = useT();
  const { data, error, reload, setData } = useFavorites(api);
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const run = async (fn: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    setActionError(null);
    setNote(null);
    try {
      await fn();
      await reload();
      if (done) setNote(done);
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (error) return <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>;
  if (!data) return <p className="p-4 text-sm text-stone-500">{t("Chargement")}…</p>;

  const counted = data.favorites.filter((f) => f.status !== "DECLINED");
  const ordered = counted.slice().sort((a, b) => a.rank - b.rank);
  const move = (id: string, dir: -1 | 1) => {
    const ids = ordered.map((f) => f.id);
    const i = ids.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    void run(() => api("/favorites/order", { method: "PUT", body: { ids } }));
  };
  const remove = async (f: FavoriteDriver) => {
    if (!(await askConfirm(t("Retirer {name} de vos livreurs favoris ?", { name: f.driver.name }), t("Retirer"), { destructive: true }))) return;
    void run(() => api(`/favorites/${f.id}`, { method: "DELETE" }));
  };
  const toggle = (favoriteFirst: boolean) => {
    setData({ ...data, favoriteFirst });
    void run(() => api("/favorites/settings", { method: "PATCH", body: { favoriteFirst } }));
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-stone-600">
        {who === "restaurant"
          ? t("Vos commandes prêtes sont proposées d'abord à vos livreurs favoris, dans l'ordre. S'ils refusent ou ne répondent pas en 60 secondes, elles partent aux autres livreurs Zedeka.")
          : t("Vos colis sont proposés d'abord à vos livreurs favoris, tout l'envoi d'un coup. S'ils refusent ou ne répondent pas en 60 secondes, ils partent aux autres livreurs Zedeka.")}
      </p>

      {actionError && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{actionError}</p>}
      {note && <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{note}</p>}

      <label className="flex items-start gap-3 rounded-xl border border-stone-200 bg-surface p-3 text-sm">
        <input type="checkbox" className="mt-1 h-4 w-4" checked={data.favoriteFirst} disabled={!data.canManage || busy} onChange={(e) => toggle(e.target.checked)} />
        <span>
          <span className="font-semibold">{t("Mon favori d'abord")}</span>
          <span className="block text-stone-600">
            {t("Chaque course part d'abord à vos favoris, sans geste de votre part. Décoché : vous choisissez course par course.")}
          </span>
        </span>
      </label>

      {data.favorites.length === 0 ? (
        <p className="rounded-xl border border-dashed border-stone-300 p-4 text-center text-sm text-stone-600">{t("Aucun livreur favori pour l'instant.")}</p>
      ) : (
        <ul className="space-y-2">
          {data.favorites.map((f) => {
            const pos = ordered.findIndex((o) => o.id === f.id);
            const st = STATUS[f.status];
            return (
              <li key={f.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-stone-200 bg-surface p-3">
                <span className="grid h-9 w-9 place-items-center rounded-full bg-emerald-600 text-sm font-bold text-white">{f.status === "DECLINED" ? "–" : pos + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {f.driver.name}
                    {f.driver.staff && <span className="ml-2 rounded-full bg-sky-100 px-2 py-0.5 text-xs text-sky-900">{t("Salarié Zedeka")}</span>}
                  </p>
                  <p className="text-sm text-stone-600">
                    <a href={`tel:${f.driver.phone}`} className="underline">
                      {f.driver.phone}
                    </a>
                    {f.status === "ACTIVE" && <span className="ml-2">{f.driver.online ? t("En ligne") : t("Hors ligne")}</span>}
                  </p>
                  <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs ${st.cls}`}>{t(st.label)}</span>
                </div>
                {data.canManage && (
                  <div className="flex gap-1">
                    {f.status !== "DECLINED" && (
                      <>
                        <button type="button" disabled={busy || pos === 0} onClick={() => move(f.id, -1)} className="rounded-lg border border-stone-300 px-2 py-1 text-sm disabled:opacity-40" aria-label={t("Monter")}>
                          ↑
                        </button>
                        <button type="button" disabled={busy || pos === ordered.length - 1} onClick={() => move(f.id, 1)} className="rounded-lg border border-stone-300 px-2 py-1 text-sm disabled:opacity-40" aria-label={t("Descendre")}>
                          ↓
                        </button>
                      </>
                    )}
                    {f.status === "DECLINED" && counted.length < MAX_FAVORITES && (
                      <button type="button" disabled={busy} onClick={() => run(() => api("/favorites", { method: "POST", body: { phone: f.driver.phone } }), t("Invitation renvoyée."))} className="rounded-lg border border-stone-300 px-2 py-1 text-sm">
                        {t("Réinviter")}
                      </button>
                    )}
                    <button type="button" disabled={busy} onClick={() => remove(f)} className="rounded-lg border border-stone-300 px-2 py-1 text-sm" aria-label={t("Retirer")}>
                      <Icon name="trash" className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {data.canManage && counted.length < MAX_FAVORITES && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await api("/favorites", { method: "POST", body: { phone } });
              setPhone("");
            }, t("Invitation envoyée : le livreur doit l'accepter dans son application."));
          }}
          className="space-y-2 rounded-xl border border-stone-200 bg-surface p-3"
        >
          <p className="font-semibold">{t("Inviter un livreur")}</p>
          <p className="text-sm text-stone-600">{t("Numéro du livreur Zedeka ({n} au plus)", { n: MAX_FAVORITES })}</p>
          <div className="flex gap-2">
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              inputMode="tel"
              required
              placeholder="90 00 00 00"
              className="w-full rounded-lg border border-stone-300 bg-surface px-3 py-2 text-sm focus:border-emerald-600 focus:outline-none"
            />
            <button disabled={busy || phone.trim().length < 8} className="shrink-0 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
              {t("Inviter")}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

// Boutons « À mon livreur favori » / « Demande ouverte » sur une ou plusieurs courses sans livreur.
export function DispatchChoice({ api, orderIds, onDone, compact = false }: { api: Fetcher; orderIds: string[]; onDone?: () => void; compact?: boolean }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const send = async (route: "FAVORITE" | "OPEN") => {
    setBusy(true);
    setMsg(null);
    try {
      await api("/dispatch", { method: "POST", body: { orderIds, route } });
      setMsg({ ok: true, text: route === "FAVORITE" ? t("Envoyée à votre livreur favori.") : t("Envoyée à tous les livreurs Zedeka.") });
      onDone?.();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={compact ? "space-y-1" : "space-y-2"}>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={() => send("FAVORITE")} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">
          <Icon name="heart" className="h-4 w-4" /> {t("À mon livreur favori")}
        </button>
        <button type="button" disabled={busy} onClick={() => send("OPEN")} className="inline-flex items-center gap-2 rounded-lg border border-stone-300 bg-surface px-3 py-2 text-sm disabled:opacity-60">
          <Icon name="rider" className="h-4 w-4" /> {t("Demande ouverte")}
        </button>
      </div>
      {msg && <p className={`text-sm ${msg.ok ? "text-emerald-700" : "text-red-700"}`}>{msg.text}</p>}
    </div>
  );
}
