import LegalPage, { legalMetadata } from "@/components/legal/LegalPage";
import LegalNotice from "@/components/legal/LegalNotice";

export const generateMetadata = legalMetadata("Mentions légales");

export default function Page() {
  return (
    <LegalPage title="Mentions légales">
      <LegalNotice />
    </LegalPage>
  );
}
