"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { fcfa } from "@/lib/api";
import { customerFetch, useSession, type Address } from "@/lib/customer";
import { useHydrated } from "@/lib/device";
import { useI18n } from "@/lib/i18n/client";
import { useModuleText, useServices, type ModuleCode } from "@/lib/services";
import { EXTRA_NOTE, isRequestModule, NEEDS_SLOT, SLOT_TIMES, slotIso, type RequestModule, type ServiceRequest } from "@/lib/serviceRequests";
import { card, input, primary, Skeleton, TopBar } from "../../ui";

// Formulaire d'une demande de service : ce qu'il faut faire, où, quand, et l'estimation du prix. La demande part aux
// prestataires du service ; le client suit ensuite sa demande (page /app/services/demande/[id]).

type Form = {
  items: string;
  budget: number;
  shop: string;
  product: "GAS_6" | "GAS_12" | "WATER";
  quantity: number;
  brand: string;
  bags: number;
  ironing: boolean;
  hours: number;
  place: "HOME" | "OFFICE";
  rooms: number;
  trade: "PLUMBING" | "ELECTRICITY" | "OTHER";
  problem: string;
};

const START: Form = { items: "", budget: 10000, shop: "", product: "GAS_12", quantity: 1, brand: "", bags: 2, ironing: false, hours: 3, place: "HOME", rooms: 2, trade: "PLUMBING", problem: "" };

function detailsOf(code: RequestModule, f: Form) {
  if (code === "ERRAND") return { items: f.items, budget: f.budget, shop: f.shop || undefined };
  if (code === "GAS") return { product: f.product, quantity: f.quantity, brand: f.brand || undefined };
  if (code === "LAUNDRY") return { bags: f.bags, ironing: f.ironing };
  if (code === "CLEANING") return { hours: f.hours, place: f.place, rooms: f.rooms };
  return { trade: f.trade, problem: f.problem };
}

const quantityOf = (code: RequestModule, f: Form) => (code === "GAS" ? f.quantity : code === "LAUNDRY" ? f.bags : code === "CLEANING" ? f.hours : 0);

function Stepper({ label, value, min, max, unit, onChange }: { label: string; value: number; min: number; max: number; unit: string; onChange: (n: number) => void }) {
  const { t } = useI18n();
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="font-medium">{label}</span>
      <span className="flex items-center gap-2">
        <button type="button" aria-label={t("Moins")} disabled={value <= min} onClick={() => onChange(value - 1)} className="grid h-10 w-10 place-items-center rounded-[10px] bg-stone-100 text-xl font-bold disabled:opacity-30">
          −
        </button>
        <span className="min-w-16 text-center text-[17px] font-bold" aria-live="polite">
          {value} {unit}
        </span>
        <button type="button" aria-label={t("Plus")} disabled={value >= max} onClick={() => onChange(value + 1)} className="grid h-10 w-10 place-items-center rounded-[10px] bg-stone-100 text-xl font-bold disabled:opacity-30">
          +
        </button>
      </span>
    </div>
  );
}

function Choice<V extends string>({ label, value, options, onChange }: { label: string; value: V; options: { value: V; label: string; emoji?: string }[]; onChange: (v: V) => void }) {
  return (
    <fieldset>
      <legend className="mb-2 font-medium">{label}</legend>
      <div role="radiogroup" aria-label={label} className="grid grid-cols-3 gap-2">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            onClick={() => onChange(o.value)}
            className={`rounded-[12px] border-2 px-2 py-3 text-center text-[14px] font-semibold transition ${value === o.value ? "border-emerald-600 bg-emerald-50 text-emerald-900" : "border-transparent bg-stone-100 text-stone-700"}`}
          >
            {o.emoji && (
              <span className="block text-[22px]" aria-hidden="true">
                {o.emoji}
              </span>
            )}
            {o.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

// Les 7 prochains jours (Lomé : heure UTC).
function nextDays(locale: string) {
  const today = new Date();
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + i));
    const value = d.toISOString().slice(0, 10);
    const label = i === 0 ? "Aujourd'hui" : i === 1 ? "Demain" : d.toLocaleDateString(locale, { weekday: "short", day: "numeric", timeZone: "UTC" });
    return { value, label };
  });
}

export default function ServiceForm() {
  const params = useParams<{ code: string }>();
  const code = String(params.code ?? "").toUpperCase();
  const router = useRouter();
  const hydrated = useHydrated();
  const session = useSession();
  const services = useServices();
  const text = useModuleText();
  const { t, locale } = useI18n();
  const [form, setForm] = useState<Form>(START);
  const [address, setAddress] = useState("");
  const [point, setPoint] = useState<{ latitude: number; longitude: number } | null>(null);
  const [saved, setSaved] = useState<Address[]>([]);
  const [asap, setAsap] = useState(true);
  const days = useMemo(() => nextDays(locale), [locale]);
  const [day, setDay] = useState(() => days[1].value);
  const [time, setTime] = useState("09:00");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const svc = services.modules.find((m) => m.code === code);

  useEffect(() => {
    if (!session) return;
    customerFetch<Address[]>("/addresses")
      .then((list) => {
        setSaved(list);
        if (list[0]) {
          setAddress((a) => a || [list[0].quarter, list[0].landmark].filter(Boolean).join(", "));
          if (list[0].latitude !== null && list[0].longitude !== null) setPoint({ latitude: list[0].latitude, longitude: list[0].longitude });
        }
      })
      .catch(() => {});
  }, [session]);

  if (!hydrated) return null;
  if (!isRequestModule(code)) {
    return (
      <div>
        <TopBar title="Services" back="/app" />
        <p className="p-6 text-center text-stone-600">{t("Service inconnu.")}</p>
      </div>
    );
  }
  const label = text({ code: code as ModuleCode, label: svc?.label ?? code, hint: svc?.hint ?? "" });

  if (!session)
    return (
      <div>
        <TopBar title={label.label} back="/app" />
        <section className={`${card} m-4 space-y-3 p-4`}>
          <p className="font-semibold">{t("Connectez-vous pour faire une demande")}</p>
          <p className="text-sm text-stone-600">{t("Le prestataire voit votre nom et peut vous appeler pour vous trouver.")}</p>
          <Link href={`/app/connexion?suite=/app/services/${code}`} className={primary}>
            {t("Se connecter")}
          </Link>
        </section>
      </div>
    );

  if (!services.ready && !svc) return <Skeleton rows={4} />;
  if (!svc || svc.state !== "ON")
    return (
      <div>
        <TopBar title={label.label} back="/app" />
        <section className={`${card} m-4 space-y-2 p-5 text-center`}>
          <p className="text-[40px]" aria-hidden="true">
            {svc?.emoji ?? "🧰"}
          </p>
          <h2 className="text-lg font-bold">{t("Ce service n'est pas encore ouvert.")}</h2>
          <p className="text-sm text-stone-600">{t("Nous vous préviendrons dès qu'il sera disponible.")}</p>
        </section>
      </div>
    );

  const price = svc.price ?? { base: 0, unit: 0, unitLabel: null };
  const qty = quantityOf(code, form);
  const estimate = price.base + price.unit * qty;
  const needsSlot = NEEDS_SLOT.includes(code);
  const extraNote = EXTRA_NOTE[code];

  function locate() {
    if (!("geolocation" in navigator)) return setError(t("Votre téléphone ne donne pas sa position."));
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setPoint({ latitude: p.coords.latitude, longitude: p.coords.longitude });
        setAddress((a) => a || t("Ma position actuelle"));
      },
      () => setError(t("Autorisez la localisation, ou écrivez l'adresse.")),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const created = await customerFetch<ServiceRequest>("/service-requests", {
        method: "POST",
        body: {
          module: code,
          address: address.trim(),
          ...(point ?? {}),
          note: note.trim() || undefined,
          scheduledFor: needsSlot || !asap ? slotIso(day, time) : undefined,
          details: detailsOf(code as RequestModule, form),
        },
      });
      router.replace(`/app/services/demande/${created.id}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen pb-32">
      <TopBar title={label.label} back="/app" />
      <form onSubmit={submit} className="space-y-4 p-4">
        <section className="flex items-center gap-3 rounded-[12px] bg-ink-deep p-4 text-white">
          <span className="grid h-14 w-14 shrink-0 place-items-center rounded-[12px] bg-white/10 text-[30px]" aria-hidden="true">
            {svc.emoji}
          </span>
          <span>
            <span className="block text-lg font-bold">{label.label}</span>
            <span className="block text-sm text-white/75">{label.hint}</span>
          </span>
        </section>

        <section className={`${card} space-y-4 p-4`} aria-label={t("Votre demande")}>
          {code === "ERRAND" && (
            <>
              <label className="block">
                <span className="mb-1 block font-medium">{t("Votre liste de courses")}</span>
                <textarea required rows={4} maxLength={800} value={form.items} onChange={(e) => set("items", e.target.value)} placeholder={t("Ex. 5 kg de riz, 1 L d'huile, 2 boîtes de tomate")} className={input} />
              </label>
              <label className="block">
                <span className="mb-1 block font-medium">{t("Budget maximum (FCFA)")}</span>
                <input type="number" inputMode="numeric" min={500} max={200000} step={500} required value={form.budget} onChange={(e) => set("budget", Number(e.target.value))} className={input} />
              </label>
              <div className="flex gap-2">
                {[5000, 10000, 20000, 50000].map((b) => (
                  <button key={b} type="button" onClick={() => set("budget", b)} className={`flex-1 rounded-[10px] py-2 text-[13px] font-semibold ${form.budget === b ? "bg-emerald-600 text-white" : "bg-stone-100 text-stone-700"}`}>
                    {fcfa(b)}
                  </button>
                ))}
              </div>
              <label className="block">
                <span className="mb-1 block font-medium">{t("Boutique ou marché (facultatif)")}</span>
                <input maxLength={120} value={form.shop} onChange={(e) => set("shop", e.target.value)} placeholder={t("Ex. Grand Marché, supermarché Champion")} className={input} />
              </label>
            </>
          )}
          {code === "GAS" && (
            <>
              <Choice
                label={t("Que faut-il livrer ?")}
                value={form.product}
                onChange={(v) => set("product", v)}
                options={[
                  { value: "GAS_6", label: t("Gaz 6 kg"), emoji: "🔥" },
                  { value: "GAS_12", label: t("Gaz 12 kg"), emoji: "🔥" },
                  { value: "WATER", label: t("Bidon d'eau"), emoji: "💧" },
                ]}
              />
              <Stepper label={t("Quantité")} value={form.quantity} min={1} max={10} unit="×" onChange={(n) => set("quantity", n)} />
              <label className="block">
                <span className="mb-1 block font-medium">{t("Marque (facultatif)")}</span>
                <input maxLength={40} value={form.brand} onChange={(e) => set("brand", e.target.value)} placeholder={form.product === "WATER" ? "Voltic, Cristal…" : "Total, Oryx…"} className={input} />
              </label>
              <p className="text-[13px] text-stone-500">{form.product === "WATER" ? t("Préparez vos bidons vides.") : t("Préparez la bouteille vide à échanger.")}</p>
            </>
          )}
          {code === "LAUNDRY" && (
            <>
              <Stepper label={t("Sacs de linge")} value={form.bags} min={1} max={10} unit={t("sac(s)")} onChange={(n) => set("bags", n)} />
              <p className="text-[13px] text-stone-500">{t("Un sac fait environ 5 kg de linge. Retour lavé et plié sous 48 h.")}</p>
              <label className="flex items-center justify-between gap-3">
                <span className="font-medium">{t("Avec repassage")}</span>
                <input type="checkbox" checked={form.ironing} onChange={(e) => set("ironing", e.target.checked)} className="h-6 w-6 accent-emerald-600" />
              </label>
            </>
          )}
          {code === "CLEANING" && (
            <>
              <Choice
                label={t("Où ?")}
                value={form.place}
                onChange={(v) => set("place", v)}
                options={[
                  { value: "HOME", label: t("Maison"), emoji: "🏠" },
                  { value: "OFFICE", label: t("Bureau"), emoji: "🏢" },
                ]}
              />
              <Stepper label={t("Nombre de pièces")} value={form.rooms} min={1} max={20} unit="" onChange={(n) => set("rooms", n)} />
              <Stepper label={t("Durée")} value={form.hours} min={2} max={8} unit="h" onChange={(n) => set("hours", n)} />
            </>
          )}
          {code === "REPAIR" && (
            <>
              <Choice
                label={t("Type de panne")}
                value={form.trade}
                onChange={(v) => set("trade", v)}
                options={[
                  { value: "PLUMBING", label: t("Plomberie"), emoji: "🚰" },
                  { value: "ELECTRICITY", label: t("Électricité"), emoji: "💡" },
                  { value: "OTHER", label: t("Autre"), emoji: "🔧" },
                ]}
              />
              <label className="block">
                <span className="mb-1 block font-medium">{t("Décrivez le problème")}</span>
                <textarea required minLength={10} rows={3} maxLength={500} value={form.problem} onChange={(e) => set("problem", e.target.value)} placeholder={t("Ex. le robinet de la cuisine fuit depuis hier")} className={input} />
              </label>
            </>
          )}
        </section>

        <section className={`${card} space-y-3 p-4`} aria-label={t("Lieu")}>
          <h2 className="font-semibold">{code === "LAUNDRY" ? t("Où ramasser le linge ?") : t("Où ?")}</h2>
          {saved.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {saved.slice(0, 4).map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => {
                    setAddress([a.quarter, a.landmark].filter(Boolean).join(", "));
                    setPoint(a.latitude !== null && a.longitude !== null ? { latitude: a.latitude, longitude: a.longitude } : null);
                  }}
                  className="rounded-[10px] bg-stone-100 px-3 py-2 text-[13px] font-semibold text-stone-700"
                >
                  📍 {a.label}
                </button>
              ))}
            </div>
          )}
          <input required minLength={3} maxLength={200} value={address} onChange={(e) => setAddress(e.target.value)} placeholder={t("Quartier, repère (ex. Bè Kpota, près de la pharmacie)")} aria-label={t("Adresse")} className={input} />
          <button type="button" onClick={locate} className="text-[14px] font-semibold text-emerald-700">
            {point ? `✓ ${t("Position enregistrée")}` : `📍 ${t("Utiliser ma position")}`}
          </button>
        </section>

        <section className={`${card} space-y-3 p-4`} aria-label={t("Quand ?")}>
          <h2 className="font-semibold">{t("Quand ?")}</h2>
          {!needsSlot && (
            <div role="radiogroup" aria-label={t("Quand ?")} className="flex gap-1 rounded-[12px] bg-stone-100 p-1">
              {[
                { v: true, l: t("Dès que possible") },
                { v: false, l: t("Choisir un créneau") },
              ].map((o) => (
                <button key={String(o.v)} type="button" role="radio" aria-checked={asap === o.v} onClick={() => setAsap(o.v)} className={`flex-1 rounded-[8px] py-2 text-sm font-semibold ${asap === o.v ? "bg-surface shadow-sm" : "text-stone-600"}`}>
                  {o.l}
                </button>
              ))}
            </div>
          )}
          {(needsSlot || !asap) && (
            <>
              <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
                {days.map((d) => (
                  <button key={d.value} type="button" onClick={() => setDay(d.value)} className={`shrink-0 rounded-[10px] px-3 py-2 text-[13px] font-semibold ${day === d.value ? "bg-emerald-600 text-white" : "bg-stone-100 text-stone-700"}`}>
                    {t(d.label)}
                  </button>
                ))}
              </div>
              <label className="flex items-center justify-between gap-3">
                <span className="font-medium">{t("Heure")}</span>
                <select value={time} onChange={(e) => setTime(e.target.value)} className="rounded-[10px] bg-stone-100 px-3 py-2 font-semibold">
                  {SLOT_TIMES.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
          <label className="block">
            <span className="mb-1 block text-sm text-stone-600">{t("Précision pour le prestataire (facultatif)")}</span>
            <input maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("Ex. portail bleu, appelez en arrivant")} className={input} />
          </label>
        </section>

        <section className="space-y-1 rounded-[12px] bg-emerald-50 p-4 text-emerald-950" aria-label={t("Estimation")}>
          <p className="flex items-baseline justify-between">
            <span className="font-semibold">{t("Estimation")}</span>
            <span className="text-[22px] font-bold" data-testid="estimate">
              {fcfa(estimate)}
            </span>
          </p>
          <p className="text-[13px] text-emerald-900/80">
            {[price.base ? `${t("Base")} ${fcfa(price.base)}` : null, price.unit && qty ? `${qty} × ${fcfa(price.unit)}` : null].filter(Boolean).join(" + ")}
          </p>
          {extraNote && <p className="text-[13px] text-emerald-900/80">{t(extraNote)}</p>}
          <p className="text-[13px] text-emerald-900/80">{t("Vous payez le prestataire à la fin, en espèces ou mobile money.")}</p>
        </section>

        {error && (
          <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">
            {error}
          </p>
        )}
        <div className="glass fixed inset-x-0 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-30 mx-auto max-w-md px-4 py-3">
          <button type="submit" disabled={busy} className={primary}>
            {busy ? t("Envoi…") : `${t("Envoyer la demande")} · ${fcfa(estimate)}`}
          </button>
        </div>
      </form>
    </div>
  );
}
