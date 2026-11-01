"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import styles from "./page.module.css";
import {
  BUSINESS_TYPES,
  DOC_TYPES,
  IMAGE_TYPES,
  MOMO_OPERATORS,
  PASSWORD_RULES,
  validateStep1,
  validateStep2,
  type Errors,
  type FormValues,
} from "./validation";

import { API_URL } from "@/lib/api";
import { useT } from "@/lib/i18n/client";

type Zone = { id: string; name: string };
type Plan = {
  id: string;
  name: string;
  description: string;
  commissionPercent: number;
  monthlyFee: number;
  features: string[];
};

const EMPTY: FormValues = {
  businessName: "",
  businessType: "",
  zoneId: "",
  address: "",
  latitude: "",
  longitude: "",
  deliveryTimeMin: "20",
  deliveryTimeMax: "40",
  logo: null,
  cover: null,
  ownerFirstName: "",
  ownerLastName: "",
  phone: "",
  whatsapp: "",
  momoOperator: "",
  momoNumber: "",
  rccm: "",
  nif: "",
  legalDoc: null,
  email: "",
  password: "",
  passwordConfirm: "",
  plan: "",
  termsAccepted: false,
};

const STEPS = ["Votre commerce", "Votre formule", "Confirmation"];

// Libellés, aides et erreurs arrivent en français et sont traduits par Section et Field.

const fcfa = (n: number) => `${n.toLocaleString("fr-FR")} FCFA`;

export default function VendorApplyForm() {
  const t = useT();
  const [step, setStep] = useState(0);
  const [values, setValues] = useState<FormValues>(EMPTY);
  const [errors, setErrors] = useState<Errors>({});
  const [zones, setZones] = useState<Zone[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [reference, setReference] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch(`${API_URL}/api/zones`).then((r) => (r.ok ? r.json() : Promise.reject())),
      fetch(`${API_URL}/api/vendor-plans`).then((r) => (r.ok ? r.json() : Promise.reject())),
    ])
      .then(([z, p]) => {
        setZones(z);
        setPlans(p);
        // Une seule formule (abonnement) : elle est choisie d'office.
        if (p.length === 1) setValues((v) => ({ ...v, plan: v.plan || p[0].id }));
      })
      .catch(() => setLoadError(t("Impossible de charger les zones. Réessayez plus tard.")));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chargé une fois
  }, []);

  function set<K extends keyof FormValues>(key: K, value: FormValues[K]) {
    setValues((v) => ({ ...v, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  }

  function locate() {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        set("latitude", pos.coords.latitude.toFixed(6));
        set("longitude", pos.coords.longitude.toFixed(6));
        setLocating(false);
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  function next() {
    const e = validateStep1(values);
    setErrors(e);
    if (Object.keys(e).length === 0) {
      setStep(1);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } else {
      document.querySelector('[aria-invalid="true"]')?.scrollIntoView({ block: "center" });
    }
  }

  async function submit() {
    const e = validateStep2(values);
    setErrors(e);
    if (Object.keys(e).length) return;

    setSubmitting(true);
    setSubmitError(null);
    const body = new FormData();
    for (const [key, value] of Object.entries(values)) {
      if (key === "passwordConfirm" || value === null || value === "") continue;
      body.append(key, value instanceof File ? value : String(value));
    }
    try {
      const res = await fetch(`${API_URL}/api/vendor-applications`, { method: "POST", body });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.errors) {
          setErrors(data.errors);
          // Les erreurs de champs viennent presque toutes de l'étape 1.
          if (Object.keys(data.errors).some((k) => k !== "plan" && k !== "termsAccepted")) setStep(0);
        }
        setSubmitError(data.message ?? t("L'envoi a échoué. Réessayez."));
        return;
      }
      setReference(data.reference);
      setStep(2);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      setSubmitError(t("Connexion impossible. Vérifiez votre réseau et réessayez."));
    } finally {
      setSubmitting(false);
    }
  }

  function reset() {
    setValues(EMPTY);
    setErrors({});
  }

  const text = (
    key: keyof FormValues,
    label: string,
    opts: { type?: string; required?: boolean; placeholder?: string; autoComplete?: string; hint?: string } = {},
  ) => (
    <Field label={label} required={opts.required} error={errors[key]} hint={opts.hint} htmlFor={key}>
      <input
        id={key}
        type={opts.type ?? "text"}
        value={values[key] as string}
        placeholder={opts.placeholder && t(opts.placeholder)}
        autoComplete={opts.autoComplete}
        aria-invalid={!!errors[key]}
        onChange={(e) => set(key, e.target.value)}
      />
    </Field>
  );

  return (
    <div className={styles.card}>
      <ol className={styles.stepper}>
        {STEPS.map((label, i) => (
          <li key={label} className={i === step ? styles.stepActive : i < step ? styles.stepDone : undefined}>
            <span className={styles.stepNum}>{i < step ? "✓" : i + 1}</span>
            {t(label)}
          </li>
        ))}
      </ol>

      {loadError && step < 2 && <p className={styles.alert}>{loadError}</p>}

      {step === 0 && (
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            next();
          }}
        >
          <Section title="Le commerce">
            <div className={styles.grid}>
              {text("businessName", "Nom du commerce", { required: true, placeholder: "Ex. Chez Tantie Ama" })}
              <Field label="Type de commerce" required error={errors.businessType} htmlFor="businessType">
                <select
                  id="businessType"
                  value={values.businessType}
                  aria-invalid={!!errors.businessType}
                  onChange={(e) => set("businessType", e.target.value)}
                >
                  <option value="">{t("Choisir…")}</option>
                  {BUSINESS_TYPES.map((b) => (
                    <option key={b.value} value={b.value}>
                      {t(b.label)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field
                label="Zone"
                required
                error={errors.zoneId}
                htmlFor="zoneId"
                hint="Quartier depuis lequel vous préparez les commandes"
              >
                <select
                  id="zoneId"
                  value={values.zoneId}
                  aria-invalid={!!errors.zoneId}
                  onChange={(e) => set("zoneId", e.target.value)}
                >
                  <option value="">{t("Choisir une zone…")}</option>
                  {zones.map((z) => (
                    <option key={z.id} value={z.id}>
                      {z.name}
                    </option>
                  ))}
                </select>
              </Field>
              {text("address", "Adresse ou repère", {
                required: true,
                placeholder: "Ex. Rue de la pharmacie du Bè, face station",
              })}
            </div>

            <div className={styles.locate}>
              <button type="button" className={styles.secondary} onClick={locate} disabled={locating}>
                {locating ? t("Localisation…") : `📍 ${t("Utiliser ma position actuelle")}`}
              </button>
              <span className={styles.hint}>
                {values.latitude
                  ? t("Position enregistrée : {lat}, {lng}", { lat: values.latitude, lng: values.longitude })
                  : t("Facultatif : à faire depuis votre commerce, pour guider les livreurs.")}
              </span>
            </div>

            <Field
              label="Temps de préparation et livraison (minutes)"
              required
              error={errors.deliveryTimeMin ?? errors.deliveryTimeMax}
            >
              <div className={styles.range}>
                <input
                  type="number"
                  inputMode="numeric"
                  min={5}
                  max={180}
                  aria-label={t("Minimum")}
                  value={values.deliveryTimeMin}
                  aria-invalid={!!errors.deliveryTimeMin}
                  onChange={(e) => set("deliveryTimeMin", e.target.value)}
                />
                <span>{t("à")}</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={5}
                  max={180}
                  aria-label={t("Maximum")}
                  value={values.deliveryTimeMax}
                  aria-invalid={!!errors.deliveryTimeMax}
                  onChange={(e) => set("deliveryTimeMax", e.target.value)}
                />
                <span>min</span>
              </div>
            </Field>
          </Section>

          <Section title="Images">
            <div className={styles.grid}>
              <FileField
                id="logo"
                label="Logo (carré)"
                required
                accept={IMAGE_TYPES}
                hint="JPG, PNG ou WebP, 2 Mo max"
                file={values.logo}
                error={errors.logo}
                onChange={(f) => set("logo", f)}
                preview="square"
              />
              <FileField
                id="cover"
                label="Photo de couverture (2:1)"
                required
                accept={IMAGE_TYPES}
                hint="JPG, PNG ou WebP, 2 Mo max"
                file={values.cover}
                error={errors.cover}
                onChange={(f) => set("cover", f)}
                preview="wide"
              />
            </div>
          </Section>

          <Section title="Le responsable">
            <div className={styles.grid}>
              {text("ownerFirstName", "Prénom", { required: true, autoComplete: "given-name" })}
              {text("ownerLastName", "Nom", { required: true, autoComplete: "family-name" })}
              {text("phone", "Téléphone", {
                required: true,
                type: "tel",
                placeholder: "90 12 34 56",
                autoComplete: "tel-national",
              })}
              {text("whatsapp", "WhatsApp (si différent)", { type: "tel", placeholder: "90 12 34 56" })}
            </div>
          </Section>

          <Section title="Paiement Mobile Money" subtitle="Vos reversements seront envoyés sur ce compte.">
            <div className={styles.grid}>
              <Field label="Opérateur" required error={errors.momoOperator}>
                <div className={styles.choices} role="radiogroup">
                  {MOMO_OPERATORS.map((o) => (
                    <label key={o.value} className={values.momoOperator === o.value ? styles.choiceOn : styles.choice}>
                      <input
                        type="radio"
                        name="momoOperator"
                        value={o.value}
                        checked={values.momoOperator === o.value}
                        onChange={() => set("momoOperator", o.value)}
                      />
                      {t(o.label)}
                    </label>
                  ))}
                </div>
              </Field>
              {text("momoNumber", "Numéro Mobile Money", { required: true, type: "tel", placeholder: "90 12 34 56" })}
            </div>
          </Section>

          <Section title="Documents légaux" subtitle="Facultatif pour le pilote, mais accélère la validation.">
            <div className={styles.grid}>
              {text("rccm", "N° RCCM")}
              {text("nif", "N° NIF")}
              <FileField
                id="legalDoc"
                label="Justificatif (RCCM, carte d'opérateur…)"
                accept={DOC_TYPES}
                hint="PDF, JPG ou PNG, 2 Mo max"
                file={values.legalDoc}
                error={errors.legalDoc}
                onChange={(f) => set("legalDoc", f)}
              />
            </div>
          </Section>

          <Section title="Votre compte" subtitle="Pour vous connecter à l'espace partenaire une fois validé.">
            <div className={styles.grid}>
              {text("email", "E-mail", { required: true, type: "email", autoComplete: "email" })}
              <div />
              {text("password", "Mot de passe", { required: true, type: "password", autoComplete: "new-password" })}
              {text("passwordConfirm", "Confirmer le mot de passe", {
                required: true,
                type: "password",
                autoComplete: "new-password",
              })}
            </div>
            <ul className={styles.rules}>
              {PASSWORD_RULES.map((r) => (
                <li key={r.id} className={r.test(values.password) ? styles.ruleOk : undefined}>
                  {r.test(values.password) ? "✓" : "○"} {t(r.label)}
                </li>
              ))}
            </ul>
          </Section>

          <div className={styles.actions}>
            <button type="button" className={styles.ghost} onClick={reset}>
              {t("Tout effacer")}
            </button>
            <button type="submit" className={styles.primary}>
              {t("Continuer")}
            </button>
          </div>
        </form>
      )}

      {step === 1 && (
        <div>
          <Section
            title={plans.length === 1 ? "Votre formule" : "Choisissez votre formule"}
            subtitle="Le prix peut évoluer : vous serez prévenu à l'avance."
          >
            <div className={styles.plans} role="radiogroup" aria-invalid={!!errors.plan}>
              {plans.map((p) => (
                <label key={p.id} className={values.plan === p.id ? styles.planOn : styles.plan}>
                  <input
                    type="radio"
                    name="plan"
                    value={p.id}
                    checked={values.plan === p.id}
                    onChange={() => set("plan", p.id)}
                  />
                  <strong>{p.name}</strong>
                  <span className={styles.price}>
                    {p.monthlyFee ? t("{price} / mois", { price: fcfa(p.monthlyFee) }) : t("Sans abonnement")}
                    {p.commissionPercent ? ` + ${t("{n} % par commande", { n: p.commissionPercent })}` : `, ${t("sans commission")}`}
                  </span>
                  <span className={styles.hint}>{t(p.description)}</span>
                  <ul>
                    {p.features.map((f) => (
                      <li key={f}>{t(f)}</li>
                    ))}
                  </ul>
                </label>
              ))}
            </div>
            {errors.plan && <p className={styles.error}>{t(errors.plan)}</p>}
          </Section>

          <label className={styles.terms}>
            <input
              type="checkbox"
              checked={values.termsAccepted}
              aria-invalid={!!errors.termsAccepted}
              onChange={(e) => set("termsAccepted", e.target.checked)}
            />
            <span>
              {t("J'accepte les")}{" "}
              <a href="/conditions-partenaires" target="_blank">
                {t("conditions partenaires")}
              </a>{" "}
              {t("et la")}{" "}
              <a href="/confidentialite" target="_blank">
                {t("politique de confidentialité")}
              </a>{" "}
              {t("de Zedeka.")}
            </span>
          </label>
          {errors.termsAccepted && <p className={styles.error}>{t(errors.termsAccepted)}</p>}
          {submitError && <p className={styles.alert}>{submitError}</p>}

          <div className={styles.actions}>
            <button type="button" className={styles.ghost} onClick={() => setStep(0)} disabled={submitting}>
              {t("Retour")}
            </button>
            <button type="button" className={styles.primary} onClick={submit} disabled={submitting}>
              {submitting ? t("Envoi…") : t("Envoyer ma candidature")}
            </button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className={styles.done}>
          <div className={styles.doneIcon}>✓</div>
          <h2>{t("Candidature envoyée")}</h2>
          <p>
            {t("Merci ! Votre référence :")} <strong>{reference}</strong>
          </p>
          <p className={styles.hint}>
            {t("Notre équipe vérifie votre dossier et vous contacte par téléphone ou WhatsApp sous 48 h pour activer votre espace partenaire.")}
          </p>
          <Link className={styles.primary} href="/">
            {t("Retour à l'accueil")}
          </Link>
        </div>
      )}
    </div>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  const t = useT();
  return (
    <fieldset className={styles.section}>
      <legend>{t(title)}</legend>
      {subtitle && <p className={styles.hint}>{t(subtitle)}</p>}
      {children}
    </fieldset>
  );
}

function Field({
  label,
  required,
  error,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  hint?: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  const t = useT();
  return (
    <div className={styles.field}>
      <label htmlFor={htmlFor}>
        {t(label)}
        {required && <span className={styles.req}> *</span>}
      </label>
      {children}
      {error ? <span className={styles.error}>{t(error)}</span> : hint && <span className={styles.hint}>{t(hint)}</span>}
    </div>
  );
}

function FileField({
  id,
  label,
  required,
  accept,
  hint,
  file,
  error,
  onChange,
  preview,
}: {
  id: string;
  label: string;
  required?: boolean;
  accept: string[];
  hint: string;
  file: File | null;
  error?: string;
  onChange: (f: File | null) => void;
  preview?: "square" | "wide";
}) {
  const t = useT();
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file || !preview) return setUrl(null);
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file, preview]);

  return (
    <Field label={label} required={required} error={error} hint={hint} htmlFor={id}>
      <label className={`${styles.drop} ${preview === "wide" ? styles.dropWide : ""}`} aria-invalid={!!error}>
        {/* eslint-disable-next-line @next/next/no-img-element -- aperçu local (blob:) */}
        {url ? <img src={url} alt={t("Aperçu : {label}", { label })} /> : <span>{file ? file.name : t("Cliquer pour choisir un fichier")}</span>}
        <input id={id} type="file" accept={accept.join(",")} onChange={(e) => onChange(e.target.files?.[0] ?? null)} />
      </label>
    </Field>
  );
}
