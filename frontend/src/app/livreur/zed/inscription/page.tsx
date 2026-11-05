"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import PinField from "@/components/PinField";
import { input, primary } from "@/app/app/ui";
import { writeStored } from "@/lib/device";
import { APPLICATION_KEY, driverPublic, type Application } from "@/lib/driver";
import { LanguageSwitch, useT } from "@/lib/i18n/client";
import { photosReady, ZedPhotos, type Photos } from "../ZedForms";

type Step = { name: "phone" } | { name: "details"; phone: string; devCode?: string };

const shownPhone = (phone: string) => phone.replace(/^\+228(\d{2})(\d{2})(\d{2})(\d{2})$/, "$1 $2 $3 $4");

// Inscription d'un conducteur Zed (moto-taxi) : numéro vérifié par SMS, nom, plaque, code PIN et photos du dossier.
// L'équipe vérifie les pièces ; le mode Zed s'ouvre ensuite avec le premier mois offert.
export default function ZedSignup() {
  const router = useRouter();
  const t = useT();
  const [step, setStep] = useState<Step>({ name: "phone" });
  const [photos, setPhotos] = useState<Photos>({});
  const [error, setError] = useState<{
    message: string;
    login?: boolean;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      const err = e as Error & { login?: boolean };
      setError({ message: err.message, login: err.login });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col px-5 py-8">
      <div className="mb-6 flex items-center gap-3">
        <span className="grid h-12 w-12 place-items-center rounded-2xl bg-ink font-display text-lg font-extrabold text-sun">Zed</span>
        <div className="flex-1">
          <p className="text-lg font-bold">{t("Devenir conducteur Zed")}</p>
          <p className="text-sm text-stone-500">{t("Moto-taxi à Lomé avec Zedeka")}</p>
        </div>
        <LanguageSwitch />
      </div>

      <ol className="mb-6 grid grid-cols-3 gap-2 text-center text-xs font-semibold">
        {["Numéro", "Dossier", "Vérification"].map((label, i) => {
          const done = (step.name === "details" ? 1 : 0) >= i;
          return (
            <li key={label} className={`rounded-full px-2 py-1.5 ${done ? "bg-emerald-600 text-white" : "bg-stone-200 text-stone-500"}`}>
              {i + 1}. {t(label)}
            </li>
          );
        })}
      </ol>

      {step.name === "phone" && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const phone = String(new FormData(e.currentTarget).get("phone") ?? "").trim();
            run(async () => {
              const r = await driverPublic<{ phone: string; devCode?: string }>("/zed/signup/otp", { phone });
              setStep({ name: "details", phone: r.phone, devCode: r.devCode });
            });
          }}
          className="space-y-4"
        >
          <div>
            <h1 className="text-2xl font-bold">{t("Votre numéro")}</h1>
            <p className="text-sm text-stone-600">{t("Nous envoyons un code par SMS pour le vérifier. Les clients vous appelleront sur ce numéro.")}</p>
          </div>
          <div className="flex items-stretch gap-2">
            <span className="grid place-items-center rounded-xl border border-stone-300 bg-stone-100 px-3 font-medium">+228</span>
            <input
              name="phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel-national"
              required
              placeholder="90 00 00 00"
              aria-label={t("Numéro de téléphone")}
              className={input}
              autoFocus
            />
          </div>
          {error && (
            <div className="rounded-xl bg-red-50 p-3 text-sm text-red-700">
              <p>{error.message}</p>
              {error.login && (
                <Link href="/livreur/connexion" className="mt-1 inline-block font-semibold underline">
                  {t("Se connecter")}
                </Link>
              )}
            </div>
          )}
          <button disabled={busy} className={primary}>
            {busy ? t("Envoi…") : t("Recevoir le code")}
          </button>
          <ul className="space-y-2 rounded-2xl bg-white p-4 text-sm text-stone-600">
            <li>✓ {t("Les clients à moins de 1 km vous appellent, vous avez 15 secondes pour accepter.")}</li>
            <li>✓ {t("Vous fixez le prix avec le client, sur place.")}</li>
            <li>✓ {t("Plan Zed : premier mois offert, puis au mois ou à la journée.")}</li>
          </ul>
        </form>
      )}

      {step.name === "details" && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            run(async () => {
              const r = await driverPublic<{ application: Application }>("/zed/signup", {
                phone: step.phone,
                code: String(f.get("code") ?? "").trim(),
                name: String(f.get("name") ?? "").trim(),
                plate: String(f.get("plate") ?? "").trim(),
                pin: String(f.get("pin") ?? ""),
                acceptTerms: f.get("terms") === "on",
                photos,
              });
              writeStored(APPLICATION_KEY, r.application);
              router.replace("/livreur/candidature");
            });
          }}
          className="space-y-4"
        >
          <div>
            <h1 className="text-2xl font-bold">{t("Votre dossier")}</h1>
            <p className="text-sm text-stone-600">{t("Code envoyé au {phone}.", { phone: shownPhone(step.phone) })}</p>
          </div>
          {step.devCode && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{t("Mode test : votre code est {code}", { code: step.devCode })}</p>}
          <label className="block">
            <span className="mb-1.5 block text-[13px] font-medium text-stone-600">{t("Code reçu par SMS")}</span>
            <input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required className={input} defaultValue={step.devCode} />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[13px] font-medium text-stone-600">{t("Nom et prénom")}</span>
            <input name="name" autoComplete="name" required minLength={3} maxLength={80} className={input} />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[13px] font-medium text-stone-600">{t("Plaque de la moto")}</span>
            <input name="plate" required minLength={3} maxLength={20} placeholder="TG 1234 AB" className={`${input} uppercase`} />
          </label>
          <PinField name="pin" label={t("Choisissez votre code PIN")} hint={t("4 chiffres")} />
          <ZedPhotos value={photos} onChange={setPhotos} />
          <label className="flex items-start gap-2 text-sm">
            <input name="terms" type="checkbox" required className="mt-1 h-4 w-4 accent-emerald-600" />
            <span>
              {t("J'accepte les")}{" "}
              <Link href="/conditions-livreurs" target="_blank" className="font-semibold text-emerald-700 underline">
                {t("conditions des conducteurs")}
              </Link>{" "}
              {t("et la")}{" "}
              <Link href="/confidentialite" target="_blank" className="font-semibold text-emerald-700 underline">
                {t("politique de confidentialité")}
              </Link>
              .
            </span>
          </label>
          {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error.message}</p>}
          <button disabled={busy || !photosReady(photos)} className={primary}>
            {busy ? t("Envoi du dossier…") : t("Envoyer mon dossier")}
          </button>
          {!photosReady(photos) && <p className="text-center text-xs text-stone-500">{t("Ajoutez votre photo, votre pièce d'identité et votre permis.")}</p>}
        </form>
      )}

      <p className="mt-auto pt-8 text-center text-sm text-stone-500">
        {t("Déjà un compte ?")}{" "}
        <Link href="/livreur/connexion" className="font-semibold text-emerald-700">
          {t("Se connecter")}
        </Link>
      </p>
    </div>
  );
}
