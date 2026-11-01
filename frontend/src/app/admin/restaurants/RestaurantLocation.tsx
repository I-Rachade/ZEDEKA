"use client";

import { useState } from "react";
import MapPicker, { type Point } from "@/components/MapPicker";
import PointPreview from "@/components/PointPreview";
import { Icon } from "@/components/panel/icons";
import { adminFetch, type AdminRestaurant, type RestaurantLocationLink } from "@/lib/admin";
import { useI18n, useT } from "@/lib/i18n/client";
import { button, buttonGhost } from "../ui";

// Position choisie à la création : placée sur la carte, ou demandée au gérant par un lien.
export type LocationChoice = { mode: "map"; point: Point } | { mode: "request" } | null;

const when = (iso: string, locale: string) =>
  new Date(iso).toLocaleString(locale, { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lome" });

const coords = (p: Point) => `${p.latitude.toFixed(5)}, ${p.longitude.toFixed(5)}`;

// Deux façons de donner la position, l'une ou l'autre obligatoire avant de créer le restaurant.
export function LocationChoiceField({ value, onChange }: { value: LocationChoice; onChange: (v: LocationChoice) => void }) {
  const t = useT();
  const [picking, setPicking] = useState(false);
  const option = (on: boolean) =>
    `flex w-full items-start gap-3 rounded-xl border p-3 text-left text-sm ${on ? "border-emerald-600 bg-emerald-50 ring-1 ring-emerald-600" : "border-stone-300 bg-white hover:bg-stone-50"}`;

  return (
    <fieldset className="space-y-2 sm:col-span-2">
      <legend className="mb-1 text-sm font-semibold">
        {t("Position du restaurant")} <span className="font-normal text-red-700">{t("(obligatoire)")}</span>
      </legend>
      <p className="text-xs text-stone-500">{t("Elle sert de point de retrait aux livreurs et au calcul des frais de livraison au km.")}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <button type="button" aria-pressed={value?.mode === "map"} onClick={() => setPicking(true)} className={option(value?.mode === "map")}>
          <Icon name="map" className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" />
          <span>
            <span className="block font-semibold">{t("Placer sur la carte")}</span>
            <span className="block text-stone-500">{t("Recherchez le lieu ou collez un lien Google Maps, puis ajustez l'épingle.")}</span>
          </span>
        </button>
        <button type="button" aria-pressed={value?.mode === "request"} onClick={() => onChange({ mode: "request" })} className={option(value?.mode === "request")}>
          <Icon name="mail" className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" />
          <span>
            <span className="block font-semibold">{t("Demander au gérant")}</span>
            <span className="block text-stone-500">{t("Un lien à lui envoyer : il partage la position depuis le restaurant. Masqué aux clients en attendant.")}</span>
          </span>
        </button>
      </div>
      {value?.mode === "map" && (
        <PointPreview point={value.point}>
          <span className="text-stone-600">{coords(value.point)}</span>{" "}
          <button type="button" onClick={() => setPicking(true)} className="font-medium text-emerald-700 underline">
            {t("Déplacer")}
          </button>
        </PointPreview>
      )}
      {picking && (
        <MapPicker
          title="Position du restaurant"
          initial={value?.mode === "map" ? value.point : null}
          onClose={() => setPicking(false)}
          onPick={(point) => {
            onChange({ mode: "map", point });
            setPicking(false);
          }}
        />
      )}
    </fieldset>
  );
}

// Lien à envoyer au gérant : sur WhatsApp au numéro du restaurant, ou copié.
export function RestaurantLinkCard({ link }: { link: RestaurantLocationLink }) {
  const { t, locale } = useI18n();
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(link.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      window.prompt(t("Copiez ce message :"), link.text);
    }
  }
  return (
    <div className="space-y-2 rounded-xl bg-emerald-50 p-3 text-sm">
      <p className="font-semibold text-emerald-900">{t("Lien prêt à envoyer au gérant")}</p>
      <p className="break-all rounded-lg bg-white p-2 text-stone-700">{link.text}</p>
      <div className="flex flex-wrap gap-2">
        <a href={link.whatsappUrl} target="_blank" rel="noopener noreferrer" className={button}>
          <Icon name="phone" className="h-4 w-4" /> {t("Envoyer sur WhatsApp")}
        </a>
        <button type="button" onClick={copy} className={buttonGhost}>
          {copied ? t("Message copié") : t("Copier le message")}
        </button>
      </div>
      <p className="text-xs text-stone-500">{t("Valable jusqu'à {time}.", { time: when(link.expiresAt, locale) })}</p>
    </div>
  );
}

// Fiche du restaurant : la position, son aperçu, et les deux façons de la donner ou de la changer.
export function PositionBlock({ restaurant, run, reload }: { restaurant: AdminRestaurant; run: (fn: () => Promise<unknown>) => Promise<boolean>; reload: () => Promise<unknown> }) {
  const { t, locale } = useI18n();
  const [picking, setPicking] = useState(false);
  const [link, setLink] = useState<RestaurantLocationLink | null>(null);
  const point = restaurant.latitude !== null && restaurant.longitude !== null ? { latitude: restaurant.latitude, longitude: restaurant.longitude } : null;
  const state = restaurant.locationState ?? (point ? "SET" : "MISSING");

  async function place(p: Point) {
    setPicking(false);
    const ok = await run(() => adminFetch(`/restaurants/${restaurant.id}`, { method: "PATCH", body: { latitude: p.latitude, longitude: p.longitude } }));
    if (ok) {
      setLink(null);
      await reload();
    }
  }

  async function ask() {
    let next: RestaurantLocationLink | null = null;
    const ok = await run(async () => {
      next = await adminFetch<RestaurantLocationLink>(`/restaurants/${restaurant.id}/location-link`, { method: "POST" });
    });
    if (ok && next) {
      setLink(next);
      await reload();
    }
  }

  return (
    <section id="position" className="space-y-3 rounded-xl border border-stone-200 bg-white p-4">
      <h2 className="flex items-center gap-2 font-semibold">
        <Icon name="pin" className="h-4 w-4 text-stone-500" /> {t("Position du restaurant")}
      </h2>
      {point ? (
        <PointPreview point={point}>
          <span className="text-stone-600">{coords(point)}</span>
        </PointPreview>
      ) : (
        <p role="status" className={`rounded-xl p-3 text-sm ${state === "REQUESTED" ? "bg-amber-50 text-amber-900" : "bg-red-50 text-red-800"}`}>
          {state === "REQUESTED"
            ? t("Position demandée au gérant, en attente de sa réponse (lien valable jusqu'à {time}). Le restaurant reste masqué aux clients.", {
                time: restaurant.locationRequestExpiresAt ? when(restaurant.locationRequestExpiresAt, locale) : "",
              })
            : state === "EXPIRED"
              ? t("Le gérant n'a pas répondu et le lien a expiré. Placez le restaurant vous-même ou envoyez un nouveau lien.")
              : t("Position manquante : les livreurs ne savent pas où récupérer les commandes et les frais au km ne peuvent pas être calculés.")}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setPicking(true)} className={button}>
          <Icon name="map" className="h-4 w-4" /> {point ? t("Déplacer sur la carte") : t("Placer sur la carte")}
        </button>
        <button type="button" onClick={ask} className={buttonGhost}>
          <Icon name="mail" className="h-4 w-4" /> {state === "REQUESTED" || state === "EXPIRED" ? t("Envoyer un nouveau lien au gérant") : t("Demander la position au gérant")}
        </button>
      </div>
      {link && <RestaurantLinkCard link={link} />}
      {picking && <MapPicker title="Position du restaurant" initial={point} onClose={() => setPicking(false)} onPick={place} />}
    </section>
  );
}
