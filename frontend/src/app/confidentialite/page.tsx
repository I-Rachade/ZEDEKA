import LegalPage, { legalMetadata } from "@/components/legal/LegalPage";
import Privacy from "@/components/legal/Privacy";

export const generateMetadata = legalMetadata("Politique de confidentialité");

export default function Page() {
  return (
    <LegalPage title="Politique de confidentialité">
      <Privacy />
    </LegalPage>
  );
}
