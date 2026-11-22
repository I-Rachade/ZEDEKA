"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/components/panel/icons";
import { customerFetch, useSession } from "@/lib/customer";
import { useHydrated } from "@/lib/device";
import { useT } from "@/lib/i18n/client";
import { card, input, primary, secondary, TopBar } from "../ui";

// Parrainage : le client partage son code ; chaque ami qui reçoit sa première commande lui offre une livraison.
// Un nouveau client peut aussi indiquer le code de l'ami qui l'a invité (avant sa première commande livrée).
export type Referral = { code: string; invited: number; rewarded: number; freeDeliveries: number; sponsored: boolean; canEnterCode: boolean };

export default function ReferralPage() {
  const t = useT();
  const hydrated = useHydrated();
  const session = useSession();
  const [data, setData] = useState<Referral | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [friendCode, setFriendCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(() => {
    customerFetch<Referral>("/referral")
      .then(setData)
      .catch((e) => setError((e as Error).message));
  }, []);
  useEffect(() => {
    if (session) load();
  }, [session, load]);

  const link = typeof window === "undefined" ? "" : `${window.location.origin}/app`;
  const message = data ? t("Je commande mes repas et colis avec Zedeka. Inscris-toi et entre mon code {code} dans Profil > Parrainage : ta première livraison est offerte. {link}", { code: data.code, link }) : "";

  async function enterCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await customerFetch("/referral", { method: "POST", body: { code: friendCode } });
      setDone(true);
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(data.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Presse-papiers refusé : le code reste lisible à l'écran.
    }
  }

  return (
    <div>
      <TopBar title="Parrainage" back="/app/profil" />
      <div className="space-y-4 px-4 py-4">
        {!hydrated ? null : !session ? (
          <section className={`${card} space-y-3 p-4`}>
            <p className="font-semibold">{t("Invitez vos amis, gagnez des livraisons")}</p>
            <p className="text-sm text-stone-600">{t("Connectez-vous pour obtenir votre code de parrainage.")}</p>
            <Link href="/app/connexion?suite=/app/parrainage" className={primary}>
              {t("Se connecter")}
            </Link>
          </section>
        ) : (
          <>
            <section className={`${card} space-y-3 p-4 text-center`}>
              <p className="text-[15px] text-stone-600">{t("Une livraison offerte pour chaque ami qui reçoit sa première commande.")}</p>
              <button type="button" onClick={copy} className="mx-auto block rounded-2xl bg-emerald-50 px-6 py-3 font-mono text-3xl font-bold tracking-[0.2em] text-emerald-800" aria-label={t("Copier mon code")}>
                {data?.code ?? "······"}
              </button>
              <p className="text-xs text-stone-500">{copied ? t("Code copié") : t("Touchez le code pour le copier")}</p>
              {data && (
                <a href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noopener noreferrer" className={primary}>
                  <Icon name="share" className="h-5 w-5" /> {t("Partager sur WhatsApp")}
                </a>
              )}
            </section>

            {data && (
              <section className={`${card} grid grid-cols-3 divide-x divide-stone-100 py-3 text-center`}>
                <div>
                  <p className="text-2xl font-bold">{data.invited}</p>
                  <p className="text-xs text-stone-600">{t("amis inscrits")}</p>
                </div>
                <div>
                  <p className="text-2xl font-bold">{data.rewarded}</p>
                  <p className="text-xs text-stone-600">{t("premières commandes")}</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-emerald-700">{data.freeDeliveries}</p>
                  <p className="text-xs text-stone-600">{t("livraisons offertes")}</p>
                </div>
              </section>
            )}
            {data && data.freeDeliveries > 0 && (
              <p className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900">{t("Utilisez vos livraisons offertes à la caisse d'une commande livrée, avec « Utiliser une livraison offerte ».")}</p>
            )}

            {data?.canEnterCode && !done && (
              <form onSubmit={enterCode} className={`${card} space-y-3 p-4`}>
                <p className="font-semibold">{t("Un ami vous a invité ?")}</p>
                <p className="text-sm text-stone-600">{t("Entrez son code avant votre première commande : il gagnera une livraison offerte quand vous serez livré.")}</p>
                <input
                  value={friendCode}
                  onChange={(e) => setFriendCode(e.target.value.toUpperCase())}
                  aria-label={t("Code de votre ami")}
                  placeholder={t("ex. AMA234")}
                  autoCapitalize="characters"
                  maxLength={20}
                  className={`${input} font-mono uppercase`}
                />
                <button className={secondary} disabled={!friendCode.trim() || busy}>
                  {busy ? "…" : t("Valider le code")}
                </button>
              </form>
            )}
            {(done || data?.sponsored) && <p className="rounded-xl bg-stone-100 p-3 text-sm text-stone-700">{t("Le code de votre ami est enregistré. Merci !")}</p>}
            {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
          </>
        )}
      </div>
    </div>
  );
}
