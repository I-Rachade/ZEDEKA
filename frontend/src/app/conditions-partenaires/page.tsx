import LegalPage, { legalMetadata } from "@/components/legal/LegalPage";
import PartnerTerms from "@/components/legal/PartnerTerms";

export const generateMetadata = legalMetadata("Conditions partenaires");

export default function Page() {
  return (
    <LegalPage title="Conditions partenaires">
      <PartnerTerms />
    </LegalPage>
  );
}
