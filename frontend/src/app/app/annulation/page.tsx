import LegalPage, { legalMetadata } from "@/components/legal/LegalPage";
import RefundPolicy from "@/components/legal/RefundPolicy";
import { getLang } from "@/lib/i18n/server";
import { getPolicies } from "../policies";

export const generateMetadata = legalMetadata("Annulation et remboursement");

export default async function Page() {
  const [p, lang] = await Promise.all([getPolicies(), getLang()]);
  return (
    <LegalPage title="Annulation et remboursement" app frenchOnly={false}>
      <RefundPolicy lang={lang} minutes={p?.freeCancellationMinutes ?? 5} percent={p?.cancellationFeePercent ?? 50} />
    </LegalPage>
  );
}
