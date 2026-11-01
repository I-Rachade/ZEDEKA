"use client";

import TermsConsent from "@/components/legal/TermsConsent";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import Logo from "@/components/Logo";
import PinField from "@/components/PinField";
import { Icon, type IconName } from "@/components/panel/icons";
import { customerFetch, getSession, pinLogin, requestCode, requestEmailCode, saveSession, setPin, verifyCode, verifyEmailCode } from "@/lib/customer";
import { LanguageSwitch, useT } from "@/lib/i18n/client";
import { card, input, primary, TopBar } from "../ui";

// Compte client : connexion par numéro ou e-mail et code PIN, inscription avec un code SMS,
// PIN oublié par SMS ou par e-mail.

type Via = "phone" | "email";
type Sent = { via: Via; id: string; devCode?: string };
type View =
  | { name: "login" }
  | { name: "register" }
  | { name: "code"; phone: string; devCode?: string; person: string; email?: string }
  | { name: "pin" }
  | { name: "forgot"; noPin?: boolean; phone?: string }
  | { name: "profile" };

const prettyPhone = (phone: string) => phone.replace(/^\+228(\d{2})(\d{2})(\d{2})(\d{2})$/, "$1 $2 $3 $4");
const field = (form: HTMLFormElement, name: string) => String(new FormData(form).get(name) ?? "").trim();

function Login() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("suite")?.startsWith("/") ? params.get("suite")! : "/app";
  // Depuis le profil, « Créer mon code PIN » ouvre directement l'envoi du code au numéro du compte.
  const [view, setView] = useState<View>(() =>
    params.get("pin") === "creer" ? { name: "forgot", noPin: true, phone: prettyPhone(getSession()?.phone ?? "") || undefined } : { name: "login" },
  );
  const [via, setVia] = useState<Via>("phone");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(0);
  // Numéro saisi à la connexion, repris si le client doit d'abord créer son PIN.
  const lastPhone = useRef<string | undefined>(undefined);
  const t = useT();

  useEffect(() => {
    if (wait <= 0) return;
    const timer = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);

  function go(v: View) {
    setError(null);
    setView(v);
  }

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      const err = e as Error & { retryIn?: number; noPin?: boolean };
      if (err.retryIn) setWait(err.retryIn);
      // Client d'avant le PIN : il crée le sien après un code SMS.
      if (err.noPin) return go({ name: "forgot", noPin: true, phone: lastPhone.current });
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const done = (name: string | null) => (name ? router.replace(next) : go({ name: "profile" }));
  const tabs = view.name === "login" || view.name === "register";
  const back = tabs ? undefined : () => go({ name: "login" });

  return (
    <div>
      <TopBar title={view.name === "forgot" && !view.noPin ? t("Code PIN oublié") : t("Mon compte")} back={tabs ? true : undefined} onBack={view.name === "profile" ? undefined : back} action={<LanguageSwitch className="mr-2" />} />
      <div className="space-y-5 px-4 py-6">
        {tabs && (
          <>
            <Logo tagline />
            <Segmented
              options={[t("Connexion"), t("Inscription")]}
              active={view.name === "login" ? 0 : 1}
              onChange={(i) => go({ name: i === 0 ? "login" : "register" })}
            />
          </>
        )}

        {view.name === "login" && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const pin = field(form, "pin");
              const id = field(form, "id");
              lastPhone.current = via === "phone" ? id : undefined;
              run(async () => {
                const r = await pinLogin(via === "phone" ? { phone: id } : { email: id }, pin);
                done(r.customer.name);
              });
            }}
            className="space-y-4"
          >
            <ViaChoice via={via} onChange={setVia} />
            <Identifier via={via} />
            <PinField name="pin" label={t("Code PIN")} hint={t("4 chiffres")} />
            <div className="text-right">
              <button type="button" onClick={() => go({ name: "forgot" })} className="text-[15px] font-semibold text-emerald-700">
                {t("Code PIN oublié ?")}
              </button>
            </div>
            <ErrorNote message={error} />
            <button disabled={busy} className={primary}>
              {busy ? t("Connexion…") : t("Se connecter")}
            </button>
          </form>
        )}

        {view.name === "register" && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const person = field(form, "name");
              const email = field(form, "email") || undefined;
              run(async () => {
                const r = await requestCode(field(form, "id"));
                setWait(60);
                go({ name: "code", phone: r.phone, devCode: r.devCode, person, email });
              });
            }}
            className="space-y-4"
          >
            <Labeled label={t("Prénom et nom")}>
              <input name="name" required minLength={2} autoComplete="name" placeholder={t("Prénom et nom")} className={input} />
            </Labeled>
            <Labeled label={t("Numéro de téléphone")} note={t("Nous y envoyons un code de vérification. Le livreur vous appelle sur ce numéro.")}>
              <PhoneInput />
            </Labeled>
            <Labeled label={t("E-mail")} hint={t("facultatif")}>
              <input name="email" type="email" autoComplete="email" placeholder={t("pour vous connecter aussi par e-mail")} className={input} />
            </Labeled>
            <TermsConsent />
            <ErrorNote message={error} />
            <button disabled={busy || wait > 0} className={primary}>
              {busy ? t("Envoi…") : wait > 0 ? t("Patientez {n} s", { n: wait }) : t("Recevoir le code")}
            </button>
          </form>
        )}

        {view.name === "code" && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const code = field(e.currentTarget, "code").replace(/\D/g, "");
              run(async () => {
                const r = await verifyCode(view.phone, code, { name: view.person, email: view.email, acceptTerms: true });
                // Numéro qui avait déjà un compte avec un PIN : il est simplement connecté.
                if (r.customer.hasPin) router.replace(next);
                else go({ name: "pin" });
              });
            }}
            className="space-y-4"
          >
            <Steps done={2} />
            <div>
              <h2 className="text-xl font-bold">{t("Code reçu")}</h2>
              <p className="text-sm text-stone-600">
                {t("Envoyé au {phone}. Valable 10 minutes.", { phone: prettyPhone(view.phone) })}{" "}
                <button type="button" onClick={() => go({ name: "register" })} className="text-emerald-700 underline">
                  {t("Changer")}
                </button>
              </p>
            </div>
            <DevCode code={view.devCode} />
            <CodeInput autoFocus />
            <ErrorNote message={error} />
            <button disabled={busy} className={primary}>
              {busy ? t("Vérification…") : t("Valider")}
            </button>
            <button
              type="button"
              disabled={busy || wait > 0}
              onClick={() =>
                run(async () => {
                  const r = await requestCode(view.phone);
                  setWait(60);
                  setView({ ...view, devCode: r.devCode });
                })
              }
              className="w-full text-center text-sm text-emerald-700 disabled:text-stone-400"
            >
              {wait > 0 ? t("Renvoyer le code dans {n} s", { n: wait }) : t("Renvoyer le code")}
            </button>
          </form>
        )}

        {view.name === "pin" && (
          <NewPin
            busy={busy}
            error={error}
            submit={t("Créer mon compte")}
            onSubmit={(pin) =>
              run(async () => {
                await setPin(pin);
                done(getSession()?.name ?? null);
              })
            }
          >
            <Steps done={3} />
            <div>
              <h2 className="text-xl font-bold">{t("Choisissez votre code PIN")}</h2>
              <p className="text-sm text-stone-600">{t("4 chiffres, pour vous reconnecter sans attendre de SMS. Ne le donnez à personne, pas même au livreur.")}</p>
            </div>
          </NewPin>
        )}

        {view.name === "forgot" && <Forgot key={view.noPin ? "nopin" : "forgot"} noPin={view.noPin} phone={view.phone} onDone={done} />}

        {view.name === "profile" && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const name = field(e.currentTarget, "name");
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
              <h2 className="text-xl font-bold">{t("Bienvenue sur Zedeka")}</h2>
              <p className="text-sm text-stone-600">{t("Comment doit-on vous appeler ? Le livreur utilisera ce nom.")}</p>
            </div>
            <input name="name" required minLength={2} autoComplete="name" placeholder={t("Prénom et nom")} className={input} autoFocus />
            <ErrorNote message={error} />
            <button disabled={busy} className={primary}>
              {t("Continuer")}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

// PIN oublié (ou premier PIN d'un client existant) : code par SMS ou par e-mail, puis nouveau PIN.
function Forgot({ noPin, phone, onDone }: { noPin?: boolean; phone?: string; onDone: (name: string | null) => void }) {
  const t = useT();
  const [via, setVia] = useState<Via>("phone");
  const [sent, setSent] = useState<Sent | null>(null);
  // Code déjà vérifié : si le PIN est refusé (trop simple), on ne redemande pas le code.
  const [verified, setVerified] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(0);

  useEffect(() => {
    if (wait <= 0) return;
    const timer = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(timer);
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

  const send = (target: Via, id: string) =>
    run(async () => {
      const r = target === "phone" ? await requestCode(id) : await requestEmailCode(id);
      setWait(60);
      setVerified(false);
      setSent({ via: target, id: "phone" in r ? r.phone : r.email, devCode: r.devCode });
    });

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold">{noPin ? t("Créez votre code PIN") : t("Nouveau code PIN")}</h2>
        <p className="text-sm text-stone-600">
          {noPin
            ? t("Zedeka passe au code PIN : recevez un code une dernière fois, puis choisissez votre PIN.")
            : t("Recevez un code par SMS ou par e-mail, puis choisissez un nouveau PIN.")}
        </p>
      </div>

      {!sent ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(via, field(e.currentTarget, "id"));
          }}
          className="space-y-4"
        >
          <ViaChoice via={via} onChange={setVia} />
          <Identifier via={via} defaultPhone={phone} note={via === "email" ? t("L'e-mail enregistré sur votre compte.") : undefined} />
          <ErrorNote message={error} />
          <button disabled={busy || wait > 0} className={primary}>
            {busy ? t("Envoi…") : wait > 0 ? t("Patientez {n} s", { n: wait }) : via === "phone" ? t("Recevoir le code par SMS") : t("Recevoir le code par e-mail")}
          </button>
        </form>
      ) : (
        <NewPin
          busy={busy}
          error={error}
          submit={t("Enregistrer le code PIN")}
          pair={false}
          onSubmit={(pin, form) =>
            run(async () => {
              if (!verified) {
                const code = field(form, "code").replace(/\D/g, "");
                if (sent.via === "phone") await verifyCode(sent.id, code);
                else await verifyEmailCode(sent.id, code);
                setVerified(true);
              }
              await setPin(pin);
              onDone(getSession()?.name ?? null);
            })
          }
        >
          <p className="text-sm text-stone-600">
            {sent.via === "phone" ? t("Code envoyé par SMS au {phone}.", { phone: prettyPhone(sent.id) }) : t("Code envoyé à {email}, s'il correspond à un compte.", { email: sent.id })}{" "}
            <button type="button" onClick={() => setSent(null)} className="text-emerald-700 underline">
              {t("Changer")}
            </button>
          </p>
          <DevCode code={sent.devCode} email={sent.via === "email"} />
          <div className={`${card} space-y-4 p-4`}>
            {!verified && (
              <Labeled label={sent.via === "phone" ? t("Code reçu par SMS") : t("Code reçu par e-mail")}>
                <CodeInput />
              </Labeled>
            )}
            <PinPair />
          </div>
          {!verified && (
            <button
              type="button"
              disabled={busy || wait > 0}
              onClick={() => send(sent.via, sent.id)}
              className="w-full text-center text-sm text-emerald-700 disabled:text-stone-400"
            >
              {wait > 0 ? t("Renvoyer le code dans {n} s", { n: wait }) : t("Renvoyer le code")}
            </button>
          )}
        </NewPin>
      )}
      <p className="text-center text-xs text-stone-500">{t("Après 5 essais faux, le compte est bloqué 15 minutes.")}</p>
    </div>
  );
}

// Formulaire du nouveau PIN : les deux saisies doivent être identiques.
// « pair » : afficher les deux champs du PIN après le contenu (le formulaire « PIN oublié » les place lui-même dans sa carte).
function NewPin({ busy, error, submit, onSubmit, pair = true, children }: { busy: boolean; error: string | null; submit: string; onSubmit: (pin: string, form: HTMLFormElement) => void; pair?: boolean; children: React.ReactNode }) {
  const t = useT();
  const [mismatch, setMismatch] = useState(false);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const pin = field(form, "pin");
        if (pin !== field(form, "pin2")) return setMismatch(true);
        setMismatch(false);
        onSubmit(pin, form);
      }}
      className="space-y-4"
    >
      {children}
      {pair && <PinPair />}
      <ErrorNote message={mismatch ? t("Les deux codes PIN ne sont pas identiques") : error} />
      <button disabled={busy} className={primary}>
        {busy ? t("Enregistrement…") : submit}
      </button>
    </form>
  );
}

function PinPair() {
  const t = useT();
  return (
    <>
      <PinField name="pin" label={t("Nouveau code PIN")} hint={t("4 chiffres")} />
      <PinField name="pin2" label={t("Confirmez le code PIN")} />
      <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{t("Évitez 1234, 0000 ou votre année de naissance.")}</p>
    </>
  );
}

// Contrôle à deux onglets, façon iOS.
function Segmented({ options, active, onChange }: { options: string[]; active: number; onChange: (i: number) => void }) {
  return (
    <div role="tablist" className="grid grid-cols-2 rounded-[10px] bg-stone-200/80 p-[3px] text-[15px] font-semibold">
      {options.map((label, i) => (
        <button
          key={label}
          type="button"
          role="tab"
          aria-selected={i === active}
          onClick={() => onChange(i)}
          className={`rounded-[8px] py-2 transition ${i === active ? "bg-white text-ink shadow-[0_3px_8px_rgb(0_0_0/0.12),0_0_1px_rgb(0_0_0/0.04)]" : "text-stone-500"}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function ViaChoice({ via, onChange }: { via: Via; onChange: (v: Via) => void }) {
  const t = useT();
  const options: [Via, IconName, string][] = [
    ["phone", "phone", t("Téléphone")],
    ["email", "mail", t("E-mail")],
  ];
  return (
    <div className="grid grid-cols-2 gap-2 text-[15px] font-semibold">
      {options.map(([v, icon, label]) => (
        <button
          key={v}
          type="button"
          aria-pressed={via === v}
          onClick={() => onChange(v)}
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
}

function Identifier({ via, defaultPhone, note }: { via: Via; defaultPhone?: string; note?: string }) {
  const t = useT();
  return via === "phone" ? (
    <Labeled label={t("Numéro de téléphone")} note={note}>
      <PhoneInput defaultValue={defaultPhone} />
    </Labeled>
  ) : (
    <Labeled label={t("Adresse e-mail")} note={note}>
      <input key="email" name="id" type="email" required autoComplete="email" placeholder="nom@exemple.com" className={input} />
    </Labeled>
  );
}

// Togo seulement pour l'instant : l'indicatif est affiché, pas à choisir.
function PhoneInput({ defaultValue }: { defaultValue?: string }) {
  const t = useT();
  return (
    <div className="flex items-stretch gap-2">
      <span className="flex items-center gap-1.5 rounded-xl bg-stone-100 px-3 font-medium">
        <TogoFlag />
        +228
      </span>
      <input key="phone" name="id" type="tel" inputMode="tel" autoComplete="tel-national" required defaultValue={defaultValue} placeholder="90 12 34 56" aria-label={t("Numéro de téléphone")} className={input} />
    </div>
  );
}

function TogoFlag() {
  return (
    <svg viewBox="0 0 30 20" className="h-[15px] w-[22px] rounded-[3px] shadow-[0_0_0_0.5px_rgb(0_0_0/0.15)]" aria-hidden="true">
      <rect width="30" height="20" fill="#006a4e" />
      <rect y="4" width="30" height="4" fill="#ffce00" />
      <rect y="12" width="30" height="4" fill="#ffce00" />
      <rect width="12" height="12" fill="#d21034" />
      <path d="M6 2.2l1 3h3.1l-2.5 1.8 1 3L6 8.2 3.4 10l1-3L1.9 5.2H5z" fill="#fff" />
    </svg>
  );
}

function CodeInput({ autoFocus }: { autoFocus?: boolean }) {
  const t = useT();
  return (
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
      autoFocus={autoFocus}
    />
  );
}

function Labeled({ label, hint, note, children }: { label: string; hint?: string; note?: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 flex justify-between text-[13px] font-medium text-stone-600">
        <span>{label}</span>
        {hint && <span className="font-normal text-stone-500">{hint}</span>}
      </p>
      {children}
      {note && <p className="mt-1.5 text-xs text-stone-500">{note}</p>}
    </div>
  );
}

function Steps({ done }: { done: number }) {
  return (
    <div className="flex gap-2" aria-hidden="true">
      {[1, 2, 3].map((i) => (
        <span key={i} className={`h-1.5 flex-1 rounded-full ${i <= done ? "bg-emerald-600" : "bg-stone-200"}`} />
      ))}
    </div>
  );
}

function DevCode({ code, email }: { code?: string; email?: boolean }) {
  const t = useT();
  if (!code) return null;
  return (
    <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
      {email ? t("Mode test, aucun e-mail n'est envoyé. Votre code :") : t("Mode test, aucun SMS n'est envoyé. Votre code :")} <strong className="font-mono text-base tracking-widest">{code}</strong>
    </p>
  );
}

function ErrorNote({ message }: { message: string | null }) {
  return message ? <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{message}</p> : null;
}

export default function LoginPage() {
  return (
    <Suspense>
      <Login />
    </Suspense>
  );
}
