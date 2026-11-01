"use client";

import Link from "next/link";
import { Icon } from "@/components/panel/icons";
import { card, primary } from "@/app/app/ui";
import { useStored } from "@/lib/device";
import { APPLICATION_KEY, type Application } from "@/lib/driver";
import { useI18n } from "@/lib/i18n/client";

const STATES: Record<Application["status"], { title: string; text: string; tone: string }> = {
  PENDING: {
    title: "Candidature en cours d'examen",
    text: "L'équipe Zedeka vérifie votre dossier et vous appellera pour un rendez-vous. Vous pourrez vous connecter dès que votre compte sera validé.",
    tone: "bg-amber-100 text-amber-800",
  },
  REJECTED: {
    title: "Candidature non retenue",
    text: "Votre candidature n'a pas été retenue pour le moment. Pour en savoir plus, contactez l'équipe Zedeka.",
    tone: "bg-red-100 text-red-700",
  },
  SUSPENDED: {
    title: "Compte suspendu",
    text: "Votre compte livreur est désactivé. Appelez la répartition pour le réactiver.",
    tone: "bg-stone-200 text-stone-700",
  },
};

// Où en est la candidature d'un livreur qui s'est identifié avec son numéro.
export default function ApplicationStatus() {
  const app = useStored<Application>(APPLICATION_KEY);
  const state = app ? STATES[app.status] : null;
  const { t, locale } = useI18n();

  return (
    <div className="space-y-5 px-5 py-8">
      <h1 className="text-2xl font-bold">{t("Ma candidature")}</h1>
      {app && state ? (
        <div className={`${card} space-y-3 p-5`}>
          <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold ${state.tone}`}>
            <Icon name={app.status === "PENDING" ? "clock" : "close"} className="h-4 w-4" />
            {t(state.title)}
          </span>
          <p className="font-medium">{app.name}</p>
          <p className="text-sm text-stone-500">{t("Envoyée le {date}", { date: new Date(app.createdAt).toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric" }) })}</p>
          <p className="text-sm text-stone-700">{t(state.text)}</p>
        </div>
      ) : (
        <div className={`${card} space-y-3 p-5`}>
          <p className="text-sm text-stone-700">{t("Connectez-vous avec le numéro de votre candidature pour voir où elle en est.")}</p>
        </div>
      )}
      <Link href="/livreur/connexion" className={primary}>
        {t("Se connecter avec un autre numéro")}
      </Link>
    </div>
  );
}
