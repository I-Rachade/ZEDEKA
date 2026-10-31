"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import PinField from "@/components/PinField";
import { Icon, type IconName } from "@/components/panel/icons";
import { input, primary } from "@/app/app/ui";
import { writeStored } from "@/lib/device";
import { APPLICATION_KEY, driverFetch, driverPublic, saveDriverSession, type Application } from "@/lib/driver";
import { LanguageSwitch, useT } from "@/lib/i18n/client";

// Connexion : numéro ou e-mail + code PIN, comme les clients. Code SMS ou e-mail seulement pour un PIN oublié
// ou pour un livreur ajouté par l'admin sans PIN, qui choisit alors le sien.
// via : le livreur s'identifie avec son numéro ou son e-mail ; id garde ce qu'il a saisi d'un écran à l'autre.
type Via = "phone" | "email";
type Step = { name: "pin"; id?: string } | { name: "forgot"; id?: string } | { name: "code"; via: Via; id: string; devCode?: string } | { name: "newPin" };
type Opened = { token?: string; driver?: { name: string; phone: string; hasPin: boolean }; application?: Application };

const shownPhone = (phone: string) => phone.replace(/^\+228(\d{2})(\d{2})(\d{2})(\d{2})$/, "$1 $2 $3 $4");

export default function DriverLogin() {
  const router = useRouter();
  const [step, setStep] = useState<Step>({ name: "pin" });
  const [via, setVia] = useState<Via>("phone");
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

  // Code pour un PIN oublié : par SMS au numéro, ou par e-mail à l'adresse du compte.
  const send = (sendVia: Via, id: string) =>
    run(async () => {
      if (sendVia === "phone") {
        const r = await driverPublic<{ phone: string; devCode?: string }>("/otp/request", { phone: id });
        setStep({ name: "code", via: "phone", id: r.phone, devCode: r.devCode });
      } else {
        const r = await driverPublic<{ email: string; devCode?: string }>("/email/request", { email: id });
        setStep({ name: "code", via: "email", id: r.email, devCode: r.devCode });
      }
      setWait(60);
    });

  // Numéro (+228) ou adresse e-mail, selon le choix en haut du formulaire.
  const idField = (defaultValue?: string) =>
    via === "phone" ? (
      <div className="flex items-stretch gap-2">
        <span className="grid place-items-center rounded-xl border border-stone-300 bg-stone-100 px-3 font-medium">+228</span>
        <input
          key="phone"
          name="id"
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          required
          defaultValue={defaultValue && !defaultValue.includes("@") ? shownPhone(defaultValue) : undefined}
          placeholder="90 00 00 00"
          aria-label={t("Numéro de téléphone")}
          className={input}
          autoFocus={!defaultValue}
        />
      </div>
    ) : (
      <input
        key="email"
        name="id"
        type="email"
        autoComplete="email"
        required
        defaultValue={defaultValue?.includes("@") ? defaultValue : undefined}
        placeholder="nom@exemple.com"
        aria-label={t("Adresse e-mail")}
        className={input}
        autoFocus={!defaultValue}
      />
    );

  const viaChoice = (
    <div className="grid grid-cols-2 gap-2 text-[15px] font-semibold">
      {(
        [
          ["phone", "phone", t("Téléphone")],
          ["email", "mail", t("E-mail")],
        ] as [Via, IconName, string][]
      ).map(([v, icon, label]) => (
        <button
          key={v}
          type="button"
          aria-pressed={via === v}
          onClick={() => (setVia(v), setError(null))}
          className={`flex items-center justify-center gap-2 rounded-xl py-2.5 transition active:scale-[0.98] ${
            via === v ? "bg-emerald-600/10 text-emerald-700 ring-1 ring-emerald-600/30" : "bg-white text-stone-600 ring-1 ring-stone-200"
          }`}
        >
          <Icon name={icon} className="h-[18px] w-[18px]" />
          {label}
        </button>
      ))}
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
            const id = String(f.get("id") ?? "").trim();
            run(async () => {
              setStep({ name: "pin", id });
              const r = await driverPublic<Opened>("/pin/login", { [via]: id, pin: String(f.get("pin") ?? "") });
              opened(r, false);
            });
          }}
          className="space-y-4"
        >
          <div>
            <h1 className="text-2xl font-bold">{t("Connexion")}</h1>
            <p className="text-sm text-stone-600">{t("Votre numéro ou votre e-mail, et le code PIN choisi à votre inscription.")}</p>
          </div>
          {viaChoice}
          {idField(step.id)}
          <PinField name="pin" label={t("Code PIN")} hint={t("4 chiffres")} autoFocus={!!step.id} />
          {error && (
            <div className="rounded-xl bg-red-50 p-3 text-sm text-red-700">
              <p>{error.message}</p>
              {error.noPin && (
                <button type="button" onClick={() => go({ name: "forgot", id: step.id })} className="mt-1 font-semibold underline">
                  {t("Recevoir un code")}
                </button>
              )}
            </div>
          )}
          <button disabled={busy} className={primary}>
            {busy ? t("Connexion…") : t("Se connecter")}
          </button>
          <button type="button" onClick={() => go({ name: "forgot", id: step.id })} className="w-full text-center text-sm font-medium text-emerald-700">
            {t("Code PIN oublié ?")}
          </button>
        </form>
      )}

      {step.name === "forgot" && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(via, String(new FormData(e.currentTarget).get("id") ?? "").trim());
          }}
          className="space-y-4"
        >
          <div>
            <h1 className="text-2xl font-bold">{t("Code PIN oublié")}</h1>
            <p className="text-sm text-stone-600">{t("Recevez un code par SMS ou par e-mail, puis choisissez un nouveau code PIN.")}</p>
          </div>
          {viaChoice}
          {idField(step.id)}
          {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error.message}</p>}
          <button disabled={busy || wait > 0} className={primary}>
            {busy ? t("Envoi…") : wait > 0 ? t("Patientez {n} s", { n: wait }) : t("Recevoir le code")}
          </button>
          <button type="button" onClick={() => go({ name: "pin", id: step.id })} className="w-full text-center text-sm text-emerald-700">
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
              const r = step.via === "phone" ? await driverPublic<Opened>("/otp/verify", { phone: step.id, code }) : await driverPublic<Opened>("/email/verify", { email: step.id, code });
              opened(r, true);
            });
          }}
          className="space-y-4"
        >
          <div>
            <h1 className="text-2xl font-bold">{t("Code reçu")}</h1>
            <p className="text-sm text-stone-600">
              {step.via === "phone" ? t("Envoyé au {phone}.", { phone: shownPhone(step.id) }) : t("Envoyé à {email}, s'il correspond à un compte livreur.", { email: step.id })}{" "}
              <button type="button" onClick={() => go({ name: "forgot", id: step.id })} className="text-emerald-700 underline">
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
          <button type="button" disabled={busy || wait > 0} onClick={() => send(step.via, step.id)} className="w-full text-center text-sm text-emerald-700 disabled:text-stone-400">
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
