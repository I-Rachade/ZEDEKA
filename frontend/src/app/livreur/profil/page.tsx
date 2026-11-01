"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { InstallPrompt } from "@/components/AppRuntime";
import PinField from "@/components/PinField";
import { Icon } from "@/components/panel/icons";
import { usePush } from "@/components/panel/partner";
import { card, primary, secondary, Skeleton, TopBar } from "@/app/app/ui";
import { driverFetch, driverLogout, tel, type DriverProfile } from "@/lib/driver";
import { driverClient } from "../client";
import { LanguageSwitch, useI18n } from "@/lib/i18n/client";

const VEHICLE = { MOTO: "Moto", VELO: "Vélo", VOITURE: "Voiture" };

// Profil (lecture seule : les changements passent par la répartition), code PIN, aide, alertes, déconnexion.
export default function DriverProfilePage() {
  const router = useRouter();
  const push = usePush(driverClient);
  const [me, setMe] = useState<DriverProfile | null>(null);
  const [test, setTest] = useState<string | null>(null);
  const { t, locale } = useI18n();
  useEffect(() => {
    driverFetch<DriverProfile>("/me").then(setMe, () => {});
  }, []);

  const wa = me?.dispatchPhone ? `https://wa.me/${me.dispatchPhone.replace(/\D/g, "")}` : null;

  return (
    <div>
      <TopBar title="Profil" />
      <div className="space-y-4 px-4 py-4">
        {!me ? (
          <Skeleton rows={2} />
        ) : (
          <section className={`${card} p-4`}>
            <div className="flex items-center gap-3">
              <span className="grid h-14 w-14 place-items-center rounded-full bg-emerald-100 text-xl font-bold text-emerald-800">{me.name.charAt(0)}</span>
              <div>
                <p className="text-lg font-semibold">{me.name}</p>
                <p className="text-sm text-stone-500">{me.phone}</p>
                <p className="text-xs font-medium text-emerald-700">{me.employment === "STAFF" ? t("Salarié Zedeka") : t("Livreur indépendant")}</p>
              </div>
            </div>
            <dl className="mt-4 grid grid-cols-3 gap-2 text-center text-sm">
              <div className="rounded-xl bg-stone-50 p-2">
                <dt className="text-xs text-stone-500">{t("Véhicule")}</dt>
                <dd className="font-semibold">{t(VEHICLE[me.vehicle])}</dd>
              </div>
              <div className="rounded-xl bg-stone-50 p-2">
                <dt className="text-xs text-stone-500">{t("Zone")}</dt>
                <dd className="font-semibold">{me.zone?.name.split(" – ")[0] ?? t("Toutes")}</dd>
              </div>
              <div className="rounded-xl bg-stone-50 p-2">
                <dt className="text-xs text-stone-500">{t("Livraisons")}</dt>
                <dd className="font-semibold">{me.delivered}</dd>
              </div>
            </dl>
            <p className="mt-3 text-xs text-stone-500">{t("Livreur depuis le {date}. Pour changer ces informations, appelez la répartition.", { date: new Date(me.createdAt).toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric" }) })}</p>
          </section>
        )}

        <section className={`${card} space-y-3 p-4`}>
          <h2 className="font-semibold">{t("Aide")}</h2>
          <p className="text-sm text-stone-600">{t("Un souci avec une course, un client ou votre compte ? La répartition répond pendant les heures de service.")}</p>
          {me?.dispatchPhone ? (
            <div className="grid grid-cols-2 gap-2">
              <a href={tel(me.dispatchPhone.startsWith("+") ? me.dispatchPhone : `+${me.dispatchPhone}`)} className={secondary}>
                <Icon name="phone" className="h-5 w-5" /> {t("Appeler")}
              </a>
              {wa && (
                <a href={wa} target="_blank" rel="noreferrer" className={secondary}>
                  WhatsApp
                </a>
              )}
            </div>
          ) : (
            <p className="text-sm text-stone-500">{t("Numéro de la répartition pas encore configuré.")}</p>
          )}
        </section>

        <ChangePin hasPin={me?.hasPin ?? true} />

        <section className={`${card} flex items-center justify-between gap-3 p-4`}>
          <h2 className="flex items-center gap-2 font-semibold">
            <Icon name="globe" className="h-5 w-5" /> {t("Langue")}
          </h2>
          <LanguageSwitch />
        </section>

        <section className={`${card} space-y-3 p-4`}>
          <h2 className="font-semibold">{t("Alertes")}</h2>
          <p className="text-sm text-stone-600">
            {t("Sur ce téléphone :")}{" "}
            <strong>{push.state === "on" ? t("activées") : push.state === "denied" ? t("bloquées par le navigateur") : push.state === "unsupported" ? t("non prises en charge") : push.state === "loading" ? "…" : t("désactivées")}</strong>
          </p>
          {push.state === "off" && (
            <button onClick={push.enable} className={secondary}>
              {t("Activer les alertes")}
            </button>
          )}
          {push.state === "on" && (
            <button onClick={() => push.test().then((r) => setTest(r.sent ? t("Notification envoyée.") : t("Aucun appareil n'a reçu la notification.")), (e: Error) => setTest(e.message))} className={secondary}>
              {t("Envoyer un test")}
            </button>
          )}
          {test && <p className="text-sm text-stone-600">{test}</p>}
          <InstallPrompt always />
        </section>

        <button
          onClick={() => {
            driverLogout();
            router.replace("/livreur/connexion");
          }}
          className={`${secondary} text-red-700`}
        >
          <Icon name="logout" className="h-5 w-5" /> {t("Se déconnecter")}
        </button>
        <button
          onClick={async () => {
            if (!window.confirm(t("Vous serez déconnecté sur tous les téléphones où vous êtes connecté, celui-ci compris. Continuer ?"))) return;
            try {
              await driverFetch("/sessions/logout-all", { method: "POST" });
              driverLogout();
              router.replace("/livreur/connexion");
            } catch (e) {
              setTest((e as Error).message);
            }
          }}
          className="w-full py-2 text-sm text-stone-600"
        >
          {t("Se déconnecter de tous les appareils")}
        </button>
      </div>
    </div>
  );
}

// Changer son code PIN de connexion : l'ancien est demandé.
function ChangePin({ hasPin }: { hasPin: boolean }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <section className={`${card} space-y-3 p-4`}>
      <h2 className="font-semibold">{t("Code PIN")}</h2>
      {!open ? (
        <>
          {note && <p className={`text-sm ${note.ok ? "text-emerald-700" : "text-red-700"}`}>{note.text}</p>}
          <button onClick={() => (setOpen(true), setNote(null))} className={secondary}>
            {hasPin ? t("Changer mon code PIN") : t("Créer mon code PIN")}
          </button>
        </>
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            if (f.get("pin") !== f.get("pin2")) return setNote({ ok: false, text: t("Les deux codes PIN ne sont pas identiques") });
            setBusy(true);
            try {
              await driverFetch("/me/pin", { method: "PUT", body: { pin: f.get("pin"), currentPin: f.get("currentPin") ?? undefined } });
              setOpen(false);
              setNote({ ok: true, text: t("Code PIN enregistré.") });
            } catch (err) {
              setNote({ ok: false, text: (err as Error).message });
            } finally {
              setBusy(false);
            }
          }}
          className="space-y-3"
        >
          {hasPin && <PinField name="currentPin" label={t("Code PIN actuel")} autoFocus />}
          <PinField name="pin" label={t("Nouveau code PIN")} hint={t("4 chiffres")} autoFocus={!hasPin} />
          <PinField name="pin2" label={t("Confirmez le code PIN")} />
          {note && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{note.text}</p>}
          <button disabled={busy} className={primary}>
            {busy ? t("Enregistrement…") : t("Enregistrer")}
          </button>
          <button type="button" onClick={() => (setOpen(false), setNote(null))} className="w-full text-center text-sm text-stone-600">
            {t("Annuler")}
          </button>
        </form>
      )}
    </section>
  );
}
