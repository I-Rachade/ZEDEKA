import LegalPage, { legalMetadata } from "@/components/legal/LegalPage";
import CookiePolicy from "@/components/legal/CookiePolicy";

export const generateMetadata = legalMetadata("Politique relative aux cookies");

export default function Page() {
  return (
    <LegalPage title="Politique relative aux cookies">
      <CookiePolicy />
    </LegalPage>
  );
}
