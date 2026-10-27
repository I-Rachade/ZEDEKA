"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { input, primary } from "@/app/app/ui";
import { writeStored } from "@/lib/device";
import { APPLICATION_KEY, driverPublic, saveDriverSession, type Application } from "@/lib/driver";

type Step = { name: "phone" } | { name: "code"; phone: string; devCode?: string };
type Verified = { token?: string; driver?: { name: string; phone: string }; application?: Application };

// Connexion du livreur par son numéro et un code reçu par SMS. Seuls les livreurs validés entrent dans l'application.
export default function DriverLogin() {
  const router = useRouter();
  const [step, setStep] = useState<Step>({ name: "phone" });
  const [error, setError] = useState<{ message: string; apply?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(0);

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      const err = e as Error & { retryIn?: number; apply?: boolean };
      if (err.retryIn) setWait(err.retryIn);
      setError({ message: err.message, apply: err.apply });
    } finally {
      setBusy(false);
    }
  }

  const send = (phone: string) =>
    run(async () => {
      const r = await driverPublic<{ phone: string; devCode?: string }>("/otp/request", { phone });
      setStep({ name: "code", phone: r.phone, devCode: r.devCode });
      setWait(60);
    });

  return (
    <div className="flex min-h-screen flex-col px-5 py-8">
      <div className="mb-8 flex items-center gap-3">
        <span className="grid h-12 w-12 place-items-center rounded-2xl bg-emerald-700 text-xl font-bold text-white">Z</span>
        <div>
          <p className="text-lg font-bold">Zedeka Livreur</p>
          <p className="text-sm text-stone-500">Vos courses à Lomé</p>
        </div>
      </div>

      {step.name === "phone" ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(String(new FormData(e.currentTarget).get("phone") ?? ""));
          }}
          className="space-y-4"
        >
          <div>
            <h1 className="text-2xl font-bold">Connexion</h1>
            <p className="text-sm text-stone-600">Le numéro donné à Zedeka lors de votre inscription. Vous recevez un code par SMS.</p>
          </div>
          <div className="flex items-stretch gap-2">
            <span className="grid place-items-center rounded-xl border border-stone-300 bg-stone-100 px-3 font-medium">+228</span>
            <input name="phone" type="tel" inputMode="tel" autoComplete="tel-national" required placeholder="90 00 00 00" aria-label="Numéro de téléphone" className={input} autoFocus />
          </div>
          {error && (
            <div className="rounded-xl bg-red-50 p-3 text-sm text-red-700">
              <p>{error.message}</p>
              {error.apply && (
                <Link href="/devenir-livreur" className="mt-1 inline-block font-semibold underline">
                  Devenir livreur Zedeka
                </Link>
              )}
            </div>
          )}
          <button disabled={busy || wait > 0} className={primary}>
            {busy ? "Envoi…" : wait > 0 ? `Patientez ${wait} s` : "Recevoir le code"}
          </button>
        </form>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const code = String(new FormData(e.currentTarget).get("code") ?? "").replace(/\D/g, "");
            run(async () => {
              const r = await driverPublic<Verified>("/otp/verify", { phone: step.phone, code });
              if (r.token && r.driver) {
                writeStored(APPLICATION_KEY, null);
                saveDriverSession({ token: r.token, ...r.driver });
                router.replace("/livreur");
              } else if (r.application) {
                writeStored(APPLICATION_KEY, r.application);
                router.replace("/livreur/candidature");
              }
            });
          }}
          className="space-y-4"
        >
          <div>
            <h1 className="text-2xl font-bold">Code reçu</h1>
            <p className="text-sm text-stone-600">
              Envoyé au {step.phone.replace(/^\+228(\d{2})(\d{2})(\d{2})(\d{2})$/, "$1 $2 $3 $4")}.{" "}
              <button type="button" onClick={() => setStep({ name: "phone" })} className="text-emerald-700 underline">
                Changer
              </button>
            </p>
          </div>
          {step.devCode && (
            <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
              Mode test, aucun SMS n&apos;est envoyé. Code : <strong className="font-mono text-base tracking-widest">{step.devCode}</strong>
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
            aria-label="Code à 6 chiffres"
            className={`${input} text-center font-mono text-2xl tracking-[0.5em]`}
            autoFocus
          />
          {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error.message}</p>}
          <button disabled={busy} className={primary}>
            {busy ? "Vérification…" : "Valider"}
          </button>
          <button type="button" disabled={busy || wait > 0} onClick={() => send(step.phone)} className="w-full text-center text-sm text-emerald-700 disabled:text-stone-400">
            {wait > 0 ? `Renvoyer le code dans ${wait} s` : "Renvoyer le code"}
          </button>
        </form>
      )}

      <p className="mt-auto pt-10 text-center text-sm text-stone-500">
        Pas encore livreur ?{" "}
        <Link href="/devenir-livreur" className="font-medium text-emerald-700 underline">
          Envoyer une candidature
        </Link>
      </p>
    </div>
  );
}
