"use client";

import { useEffect, useState } from "react";
import { customerFetch, useSession } from "@/lib/customer";
import { useT } from "@/lib/i18n/client";
import { Icon } from "./panel/icons";
import { usePush } from "./panel/partner";

// Notifications de suivi pour le client connecté : Firebase dans l'application Zedeka, Web Push dans le navigateur.
const api = { apiFetch: customerFetch };
const ASKED_KEY = "zedeka.customerPushAsked";

// Proposé sur le suivi d'une commande en cours, tant que les notifications ne sont ni activées ni refusées.
export function CustomerPushPrompt() {
  const session = useSession();
  return session ? <Prompt /> : null;
}

function Prompt() {
  const t = useT();
  const push = usePush(api);
  const [dismissed, setDismissed] = useState(true);
  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(ASKED_KEY) === "1");
    } catch {
      setDismissed(false);
    }
  }, []);
  const dismiss = () => {
    try {
      localStorage.setItem(ASKED_KEY, "1");
    } catch {
      // stockage indisponible : la proposition reviendra
    }
    setDismissed(true);
  };
  if (dismissed || push.state !== "off") return null;
  return (
    <section className="flex flex-wrap items-center gap-3 rounded-[12px] bg-emerald-50 p-4 text-emerald-950">
      <Icon name="bell" className="h-6 w-6 shrink-0 text-emerald-700" />
      <p className="min-w-48 flex-1 text-[15px]">{t("Soyez prévenu à chaque étape de votre commande, même application fermée.")}</p>
      <button onClick={() => push.enable().then((ok) => ok && dismiss())} className="rounded-full bg-emerald-600 px-4 py-2 font-semibold text-white">
        {t("Activer")}
      </button>
      <button onClick={dismiss} className="px-2 py-2 text-emerald-800">
        {t("Plus tard")}
      </button>
    </section>
  );
}

// Réglage dans le profil : activer, couper, tester.
export function CustomerPushSetting({ className = "" }: { className?: string }) {
  const t = useT();
  const push = usePush(api);
  const [tested, setTested] = useState<string | null>(null);
  if (push.state === "loading") return null;
  return (
    <section className={`space-y-2 p-4 ${className}`}>
      <div className="flex items-center gap-3">
        <Icon name="bell" className="h-5 w-5 shrink-0 text-emerald-700" />
        <div className="flex-1">
          <p className="font-semibold">{t("Notifications de commande")}</p>
          <p className="text-sm text-stone-500">
            {push.state === "on"
              ? t("Activées sur cet appareil.")
              : push.state === "denied"
                ? t("Bloquées : autorisez les notifications de Zedeka dans les réglages du téléphone ou du navigateur.")
                : push.state === "unsupported"
                  ? t("Cet appareil ne permet pas les notifications.")
                  : t("Commande acceptée, livreur en route, commande livrée.")}
          </p>
        </div>
        {push.state === "off" && (
          <button onClick={() => push.enable()} className="rounded-full bg-emerald-600 px-3 py-2 text-sm font-semibold text-white">
            {t("Activer")}
          </button>
        )}
        {push.state === "on" && (
          <button onClick={() => push.disable()} className="rounded-xl bg-stone-100 px-3 py-2 text-sm font-semibold text-stone-700">
            {t("Couper")}
          </button>
        )}
      </div>
      {push.state === "on" && (
        <button
          onClick={() =>
            push.test().then(
              (r) => setTested(r.sent ? t("Notification envoyée.") : t("Rien n'est parti : réessayez dans un instant.")),
              () => setTested(t("Rien n'est parti : réessayez dans un instant.")),
            )
          }
          className="text-sm font-medium text-emerald-700 underline"
        >
          {t("Envoyer une notification d'essai")}
        </button>
      )}
      {tested && <p className="text-sm text-stone-500">{tested}</p>}
    </section>
  );
}
