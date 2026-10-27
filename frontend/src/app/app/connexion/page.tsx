"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { customerFetch, getSession, requestCode, saveSession, verifyCode } from "@/lib/customer";
import { input, primary, TopBar } from "../ui";

type Step = { name: "phone" } | { name: "code"; phone: string; devCode?: string } | { name: "profile" };

function Login() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("suite")?.startsWith("/") ? params.get("suite")! : "/app";
  const [step, setStep] = useState<Step>({ name: "phone" });
  const [error, setError] = useState<string | null>(null);
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
      const err = e as Error & { retryIn?: number };
      if (err.retryIn) setWait(err.retryIn);
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const send = (phone: string) =>
    run(async () => {
      const r = await requestCode(phone);
      setStep({ name: "code", phone: r.phone, devCode: r.devCode });
      setWait(60);
    });

  return (
    <div>
      <TopBar title="Connexion" back={step.name === "code" ? undefined : true} />
      <div className="space-y-5 px-4 py-6">
        {step.name === "phone" && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(String(new FormData(e.currentTarget).get("phone") ?? ""));
            }}
            className="space-y-4"
          >
            <div>
              <h2 className="text-xl font-bold">Votre numéro</h2>
              <p className="text-sm text-stone-600">Nous vous envoyons un code à 6 chiffres. Pas de mot de passe à retenir.</p>
            </div>
            <div className="flex items-stretch gap-2">
              <span className="grid place-items-center rounded-xl border border-stone-300 bg-stone-100 px-3 font-medium">+228</span>
              <input name="phone" type="tel" inputMode="tel" autoComplete="tel-national" required placeholder="90 00 00 00" aria-label="Numéro de téléphone" className={input} autoFocus />
            </div>
            {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
            <button disabled={busy || wait > 0} className={primary}>
              {busy ? "Envoi…" : wait > 0 ? `Patientez ${wait} s` : "Recevoir le code"}
            </button>
            <p className="text-center text-xs text-stone-500">Vos commandes passées avec ce numéro seront retrouvées automatiquement.</p>
          </form>
        )}

        {step.name === "code" && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const code = String(new FormData(e.currentTarget).get("code") ?? "").replace(/\D/g, "");
              run(async () => {
                const r = await verifyCode(step.phone, code);
                if (r.customer.name) router.replace(next);
                else setStep({ name: "profile" });
              });
            }}
            className="space-y-4"
          >
            <div>
              <h2 className="text-xl font-bold">Code reçu</h2>
              <p className="text-sm text-stone-600">
                Envoyé au {step.phone.replace(/^\+228(\d{2})(\d{2})(\d{2})(\d{2})$/, "$1 $2 $3 $4")}. Valable 10 minutes.{" "}
                <button type="button" onClick={() => setStep({ name: "phone" })} className="text-emerald-700 underline">
                  Changer
                </button>
              </p>
            </div>
            {step.devCode && (
              <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
                Mode test, aucun SMS n&apos;est envoyé. Votre code : <strong className="font-mono text-base tracking-widest">{step.devCode}</strong>
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
            {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
            <button disabled={busy} className={primary}>
              {busy ? "Vérification…" : "Valider"}
            </button>
            <button type="button" disabled={busy || wait > 0} onClick={() => send(step.phone)} className="w-full text-center text-sm text-emerald-700 disabled:text-stone-400">
              {wait > 0 ? `Renvoyer le code dans ${wait} s` : "Renvoyer le code"}
            </button>
          </form>
        )}

        {step.name === "profile" && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const name = String(new FormData(e.currentTarget).get("name") ?? "");
              run(async () => {
                const p = await customerFetch<{ phone: string; name: string }>("/me", { method: "PATCH", body: { name } });
                const s = getSession();
                if (s) saveSession({ ...s, name: p.name });
                router.replace(next);
              });
            }}
            className="space-y-4"
          >
            <div>
              <h2 className="text-xl font-bold">Bienvenue sur Zedeka</h2>
              <p className="text-sm text-stone-600">Comment doit-on vous appeler ? Le livreur utilisera ce nom.</p>
            </div>
            <input name="name" required minLength={2} autoComplete="name" placeholder="Prénom et nom" className={input} autoFocus />
            {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
            <button disabled={busy} className={primary}>
              Continuer
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <Login />
    </Suspense>
  );
}
