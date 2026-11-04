"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { card, input, primary, secondary, TopBar } from "@/app/app/ui";
import TermsConsent from "@/components/legal/TermsConsent";
import { Icon } from "@/components/panel/icons";
import type { Point } from "@/components/MapPicker";
import { logout } from "@/lib/customer";
import { LanguageSwitch, useT } from "@/lib/i18n/client";
import { LOGIN_HREF, merchantFetch, WEEK_DAYS } from "@/lib/merchant";
import { useMerchant } from "../MerchantShell";

const MapPicker = dynamic(() => import("@/components/MapPicker"), { ssr: false });

// Lundi d'abord, dimanche à la fin.
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

// Ma boutique : création (première visite) ou modification. Le point de ramassage placé sur la carte donne le
// prix au km de chaque colis ; sans lui, le prix minimum s'applique et Zedeka le confirme.
export default function ShopPage() {
  const t = useT();
  const router = useRouter();
  const { me, reload } = useMerchant();
  const m = me?.merchant ?? null;
  const creating = !m;
  const [shopName, setShopName] = useState(m?.shopName ?? "");
  const [phone, setPhone] = useState(m?.phone ?? me?.account.phone ?? "");
  const [pickupAddress, setPickupAddress] = useState(m?.pickupAddress ?? "");
  const [point, setPoint] = useState<Point | null>(m && m.pickupLatitude !== null && m.pickupLongitude !== null ? { latitude: m.pickupLatitude, longitude: m.pickupLongitude } : null);
  const [days, setDays] = useState<number[]>(m?.pickupDays ?? []);
  const [time, setTime] = useState(m?.pickupTime ?? "");
  const [payoutPhone, setPayoutPhone] = useState(m?.payoutPhone ?? "");
  const [terms, setTerms] = useState(false);
  const [map, setMap] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setNote(null);
    const body = {
      shopName,
      phone,
      pickupAddress,
      ...(point ? { pickupLatitude: point.latitude, pickupLongitude: point.longitude } : {}),
      pickupDays: days,
      pickupTime: time,
      payoutPhone,
      ...(creating ? { acceptTerms: terms } : {}),
    };
    try {
      await merchantFetch("/me", { method: creating ? "POST" : "PATCH", body });
      await reload();
      if (creating) router.replace("/marchand");
      else setNote({ ok: true, text: t("Enregistré.") });
    } catch (err) {
      setNote({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <TopBar title={creating ? "Créer ma boutique" : "Ma boutique"} action={<LanguageSwitch />} />
      <form onSubmit={save} className="space-y-4 px-4 pb-8 pt-4">
        {creating && (
          <div className="rounded-[20px] bg-emerald-600/10 p-4 text-[15px] text-emerald-900">
            <p className="font-semibold">{t("Bienvenue sur Zedeka Marchand")}</p>
            <p className="mt-1 text-sm">{t("Vendez en ligne, on livre à Lomé : envois groupés, ramassage à votre boutique, et le livreur encaisse vos articles à la livraison.")}</p>
          </div>
        )}

        <section className={`${card} card-line space-y-3 p-4`}>
          <Field label="Nom de la boutique">
            <input className={input} value={shopName} onChange={(e) => setShopName(e.target.value)} required minLength={2} maxLength={80} placeholder={t("Ex. Ama Fashion")} />
          </Field>
          <Field label="Téléphone de la boutique">
            <input className={input} value={phone} onChange={(e) => setPhone(e.target.value)} required inputMode="tel" />
          </Field>
        </section>

        <section className={`${card} card-line space-y-3 p-4`}>
          <h2 className="text-[17px] font-bold">{t("Point de ramassage")}</h2>
          <Field label="Adresse et repère">
            <input className={input} value={pickupAddress} onChange={(e) => setPickupAddress(e.target.value)} required minLength={3} maxLength={300} placeholder={t("Quartier, rue, repère")} />
          </Field>
          <button type="button" onClick={() => setMap(true)} className={secondary}>
            <Icon name="pin" className="h-5 w-5" />
            {point ? t("Position placée · modifier") : t("Placer la boutique sur la carte")}
          </button>
          {!point && <p className="text-[13px] text-stone-500">{t("Recommandé : avec la position, chaque colis est payé au km, sans attendre de confirmation.")}</p>}

          <div>
            <p className="mb-1.5 text-[12px] uppercase tracking-wide text-stone-500">{t("Ramassage habituel")}</p>
            <div className="flex flex-wrap gap-1.5">
              {DAY_ORDER.map((d) => {
                const on = days.includes(d);
                return (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setDays((ds) => (on ? ds.filter((x) => x !== d) : [...ds, d].sort()))}
                    className={`rounded-full px-3 py-1.5 text-[14px] font-semibold transition ${on ? "bg-emerald-600 text-white" : "bg-stone-100 text-stone-700"}`}
                  >
                    {t(WEEK_DAYS[d])}
                  </button>
                );
              })}
            </div>
            <label className="mt-2 flex items-center gap-2 text-[15px]">
              <span className="text-stone-600">{t("vers")}</span>
              <input type="time" className={`${input} !w-32`} value={time} onChange={(e) => setTime(e.target.value)} aria-label={t("Heure du ramassage")} />
            </label>
            <p className="mt-1 text-[13px] text-stone-500">{t("L'équipe passe ces jours-là. Les autres jours, appuyez sur « Venez ramasser ».")}</p>
          </div>
        </section>

        <section className={`${card} card-line space-y-3 p-4`}>
          <h2 className="text-[17px] font-bold">{t("Reversements")}</h2>
          <Field label="Numéro mobile money (Flooz ou T-Money)">
            <input className={input} value={payoutPhone} onChange={(e) => setPayoutPhone(e.target.value)} inputMode="tel" placeholder={t("Facultatif")} />
          </Field>
        </section>

        {creating && <TermsConsent checked={terms} onChange={setTerms} />}
        {note && (
          <p role={note.ok ? "status" : "alert"} className={`rounded-xl p-3 text-sm ${note.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`}>
            {note.text}
          </p>
        )}
        <button type="submit" disabled={busy || (creating && !terms)} className={primary}>
          {busy ? t("Enregistrement…") : creating ? t("Créer ma boutique") : t("Enregistrer")}
        </button>

        {!creating && me && (
          <p className="text-center text-[13px] text-stone-500">
            {t("Compte")} : {me.account.name ?? me.account.phone} · {me.account.phone}
          </p>
        )}
        <button
          type="button"
          onClick={() => {
            logout();
            router.replace(LOGIN_HREF);
          }}
          className="w-full rounded-2xl py-3 text-[17px] font-semibold text-red-600 active:bg-red-50"
        >
          {t("Se déconnecter")}
        </button>
      </form>

      {map && (
        <MapPicker
          title={t("Position de la boutique")}
          initial={point}
          onPick={(p) => {
            setPoint(p);
            setMap(false);
          }}
          onClose={() => setMap(false)}
        />
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  const t = useT();
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] uppercase tracking-wide text-stone-500">{t(label)}</span>
      {children}
    </label>
  );
}
