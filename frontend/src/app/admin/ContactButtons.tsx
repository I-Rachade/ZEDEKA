"use client";

import Link from "next/link";
import { Icon } from "@/components/panel/icons";
import { telLink, whatsappLink, type RequestSource } from "@/lib/admin";
import { useT } from "@/lib/i18n/client";

const small = "inline-flex items-center gap-1 rounded-lg border border-stone-300 bg-white px-2 py-1 text-xs font-medium hover:bg-stone-50";

// Appel depuis le téléphone de la managerin, appel ou message WhatsApp (application WhatsApp de son téléphone),
// et saisie d'une demande liée. Rien ne passe par la plateforme : pas d'enregistrement ni de coût d'appel.
export function ContactButtons({
  phone,
  message,
  request,
}: {
  phone: string | null | undefined;
  message?: string;
  request?: { source: RequestSource; name?: string | null; orderId?: string; restaurantId?: string; subject?: string };
}) {
  const t = useT();
  if (!phone) return null;
  const params = request
    ? new URLSearchParams(
        Object.entries({ source: request.source, phone, name: request.name ?? "", orderId: request.orderId ?? "", restaurantId: request.restaurantId ?? "", subject: request.subject ?? "" }).filter(
          ([, v]) => v,
        ),
      )
    : null;
  return (
    <div className="mt-1 flex flex-wrap gap-1.5 print:hidden">
      <a href={telLink(phone)} className={small}>
        <Icon name="phone" className="h-3.5 w-3.5" /> {t("Appeler")}
      </a>
      <a href={whatsappLink(phone)} target="_blank" rel="noopener noreferrer" className={`${small} border-emerald-300 text-emerald-800`}>
        {t("WhatsApp")}
      </a>
      {message && (
        <a href={whatsappLink(phone, message)} target="_blank" rel="noopener noreferrer" className={`${small} border-emerald-300 text-emerald-800`}>
          <Icon name="mail" className="h-3.5 w-3.5" /> {t("Message prêt")}
        </a>
      )}
      {params && (
        <Link href={`/admin/demandes?${params}`} className={small}>
          <Icon name="plus" className="h-3.5 w-3.5" /> {t("Noter une demande")}
        </Link>
      )}
    </div>
  );
}
