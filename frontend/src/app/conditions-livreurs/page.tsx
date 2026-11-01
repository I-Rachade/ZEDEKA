import LegalPage, { legalMetadata } from "@/components/legal/LegalPage";
import DriverTerms from "@/components/legal/DriverTerms";

export const generateMetadata = legalMetadata("Conditions livreurs");

export default function Page() {
  return (
    <LegalPage title="Conditions livreurs">
      <DriverTerms />
    </LegalPage>
  );
}
