"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import PinField from "@/components/PinField";
import { input, primary } from "@/app/app/ui";
import { writeStored } from "@/lib/device";
import { APPLICATION_KEY, driverFetch, driverPublic, saveDriverSession, type Application } from "@/lib/driver";
import { LanguageSwitch, useT } from "@/lib/i18n/client";

// Connexion : numéro + code PIN, comme les clients. Code SMS seulement pour un PIN oublié
// ou pour un livreur ajouté par l'admin sans PIN, qui choisit alors le sien.
type Step = { name: "pin"; phone?: string } | { name: "phone"; phone?: string } | { name: "code"; phone: string; devCode?: string } | { name: "newPin" };
type Opened = { token?: string; driver?: { name: string; phone: string; hasPin: boolean }; application?: Application };

const shownPhone = (phone: string) => phone.replace(/^\+228(\d{2})(\d{2})(\d{2})(\d{2})$/, "$1 $2 $3 $4");

export default function DriverLogin() {
  const router = useRouter();
  const [step, setStep] = useState<Step>({ name: "pin" });
  const [error, setError] = useState<{ message: string; noPin?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(0);
  const t = useT();

  useEffect(() => {
    if (wait <= 0) return;
    const timer = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);

  function go(next: Step) {
    setError(null);
    setStep(next);
  }

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      const err = e as Error & { retryIn?: number; noPin?: boolean };
      if (err.retryIn) setWait(err.retryIn);
      setError({ message: err.message, noPin: err.noPin });
    } finally {
      setBusy(false);
    }
  }

  // Identité vérifiée : l'application s'ouvre, ou la candidature s'affiche si elle n'est pas validée.
  function opened(r: Opened, choosePin: boolean) {
    if (r.token && r.driver) {
      writeStored(APPLICATION_KEY, null);
      saveDriverSession({ token: r.token, name: r.driver.name, phone: r.driver.phone });
      if (choosePin || !r.driver.hasPin) setStep({ name: "newPin" });
      else router.replace("/livreur");
    } else if (r.application) {
      writeStored(APPLICATION_KEY, r.application);
      router.replace("/livreur/candidature");
    }
  }

  const send = (phone: string) =>
    run(async () => {
      const r = await driverPublic<{ phone: string; devCode?: string }>("/otp/request", { phone });
      setStep({ name: "code", phone: r.phone, devCode: r.devCode });
      setWait(60);
    });

  const phoneField = (defaultValue?: string) => (
    <div className="flex items-stretch gap-2">
      <span className="grid place-items-center rounded-xl border border-stone-300 bg-stone-100 px-3 font-medium">+228</span>
      <input
        name="phone"
        type="tel"
        inputMode="tel"
        autoComplete="tel-national"
        required
        defaultValue={defaultValue ? shownPhone(defaultValue) : undefined}
        placeholder="90 00 00 00"
        aria-label={t("Numéro de téléphone")}
        className={input}
        autoFocus={!defaultValue}
      />
    </div>
  );

  return (
    <div className="flex min-h-screen flex-col px-5 py-8">
      <div className="mb-8 flex items-center gap-3">
        <span className="grid h-12 w-12 place-items-center rounded-2xl bg-emerald-700 text-xl font-bold text-white">Z</span>
        <div className="flex-1">
          <p className="text-lg font-bold">{t("Zedeka Livreur")}</p>
          <p className="text-sm text-stone-500">{t("Vos courses à Lomé")}</p>
        </div>
        <LanguageSwitch />
      </div>

      {step.name === "pin" && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const phone = String(f.get("phone") ?? "");
            run(async () => {
              setStep({ name: "pin", phone });
              const r = await driverPublic<Opened>("/pin/login", { phone, pin: String(f.get("pin") ?? "") });
              opened(r, false);
            });
          }}
          className="space-y-4"
        >
          <div>
            <h1 className="text-2xl font-bold">{t("Connexion")}</h1>
            <p className="text-sm text-stone-600">{t("Votre numéro et le code PIN choisi à votre inscription.")}</p>
          </div>
          {phoneField(step.phone)}
          <PinField name="pin" label={t("Code PIN")} hint={t("4 chiffres")} autoFocus={!!step.phone} />
          {error && (
            <div className="rounded-xl bg-red-50 p-3 text-sm text-red-700">
              <p>{error.message}</p>
              {error.noPin && (
                <button type="button" onClick={() => go({ name: "phone", phone: step.phone })} className="mt-1 font-semibold underline">
                  {t("Recevoir un code par SMS")}
                </button>
              )}
            </div>
          )}
          <button disabled={busy} className={primary}>
            {busy ? t("Connexion…") : t("Se connecter")}
          </button>
          <button type="button" onClick={() => go({ name: "phone", phone: step.phone })} className="w-full text-center text-sm font-medium text-emerald-700">
            {t("Code PIN oublié ?")}
          </button>
        </form>
      )}

      {step.name === "phone" && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(String(new FormData(e.currentTarget).get("phone") ?? ""));
          }}
          className="space-y-4"
        >
          <div>
            <h1 className="text-2xl font-bold">{t("Code PIN oublié")}</h1>
            <p className="text-sm text-stone-600">{t("Recevez un code par SMS au numéro donné à Zedeka, puis choisissez un nouveau code PIN.")}</p>
          </div>
          {phoneField(step.phone)}
          {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error.message}</p>}
          <button disabled={busy || wait > 0} className={primary}>
            {busy ? t("Envoi…") : wait > 0 ? t("Patientez {n} s", { n: wait }) : t("Recevoir le code")}
          </button>
          <button type="button" onClick={() => go({ name: "pin", phone: step.phone })} className="w-full text-center text-sm text-emerald-700">
            {t("Retour à la connexion")}
          </button>
        </form>
      )}

      {step.name === "code" && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const code = String(new FormData(e.currentTarget).get("code") ?? "").replace(/\D/g, "");
            run(async () => {
              const r = await driverPublic<Opened>("/otp/verify", { phone: step.phone, code });
              opened(r, true);
            });
          }}
          className="space-y-4"
        >
          <div>
            <h1 className="text-2xl font-bold">{t("Code reçu")}</h1>
            <p className="text-sm text-stone-600">
              {t("Envoyé au {phone}.", { phone: shownPhone(step.phone) })}{" "}
              <button type="button" onClick={() => go({ name: "phone", phone: step.phone })} className="text-emerald-700 underline">
                {t("Changer")}
              </button>
            </p>
          </div>
          {step.devCode && (
            <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
              {t("Mode test, aucun SMS n'est envoyé. Code :")} <strong className="font-mono text-base tracking-widest">{step.devCode}</strong>
            </p>
          )}
          <input
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            required
            placeholder="••••••"
            aria-label={t("Code à 6 chiffres")}
            className={`${input} text-center font-mono text-2xl tracking-[0.5em]`}
            autoFocus
          />
          {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error.message}</p>}
          <button disabled={busy} className={primary}>
            {busy ? t("Vérification…") : t("Valider")}
          </button>
          <button type="button" disabled={busy || wait > 0} onClick={() => send(step.phone)} className="w-full text-center text-sm text-emerald-700 disabled:text-stone-400">
            {wait > 0 ? t("Renvoyer le code dans {n} s", { n: wait }) : t("Renvoyer le code")}
          </button>
        </form>
      )}

      {step.name === "newPin" && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            if (f.get("pin") !== f.get("pin2")) {
              setError({ message: t("Les deux codes PIN ne sont pas identiques") });
              return;
            }
            run(async () => {
              await driverFetch("/me/pin", { method: "PUT", body: { pin: f.get("pin") } });
              router.replace("/livreur");
            });
          }}
          className="space-y-4"
        >
          <div>
            <h1 className="text-2xl font-bold">{t("Choisissez votre code PIN")}</h1>
            <p className="text-sm text-stone-600">{t("Vous vous connecterez ensuite avec votre numéro et ce code, sans attendre de SMS.")}</p>
          </div>
          <PinField name="pin" label={t("Nouveau code PIN")} hint={t("4 chiffres")} autoFocus />
          <PinField name="pin2" label={t("Confirmez le code PIN")} />
          <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{t("Évitez 1234, 0000 ou votre année de naissance.")}</p>
          {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error.message}</p>}
          <button disabled={busy} className={primary}>
            {busy ? t("Enregistrement…") : t("Enregistrer et continuer")}
          </button>
        </form>
      )}

      {step.name !== "newPin" && (
        <p className="mt-auto pt-10 text-center text-sm text-stone-500">
          {t("Pas encore livreur ?")}{" "}
          <Link href="/devenir-livreur" className="font-medium text-emerald-700 underline">
            {t("S'inscrire comme livreur")}
          </Link>
        </p>
      )}
    </div>
  );
}
