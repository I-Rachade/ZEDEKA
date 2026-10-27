"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { Icon } from "@/components/panel/icons";
import { customerFetch, guessZone, savePlace, usePlace, useSession, type Address, type Profile } from "@/lib/customer";
import { useHydrated } from "@/lib/device";
import { useZones } from "../data";
import { card, Empty, input, primary, Skeleton, TopBar } from "../ui";

const LABELS = ["Maison", "Bureau", "Famille"];

type Draft = { id?: string; label: string; quarter: string; landmark: string; zoneId: string; latitude: number | null; longitude: number | null };

function AddressForm({ initial, onDone, onCancel }: { initial: Draft; onDone: (a: Address) => void; onCancel: () => void }) {
  const zones = useZones();
  const [d, setD] = useState(initial);
  const [zoneTouched, setZoneTouched] = useState(Boolean(initial.id));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  const guessed = zones.data ? guessZone(zones.data, d.quarter) : null;
  const zoneId = zoneTouched ? d.zoneId : (guessed?.id ?? d.zoneId);

  function locate() {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setD((x) => ({ ...x, latitude: p.coords.latitude, longitude: p.coords.longitude }));
        setLocating(false);
      },
      () => {
        setError("Position indisponible. Le repère suffit au livreur.");
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = { label: d.label, quarter: d.quarter, landmark: d.landmark, zoneId, latitude: d.latitude, longitude: d.longitude };
      const saved = await customerFetch<Address>(d.id ? `/addresses/${d.id}` : "/addresses", { method: d.id ? "PATCH" : "POST", body });
      onDone(saved);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className={`${card} space-y-3 p-4`}>
      <h2 className="font-semibold">{d.id ? "Modifier l'adresse" : "Nouvelle adresse"}</h2>
      <div className="flex flex-wrap gap-2">
        {LABELS.map((l) => (
          <button
            key={l}
            type="button"
            onClick={() => setD({ ...d, label: l })}
            className={`rounded-full border px-3 py-1.5 text-sm ${d.label === l ? "border-emerald-600 bg-emerald-50 font-semibold" : "border-stone-300"}`}
          >
            {l}
          </button>
        ))}
      </div>
      <input value={d.label} onChange={(e) => setD({ ...d, label: e.target.value })} required maxLength={40} placeholder="Nom de l'adresse" aria-label="Nom de l'adresse" className={input} />
      <input value={d.quarter} onChange={(e) => setD({ ...d, quarter: e.target.value })} required minLength={2} placeholder="Quartier (ex. Tokoin Casablanca)" aria-label="Quartier" className={input} />
      <textarea
        value={d.landmark}
        onChange={(e) => setD({ ...d, landmark: e.target.value })}
        required
        minLength={5}
        rows={2}
        placeholder="Repère pour le livreur (ex. portail bleu en face de la pharmacie)"
        aria-label="Repère"
        className={input}
      />
      <select
        value={zoneId}
        onChange={(e) => {
          setZoneTouched(true);
          setD({ ...d, zoneId: e.target.value });
        }}
        required
        aria-label="Zone de livraison"
        className={input}
      >
        <option value="">Zone de livraison</option>
        {(zones.data ?? []).map((z) => (
          <option key={z.id} value={z.id}>
            {z.name}
          </option>
        ))}
      </select>
      {!zoneTouched && guessed && <p className="-mt-1 text-xs text-stone-500">Zone trouvée d&apos;après le quartier. Vous pouvez la changer.</p>}
      <button type="button" onClick={locate} className="flex items-center gap-2 text-sm text-emerald-700">
        <Icon name="pin" className="h-4 w-4" />
        {locating ? "Localisation…" : d.latitude !== null ? "Position enregistrée ✓ (mettre à jour)" : "Ajouter ma position sur la carte (facultatif)"}
      </button>
      {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <div className="flex gap-2">
        <button disabled={busy} className={primary}>
          {busy ? "Enregistrement…" : "Enregistrer"}
        </button>
        <button type="button" onClick={onCancel} className="rounded-xl px-4 text-stone-600">
          Annuler
        </button>
      </div>
    </form>
  );
}

const EMPTY: Draft = { label: "Maison", quarter: "", landmark: "", zoneId: "", latitude: null, longitude: null };

function Addresses() {
  const router = useRouter();
  const params = useSearchParams();
  const hydrated = useHydrated();
  const session = useSession();
  const place = usePlace();
  const [list, setList] = useState<Address[] | null>(null);
  const [editing, setEditing] = useState<Draft | null>(params.get("nouvelle") ? EMPTY : null);

  const load = useCallback(() => customerFetch<Profile>("/me").then((p) => setList(p.addresses)), []);
  useEffect(() => {
    if (session) load().catch(() => setList([]));
  }, [session, load]);

  useEffect(() => {
    if (hydrated && !session) router.replace("/app/connexion?suite=/app/adresses");
  }, [hydrated, session, router]);

  async function remove(a: Address) {
    if (!window.confirm(`Supprimer l'adresse « ${a.label} » ?`)) return;
    await customerFetch(`/addresses/${a.id}`, { method: "DELETE" });
    if (place?.addressId === a.id) savePlace({ zoneId: a.zone.id, label: a.zone.name });
    await load();
  }

  return (
    <div>
      <TopBar title="Mes adresses" back="/app/profil" />
      <div className="space-y-3 px-4 py-4">
        {editing && (
          <AddressForm
            key={editing.id ?? "new"}
            initial={editing}
            onCancel={() => setEditing(null)}
            onDone={(a) => {
              setEditing(null);
              if (!place?.addressId || place.addressId === a.id) savePlace({ addressId: a.id, zoneId: a.zone.id, label: a.label });
              load();
            }}
          />
        )}
        {!list ? (
          <Skeleton rows={2} />
        ) : list.length === 0 && !editing ? (
          <Empty icon="pin" title="Aucune adresse enregistrée">
            Enregistrez votre maison ou votre bureau pour commander plus vite.
          </Empty>
        ) : (
          <ul className="space-y-2">
            {list.map((a) => (
              <li key={a.id} className={`${card} flex items-start gap-3 p-3`}>
                <Icon name="pin" className={`mt-0.5 h-5 w-5 ${place?.addressId === a.id ? "text-emerald-600" : "text-stone-400"}`} />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">
                    {a.label} {place?.addressId === a.id && <span className="ml-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">choisie</span>}
                  </p>
                  <p className="text-sm text-stone-700">
                    {a.quarter}, {a.landmark}
                  </p>
                  <p className="text-xs text-stone-500">
                    {a.zone.name}
                    {a.latitude !== null && " · position enregistrée"}
                  </p>
                </div>
                <button
                  onClick={() => setEditing({ id: a.id, label: a.label, quarter: a.quarter, landmark: a.landmark, zoneId: a.zone.id, latitude: a.latitude, longitude: a.longitude })}
                  aria-label={`Modifier ${a.label}`}
                  className="grid h-9 w-9 place-items-center rounded-full hover:bg-stone-100"
                >
                  <Icon name="edit" className="h-4 w-4" />
                </button>
                <button onClick={() => remove(a)} aria-label={`Supprimer ${a.label}`} className="grid h-9 w-9 place-items-center rounded-full text-red-700 hover:bg-red-50">
                  <Icon name="trash" className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
        {!editing && (
          <button onClick={() => setEditing(EMPTY)} className={primary}>
            <Icon name="plus" className="h-5 w-5" /> Ajouter une adresse
          </button>
        )}
        <p className="text-center text-xs text-stone-500">
          Le repère est obligatoire : à Lomé, c&apos;est lui qui guide le livreur.{" "}
          <Link href="/app/aide" className="underline">
            Aide
          </Link>
        </p>
      </div>
    </div>
  );
}

export default function AddressesPage() {
  return (
    <Suspense>
      <Addresses />
    </Suspense>
  );
}
