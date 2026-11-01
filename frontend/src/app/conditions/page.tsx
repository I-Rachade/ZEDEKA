import LegalPage, { legalMetadata } from "@/components/legal/LegalPage";
import Terms from "@/components/legal/Terms";

export const generateMetadata = legalMetadata("Conditions générales");

export default function Page() {
  return (
    <LegalPage title="Conditions générales">
      <Terms />
    </LegalPage>
  );
}
