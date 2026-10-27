"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { InstallPrompt } from "@/components/AppRuntime";
import { Icon } from "@/components/panel/icons";
import { usePush } from "@/components/panel/partner";
import { card, secondary, Skeleton, TopBar } from "@/app/app/ui";
import { driverFetch, driverLogout, tel, type DriverProfile } from "@/lib/driver";
import { driverClient } from "../client";

const VEHICLE = { MOTO: "Moto", VELO: "Vélo", VOITURE: "Voiture" };

// Profil (lecture seule : les changements passent par la répartition), aide, alertes, déconnexion.
export default function DriverProfilePage() {
  const router = useRouter();
  const push = usePush(driverClient);
  const [me, setMe] = useState<DriverProfile | null>(null);
  const [test, setTest] = useState<string | null>(null);
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
              </div>
            </div>
            <dl className="mt-4 grid grid-cols-3 gap-2 text-center text-sm">
              <div className="rounded-xl bg-stone-50 p-2">
                <dt className="text-xs text-stone-500">Véhicule</dt>
                <dd className="font-semibold">{VEHICLE[me.vehicle]}</dd>
              </div>
              <div className="rounded-xl bg-stone-50 p-2">
                <dt className="text-xs text-stone-500">Zone</dt>
                <dd className="font-semibold">{me.zone?.name.split(" – ")[0] ?? "Toutes"}</dd>
              </div>
              <div className="rounded-xl bg-stone-50 p-2">
                <dt className="text-xs text-stone-500">Livraisons</dt>
                <dd className="font-semibold">{me.delivered}</dd>
              </div>
            </dl>
            <p className="mt-3 text-xs text-stone-500">Livreur depuis le {new Date(me.createdAt).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}. Pour changer ces informations, appelez la répartition.</p>
          </section>
        )}

        <section className={`${card} space-y-3 p-4`}>
          <h2 className="font-semibold">Aide</h2>
          <p className="text-sm text-stone-600">Un souci avec une course, un client ou votre compte ? La répartition répond pendant les heures de service.</p>
          {me?.dispatchPhone ? (
            <div className="grid grid-cols-2 gap-2">
              <a href={tel(me.dispatchPhone.startsWith("+") ? me.dispatchPhone : `+${me.dispatchPhone}`)} className={secondary}>
                <Icon name="phone" className="h-5 w-5" /> Appeler
              </a>
              {wa && (
                <a href={wa} target="_blank" rel="noreferrer" className={secondary}>
                  WhatsApp
                </a>
              )}
            </div>
          ) : (
            <p className="text-sm text-stone-500">Numéro de la répartition pas encore configuré.</p>
          )}
        </section>

        <section className={`${card} space-y-3 p-4`}>
          <h2 className="font-semibold">Alertes</h2>
          <p className="text-sm text-stone-600">
            Sur ce téléphone :{" "}
            <strong>{push.state === "on" ? "activées" : push.state === "denied" ? "bloquées par le navigateur" : push.state === "unsupported" ? "non prises en charge" : push.state === "loading" ? "…" : "désactivées"}</strong>
          </p>
          {push.state === "off" && (
            <button onClick={push.enable} className={secondary}>
              Activer les alertes
            </button>
          )}
          {push.state === "on" && (
            <button onClick={() => push.test().then((r) => setTest(r.sent ? "Notification envoyée." : "Aucun appareil n'a reçu la notification."), (e: Error) => setTest(e.message))} className={secondary}>
              Envoyer un test
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
          <Icon name="logout" className="h-5 w-5" /> Se déconnecter
        </button>
      </div>
    </div>
  );
}
